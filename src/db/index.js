import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';

const dbFile = process.env.DB_FILE || './data/botstore.sqlite';
let db;
let SQL;
let saveTimer;
let saveInProgress = false;

export async function initDb() {
  SQL = await initSqlJs();
  fs.mkdirSync(path.dirname(path.resolve(dbFile)), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(path.dirname(path.resolve(dbFile)),0o700); } catch {}
  db = fs.existsSync(dbFile) ? new SQL.Database(fs.readFileSync(dbFile)) : new SQL.Database();
  db.run(`PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, telegram_id TEXT UNIQUE NOT NULL, username TEXT, first_name TEXT, language TEXT DEFAULT 'en', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT UNIQUE NOT NULL, user_id INTEGER NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT, expires_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, icon TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS bots(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, url TEXT NOT NULL, category_id INTEGER, image_url TEXT, tags TEXT DEFAULT '[]', status TEXT NOT NULL DEFAULT 'PENDING', verified INTEGER DEFAULT 0, featured INTEGER DEFAULT 0, views INTEGER DEFAULT 0, opens INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(category_id) REFERENCES categories(id));
  CREATE TABLE IF NOT EXISTS favorites(user_id INTEGER NOT NULL, bot_id INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,bot_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(bot_id) REFERENCES bots(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS ratings(user_id INTEGER NOT NULL, bot_id INTEGER NOT NULL, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), review TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,bot_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(bot_id) REFERENCES bots(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS submissions(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, username TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, url TEXT NOT NULL, category_id INTEGER, tags TEXT DEFAULT '[]', status TEXT NOT NULL DEFAULT 'PENDING', moderator_note TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(category_id) REFERENCES categories(id));
  CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, bot_id INTEGER NOT NULL, reason TEXT NOT NULL, details TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(bot_id) REFERENCES bots(id));
  CREATE TABLE IF NOT EXISTS tickets(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, subject TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'NORMAL', status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id));
  CREATE TABLE IF NOT EXISTS ticket_messages(id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, sender_type TEXT NOT NULL, sender_id TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS search_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, query TEXT NOT NULL, contact_username TEXT DEFAULT '', details TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id));
  CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, bot_id INTEGER, type TEXT NOT NULL, query TEXT DEFAULT '', created_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(bot_id) REFERENCES bots(id));
  CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT, entity_id TEXT, details TEXT DEFAULT '', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ads(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, text TEXT DEFAULT '', url TEXT NOT NULL, image_url TEXT DEFAULT '', active INTEGER DEFAULT 1, priority INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_bots_status_category ON bots(status,category_id);
  CREATE INDEX IF NOT EXISTS idx_bots_popularity ON bots(status,featured,opens,views);
  CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(type,created_at);
  CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status,created_at);
  CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status,created_at);
  CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status,created_at);
  CREATE INDEX IF NOT EXISTS idx_search_requests_status ON search_requests(status,created_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bots_username_nocase ON bots(username COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_favorites_user_created ON favorites(user_id,created_at);
  CREATE INDEX IF NOT EXISTS idx_ratings_bot_updated ON ratings(bot_id,updated_at);
  CREATE INDEX IF NOT EXISTS idx_events_user_bot_time ON events(user_id,bot_id,created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_ads_active_priority ON ads(active,priority,id);`);
  seedCategories();
  save();
}
function seedCategories() {
  const rows = [['ai','AI','🤖'],['games','Games','🎮'],['download','Download','📥'],['education','Education','📚'],['tools','Tools','🛠️'],['entertainment','Entertainment','🎬'],['finance','Finance','💰'],['other','Other','✨']];
  const stmt = db.prepare('INSERT OR IGNORE INTO categories(slug,name,icon) VALUES(?,?,?)');
  for (const r of rows) stmt.run(r);
  stmt.free();
}
function save() {
  if (!db || saveInProgress) return;
  saveInProgress = true;
  try {
    const tmp=`${dbFile}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(db.export()), { mode: 0o600 });
    try { fs.chmodSync(tmp,0o600); } catch {}
    fs.renameSync(tmp,dbFile);
    try { fs.chmodSync(dbFile,0o600); } catch {}
  } finally { saveInProgress=false; }
}
export function flush() { clearTimeout(saveTimer); save(); }
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 250); }
export function databasePath() { return dbFile; }
export function pruneSessions() { if(!db) return; db.run('DELETE FROM sessions WHERE expires_at <= ?', [now()]); save(); }
export function pruneEvents(days=90) {
  if(!db) return;
  const safeDays=Math.min(Math.max(Number(days)||90,7),3650);
  const cutoff=new Date(Date.now()-safeDays*86400000).toISOString();
  db.run('DELETE FROM events WHERE created_at < ?', [cutoff]);
  db.run('DELETE FROM audit_logs WHERE created_at < ?', [new Date(Date.now()-365*86400000).toISOString()]);
  save();
}
export function backupDirectory() { return path.join(path.dirname(path.resolve(dbFile)), 'backups'); }
export function pruneBackups(keep=10) {
  const dir=backupDirectory();
  if(!fs.existsSync(dir)) return;
  const files=fs.readdirSync(dir).filter(f=>/^backup-.*\.sqlite$/.test(f))
    .map(name=>({name,mtime:fs.statSync(path.join(dir,name)).mtimeMs}))
    .sort((a,b)=>b.mtime-a.mtime);
  for(const f of files.slice(Math.max(0,Number(keep)||10))) {
    try { fs.unlinkSync(path.join(dir,f.name)); } catch {}
  }
}
export function now() { return new Date().toISOString(); }
export function query(sql, params = []) { const stmt = db.prepare(sql); stmt.bind(params); const out=[]; while(stmt.step()) out.push(stmt.getAsObject()); stmt.free(); return out; }
export function get(sql, params = []) { return query(sql, params)[0] || null; }
export function run(sql, params = []) { db.run(sql, params); scheduleSave(); }
export function transaction(fn) { db.run('BEGIN'); try { const result=fn(); db.run('COMMIT'); save(); return result; } catch (e) { db.run('ROLLBACK'); throw e; } }
export function integrityCheck() {
  if (!db) throw new Error('DB_NOT_INITIALIZED');
  const rows=query('PRAGMA integrity_check');
  return rows.length===1 && Object.values(rows[0])[0]==='ok';
}

export function backup(target) {
  flush();
  fs.mkdirSync(path.dirname(target), {recursive:true});
  const tmp=`${target}.tmp`;
  fs.copyFileSync(dbFile,tmp);
  try { fs.chmodSync(tmp,0o600); } catch {}
  fs.renameSync(tmp,target);
  try { fs.chmodSync(target,0o600); } catch {}
}
