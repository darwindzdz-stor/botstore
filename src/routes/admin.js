import express from 'express';
import path from 'node:path';
import { z } from 'zod';
import { get, query, run, transaction, now, backup, integrityCheck, backupDirectory, pruneBackups } from '../db/index.js';
import { requireUser, upsertUser } from '../middleware/auth.js';
import { invalidateDiscoveryCache } from './api.js';
import { requireAdmin } from '../middleware/admin.js';
import { httpsUrl, telegramBotUrl, userRateLimit, sensitiveRateLimit, normalizeBotUsername, telegramUrlMatchesUsername } from '../security.js';

export const adminApi=express.Router();
adminApi.use(userRateLimit(120), requireUser, (req,res,next)=>{ upsertUser(req.user); next(); }, requireAdmin);
adminApi.use((req,res,next)=>{res.set('Cache-Control','no-store');next()});

const id=z.coerce.number().int().positive();
const bool=z.preprocess(v=>v===true||v==='true'||v===1||v==='1',z.boolean());
const botSchema=z.object({
  username:z.string().trim().regex(/^@?[A-Za-z0-9_]{3,64}$/),
  name:z.string().trim().min(1).max(120),
  description:z.string().trim().min(1).max(2000),
  url:telegramBotUrl,
  category_id:z.coerce.number().int().positive(),
  image_url:httpsUrl.optional().or(z.literal('')),
  tags:z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  status:z.enum(['APPROVED','PENDING','SUSPENDED','ARCHIVED']).default('APPROVED'),
  verified:bool.default(false),
  featured:bool.default(false)
});
const audit=(req,action,type,entityId,details='')=>run('INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,details,created_at) VALUES(?,?,?,?,?,?)',[String(req.user.id),action,type,entityId==null?'':String(entityId),details,now()]);
const parseTags=s=>{try{return JSON.parse(s||'[]')}catch{return []}};
const row=r=>({...r,tags:parseTags(r.tags),verified:Boolean(Number(r.verified)),featured:Boolean(Number(r.featured))});


const adSchema=z.object({title:z.string().trim().min(1).max(120),text:z.string().trim().max(500).default(''),url:telegramBotUrl,image_url:httpsUrl.optional().or(z.literal('')),active:bool.default(true),priority:z.coerce.number().int().min(-100).max(100).default(0)});
adminApi.get('/ads',(req,res)=>res.json({ads:query('SELECT * FROM ads ORDER BY priority DESC,id DESC')}));
adminApi.post('/ads',(req,res)=>{const s=adSchema.safeParse(req.body);if(!s.success)return res.status(400).json({error:'INVALID_INPUT'});const d=s.data,t=now();run('INSERT INTO ads(title,text,url,image_url,active,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',[d.title,d.text,d.url,d.image_url||'',Number(d.active),d.priority,t,t]);const aid=get('SELECT last_insert_rowid() id').id;audit(req,'CREATE','AD',aid,d.title);res.status(201).json({ad:get('SELECT * FROM ads WHERE id=?',[aid])})});
adminApi.patch('/ads/:id',(req,res)=>{const aid=id.parse(req.params.id),old=get('SELECT id FROM ads WHERE id=?',[aid]);if(!old)return res.status(404).json({error:'NOT_FOUND'});const s=adSchema.partial().safeParse(req.body);if(!s.success)return res.status(400).json({error:'INVALID_INPUT'});const d=s.data,fields=[],p=[];for(const k of ['title','text','url','image_url','priority'])if(d[k]!==undefined){fields.push(`${k}=?`);p.push(d[k])}if(d.active!==undefined){fields.push('active=?');p.push(Number(d.active))}fields.push('updated_at=?');p.push(now(),aid);run(`UPDATE ads SET ${fields.join(',')} WHERE id=?`,p);audit(req,'UPDATE','AD',aid,JSON.stringify(Object.keys(d)));res.json({ad:get('SELECT * FROM ads WHERE id=?',[aid])})});
adminApi.delete('/ads/:id',sensitiveRateLimit(10,60_000),(req,res)=>{const aid=id.parse(req.params.id);if(!get('SELECT id FROM ads WHERE id=?',[aid]))return res.status(404).json({error:'NOT_FOUND'});run('DELETE FROM ads WHERE id=?',[aid]);audit(req,'DELETE','AD',aid);res.json({ok:true})});

adminApi.get('/dashboard',(req,res)=>{
  const stats={
    users:Number(get('SELECT COUNT(*) c FROM users')?.c||0),
    bots:Number(get("SELECT COUNT(*) c FROM bots WHERE status='APPROVED'")?.c||0),
    pending:Number(get("SELECT COUNT(*) c FROM submissions WHERE status='PENDING'")?.c||0),
    reports:Number(get("SELECT COUNT(*) c FROM reports WHERE status='OPEN'")?.c||0),
    tickets:Number(get("SELECT COUNT(*) c FROM tickets WHERE status IN ('OPEN','IN_PROGRESS')")?.c||0),
    requests:Number(get("SELECT COUNT(*) c FROM search_requests WHERE status='OPEN'")?.c||0),
    views:Number(get('SELECT COALESCE(SUM(views),0) c FROM bots')?.c||0),
    opens:Number(get('SELECT COALESCE(SUM(opens),0) c FROM bots')?.c||0)
  };
  const recent=query(`SELECT id,username,name,status,verified,featured,views,opens,created_at,updated_at FROM bots ORDER BY id DESC LIMIT 20`).map(row);
  const reports=query(`SELECT r.id,r.reason,r.details,r.status,r.created_at,b.id bot_id,b.username,b.name FROM reports r JOIN bots b ON b.id=r.bot_id ORDER BY r.id DESC LIMIT 12`);
  const submissions=query(`SELECT s.id,s.username,s.name,s.description,s.url,s.category_id,s.tags,s.status,s.moderator_note,s.created_at,u.telegram_id,u.username user_username FROM submissions s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 12`).map(row);
  res.json({stats,recent,reports,submissions,categories:query('SELECT id,slug,name,icon FROM categories ORDER BY id')});
});

adminApi.get('/bots',(req,res)=>{
  const q=String(req.query.q||'').trim().slice(0,80),status=String(req.query.status||'').trim();
  const p=[]; let where='1=1';
  if(q){const x=q.replace(/[\\%_]/g,m=>'\\'+m);where+=` AND (LOWER(username) LIKE LOWER(?) ESCAPE '\\' OR LOWER(name) LIKE LOWER(?) ESCAPE '\\')`;p.push(`%${x}%`,`%${x}%`)}
  if(['APPROVED','PENDING','SUSPENDED','ARCHIVED'].includes(status)){where+=' AND status=?';p.push(status)}
  res.json({bots:query(`SELECT b.*,c.name category_name FROM bots b LEFT JOIN categories c ON c.id=b.category_id WHERE ${where} ORDER BY b.featured DESC,b.id DESC LIMIT 100`,p).map(row)});
});

adminApi.post('/bots',sensitiveRateLimit(20,60_000),(req,res)=>{
  const s=botSchema.safeParse(req.body); if(!s.success)return res.status(400).json({error:'INVALID_INPUT',details:s.error.issues});
  const d=s.data,username=normalizeBotUsername(d.username);
  if(!telegramUrlMatchesUsername(d.url,username))return res.status(400).json({error:'USERNAME_URL_MISMATCH'});
  if(get('SELECT id FROM bots WHERE LOWER(username)=LOWER(?)',[username]))return res.status(409).json({error:'BOT_ALREADY_EXISTS'});
  if(!get('SELECT id FROM categories WHERE id=?',[d.category_id]))return res.status(400).json({error:'INVALID_CATEGORY'});
  const t=now(); run(`INSERT INTO bots(username,name,description,url,category_id,image_url,tags,status,verified,featured,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,[username,d.name,d.description,d.url,d.category_id,d.image_url||'',JSON.stringify(d.tags),d.status,Number(d.verified),Number(d.featured),t,t]);
  const bot=get('SELECT last_insert_rowid() id').id; invalidateDiscoveryCache(); audit(req,'CREATE','BOT',bot,username); res.status(201).json({bot:row(get('SELECT * FROM bots WHERE id=?',[bot]))});
});

adminApi.patch('/bots/:id',sensitiveRateLimit(30,60_000),(req,res)=>{
  const bid=id.parse(req.params.id),old=get('SELECT * FROM bots WHERE id=?',[bid]); if(!old)return res.status(404).json({error:'NOT_FOUND'});
  const s=botSchema.partial().safeParse(req.body); if(!s.success)return res.status(400).json({error:'INVALID_INPUT',details:s.error.issues});
  const d=s.data;if(d.category_id!==undefined&&!get('SELECT id FROM categories WHERE id=?',[d.category_id]))return res.status(400).json({error:'INVALID_CATEGORY'});
  if(d.status!==undefined){
    const allowed={PENDING:['APPROVED','SUSPENDED','ARCHIVED'],APPROVED:['SUSPENDED','ARCHIVED'],SUSPENDED:['APPROVED','ARCHIVED'],ARCHIVED:['APPROVED']};
    if(d.status!==old.status && !allowed[old.status]?.includes(d.status))return res.status(409).json({error:'INVALID_STATUS_TRANSITION'});
    if(['SUSPENDED','ARCHIVED'].includes(d.status)){d.verified=false;d.featured=false;}
  }
  if(d.username!==undefined){d.username=normalizeBotUsername(d.username);const other=get('SELECT id FROM bots WHERE LOWER(username)=LOWER(?) AND id<>?',[d.username,bid]);if(other)return res.status(409).json({error:'BOT_ALREADY_EXISTS'})}
  if(d.url!==undefined || d.username!==undefined){const effectiveUrl=d.url!==undefined?d.url:old.url;const effectiveUsername=d.username!==undefined?d.username:old.username;if(!telegramUrlMatchesUsername(effectiveUrl,effectiveUsername))return res.status(400).json({error:'USERNAME_URL_MISMATCH'})}
  const fields=[];const p=[];for(const k of ['username','name','description','url','category_id','image_url','status','verified','featured']) if(d[k]!==undefined){fields.push(`${k}=?`);p.push(['verified','featured'].includes(k)?Number(d[k]):d[k])}
  if(d.tags!==undefined){fields.push('tags=?');p.push(JSON.stringify(d.tags))} fields.push('updated_at=?');p.push(now(),bid);
  if(fields.length>1)run(`UPDATE bots SET ${fields.join(',')} WHERE id=?`,p);
  invalidateDiscoveryCache(); audit(req,'UPDATE','BOT',bid,JSON.stringify(Object.keys(d))); res.json({bot:row(get('SELECT * FROM bots WHERE id=?',[bid]))});
});

adminApi.delete('/bots/:id',sensitiveRateLimit(10,60_000),(req,res)=>{
  const bid=id.parse(req.params.id),b=get('SELECT id,username,status FROM bots WHERE id=?',[bid]);
  if(!b)return res.status(404).json({error:'NOT_FOUND'});
  if(b.status==='ARCHIVED')return res.status(409).json({error:'ALREADY_ARCHIVED'});
  run("UPDATE bots SET status='ARCHIVED',verified=0,featured=0,updated_at=? WHERE id=?",[now(),bid]);
  invalidateDiscoveryCache(); audit(req,'ARCHIVE','BOT',bid,b.username);
  res.json({ok:true,status:'ARCHIVED'});
});

adminApi.post('/bots/:id/restore',sensitiveRateLimit(10,60_000),(req,res)=>{
  const bid=id.parse(req.params.id),b=get('SELECT id,username,status FROM bots WHERE id=?',[bid]);
  if(!b)return res.status(404).json({error:'NOT_FOUND'});
  if(b.status!=='ARCHIVED')return res.status(409).json({error:'BOT_NOT_ARCHIVED'});
  if(get("SELECT id FROM bots WHERE LOWER(username)=LOWER(?) AND id<>? AND status<>'ARCHIVED'",[b.username,bid]))return res.status(409).json({error:'BOT_ALREADY_EXISTS'});
  run("UPDATE bots SET status='APPROVED',updated_at=? WHERE id=?",[now(),bid]);
  invalidateDiscoveryCache(); audit(req,'RESTORE','BOT',bid,b.username);
  res.json({ok:true,status:'APPROVED'});
});

adminApi.post('/bots/:id/purge',sensitiveRateLimit(2,10*60_000),(req,res)=>{
  const bid=id.parse(req.params.id),b=get('SELECT id,username,status FROM bots WHERE id=?',[bid]);
  if(!b)return res.status(404).json({error:'NOT_FOUND'});
  if(b.status!=='ARCHIVED')return res.status(409).json({error:'BOT_MUST_BE_ARCHIVED_FIRST'});
  if(req.body?.confirm!==`PURGE:${bid}`)return res.status(400).json({error:'PURGE_CONFIRMATION_REQUIRED'});
  transaction(()=>{run('DELETE FROM favorites WHERE bot_id=?',[bid]);run('DELETE FROM ratings WHERE bot_id=?',[bid]);run('DELETE FROM reports WHERE bot_id=?',[bid]);run('DELETE FROM events WHERE bot_id=?',[bid]);run('DELETE FROM bots WHERE id=?',[bid]);});
  invalidateDiscoveryCache(); audit(req,'PURGE','BOT',bid,b.username);
  res.json({ok:true});
});

adminApi.post('/submissions/:id/approve',sensitiveRateLimit(20,60_000),(req,res)=>{
  const sid=id.parse(req.params.id),s=get('SELECT * FROM submissions WHERE id=?',[sid]);if(!s)return res.status(404).json({error:'NOT_FOUND'});if(s.status!=='PENDING')return res.status(409).json({error:'SUBMISSION_NOT_PENDING'});if(!get('SELECT id FROM categories WHERE id=?',[s.category_id]))return res.status(400).json({error:'INVALID_CATEGORY'});
  const username=normalizeBotUsername(s.username);
  if(!telegramUrlMatchesUsername(s.url,username))return res.status(400).json({error:'USERNAME_URL_MISMATCH'});
  if(get('SELECT id FROM bots WHERE LOWER(username)=LOWER(?) AND status<>\'ARCHIVED\'',[username]))return res.status(409).json({error:'BOT_ALREADY_EXISTS'});
  transaction(()=>{run(`INSERT INTO bots(username,name,description,url,category_id,tags,status,created_at,updated_at) VALUES(?,?,?,?,?,?, 'APPROVED',?,?)`,[username,s.name,s.description,s.url,s.category_id,s.tags,s.created_at,now()]);run("UPDATE submissions SET status='APPROVED',updated_at=? WHERE id=?",[now(),sid]);});invalidateDiscoveryCache();audit(req,'APPROVE','SUBMISSION',sid,s.username);res.json({ok:true});
});
adminApi.post('/submissions/:id/reject',sensitiveRateLimit(20,60_000),(req,res)=>{const sid=id.parse(req.params.id),note=String(req.body?.note||'').trim().slice(0,1000),s=get('SELECT id,status FROM submissions WHERE id=?',[sid]);if(!s)return res.status(404).json({error:'NOT_FOUND'});if(s.status!=='PENDING')return res.status(409).json({error:'SUBMISSION_NOT_PENDING'});run("UPDATE submissions SET status='REJECTED',moderator_note=?,updated_at=? WHERE id=?",[note,now(),sid]);audit(req,'REJECT','SUBMISSION',sid,note);res.json({ok:true})});

adminApi.patch('/reports/:id',sensitiveRateLimit(30,60_000),(req,res)=>{const rid=id.parse(req.params.id),status=z.enum(['OPEN','REVIEWING','RESOLVED','DISMISSED']).safeParse(req.body?.status);if(!status.success)return res.status(400).json({error:'INVALID_STATUS'});if(!get('SELECT id FROM reports WHERE id=?',[rid]))return res.status(404).json({error:'NOT_FOUND'});run('UPDATE reports SET status=?,updated_at=? WHERE id=?',[status.data,now(),rid]);audit(req,'REPORT_STATUS','REPORT',rid,status.data);res.json({ok:true})});
adminApi.get('/audit',(req,res)=>{ const page=Math.min(Math.max(Number(req.query.page)||1,1),100000); const limit=Math.min(Math.max(Number(req.query.limit)||50,1),100); const offset=(page-1)*limit; const logs=query('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?',[limit,offset]); const total=Number(get('SELECT COUNT(*) c FROM audit_logs')?.c||0); res.json({logs,page,limit,total,pages:Math.ceil(total/limit)}); });
adminApi.get('/integrity',(req,res)=>{ try { res.json({ok:integrityCheck()}); } catch { res.status(503).json({error:'INTEGRITY_CHECK_FAILED'}); } });
adminApi.post('/backup',sensitiveRateLimit(1,10*60_000),(req,res)=>{
  const safe=`backup-${new Date().toISOString().replace(/[:.]/g,'-')}`;
  const dir=backupDirectory();
  const target=path.join(dir,`${safe}.sqlite`);
  backup(target);
  pruneBackups(Number(process.env.BACKUP_RETENTION||10));
  audit(req,'BACKUP','DATABASE','',safe);
  res.json({ok:true,file:safe+'.sqlite'});
});
