import 'dotenv/config';
import {initDb,run,get,now} from '../src/db/index.js';
await initDb();
const cats=[['ai','AI','🤖'],['games','Games','🎮'],['download','Download','📥'],['education','Education','📚'],['tools','Tools','🛠️'],['entertainment','Entertainment','🎬'],['finance','Finance','💰'],['other','Other','📦']];
for(const c of cats)run('INSERT OR IGNORE INTO categories(slug,name,icon) VALUES(?,?,?)',c);
const rows=[['demo_ai_bot','Demo AI Bot','Demo entry for the Bot Store. Replace with a real verified listing.','https://t.me/demo_ai_bot','ai',['ai','assistant']],['demo_game_bot','Demo Game Bot','Demo game listing for development and UI testing.','https://t.me/demo_game_bot','games',['game','fun']],['demo_tools_bot','Demo Tools Bot','Demo utilities listing used only for development.','https://t.me/demo_tools_bot','tools',['tools','utility']]];
for(const [u,n,d,url,slug,tags] of rows){const cat=get('SELECT id FROM categories WHERE slug=?',[slug]);run('INSERT OR IGNORE INTO bots(username,name,description,url,category_id,tags,status,created_at,updated_at) VALUES(?,?,?,?,?,?,\'APPROVED\',?,?)',[u,n,d,url,cat.id,JSON.stringify(tags),now(),now()]);}
console.log('Seed complete.');
