import crypto from 'node:crypto';
import { get, query, run, now } from '../db/index.js';

export function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken || typeof initData !== 'string' || initData.length > 8192) return null;
  try {
    const p = new URLSearchParams(initData);
    const keys = new Set();
    for (const [k] of p.entries()) { if (!k || k.length > 64 || keys.has(k)) return null; keys.add(k); }
    const hash = p.get('hash');
    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
    const authDate = Number(p.get('auth_date') || 0);
    const configuredAge = Number(process.env.TELEGRAM_AUTH_MAX_AGE || 86400);
    const maxAge = Number.isFinite(configuredAge) ? Math.min(Math.max(configuredAge, 60), 86400) : 86400;
    const nowSec = Math.floor(Date.now()/1000);
    if (!Number.isFinite(authDate) || authDate <= 0 || authDate > nowSec + 60 || nowSec - authDate > maxAge) return null;
    const data = [...p.entries()].filter(([k])=>k!=='hash').sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256','WebAppData').update(botToken).digest();
    const expected = crypto.createHmac('sha256',secret).update(data).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(expected,'hex'), Buffer.from(hash,'hex'))) return null;
    const userRaw = p.get('user');
    if (!userRaw || userRaw.length > 4096) return null;
    const user = JSON.parse(userRaw);
    if (!user || typeof user !== 'object' || Array.isArray(user)) return null;
    if (!Number.isSafeInteger(Number(user.id)) || Number(user.id) <= 0) return null;
    if (user.username !== undefined && (typeof user.username !== 'string' || user.username.length > 64)) return null;
    if (user.first_name !== undefined && (typeof user.first_name !== 'string' || user.first_name.length > 128)) return null;
    if (user.language_code !== undefined && (typeof user.language_code !== 'string' || user.language_code.length > 16)) return null;
    return {
      id:Number(user.id),
      username:typeof user.username==='string'?user.username.slice(0,64):'',
      first_name:typeof user.first_name==='string'?user.first_name.slice(0,128):'',
      language_code:typeof user.language_code==='string'?user.language_code.slice(0,16):'en'
    };
  } catch { return null; }
}
export function sessionTokenHash(token){ return crypto.createHash('sha256').update(token).digest('hex'); }
export function createSession(tg){
  const token=crypto.randomBytes(32).toString('hex');
  const ttl=Math.min(Math.max(Number(process.env.SESSION_TTL||43200),900),604800);
  const t=now(), exp=new Date(Date.now()+ttl*1000).toISOString();
  const u=upsertUser(tg);
  // Keep a small bounded number of active sessions per account. This limits replay/session accumulation
  // without forcing a single active device.
  run('DELETE FROM sessions WHERE user_id=? AND expires_at<=?', [u.id, t]);
  run('INSERT INTO sessions(token_hash,user_id,created_at,last_used_at,expires_at) VALUES(?,?,?,?,?)',[sessionTokenHash(token),u.id,t,t,exp]);
  const extra=querySessionIds(u.id);
  for (const x of extra.slice(5)) run('DELETE FROM sessions WHERE id=?',[x.id]);
  return {token,expires_at:exp,user:u};
}
function querySessionIds(userId){ return query('SELECT id FROM sessions WHERE user_id=? ORDER BY created_at DESC',[userId]); }
export function requireTelegramInitData(req,res,next){
  const raw=req.get('x-telegram-init-data');
  const tg=verifyTelegramInitData(raw,process.env.BOT_TOKEN);
  if(!tg) return res.status(401).json({error:'TELEGRAM_AUTH_REQUIRED'});
  req.user=tg;
  next();
}

export function authenticateRequest(req){
  const token=req.get('x-botstore-session');
  if(token && /^[a-f0-9]{64}$/i.test(token)) {
    const s=get(`SELECT s.user_id,s.expires_at,s.last_used_at,u.telegram_id,u.username,u.first_name,u.language FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`,[sessionTokenHash(token)]);
    if(s && Date.parse(s.expires_at)>Date.now()){
      req.user={id:Number(s.telegram_id),username:s.username||'',first_name:s.first_name||'',language_code:s.language||'en'};
      const last=s.last_used_at?Date.parse(s.last_used_at):0;
      if(!last || Date.now()-last>=5*60*1000) run('UPDATE sessions SET last_used_at=? WHERE token_hash=?',[now(),sessionTokenHash(token)]);
      return;
    }
  }
  if(req.path==='/auth/telegram'){
    const raw=req.get('x-telegram-init-data');
    const tg=verifyTelegramInitData(raw,process.env.BOT_TOKEN);
    if(tg) req.user=tg;
  }
}
export function logoutSession(req){ const token=req.get('x-botstore-session'); if(token && /^[a-f0-9]{64}$/i.test(token)) run('DELETE FROM sessions WHERE token_hash=?',[sessionTokenHash(token)]); }
export function requireUser(req,res,next) { if (!req.user) return res.status(401).json({error:'AUTH_REQUIRED'}); next(); }
export function upsertUser(tg) {
  const id=String(tg.id);
  const username=tg.username||'';
  const firstName=tg.first_name||'';
  const language=tg.language_code||'en';
  const t=now();

  run(`INSERT INTO users(telegram_id,username,first_name,language,created_at,updated_at)
       VALUES(?,?,?,?,?,?)
       ON CONFLICT(telegram_id) DO UPDATE SET
         username=excluded.username,
         first_name=excluded.first_name,
         language=excluded.language,
         updated_at=excluded.updated_at`,
    [id,username,firstName,language,t,t]);

  return get('SELECT * FROM users WHERE telegram_id=?',[id]);
}
