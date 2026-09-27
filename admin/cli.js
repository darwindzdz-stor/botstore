import 'dotenv/config';
import readline from 'node:readline';
import { initDb, query, get, run, backup, now } from '../src/db/index.js';
await initDb();
const rl=readline.createInterface({input:process.stdin,output:process.stdout});
const ask=q=>new Promise(r=>rl.question(q,r));
const adminId=(process.env.ADMIN_TELEGRAM_IDS||'local-admin').split(',')[0].trim()||'local-admin';
function audit(action,type,id,details=''){run('INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,details,created_at) VALUES(?,?,?,?,?,?)',[adminId,action,type,id==null?'':String(id),details,now()])}
function dash(){console.table({users:get('SELECT COUNT(*) c FROM users')?.c||0,approved_bots:get("SELECT COUNT(*) c FROM bots WHERE status='APPROVED'")?.c||0,pending:get("SELECT COUNT(*) c FROM submissions WHERE status='PENDING'")?.c||0,reports:get("SELECT COUNT(*) c FROM reports WHERE status='OPEN'")?.c||0,tickets:get("SELECT COUNT(*) c FROM tickets WHERE status IN ('OPEN','IN_PROGRESS')")?.c||0,requests:get("SELECT COUNT(*) c FROM search_requests WHERE status='OPEN'")?.c||0,views:get('SELECT COALESCE(SUM(views),0) c FROM bots')?.c||0,opens:get('SELECT COALESCE(SUM(opens),0) c FROM bots')?.c||0})}
async function main(){console.log('\n🏪 BOT STORE ADMIN — CONTROL CENTER\n');while(true){console.log('\n1 Dashboard\n2 Pending submissions\n3 Approved bots\n4 Reports\n5 Tickets\n6 Search requests\n7 Add bot\n8 Approve submission\n9 Suspend bot\n10 Feature/Unfeature\n11 Verify/Unverify\n12 Backup\n13 Audit log\n0 Exit');const c=(await ask('\n> ')).trim();if(c==='0')break;
try{if(c==='1')dash();
else if(c==='2')console.table(query("SELECT id,username,name,status,created_at FROM submissions WHERE status='PENDING' ORDER BY id DESC LIMIT 100"));
else if(c==='3')console.table(query("SELECT id,username,name,status,verified,featured,views,opens FROM bots WHERE status='APPROVED' ORDER BY featured DESC,opens DESC LIMIT 100"));
else if(c==='4')console.table(query('SELECT r.id,b.username,r.reason,r.status,r.created_at FROM reports r JOIN bots b ON b.id=r.bot_id ORDER BY r.id DESC LIMIT 100'));
else if(c==='5')console.table(query('SELECT id,subject,priority,status,created_at FROM tickets ORDER BY id DESC LIMIT 100'));
else if(c==='6')console.table(query('SELECT id,query,contact_username,status,created_at FROM search_requests ORDER BY id DESC LIMIT 100'));
else if(c==='7'){const username=(await ask('username: ')).replace(/^@/,''),name=await ask('name: '),description=await ask('description: '),url=await ask('url: '),cat=await ask('category id: ');run("INSERT INTO bots(username,name,description,url,category_id,status,created_at,updated_at) VALUES(?,?,?,?,?,'APPROVED',?,?)",[username,name,description,url,Number(cat),now(),now()]);audit('ADD','BOT',get('SELECT last_insert_rowid() id').id,username);console.log('Added.');}
else if(c==='8'){const id=await ask('submission id: '),s=get('SELECT * FROM submissions WHERE id=?',[id]);if(!s){console.log('Not found');continue}if(get('SELECT id FROM bots WHERE LOWER(username)=LOWER(?)',[s.username.replace(/^@/, '')])){console.log('A bot with this username already exists.');continue}run("INSERT INTO bots(username,name,description,url,category_id,tags,status,created_at,updated_at) VALUES(?,?,?,?,?,?, 'APPROVED',?,?)",[s.username.replace(/^@/,''),s.name,s.description,s.url,s.category_id,s.tags,s.created_at,now()]);run("UPDATE submissions SET status='APPROVED',updated_at=? WHERE id=?",[now(),id]);audit('APPROVE','SUBMISSION',id,s.username);console.log('Approved.');}
else if(c==='9'){const id=await ask('bot id: ');run("UPDATE bots SET status='SUSPENDED',updated_at=? WHERE id=?",[now(),id]);audit('SUSPEND','BOT',id);console.log('Suspended.');}
else if(c==='10'){const id=await ask('bot id: ');const v=get('SELECT featured FROM bots WHERE id=?',[id]);if(!v){console.log('Not found');continue}run('UPDATE bots SET featured=?,updated_at=? WHERE id=?',[Number(!Number(v.featured)),now(),id]);audit('FEATURE_TOGGLE','BOT',id);console.log('Updated.');}
else if(c==='11'){const id=await ask('bot id: ');const v=get('SELECT verified FROM bots WHERE id=?',[id]);if(!v){console.log('Not found');continue}run('UPDATE bots SET verified=?,updated_at=? WHERE id=?',[Number(!Number(v.verified)),now(),id]);audit('VERIFY_TOGGLE','BOT',id);console.log('Updated.');}
else if(c==='12'){const target=`./data/backup-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`;backup(target);console.log(`Backup: ${target}`);}
else if(c==='13')console.table(query('SELECT id,admin_id,action,entity_type,entity_id,details,created_at FROM audit_logs ORDER BY id DESC LIMIT 100'));
else console.log('Unknown command.');}catch(e){console.error('ADMIN_ERROR:',e.message)}}rl.close()}
main();
