import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseSnapshot } from '../src/domain';
import { parseSiteConfig, parseHealth, selectSignal } from '../src/site-state';
const raw = execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', `
import json,tempfile
from pathlib import Path
from datetime import datetime,timezone,timedelta
from monitor.store import Store
from monitor.engine import update
from monitor.feeds import stamp
with tempfile.TemporaryDirectory() as d:
 s=Store(Path(d)/'state.sqlite3')
 now=datetime.now(timezone.utc)
 update(s,[],now-timedelta(hours=1))
 print(json.dumps(update(s,[{'id':'123','text':'We will reset Codex limits for all users tomorrow.','postedAt':stamp(now),'url':'https://x.com/thsottiaux/status/123'}],now)))
 s.close()
`], { encoding: 'utf8' });
const data = parseSnapshot(JSON.parse(raw));
const now = Date.parse(data.checkedAt);
const health = { status: 'ok' as const, attemptedAt: data.checkedAt, posts: 1 };
test('website shows real engine score only with a matching successful collection', () => {
  const signal = selectSignal(data, health, false, now);
  assert.equal(signal.score, 85); assert.equal(signal.reachesThreshold, true);
  for (const h of [null, { ...health, status: 'unavailable' as const }, { ...health, attemptedAt: new Date(now - 1000).toISOString() }]) {
    assert.equal(selectSignal(data, h, false, now).score, null);
    assert.equal(selectSignal(data, h, false, now).summary, null);
  }
  assert.equal(selectSignal(data, health, true, now).score, null);
  assert.equal(selectSignal(data, health, false, now + 3600001).score, null);
});
test('demo, completed, retracted, future and unreviewed forecasts cannot appear current', () => {
  for (const mutate of [
    (s: typeof data) => { s.mode = 'demo'; },
    (s: typeof data) => { s.forecast!.status = s.events[0].status = 'confirmed'; },
    (s: typeof data) => { s.forecast!.status = s.events[0].status = 'retracted'; },
    (s: typeof data) => { s.events[0].reviewRequired = true; },
    (s: typeof data) => { s.events[0].type = 'limited-reset'; },
    (s: typeof data) => { s.forecast!.method = 'rules-v1'; },
    (s: typeof data) => { s.evidence[0].postedAt = new Date(now + 1).toISOString(); },
    (s: typeof data) => { s.evidence[0].kind = 'context'; },
  ]) { const copy = structuredClone(data); mutate(copy); assert.equal(selectSignal(copy, health, false, now).score, null); }
});
test('fresh collection without forecast remains healthy without inventing zero', () => {
  const signal = selectSignal({ ...data, forecast: null }, health, false, now);
  assert.equal(signal.fresh, true); assert.equal(signal.score, null);
});
test('subscription and download links only resolve to the actual first-party configuration', () => {
  const config = JSON.parse(readFileSync('public/config.json', 'utf8'));
  assert.match(parseSiteConfig(config).desktopVersion, /^\d+\.\d+\.\d+$/);
  for (const key of ['subscriptionUrl', 'macDownloadUrl', 'windowsDownloadUrl', 'releaseUrl'])
    assert.throws(() => parseSiteConfig({ ...config, [key]: 'https://evil.example/' }));
  assert.throws(() => parseHealth({ status: 'ok', attemptedAt: 'not-a-time' }));
  assert.throws(() => parseHealth({ ...health, posts: -1 }));
});
