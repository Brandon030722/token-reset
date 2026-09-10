import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {service,validateSchedule} from '../worker.mjs';
const DAY = 86400000;
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0002.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0003.sql', import.meta.url), 'utf8'));
  sqlite.prepare('INSERT INTO invitations(code_hash,created_at) VALUES (?,?)').run(createHash('sha256').update('TEST-ONLY-invite-not-for-production').digest('hex'),0);
  const DB = {
    prepare(sql) {
      return {bind(...args) {
        const s = sqlite.prepare(sql);
        return {first:async()=>s.get(...args)??null,all:async()=>({results:s.all(...args)}),run:async()=>s.run(...args)};
      }};
    },
    async batch(items) {
      sqlite.exec('BEGIN');
      try { const result=[]; for(const item of items) result.push(await item.run()); sqlite.exec('COMMIT'); return result; }
      catch(e) { sqlite.exec('ROLLBACK'); throw e; }
    }
  };
  let now = Date.parse('2026-09-10T08:00:00Z'), failure = false;
  const sent=[], contacts=new Map();
  const env={DB,INVITE_CODE:'TEST-ONLY-invite-not-for-production',RATE_SALT:'x'.repeat(32),BREVO_API_KEY:'fake-provider-key',BREVO_LIST_ID:'19',BREVO_FROM_EMAIL:'sender@example.com',PUBLIC_ORIGIN:'https://mail.example.com'};
  const app=service({clock:()=>now,fetcher:async(url,options)=>{
    assert.equal(options.redirect,'manual','Worker must prevent redirects without unsupported error mode');
    const path=new URL(url).pathname.replace('/v3',''); const body=options.body&&JSON.parse(options.body);
    if(path==='/account') return Response.json({plan:[{type:'free',creditsType:'sendLimit',credits:300}]});
    if(path==='/smtp/email') {sent.push(body);if(failure)throw Error('accepted but timed out');return Response.json({messageId:'test-id'});}
    if(path==='/contacts'&&options.method==='POST'){const old=contacts.get(body.email);contacts.set(body.email,{email:body.email,emailBlacklisted:old?.emailBlacklisted??false,listIds:body.listIds});return Response.json({id:1});}
    if(path==='/contacts/lists/19/contacts/remove'){for(const email of body.emails){const c=contacts.get(email);if(c)c.listIds=[];}return Response.json({contacts:{success:body.emails}});}
    if(path.startsWith('/contacts/')){const c=contacts.get(decodeURIComponent(path.slice(10)));return c?Response.json(c):new Response(null,{status:404});}
    throw Error('unexpected provider route '+path);
  }});
  const call=async(path,body,token)=>{
    const result=await app.fetch(new Request(env.PUBLIC_ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
    return {status:result.status,data:result.headers.get('content-type')?.includes('json')?await result.json():await result.text()};
  };
  const subscribe=async(email='user@example.com')=>{
    const response=await call('/v1/subscribe',{email,invite:env.INVITE_CODE});assert.equal(response.status,202,JSON.stringify(response.data));
    const confirmation=sent.at(-1).htmlContent.match(/\/confirm#([a-f0-9]{64})/)[1];return {token:response.data.token,confirmation};
  };
  const activate=async(email)=>{const s=await subscribe(email);assert.equal((await call('/v1/confirm',{token:s.confirmation})).status,200);return s;};
  const schedule=(delta=DAY)=>({enabled:true,scope:'a'.repeat(32),observedAt:new Date(now).toISOString(),windows:[{id:'codex',label:'Codex',windowDurationMins:10080,dueAt:new Date(now+delta).toISOString()}]});
  return {env,sqlite,app,call,subscribe,activate,schedule,sent,contacts,setNow:v=>now=v,advance:ms=>now+=ms,now:()=>now,setFailure:v=>failure=v};
}
test('wrong/missing/public legacy invite never calls mail provider',async()=>{
  const f=fixture();for(const invite of ['', 'TOKENEMAIL', 'wrong']) assert.equal((await f.call('/v1/subscribe',{email:'a@example.com',invite})).status,403);
  assert.equal(f.sent.length,0);assert.equal((await f.call('/v1/schedule',f.schedule())).status,401);
});
test('confirmation requires secret in email, not the returned pending session',async()=>{
  const f=fixture(),s=await f.subscribe();assert.equal((await f.call('/v1/schedule',f.schedule(),s.token)).status,403);
  assert.equal((await f.call('/v1/confirm',{token:s.token})).status,410);
  assert.equal((await f.call('/confirm')).status,200);assert.equal(f.contacts.size,0);
  assert.equal((await f.call('/v1/confirm',{token:s.confirmation})).status,200);
  assert.equal((await f.call('/v1/status',undefined,s.token)).data.subscriptionStatus,'active');
});
test('knowing an already-confirmed email plus invite does not hijack its identity',async()=>{
  const f=fixture(),first=await f.activate();f.advance(600001);const second=await f.subscribe();
  assert.equal((await f.call('/v1/schedule',f.schedule(),second.token)).status,403);
  assert.equal((await f.call('/v1/status',undefined,first.token)).data.subscriptionStatus,'active');
});
test('schedule cannot pick another recipient; due mail is deduplicated',async()=>{
  const f=fixture(),s=await f.activate(),body={...f.schedule(),email:'victim@example.com'};
  assert.equal((await f.call('/v1/schedule',body,s.token)).status,200);
  assert.equal((await f.call('/v1/schedule',body,s.token)).status,200);
  f.advance(DAY+1);await f.app.scheduled({},f.env);await f.app.scheduled({},f.env);
  assert.equal(f.sent.length,2);assert.deepEqual(f.sent.at(-1).to,[{email:'user@example.com'}]);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM jobs WHERE status='submitted'").get().n,1);
});
test('stale observations rejected, latest future schedule replaces previous',async()=>{
  const f=fixture(),s=await f.activate(),old=f.schedule();await f.call('/v1/schedule',old,s.token);
  f.advance(60000);assert.equal((await f.call('/v1/schedule',f.schedule(2*DAY),s.token)).status,200);
  assert.equal((await f.call('/v1/schedule',old,s.token)).status,409);
  f.advance(DAY);await f.app.scheduled({},f.env);assert.equal(f.sent.length,1);
});
test('advancing to next week preserves already-due reminder',async()=>{
  const f=fixture(),s=await f.activate();await f.call('/v1/schedule',f.schedule(),s.token);f.advance(DAY+1);
  await f.call('/v1/schedule',f.schedule(7*DAY),s.token);await f.app.scheduled({},f.env);assert.equal(f.sent.length,2);
});
test('disable cancels; GET unsubscribe cannot cancel; old links remain valid',async()=>{
  const f=fixture(),s=await f.activate();await f.call('/v1/schedule',f.schedule(),s.token);f.advance(DAY+1);await f.app.scheduled({},f.env);
  const firstLink=f.sent.at(-1).htmlContent.match(/\/unsubscribe#([a-f0-9]{64})/)[1];
  await f.call('/v1/schedule',f.schedule(),s.token);f.advance(DAY+1);await f.app.scheduled({},f.env);
  await f.call('/unsubscribe');assert.equal((await f.call('/v1/status',undefined,s.token)).data.subscriptionStatus,'active');
  assert.equal((await f.call('/v1/unsubscribe',{token:firstLink})).status,200);
  assert.equal((await f.call('/v1/schedule',f.schedule(),s.token)).status,403);
});
test('provider unsubscribe is honored and ambiguous delivery is not retried',async()=>{
  const f=fixture(),s=await f.activate();await f.call('/v1/schedule',f.schedule(),s.token);f.advance(DAY+1);f.setFailure(true);
  await f.app.scheduled({},f.env);await f.app.scheduled({},f.env);assert.equal(f.sent.length,2);
  assert.equal(f.sqlite.prepare('SELECT status FROM jobs').get().status,'needs-review');
  f.contacts.get('user@example.com').emailBlacklisted=true;
  assert.equal((await f.call('/v1/schedule',f.schedule(),s.token)).status,403);
});
test('bounded registration rate, expiration, missing config fail closed',async()=>{
  const f=fixture(),s=await f.subscribe();assert.equal((await f.call('/v1/subscribe',{email:'user@example.com',invite:f.env.INVITE_CODE})).status,429);
  f.advance(DAY+1);assert.equal((await f.call('/v1/confirm',{token:s.confirmation})).status,410);
  f.env.RATE_SALT='';assert.equal((await f.call('/v1/subscribe',{email:'a@example.com',invite:''})).status,503);
});
test('reject malformed and non-weekly deadlines',()=>{
  const f=fixture(),body=f.schedule();assert.throws(()=>validateSchedule({...body,windows:[{...body.windows[0],windowDurationMins:300}]},f.now()));
  assert.throws(()=>validateSchedule({...body,windows:[{...body.windows[0],dueAt:new Date(f.now()+9*DAY).toISOString()}]},f.now()));
});

test('pending attacker cannot cancel; revoked devices stay revoked after resubscription',async()=>{
  const f=fixture(),first=await f.activate();f.advance(600001);const attacker=await f.subscribe();
  assert.equal((await f.call('/v1/cancel',{},attacker.token)).status,403);
  assert.equal((await f.call('/v1/cancel',{},first.token)).status,200);
  assert.equal((await f.call('/v1/cancel',{},first.token)).status,200);
  f.advance(600001);const restored=await f.activate();
  assert.equal((await f.call('/v1/schedule',f.schedule(),first.token)).status,403);
  assert.equal((await f.call('/v1/cancel',{},first.token)).status,403);
  assert.equal((await f.call('/v1/schedule',f.schedule(),restored.token)).status,200);
});
test('account change cancels just-due old account and disabled request cancels all',async()=>{
  const f=fixture(),s=await f.activate();await f.call('/v1/schedule',f.schedule(),s.token);f.advance(DAY+1);
  await f.call('/v1/schedule',{...f.schedule(),scope:'b'.repeat(32)},s.token);await f.app.scheduled({},f.env);assert.equal(f.sent.length,1);
  const disabled={...f.schedule(),scope:'b'.repeat(32),enabled:false,windows:[]};
  assert.equal((await f.call('/v1/schedule',disabled,s.token)).status,200);
  f.advance(DAY+1);await f.app.scheduled({},f.env);assert.equal(f.sent.length,1);
});

test('pending requests do not reserve codes; concurrent email confirmations have one winner',async()=>{
  const f=fixture(),a=await f.subscribe('a@example.com'),b=await f.subscribe('b@example.com');
  assert.equal(f.sqlite.prepare('SELECT subscriber_id FROM invitations').get().subscriber_id,null);
  const results=await Promise.all([a,b].map(s=>f.call('/v1/confirm',{token:s.confirmation})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,403]);
  assert.equal(f.contacts.size,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM subscribers WHERE active=1').get().n,1);
  const loser=results[0].status===403?'a@example.com':'b@example.com';
  f.advance(600001);
  assert.equal((await f.call('/v1/subscribe',{email:loser,invite:f.env.INVITE_CODE})).status,403);
});
test('bound email is normalized, supports multiple devices, and cannot transfer after unsubscribe',async()=>{
  const f=fixture(),a=await f.activate(' User@Example.COM ');f.advance(600001);
  const b=await f.activate('user@example.com');
  for(const s of [a,b]) assert.equal((await f.call('/v1/status',undefined,s.token)).data.subscriptionStatus,'active');
  await f.call('/v1/cancel',{},a.token);f.advance(600001);
  assert.equal((await f.call('/v1/subscribe',{email:'other@example.com',invite:f.env.INVITE_CODE})).status,403);
  const restored=await f.activate();
  assert.equal((await f.call('/v1/status',undefined,restored.token)).data.subscriptionStatus,'active');
});
test('expired pending email leaves code available; revoked codes cannot confirm',async()=>{
  const f=fixture(),a=await f.subscribe('a@example.com');f.advance(DAY+1);
  assert.equal((await f.call('/v1/confirm',{token:a.confirmation})).status,410);
  const b=await f.subscribe('b@example.com');f.sqlite.exec('UPDATE invitations SET revoked=1');
  assert.equal((await f.call('/v1/confirm',{token:b.confirmation})).status,403);
  assert.equal(f.contacts.size,0);
});
test('legacy confirmed sessions retain schedules, but legacy pending sessions cannot activate',async()=>{
  const f=fixture(),a=await f.activate();
  f.sqlite.exec('UPDATE sessions SET invite_hash=NULL');
  assert.equal((await f.call('/v1/schedule',f.schedule(),a.token)).status,200);
  f.advance(600001);const b=await f.subscribe();f.sqlite.exec('UPDATE sessions SET invite_hash=NULL WHERE confirmed=0');
  assert.equal((await f.call('/v1/confirm',{token:b.confirmation})).status,403);
  assert.equal((await f.call('/v1/status',undefined,a.token)).data.subscriptionStatus,'active');
});
test('provider rejection keeps code bound and allows same email confirmation retry',async()=>{
  const f=fixture(),a=await f.subscribe();
  f.contacts.set('user@example.com',{emailBlacklisted:true,listIds:[]});
  assert.equal((await f.call('/v1/confirm',{token:a.confirmation})).status,409);
  assert.ok(f.sqlite.prepare('SELECT subscriber_id FROM invitations').get().subscriber_id);
  assert.equal((await f.call('/v1/subscribe',{email:'other@example.com',invite:f.env.INVITE_CODE})).status,403);
  f.contacts.get('user@example.com').emailBlacklisted=false;
  assert.equal((await f.call('/v1/confirm',{token:a.confirmation})).status,200);
});
