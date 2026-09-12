// All authorization and recipient selection live here, never in the open client.
const DAY = 86400000;
const enc = new TextEncoder();
export const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value))), b => b.toString(16).padStart(2, '0')).join('');
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
const validToken = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
class Fault extends Error { constructor(status, message) { super(message); this.status = status; } }
const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const required = (value, status, message) => { if (!value) throw new Fault(status, message); };
function configured(env) {
  required(env.DB && env.BREVO_API_KEY && env.RATE_SALT?.length >= 32 &&
    /^\d+$/.test(env.BREVO_LIST_ID) && /^https:\/\/[^/]+$/.test(env.PUBLIC_ORIGIN) &&
    /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(env.BREVO_FROM_EMAIL), 503, '邮件服务尚未开放，请稍后再试。');
}
export function validateSchedule(body, now) {
  required(body && typeof body.enabled === 'boolean' && /^[a-f0-9]{32}$/.test(body.scope) && Array.isArray(body.windows) && body.windows.length <= 8, 400, '预约数据无效。');
  const observed = Date.parse(body.observedAt);
  required(Number.isFinite(observed) && observed <= now + 60000 && now - observed <= 30 * 60000, 400, '请重新读取额度时间。');
  const seen = new Set();
  for (const w of body.windows) {
    const due = Date.parse(w.dueAt);
    required(typeof w.id === 'string' && w.id.length > 0 && w.id.length <= 100 && !seen.has(w.id) &&
      typeof w.label === 'string' && w.label.length > 0 && w.label.length <= 100 && w.windowDurationMins === 10080 &&
      Number.isFinite(due) && due > now && due > observed && due - observed <= 8 * DAY, 400, '只接受实际读取到的每周恢复时间。');
    seen.add(w.id);
  }
  required(body.enabled || body.windows.length === 0, 400, '关闭预约时不能提交时间。');
  return {...body, observed};
}
function emailShell(title, body, footer = 'Token重置 · 有消息时，再来找你。') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="margin:0;background:#edf3fb;color:#23324a;font:16px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><main style="max-width:520px;margin:36px auto;background:white;border-radius:24px;padding:32px"><span style="display:inline-block;background:#111;color:white;border-radius:12px;padding:7px 13px;font-weight:800">T!</span><p style="font-size:13px;color:#68758b">TOKEN RESET / 邮件提醒</p><h1 style="font-size:27px;line-height:1.35">${esc(title)}</h1>${body}<hr style="border:0;border-top:1px solid #e3eaf3;margin:28px 0"><p style="font-size:12px;color:#68758b">${footer}</p></main></body></html>`;
}
const button = (label, href) => `<p style="margin:26px 0"><a href="${esc(href)}" style="display:inline-block;background:#ffcf3f;border:2px solid #23324a;border-radius:28px;padding:10px 24px;color:#23324a;text-decoration:none;font-weight:bold">${esc(label)} →</a></p>`;
function actionPage(action) {
  const confirm = action === 'confirm';
  const title = confirm ? '把提醒留给我们。' : '暂停邮件提醒';
  // Tokens arrive in URL fragments: absent from HTTP access logs/referrers. GET
  // never activates anything, so mail scanners cannot subscribe or unsubscribe.
  const script = `const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);document.querySelector('button').onclick=async()=>{const b=document.querySelector('button');b.disabled=true;try{const r=await fetch('/v1/${action}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});const d=await r.json();document.querySelector('#message').textContent=d.message;b.hidden=r.ok;b.disabled=false}catch{document.querySelector('#message').textContent='暂时无法连接，请重新打开邮件中的链接再试。';b.disabled=false}};`;
  const html = emailShell(title, `<p id="message">${confirm ? '确认这是你的邮箱，随后回到应用检查订阅状态。我们只在需要时提醒，可随时退订。' : '确认后停止公共邮件及个人周邮件。看板仍可正常使用。'}</p><button style="background:#ffcf3f;border:2px solid #23324a;border-radius:28px;padding:12px 24px;font:inherit;font-weight:bold">${confirm ? '确认订阅' : '确认退订'}</button><script>${script}</script>`);
  return new Response(html, {headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"}});
}
function signupPage() {
  const script = `document.querySelector('form').onsubmit=async(e)=>{e.preventDefault();const b=document.querySelector('button');b.disabled=true;try{const r=await fetch('/v1/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#email').value,invite:document.querySelector('#invite').value})});const d=await r.json();document.querySelector('#message').textContent=d.message;if(r.ok)document.querySelector('#invite').value='';}catch{document.querySelector('#message').textContent='连接失败，请稍后重试。'}b.disabled=false;};`;
  const html=emailShell('有消息时，再来找你。', `<p>一个邀请码绑定一个邮箱，可在多台设备使用。确认后由 Token重置 统一发信。</p><form><label for="email">收件邮箱</label><input id="email" type="email" maxlength="254" autocomplete="email" required style="box-sizing:border-box;width:100%;padding:12px;margin:8px 0 16px;border:1px solid #b4c3d5;border-radius:10px;font:inherit"><label for="invite">邀请码</label><input id="invite" type="password" maxlength="128" autocomplete="off" required style="box-sizing:border-box;width:100%;padding:12px;margin:8px 0 16px;border:1px solid #b4c3d5;border-radius:10px;font:inherit"><button style="background:#ffcf3f;border:2px solid #23324a;border-radius:28px;padding:12px 24px;font:inherit;font-weight:bold">验证并发送确认邮件</button><p id="message" role="status"></p></form><script>${script}</script>`, '确认后订阅，可随时退订。没有邀请码也能免费使用看板。');
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"}});
}
export function service({fetcher = fetch, clock = Date.now} = {}) {
  const api = async (env, method, path, payload) => {
    const response = await fetcher('https://api.brevo.com/v3' + path, {method, redirect:'manual', signal:AbortSignal.timeout(10000), headers:{'api-key':env.BREVO_API_KEY,'Content-Type':'application/json'}, ...(payload ? {body:JSON.stringify(payload)} : {})});
    if (response.status === 404) return null;
    if (!response.ok) {
      let details; try { details = await response.json(); } catch { details = {}; }
      const error = new Fault(503, '邮件服务暂时不可用，请稍后检查状态。');
      error.providerStatus = response.status;
      error.providerCode = typeof details?.code === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(details.code) ? details.code : 'provider-error';
      error.stage = path === '/account' ? 'account' : path === '/smtp/email' ? 'send' : 'contacts';
      throw error;
    }
    return response.status === 204 ? {} : response.json();
  };
  const stmt = (env, sql, ...values) => env.DB.prepare(sql).bind(...values);
  async function limit(env, key, max, duration) {
    const bucket = Math.floor(clock() / duration);
    const result = await stmt(env, 'INSERT INTO counters(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count', key + ':' + bucket, (bucket + 2) * duration, max).first();
    required(result, 429, '操作太频繁，请稍后再试。');
  }
  async function mail(env, email, subject, html) {
    // Conservative free-plan ceiling; never switch to a paid plan automatically.
    const account = await api(env, 'GET', '/account');
    const free = account?.plan?.filter(p => p.type === 'free' && p.creditsType === 'sendLimit');
    required(free?.length === 1 && Number.isFinite(free[0].credits) && free[0].credits >= 1, 503, '今日免费邮件额度暂不可用。');
    await limit(env, 'mail', 200, DAY);
    const result = await api(env, 'POST', '/smtp/email', {sender:{name:'Token重置',email:env.BREVO_FROM_EMAIL},to:[{email}],subject,htmlContent:html});
    required(typeof result?.messageId === 'string' && result.messageId, 503, '邮件投递结果待核查，请勿重复提交。');
  }
  async function identity(env, request, active = true) {
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
    required(validToken(token), 401, '请先使用邀请码订阅。');
    const row = await stmt(env, 'SELECT s.*,u.email,u.active,u.unsubscribe_hash FROM sessions s JOIN subscribers u ON s.subscriber_id=u.id WHERE s.token_hash=?', await digest(token)).first();
    required(row && row.expires_at > clock(), 401, '授权已过期，请重新确认邮箱。');
    if (active) required(row.confirmed && row.active && !row.revoked, 403, '请先完成邮箱确认。');
    return row;
  }
  async function eligible(env, row) {
    const contact = await api(env, 'GET', '/contacts/' + encodeURIComponent(row.email));
    return !!contact && contact.emailBlacklisted === false && contact.listIds?.includes(Number(env.BREVO_LIST_ID));
  }
  async function summary(env, row) {
    const state = await stmt(env, "SELECT MIN(due_at) AS nextAt,COUNT(*) AS pending FROM jobs WHERE subscriber_id=? AND status='pending' AND due_at>?", row.subscriber_id, clock()).first();
    const schedule = await stmt(env, 'SELECT enabled FROM schedules WHERE subscriber_id=?', row.subscriber_id).first();
    return {subscriptionStatus:row.revoked ? 'inactive' : row.confirmed && row.active ? 'active' : 'pending', email:row.email, weeklyEnabled:schedule?.enabled === 1, pending:state.pending, nextAt:state.nextAt ? new Date(state.nextAt).toISOString() : null};
  }
  async function route(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/subscribe') return signupPage();
    if (request.method === 'GET' && ['/confirm','/unsubscribe'].includes(url.pathname)) return actionPage(url.pathname.slice(1));
    if (request.method === 'GET' && url.pathname === '/health') { configured(env); return json({status:'ok'}); }
    configured(env);
    required(!request.headers.get('Origin') || request.headers.get('Origin') === env.PUBLIC_ORIGIN, 403, '请求来源不受支持。');
    const ip = await digest(env.RATE_SALT + '|' + (request.headers.get('CF-Connecting-IP') || 'local'));
    await limit(env, 'ip:' + ip, 60, 60000);
    if (request.method === 'GET' && url.pathname === '/v1/status') {
      const row = await identity(env, request, false);
      if (row.confirmed && row.active && !row.revoked && !await eligible(env, row)) {
        await stmt(env, 'UPDATE subscribers SET active=0 WHERE id=?', row.subscriber_id).run();
        return json({subscriptionStatus:'inactive',email:row.email,weeklyEnabled:false});
      }
      return json(await summary(env, row));
    }
    required(request.method === 'POST' && request.headers.get('Content-Type')?.split(';')[0] === 'application/json', 405, '不支持的请求。');
    // Bound actual bytes, not merely the untrusted Content-Length header.
    const reader = request.body?.getReader(); let size = 0, chunks = [];
    required(reader, 400, '请求不能为空。');
    while (true) { const {value, done} = await reader.read(); if (done) break; size += value.byteLength; if (size > 8192) { await reader.cancel(); throw new Fault(413, '请求过大。'); } chunks.push(value); }
    let body; try { body = JSON.parse(await new Blob(chunks).text()); } catch { throw new Fault(400, '请求格式错误。'); }
    if (url.pathname === '/v1/subscribe') {
      await limit(env, 'signup-ip:' + ip, 10, 3600000);
      required(typeof body.invite === 'string' && body.invite.trim().length >= 20 && body.invite.length <= 128, 403, '邀请码无效或已停用。');
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      required(email.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email), 400, '请填写有效邮箱。');
      const invitation = await stmt(env, 'SELECT i.*,u.email AS bound_email FROM invitations i LEFT JOIN subscribers u ON u.id=i.subscriber_id WHERE i.code_hash=? AND i.revoked=0', await digest(body.invite.trim())).first();
      required(invitation && (!invitation.subscriber_id || invitation.bound_email === email), 403, '邀请码无效、已停用或已绑定其他邮箱。');
      await limit(env, 'signup-email:' + await digest(env.RATE_SALT + email), 1, 600000);
      await limit(env, 'signup-day:' + await digest(env.RATE_SALT + email), 3, DAY);
      const token = random(), confirmation = random(), unsubscribe = random(), id = random();
      // Never invalidate an existing subscriber/session on an unconfirmed request.
      await stmt(env, 'INSERT INTO subscribers(id,email,unsubscribe_hash,created_at) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING', id, email, await digest(unsubscribe), clock()).run();
      const subscriber = await stmt(env, 'SELECT id FROM subscribers WHERE email=?', email).first();
      await stmt(env, 'INSERT INTO sessions(token_hash,subscriber_id,confirm_hash,expires_at,confirm_expires,created_at,invite_hash) VALUES (?,?,?,?,?,?,?)', await digest(token), subscriber.id, await digest(confirmation), clock()+90*DAY, clock()+DAY, clock(), invitation.code_hash).run();
      const link = env.PUBLIC_ORIGIN + '/confirm#' + confirmation;
      try {
        await mail(env, email, '请确认订阅 Token重置 邮件提醒', emailShell('消息来了，我们提醒你。', '<p>欢迎来到 Token重置。你已通过邀请验证，再确认一下邮箱，就可以安心等待下一次提醒了。</p><p>确认后开启重置信号邮件；个人每周到点邮件由你在应用里单独开启。</p>' + button('确认我的订阅', link) + '<p style="font-size:13px;color:#68758b">链接 24 小时有效。如果不是你申请的，忽略这封邮件即可。</p>'));
      } catch (error) {
        await stmt(env, 'INSERT INTO mail_diagnostics(id,stage,status,code,created_at) VALUES (?,?,?,?,?)', random(), error.stage || 'send-unknown', error.providerStatus || null, error.providerCode || (error.name === 'TimeoutError' ? 'timeout' : 'unconfirmed'), clock()).run();
        return json({token,subscriptionStatus:'pending',email,message:'发信结果尚未确认，请检查邮箱；如未收到，10 分钟后可重新申请。'}, 202); }
      return json({token,subscriptionStatus:'pending',email,message:'确认邮件已提交，请点击邮件按钮完成确认。'}, 202);
    }
    if (url.pathname === '/v1/confirm') {
      required(validToken(body.token), 400, '确认链接无效。');
      const row = await stmt(env, 'SELECT s.*,u.email FROM sessions s JOIN subscribers u ON s.subscriber_id=u.id WHERE confirm_hash=?', await digest(body.token)).first();
      required(row && !row.revoked && row.confirm_expires > clock(), 410, '链接已过期，请在应用重新申请。');
      if (row.confirmed) return json({message:'邮箱已确认，可以回到应用了。'});
      // Atomic claim precedes every provider side effect. Pending requests do not
      // reserve codes; only the first email proof wins, even across isolates.
      const claimed = await stmt(env, `UPDATE invitations SET subscriber_id=?,bound_at=COALESCE(bound_at,?)
        WHERE code_hash=? AND revoked=0 AND (subscriber_id IS NULL OR subscriber_id=?)
        AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND revoked=0 AND confirm_expires>?)
        RETURNING code_hash`, row.subscriber_id, clock(), row.invite_hash, row.subscriber_id, row.token_hash, clock()).first();
      required(claimed, 403, '邀请码已失效或已绑定其他邮箱，请使用本人的邀请码重新申请。');
      // Keep the binding on provider failure so the same email can safely retry.
      // The list is private to this gateway, never attached to a public form.
      await api(env, 'POST', '/contacts', {email:row.email, listIds:[Number(env.BREVO_LIST_ID)], updateEnabled:true});
      required(await eligible(env, row), 409, '此邮箱在邮件服务中已退订，请联系管理员恢复后再确认。');
      await env.DB.batch([
        stmt(env, 'UPDATE sessions SET confirmed=1 WHERE token_hash=? AND confirm_expires>? AND revoked=0', row.token_hash, clock()),
        stmt(env, 'UPDATE subscribers SET active=1 WHERE id=? AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND confirmed=1 AND revoked=0 AND confirm_expires>?)', row.subscriber_id, row.token_hash, clock())
      ]);
      const confirmed = await stmt(env, 'SELECT confirmed,revoked FROM sessions WHERE token_hash=?', row.token_hash).first();
      required(confirmed?.confirmed && !confirmed.revoked, 410, '此次确认已取消，请重新申请。');
      return json({message:'订阅成功。回到应用点击“检查确认状态”，就可以开启个人周邮件了。'});
    }
    if (url.pathname === '/v1/unsubscribe') {
      required(validToken(body.token), 400, '退订链接无效。');
      const row = await stmt(env, 'SELECT u.* FROM subscribers u JOIN unsubscribe_links l ON l.subscriber_id=u.id WHERE l.token_hash=?', await digest(body.token)).first();
      required(row, 410, '退订链接已失效。');
      await cancel(env, row.id, row.email);
      return json({message:'已退订，后续不会再安排邮件。已提交的邮件可能仍会送达。'});
    }
    const row = await identity(env, request, url.pathname !== '/v1/cancel');
    if (url.pathname === '/v1/cancel') {
      required(row.confirmed && (!row.revoked || !row.active), 403, '订阅授权已失效。');
      await cancel(env, row.subscriber_id, row.email);
      return json({subscriptionStatus:'inactive',message:'已退订，后续预约已取消。'});
    }
    required(url.pathname === '/v1/schedule', 404, '没有这个接口。');
    required(await eligible(env, row), 403, '订阅已失效，请重新确认邮箱。');
    const schedule = validateSchedule(body, clock());
    const prev = await stmt(env, 'SELECT * FROM schedules WHERE subscriber_id=?', row.subscriber_id).first();
    required(!prev || schedule.observed >= prev.observed_at, 409, '已有更新的预约，请重新读取额度。');
    // One transaction keeps cancellation and replacement consistent under retries.
    // Already due entries survive a fresh read of the next week, unless disabled
    // or the local account scope changed. Sent IDs remain tombstones for dedup.
    const operations = [stmt(env, 'INSERT INTO schedules(subscriber_id,scope,observed_at,enabled) VALUES (?,?,?,?) ON CONFLICT(subscriber_id) DO UPDATE SET scope=excluded.scope,observed_at=excluded.observed_at,enabled=excluded.enabled WHERE schedules.observed_at<=excluded.observed_at', row.subscriber_id, schedule.scope, schedule.observed, Number(schedule.enabled)),
      stmt(env, "UPDATE jobs SET status='cancelled' WHERE subscriber_id=? AND status='pending' AND (?=0 OR scope<>? OR due_at>?) AND EXISTS(SELECT 1 FROM schedules WHERE subscriber_id=? AND observed_at=? AND scope=?)", row.subscriber_id, Number(schedule.enabled), schedule.scope, clock(), row.subscriber_id, schedule.observed, schedule.scope)];
    for (const w of schedule.windows) {
      const due = Date.parse(w.dueAt), id = await digest([row.subscriber_id, schedule.scope, w.id, due].join('|'));
      operations.push(stmt(env, "INSERT INTO jobs(id,subscriber_id,scope,window_id,label,due_at,observed_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM schedules WHERE subscriber_id=? AND observed_at=? AND scope=? AND enabled=1) ON CONFLICT(id) DO UPDATE SET status='pending' WHERE status='cancelled' AND due_at>?", id, row.subscriber_id, schedule.scope, w.id, w.label, due, schedule.observed, row.subscriber_id, schedule.observed, schedule.scope, clock()));
    }
    const committed = await env.DB.batch(operations);
    required((committed[0].meta?.changes ?? committed[0].changes) > 0, 409, '已有更新的预约，请重新读取额度。');
    return json({...await summary(env, row),status:schedule.enabled ? 'synced' : 'disabled',syncedAt:new Date(clock()).toISOString()});
  }
  async function cancel(env, id, email) {
    // Fail closed locally before contacting Brevo. A failed list removal is not
    // reported as success; the same unsubscribe link can retry the operation.
    await env.DB.batch([
      stmt(env, 'UPDATE subscribers SET active=0 WHERE id=?', id),
      stmt(env, 'UPDATE sessions SET revoked=1,confirm_expires=0 WHERE subscriber_id=?', id),
      stmt(env, 'UPDATE schedules SET enabled=0 WHERE subscriber_id=?', id),
      stmt(env, "UPDATE jobs SET status='cancelled' WHERE subscriber_id=? AND status='pending'", id)
    ]);
    const contact = await api(env, 'GET', '/contacts/' + encodeURIComponent(email));
    if (contact?.listIds?.includes(Number(env.BREVO_LIST_ID))) {
      await api(env, 'POST', '/contacts/lists/' + env.BREVO_LIST_ID + '/contacts/remove', {emails:[email]});
    }
  }
  async function dispatchMonitor(env) {
    // Optional for self-hosters. Credentials only ever go to GitHub's API;
    // neither the workflow/ref nor its inputs can be supplied by a client.
    if (!env.GITHUB_DISPATCH_TOKEN && !env.GITHUB_MONITOR_REPO) return {status:'disabled'};
    required(env.DB && typeof env.GITHUB_DISPATCH_TOKEN === 'string' && /^[^\s]{20,1024}$/.test(env.GITHUB_DISPATCH_TOKEN) &&
      typeof env.GITHUB_MONITOR_REPO === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(env.GITHUB_MONITOR_REPO), 503, '公共监控调度配置无效。');
    const interval = 15 * 60000, bucket = Math.floor(clock() / interval);
    const key = 'monitor-dispatch:' + bucket;
    // Claim before the request, including unknown outcomes: never dispatch twice
    // on a retried cron event. A later quarter-hour can try again safely.
    const claimed = await stmt(env, 'INSERT INTO counters(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO NOTHING RETURNING key', key, (bucket + 2) * interval).first();
    if (!claimed) return {status:'duplicate'};
    try {
      const response = await fetcher('https://api.github.com/repos/' + env.GITHUB_MONITOR_REPO + '/actions/workflows/monitor.yml/dispatches', {
        method:'POST', redirect:'manual', signal:AbortSignal.timeout(10000),
        headers:{Authorization:'Bearer ' + env.GITHUB_DISPATCH_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'Token-reset-monitor'},
        body:JSON.stringify({ref:'main',inputs:{test_email:false}})
      });
      // New API versions return the run id; older installations return 204.
      let accepted = response.status === 204;
      if (response.status === 200) {
        let body; try { body = await response.json(); } catch { body = null; }
        accepted = Number.isSafeInteger(body?.workflow_run_id) && body.workflow_run_id > 0;
      }
      if (!accepted) {
        const error = new Error('GitHub did not accept the monitor dispatch');
        error.providerStatus = response.status;
        error.providerCode = response.status === 200 ? 'invalid-response' : 'github-http-error';
        throw error;
      }
      await stmt(env, 'UPDATE counters SET count=2 WHERE key=?', key).run();
      await stmt(env, 'INSERT INTO mail_diagnostics(id,stage,status,code,created_at) VALUES (?,?,?,?,?)', random(), 'monitor-dispatch', response.status, 'accepted', clock()).run();
      return {status:'accepted'};
    } catch (error) {
      await stmt(env, 'UPDATE counters SET count=3 WHERE key=?', key).run();
      throw error;
    }
  }
  async function weeklyScheduled(env) {
    configured(env);
    const now = clock();
    await stmt(env, 'DELETE FROM counters WHERE expires_at<?', now).run();
    await stmt(env, "DELETE FROM mail_diagnostics WHERE stage IN ('monitor-dispatch','weekly-scheduler') AND created_at<?", now-30*DAY).run();
    await stmt(env, 'DELETE FROM sessions WHERE expires_at<? OR (confirmed=0 AND confirm_expires<?)', now, now-7*DAY).run();
    const jobs = (await stmt(env, "SELECT j.*,u.email FROM jobs j JOIN subscribers u ON u.id=j.subscriber_id JOIN schedules s ON s.subscriber_id=j.subscriber_id WHERE j.status='pending' AND u.active=1 AND s.enabled=1 AND s.scope=j.scope AND due_at<=? AND due_at>=? ORDER BY due_at LIMIT 25", now, now-DAY).all()).results;
    let submitted = 0;
    for (const job of jobs) {
      if (!await eligible(env, job)) { await stmt(env, 'UPDATE subscribers SET active=0 WHERE id=?', job.subscriber_id).run(); continue; }
      const claimed = await stmt(env, "UPDATE jobs SET status='claimed',claimed_at=? WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM subscribers u JOIN schedules s ON s.subscriber_id=u.id WHERE u.id=? AND u.active=1 AND s.enabled=1 AND s.scope=jobs.scope) RETURNING id", now, job.id, job.subscriber_id).first();
      if (!claimed) continue;
      try {
        await limit(env, 'weekly:' + job.subscriber_id, 4, DAY);
        // Keep old mail links usable after newer reminders are sent.
        const unsubscribe = random();
        await stmt(env, 'INSERT INTO unsubscribe_links(token_hash,subscriber_id) VALUES (?,?)', await digest(unsubscribe), job.subscriber_id).run();
        const date = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(job.due_at));
        await mail(env, job.email, 'Token重置 · 每周恢复时间到了', emailShell('新的额度周期，\n可以回来看看啦。', `<p>电脑休息时，我们也记着你的时间。</p><div style="padding:20px;background:#edf5ff;border-radius:16px"><strong>${esc(job.label)}</strong><br>${esc(date)}（北京时间）</div><p>这是按你本机记录的时间发出的提醒，不代表额度已经到账。下一周期需要应用重新读取时间。</p>` + button('查看 Codex', 'https://chatgpt.com/codex'), `<a href="${env.PUBLIC_ORIGIN}/unsubscribe#${unsubscribe}" style="color:#68758b">退订所有邮件提醒</a>`));
        await stmt(env, "UPDATE jobs SET status='submitted' WHERE id=?", job.id).run(); submitted++;
      } catch {
        // Never resend after a timeout: the provider may already have accepted it.
        await stmt(env, "UPDATE jobs SET status='needs-review' WHERE id=?", job.id).run();
      }
    }
    return {submitted};
  }
  async function scheduled(env) {
    // One provider failure must not starve the other task. Wait for both before
    // surfacing failure to the cron runtime; diagnostics contain no credentials.
    const outcomes = await Promise.allSettled([dispatchMonitor(env), weeklyScheduled(env)]);
    let failed = false;
    for (const [index, result] of outcomes.entries()) {
      if (result.status !== 'rejected') continue;
      failed = true;
      const error = result.reason;
      const code = error.providerCode || (error.name === 'TimeoutError' ? 'timeout' : error instanceof Fault ? 'configuration-error' : 'execution-error');
      await stmt(env, 'INSERT INTO mail_diagnostics(id,stage,status,code,created_at) VALUES (?,?,?,?,?)', random(), index === 0 ? 'monitor-dispatch' : 'weekly-scheduler', error.providerStatus || null, code, clock()).run();
    }
    if (failed) throw new Error('A scheduled task failed; inspect private scheduler diagnostics.');
    return {...outcomes[1].value,monitorDispatch:outcomes[0].value};
  }
  return {fetch: async (request, env) => { try { return await route(request, env); } catch (error) { return json({message:error instanceof Fault ? error.message : '服务暂时不可用，请稍后再试。'}, error instanceof Fault ? error.status : 503); } }, scheduled: async (_event, env) => scheduled(env)};
}
export default service();
