import { canAlert, isFresh, MAX_FRESH_MS, THRESHOLD, type Snapshot } from './domain';
export interface Health { status: 'ok' | 'unavailable'; attemptedAt: string; posts?: number; }
export function parseHealth(input: unknown): Health {
  const value = input as Health;
  if (!value || !['ok', 'unavailable'].includes(value.status) || typeof value.attemptedAt !== 'string' || !Number.isFinite(Date.parse(value.attemptedAt)) ||
    (value.posts !== undefined && (!Number.isInteger(value.posts) || value.posts < 0))) throw Error('Invalid health');
  return { status: value.status, attemptedAt: value.attemptedAt, posts: value.posts };
}
export function selectSignal(snapshot: Snapshot | null, health: Health | null, readFailed: boolean, now: number) {
  const fresh = !!snapshot && snapshot.mode === 'live' && isFresh(snapshot, now) && !readFailed && health?.status === 'ok' && health.attemptedAt === snapshot.checkedAt;
  const forecast = snapshot?.forecast;
  const event = snapshot?.events.find(e => e.id === forecast?.eventId);
  const valid = fresh && !!forecast && !!event && !event.reviewRequired && event.type === 'global-reset' &&
    ['watching', 'promised'].includes(forecast.status) && forecast.status === event.status && forecast.method === 'rules-v2' &&
    Date.parse(forecast.generatedAt) <= now && now - Date.parse(forecast.generatedAt) <= MAX_FRESH_MS &&
    Date.parse(forecast.validUntil) > now && Date.parse(forecast.windowEndsAt) > now && forecast.evidenceIds.length > 0 &&
    forecast.evidenceIds.every(id => snapshot!.evidence.some(e => e.id === id && e.eventId === event.id && Date.parse(e.postedAt) <= now));
  const reachesThreshold = !!valid && canAlert(snapshot!, now);
  const display = valid && (forecast.probability48h < THRESHOLD || reachesThreshold);
  return { fresh, score: display ? forecast.probability48h : null, summary: display ? forecast.summary : null, reachesThreshold };
}
export interface SiteConfig { subscriptionUrl: string; releaseUrl: string; macDownloadUrl: string; windowsDownloadUrl: string; desktopVersion: string; }
export function parseSiteConfig(input: unknown): SiteConfig {
  const c = input as SiteConfig;
  if (!c || !/^\d+\.\d+\.\d+$/.test(c.desktopVersion)) throw Error('Invalid version');
  if (c.subscriptionUrl !== 'https://token-reset-mail.brandon030722-token-reset.workers.dev/subscribe') throw Error('Invalid invitation service');
  const base = 'https://github.com/Brandon030722/token-reset-desktop/releases/';
  if (c.releaseUrl !== base + 'tag/v' + c.desktopVersion) throw Error('Invalid release');
  for (const [key, platform] of [['macDownloadUrl', 'macOS-arm64'], ['windowsDownloadUrl', 'Windows-x64']] as const)
    if (c[key] !== `${base}download/v${c.desktopVersion}/Token-reset-desktop-v${c.desktopVersion}-${platform}.zip`) throw Error('Invalid download');
  return c;
}
