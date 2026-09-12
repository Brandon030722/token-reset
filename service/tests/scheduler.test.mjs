import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {service} from '../worker.mjs';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of ['0001','0002','0003']) sqlite.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'));
  let now = Date.parse('2026-09-12T08:07:00Z'), githubStatus = 204, githubBody, githubError, brevoError;
  const calls = [];
  const env = {
    DB:{prepare(sql) { return {bind(...args) { const s=sqlite.prepare(sql); return {first:async()=>s.get(...args)??null,all:async()=>({results:s.all(...args)}),run:async()=>s.run(...args)}; }}; }},
    RATE_SALT:'x'.repeat(32),BREVO_API_KEY:'fake-brevo-key',BREVO_LIST_ID:'19',BREVO_FROM_EMAIL:'sender@example.com',PUBLIC_ORIGIN:'https://mail.example.com',
    GITHUB_DISPATCH_TOKEN:'fake-dispatch-token-only-for-tests',GITHUB_MONITOR_REPO:'Brandon030722/token-reset'
  };
  const app = service({clock:()=>now, fetcher:async(url,options)=>{
    calls.push({url,options});
    assert.equal(options.redirect,'manual');
    if (new URL(url).host === 'api.github.com') {
      if (githubError) throw githubError;
      return new Response(githubBody===undefined?null:JSON.stringify(githubBody),{status:githubStatus});
    }
    assert.equal(new URL(url).host,'api.brevo.com');
    assert.equal(options.headers.Authorization,undefined,'GitHub credential must never go to Brevo');
    if (brevoError) throw brevoError;
    if (url.endsWith('/contacts/user%40example.com')) return Response.json({emailBlacklisted:false,listIds:[19]});
    if (url.endsWith('/account')) return Response.json({plan:[{type:'free',creditsType:'sendLimit',credits:300}]});
    if (url.endsWith('/smtp/email')) return Response.json({messageId:'mock-only'});
    throw new Error('unexpected mock request');
  }});
  const due = () => {
    sqlite.prepare('INSERT INTO subscribers(id,email,active,unsubscribe_hash,created_at) VALUES (?,?,?,?,?)').run('subscriber','user@example.com',1,'unused-hash',now);
    sqlite.prepare('INSERT INTO schedules(subscriber_id,scope,observed_at,enabled) VALUES (?,?,?,?)').run('subscriber','scope',now-1000,1);
    sqlite.prepare('INSERT INTO jobs(id,subscriber_id,scope,window_id,label,due_at,observed_at) VALUES (?,?,?,?,?,?,?)').run('job','subscriber','scope','codex','Codex',now-1,now-1000);
  };
  return {app,env,sqlite,calls,due,run:()=>app.scheduled({},env),advance:ms=>now+=ms,
    github:(status,body)=>{githubStatus=status;githubBody=body;},githubError:error=>githubError=error,brevoError:error=>brevoError=error,
    dispatches:()=>calls.filter(c=>new URL(c.url).host==='api.github.com'),diagnostics:()=>sqlite.prepare('SELECT stage,status,code FROM mail_diagnostics ORDER BY created_at').all()};
}

test('unconfigured optional dispatcher makes no GitHub requests',async()=>{
  const f=fixture();delete f.env.GITHUB_DISPATCH_TOKEN;delete f.env.GITHUB_MONITOR_REPO;
  assert.equal((await f.run()).monitorDispatch.status,'disabled');assert.equal(f.calls.length,0);
});
test('atomic bucket claim deduplicates overlapping invocations and permits next quarter hour',async()=>{
  const f=fixture();const outcomes=await Promise.all([f.run(),f.run()]);
  assert.deepEqual(outcomes.map(o=>o.monitorDispatch.status).sort(),['accepted','duplicate']);
  assert.equal(f.dispatches().length,1);
  const {url,options}=f.dispatches()[0];
  assert.equal(url,'https://api.github.com/repos/Brandon030722/token-reset/actions/workflows/monitor.yml/dispatches');
  assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,'Bearer '+f.env.GITHUB_DISPATCH_TOKEN);
  assert.equal(options.headers['api-key'],undefined);
  assert.deepEqual(JSON.parse(options.body),{ref:'main',inputs:{test_email:false}});
  assert.equal(f.sqlite.prepare("SELECT count FROM counters WHERE key LIKE 'monitor-dispatch:%'").get().count,2);
  f.advance(15*60000);assert.equal((await f.run()).monitorDispatch.status,'accepted');assert.equal(f.dispatches().length,2);
});
test('new GitHub response requires an actual run id',async()=>{
  const f=fixture();f.github(200,{workflow_run_id:123});assert.equal((await f.run()).monitorDispatch.status,'accepted');
  const invalid=fixture();invalid.github(200,{message:'not a dispatch receipt'});
  await assert.rejects(invalid.run(),/scheduled task failed/);
  assert.deepEqual({...invalid.diagnostics()[0]},{stage:'monitor-dispatch',status:200,code:'invalid-response'});
});
test('GitHub authorization failures and redirects never count as accepted or stop weekly reminders',async()=>{
  for (const status of [401,403,302,422,500]) {
    const f=fixture();f.github(status,{message:'fake response containing sensitive material'});f.due();
    await assert.rejects(f.run(),/scheduled task failed/);
    assert.equal(f.sqlite.prepare('SELECT status FROM jobs').get().status,'submitted');
    assert.equal(f.sqlite.prepare("SELECT count FROM counters WHERE key LIKE 'monitor-dispatch:%'").get().count,3);
    assert.deepEqual({...f.diagnostics()[0]},{stage:'monitor-dispatch',status,code:'github-http-error'});
    await f.run();assert.equal(f.dispatches().length,1,'failed bucket must not be retried immediately');
    f.advance(15*60000);f.github(204);await f.run();assert.equal(f.dispatches().length,2);
  }
});
test('unknown dispatch outcomes are recorded without leaking exception text and are not retried in the same bucket',async()=>{
  const f=fixture();f.githubError(new DOMException('credential material must not reach diagnostics','TimeoutError'));
  await assert.rejects(f.run(),/scheduled task failed/);await f.run();assert.equal(f.dispatches().length,1);
  assert.deepEqual({...f.diagnostics()[0]},{stage:'monitor-dispatch',status:null,code:'timeout'});
});
test('a failing weekly provider cannot prevent public monitor dispatch',async()=>{
  const f=fixture();f.due();f.brevoError(new Error('mock provider unavailable'));
  await assert.rejects(f.run(),/scheduled task failed/);assert.equal(f.dispatches().length,1);
  assert.ok(f.diagnostics().some(d=>d.stage==='monitor-dispatch'&&d.code==='accepted'));
  assert.ok(f.diagnostics().some(d=>d.stage==='weekly-scheduler'&&d.code==='execution-error'));
});
test('mail configuration failure still permits independent monitor dispatch',async()=>{
  const f=fixture();delete f.env.BREVO_API_KEY;
  await assert.rejects(f.run(),/scheduled task failed/);assert.equal(f.dispatches().length,1);
});
test('invalid or partial dispatch configuration cannot redirect credentials and does not block weekly work',async()=>{
  for (const repo of ['https://evil.example/repo','owner/../../evil','owner/repo?redirect=evil','owner/repo/extra','owner/..','']) {
    const f=fixture();f.env.GITHUB_MONITOR_REPO=repo;f.due();
    await assert.rejects(f.run(),/scheduled task failed/);assert.equal(f.dispatches().length,0);
    assert.equal(f.sqlite.prepare('SELECT status FROM jobs').get().status,'submitted');
  }
  const missing=fixture();delete missing.env.GITHUB_DISPATCH_TOKEN;
  await assert.rejects(missing.run(),/scheduled task failed/);assert.equal(missing.dispatches().length,0);
});
