// Owner-only CLI: Cloudflare authentication is required; no public admin endpoint.
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,chmodSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const args=process.argv.slice(2), remote=args.includes('--remote');
const value=name=>args[args.indexOf(name)+1];
const count=args.includes('--count')?Number(value('--count')):10;
if(!Number.isInteger(count)||count<0||count>100)throw Error('count must be 0–100');
const cwd=fileURLToPath(new URL('../',import.meta.url));
const dir=path.resolve(cwd,'../.local/invite-service');
mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(4).toString('hex');
const out=path.join(dir,`invites-${stamp}.json`),sqlFile=path.join(dir,`invites-${stamp}.sql`);
const run=options=>{const output=execFileSync(process.execPath,[path.join(cwd,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','token-reset-mail',remote?'--remote':'--local','--json',...options],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});return options.includes('--file')?null:JSON.parse(output);};
let existing=[];
if(args.includes('--existing'))existing=run(['--command',`SELECT u.id,u.email FROM subscribers u WHERE (u.active=1 OR EXISTS(SELECT 1 FROM sessions s WHERE s.subscriber_id=u.id AND s.confirmed=1)) AND NOT EXISTS(SELECT 1 FROM invitations i WHERE i.subscriber_id=u.id AND i.revoked=0)`]).flatMap(r=>r.results??[]);
const entries=[...existing.map(r=>({email:r.email,id:r.id})),...Array.from({length:count},()=>({}))].map(r=>({...r,code:'TR-'+randomBytes(24).toString('base64url')}));
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const now=Date.now();
const sql=entries.map(r=>`INSERT INTO invitations(code_hash,subscriber_id,created_at,bound_at) VALUES (${quote(createHash('sha256').update(r.code).digest('hex'))},${r.id?quote(r.id):'NULL'},${now},${r.id?now:'NULL'});`).join('\n');
const record={status:'pending',environment:remote?'remote':'local',createdAt:new Date(now).toISOString(),invitations:entries.map(({id,...r})=>r)};
// Save before upload, so a timeout never loses the only copy of a code.
writeFileSync(out,JSON.stringify(record,null,2)+'\n',{mode:0o600,flag:'wx'});
writeFileSync(sqlFile,sql,{mode:0o600,flag:'wx'});
if(entries.length)run(['--file',sqlFile]);
record.status='issued';writeFileSync(out,JSON.stringify(record,null,2)+'\n',{mode:0o600});
console.log(`Issued ${count} new codes; preserved ${existing.length} existing emails. Private file: ${out}`);
