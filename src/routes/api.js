import express from 'express';
import { z } from 'zod';
import { get, query, run, now, transaction } from '../db/index.js';
import { requireUser, requireTelegramInitData, upsertUser, createSession, logoutSession } from '../middleware/auth.js';
import { telegramBotUrl, userRateLimit, normalizeBotUsername, escapeLike, telegramUrlMatchesUsername, isSafeBotUsername } from '../security.js';

export const api=express.Router();
const discoverCache=new Map();
export function invalidateDiscoveryCache(){ discoverCache.clear(); }
const text=(max)=>z.string().trim().min(1).max(max);
const optionalText=(max)=>z.string().trim().max(max).default('');
function parseJson(s){try{return JSON.parse(s||'[]')}catch{return []}}
function botRow(r){return {...r,tags:parseJson(r.tags),verified:Boolean(Number(r.verified)),featured:Boolean(Number(r.featured)),rating:Number(r.rating||0),rating_count:Number(r.rating_count||0)}}
function userId(req){return get('SELECT id FROM users WHERE telegram_id=?',[String(req.user.id)])?.id||null}
function requireUserId(req,res){const uid=userId(req);if(!uid){res.status(401).json({error:'SESSION_INVALID'});return null}return uid}
function positiveId(value){const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null}

api.get('/health',(_,res)=>res.set('Cache-Control','no-store').json({ok:true,time:now()}));
api.post('/auth/telegram',requireTelegramInitData,userRateLimit(10,5*60_000),(req,res)=>{const u=upsertUser(req.user);const session=createSession(req.user);res.set('Cache-Control','no-store').json({session:session.token,expires_at:session.expires_at,user:{id:u.id,telegram_id:u.telegram_id,username:u.username,first_name:u.first_name,language:u.language}})});
api.post('/auth/logout',userRateLimit(20),requireUser,(req,res)=>{logoutSession(req);res.set('Cache-Control','no-store').json({ok:true})});
api.get('/me',requireUser,(req,res)=>res.json({user:get('SELECT id,telegram_id,username,first_name,language,created_at FROM users WHERE telegram_id=?',[String(req.user.id)])}));
api.get('/categories',userRateLimit(120), (req,res)=>res.json({categories:query(`SELECT c.id,c.slug,c.name,c.icon,COUNT(b.id) bot_count FROM categories c LEFT JOIN bots b ON b.category_id=c.id AND b.status='APPROVED' GROUP BY c.id ORDER BY bot_count DESC,c.id`).map(c=>({...c,bot_count:Number(c.bot_count||0)}))}));
api.get('/ads',userRateLimit(120), (req,res)=>res.json({ads:query("SELECT id,title,text,url,image_url,priority FROM ads WHERE active=1 ORDER BY priority DESC,id DESC LIMIT 3")}));
api.get('/ad-config',userRateLimit(120), (req,res)=>res.json({enabled:process.env.GOOGLE_IMA_ENABLED==='1',vastTag:process.env.GOOGLE_IMA_VAST_TAG||'',everyOpen:process.env.GOOGLE_IMA_EVERY_OPEN!=='0'}));

api.get('/discover',userRateLimit(60),(req,res)=>{
  const cacheKey='discover';
  const cached=discoverCache.get(cacheKey);
  if(cached && cached.expiresAt>Date.now()) return res.json(cached.value);
  const base=`FROM bots b LEFT JOIN categories c ON c.id=b.category_id LEFT JOIN ratings r ON r.bot_id=b.id WHERE b.status='APPROVED' GROUP BY b.id`;
  const select=`SELECT b.*,c.slug category_slug,c.name category_name,COALESCE(AVG(r.rating),0) rating,COUNT(r.rating) rating_count `;
  const featured=query(`${select}${base} ORDER BY b.featured DESC,b.opens DESC,b.created_at DESC LIMIT 8`).map(botRow);
  const popular=query(`${select}${base} ORDER BY (b.featured*80+b.opens*0.5+b.views*0.05+COALESCE(AVG(r.rating),0)*12) DESC,b.created_at DESC LIMIT 8`).map(botRow);
  const newest=query(`${select}${base} ORDER BY b.created_at DESC LIMIT 8`).map(botRow);
  const rated=query(`${select}${base} HAVING COUNT(r.rating)>=1 ORDER BY COALESCE(AVG(r.rating),0) DESC,COUNT(r.rating) DESC,b.created_at DESC LIMIT 8`).map(botRow);
  const value={featured,popular,newest,rated};
  discoverCache.set(cacheKey,{value,expiresAt:Date.now()+20_000});
  res.json(value);
});

api.get('/bots',userRateLimit(90), (req,res)=>{
  const q=String(req.query.q||'').trim().slice(0,80),cat=String(req.query.category||'').trim().slice(0,50),sort=String(req.query.sort||'relevance');
  const page=Math.min(1000,Math.max(1,Number(req.query.page||1)||1)),limit=Math.min(30,Math.max(1,Number(req.query.limit||12)||12)),offset=(page-1)*limit;
  let where=`b.status='APPROVED'`,p=[];
  if(q){where+=` AND (LOWER(b.name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(b.username) LIKE LOWER(?) ESCAPE '\\' OR LOWER(b.description) LIKE LOWER(?) ESCAPE '\\' OR LOWER(b.tags) LIKE LOWER(?) ESCAPE '\\')`;const escaped=escapeLike(q), x='%'+escaped+'%';p.push(x,x,x,x)}
  if(cat){where+=' AND c.slug=?';p.push(cat)}
  const count=Number(get(`SELECT COUNT(*) c FROM bots b LEFT JOIN categories c ON c.id=b.category_id WHERE ${where}`,p)?.c||0);
  const score=sort==='new'?`b.created_at DESC`:sort==='popular'?`(b.featured*80 + b.opens*0.5 + b.views*0.05 + COALESCE(AVG(r.rating),0)*12) DESC`:q?`CASE WHEN LOWER(b.name)=LOWER(?) THEN 1000 WHEN LOWER(b.username)=LOWER(?) THEN 900 WHEN LOWER(b.name) LIKE LOWER(?) THEN 500 ELSE 0 END + b.featured*80 + b.opens*0.5 + b.views*0.05 + COALESCE(AVG(r.rating),0)*12 DESC`:`b.featured DESC,b.opens DESC,b.views DESC,b.created_at DESC`;
  if(q){const escaped=escapeLike(q);p.push(q,q,'%'+escaped+'%');}
  const rows=query(`SELECT b.*,c.slug category_slug,c.name category_name,COALESCE(AVG(r.rating),0) rating,COUNT(r.rating) rating_count FROM bots b LEFT JOIN categories c ON c.id=b.category_id LEFT JOIN ratings r ON r.bot_id=b.id WHERE ${where} GROUP BY b.id ORDER BY ${score} LIMIT ? OFFSET ?`,[...p,limit,offset]).map(botRow);
  if(req.user&&q && q.length>=2){const uid=userId(req);if(uid && !get("SELECT id FROM events WHERE user_id=? AND type='search' AND query=? AND created_at>? LIMIT 1",[uid,q,new Date(Date.now()-30*1000).toISOString()])) run('INSERT INTO events(user_id,type,query,created_at) VALUES(?,?,?,?)',[uid,'search',q,now()]);}
  res.json({bots:rows,page,limit,total:count,pages:Math.ceil(count/limit),query:q,category:cat,sort});
});

api.get('/bots/:id',userRateLimit(60),(req,res)=>{
  const bid=positiveId(req.params.id);
  if(!bid)return res.status(400).json({error:'INVALID_ID'});
  const b=get(`SELECT b.*,c.slug category_slug,c.name category_name,COALESCE(AVG(r.rating),0) rating,COUNT(r.rating) rating_count FROM bots b LEFT JOIN categories c ON c.id=b.category_id LEFT JOIN ratings r ON r.bot_id=b.id WHERE b.id=? AND b.status='APPROVED' GROUP BY b.id`,[bid]);
  if(!b)return res.status(404).json({error:'NOT_FOUND'});
  let countView=false;
  if(req.user){
    const uid=userId(req);
    if(uid){
      transaction(()=>{
        const recent=get("SELECT id FROM events WHERE user_id=? AND bot_id=? AND type='view' AND created_at>? LIMIT 1",[uid,bid,new Date(Date.now()-10*60*1000).toISOString()]);
        if(!recent){
          countView=true;
          run('INSERT INTO events(user_id,bot_id,type,created_at) VALUES(?,?,?,?)',[uid,bid,'view',now()]);
        }
      });
    }
  }
  if(countView)run('UPDATE bots SET views=views+1,updated_at=? WHERE id=?',[now(),bid]);
  const reviews=query(`SELECT r.rating,r.review,r.updated_at,u.username,u.first_name FROM ratings r LEFT JOIN users u ON u.id=r.user_id WHERE r.bot_id=? AND r.review<>'' ORDER BY r.updated_at DESC LIMIT 5`,[bid]);
  const similar=query(`SELECT b.*,c.slug category_slug,c.name category_name,COALESCE(AVG(r.rating),0) rating,COUNT(r.rating) rating_count FROM bots b LEFT JOIN categories c ON c.id=b.category_id LEFT JOIN ratings r ON r.bot_id=b.id WHERE b.status='APPROVED' AND b.category_id=(SELECT category_id FROM bots WHERE id=?) AND b.id<>? GROUP BY b.id ORDER BY b.featured DESC,b.opens DESC LIMIT 4`,[bid,bid]).map(botRow);
  res.json({bot:botRow(b),reviews,similar});
});
api.post('/bots/:id/open',userRateLimit(30),requireUser,(req,res)=>{const bid=positiveId(req.params.id);if(!bid)return res.status(400).json({error:'INVALID_ID'});const b=get("SELECT id,url FROM bots WHERE id=? AND status='APPROVED'",[bid]);if(!b)return res.status(404).json({error:'NOT_FOUND'});const uid=requireUserId(req,res);if(!uid)return;let counted=false;transaction(()=>{const recent=get("SELECT id FROM events WHERE user_id=? AND bot_id=? AND type='open' AND created_at>? LIMIT 1",[uid,b.id,new Date(Date.now()-10*60*1000).toISOString()]);if(!recent){run('INSERT INTO events(user_id,bot_id,type,created_at) VALUES(?,?,?,?)',[uid,b.id,'open',now()]);counted=true;}});if(counted)run('UPDATE bots SET opens=opens+1,updated_at=? WHERE id=?',[now(),b.id]);res.json({url:b.url})});
api.post('/bots/:id/favorite',userRateLimit(40),requireUser,(req,res)=>{const bid=positiveId(req.params.id);if(!bid)return res.status(400).json({error:'INVALID_ID'});const uid=requireUserId(req,res);if(!uid)return;const b=get('SELECT id FROM bots WHERE id=? AND status=\'APPROVED\'',[bid]);if(!b)return res.status(404).json({error:'NOT_FOUND'});const exists=get('SELECT 1 FROM favorites WHERE user_id=? AND bot_id=?',[uid,b.id]);if(exists){run('DELETE FROM favorites WHERE user_id=? AND bot_id=?',[uid,b.id]);return res.json({favorite:false})}run('INSERT OR IGNORE INTO favorites(user_id,bot_id,created_at) VALUES(?,?,?)',[uid,b.id,now()]);res.json({favorite:true})});
api.get('/bots/:id/favorite',userRateLimit(60),requireUser,(req,res)=>{const bid=positiveId(req.params.id);if(!bid)return res.status(400).json({error:'INVALID_ID'});res.json({favorite:Boolean(get('SELECT 1 FROM favorites f JOIN bots b ON b.id=f.bot_id WHERE f.user_id=? AND f.bot_id=? AND b.status=\'APPROVED\'',[userId(req),bid]))})});
api.post('/bots/:id/rating',userRateLimit(10),requireUser,(req,res)=>{const bid=positiveId(req.params.id);if(!bid)return res.status(400).json({error:'INVALID_ID'});const s=z.object({rating:z.coerce.number().int().min(1).max(5),review:optionalText(500)}).safeParse(req.body);if(!s.success)return res.status(400).json({error:'INVALID_INPUT'});const uid=requireUserId(req,res);if(!uid)return;const b=get('SELECT id FROM bots WHERE id=? AND status=\'APPROVED\'',[bid]);if(!b)return res.status(404).json({error:'NOT_FOUND'});const t=now();transaction(()=>{const ex=get('SELECT 1 FROM ratings WHERE user_id=? AND bot_id=?',[uid,b.id]);if(ex)run('UPDATE ratings SET rating=?,review=?,updated_at=? WHERE user_id=? AND bot_id=?',[s.data.rating,s.data.review,t,uid,b.id]);else run('INSERT INTO ratings(user_id,bot_id,rating,review,created_at,updated_at) VALUES(?,?,?,?,?,?)',[uid,b.id,s.data.rating,s.data.review,t,t]);});res.json({ok:true})});

api.post('/submissions',userRateLimit(5,3600000),requireUser,(req,res)=>{const s=z.object({username:text(100),name:text(120),description:text(1500),url:telegramBotUrl,category_id:z.coerce.number().int().positive(),tags:z.array(z.string().trim().min(1).max(40)).max(20).default([])}).safeParse(req.body);if(!s.success)return res.status(400).json({error:'INVALID_INPUT'});const uid=requireUserId(req,res);if(!uid)return;const username=normalizeBotUsername(s.data.username);if(!isSafeBotUsername(username))return res.status(400).json({error:'INVALID_USERNAME'});if(!telegramUrlMatchesUsername(s.data.url,username))return res.status(400).json({error:'USERNAME_URL_MISMATCH'});if(!get('SELECT id FROM categories WHERE id=?',[s.data.category_id]))return res.status(400).json({error:'INVALID_CATEGORY'});if(get('SELECT 1 FROM bots WHERE LOWER(username)=LOWER(?) AND status<>\'ARCHIVED\'',[username])||get('SELECT 1 FROM submissions WHERE LOWER(username)=LOWER(?) AND status=\'PENDING\'',[username]))return res.status(409).json({error:'BOT_ALREADY_EXISTS'});run('INSERT INTO submissions(user_id,username,name,description,url,category_id,tags,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',[uid,username,s.data.name,s.data.description,s.data.url,s.data.category_id,JSON.stringify(s.data.tags),now(),now()]);res.json({ok:true})});
api.post('/bots/:id/report',userRateLimit(5,3600000),requireUser,(req,res)=>{const bid=positiveId(req.params.id);if(!bid)return res.status(400).json({error:'INVALID_ID'});const s=z.object({reason:text(80),details:optionalText(1000)}).safeParse(req.body);if(!s.success)return res.status(400).json({error:'INVALID_INPUT'});const uid=requireUserId(req,res);if(!uid)return;if(!get('SELECT id FROM bots WHERE id=? AND status=\'APPROVED\'',[bid]))return res.status(404).json({error:'NOT_FOUND'});if(get('SELECT 1 FROM reports WHERE user_id=? AND bot_id=? AND created_at>?',[uid,bid,new Date(Date.now()-86400000).toISOString()]))return res.status(429).json({error:'REPORT_ALREADY_SENT'});run('INSERT INTO reports(user_id,bot_id,reason,details,created_at,updated_at) VALUES(?,?,?,?,?,?)',[uid,bid,s.data.reason,s.data.details,now(),now()]);res.json({ok:true})});
api.post('/requests',userRateLimit(5,3600000),requireUser,(req,res)=>{const s=z.object({query:text(200),contact_username:optionalText(100),details:optionalText(1200)}).safeParse(req.body);if(!s.success)return res.status(400).json({error:'INVALID_INPUT'});const uid=requireUserId(req,res);if(!uid)return;if(s.data.contact_username && !isSafeBotUsername(normalizeBotUsername(s.data.contact_username)))return res.status(400).json({error:'INVALID_CONTACT_USERNAME'});if(get("SELECT 1 FROM search_requests WHERE user_id=? AND status='OPEN' AND created_at>?",[uid,new Date(Date.now()-3600000).toISOString()]))return res.status(429).json({error:'REQUEST_ALREADY_OPEN'});run('INSERT INTO search_requests(user_id,query,contact_username,details,created_at,updated_at) VALUES(?,?,?,?,?,?)',[uid,s.data.query,s.data.contact_username.replace(/^@/,''),s.data.details,now(),now()]);res.json({ok:true})});
api.post('/support/tickets',userRateLimit(5,3600000),requireUser,(req,res)=>{const s=z.object({subject:text(200),message:text(3000),priority:z.enum(['LOW','NORMAL','HIGH']).default('NORMAL')}).safeParse(req.body);if(!s.success)return res.status(400).json({error:'INVALID_INPUT'});const uid=requireUserId(req,res);if(!uid)return;const t=now();if(get("SELECT 1 FROM tickets WHERE user_id=? AND status IN ('OPEN','IN_PROGRESS') AND created_at>?",[uid,new Date(Date.now()-3600000).toISOString()]))return res.status(429).json({error:'TICKET_ALREADY_OPEN'});let ticketId;transaction(()=>{run('INSERT INTO tickets(user_id,subject,priority,created_at,updated_at) VALUES(?,?,?,?,?)',[uid,s.data.subject,s.data.priority,t,t]);ticketId=get('SELECT last_insert_rowid() id').id;run('INSERT INTO ticket_messages(ticket_id,sender_type,sender_id,message,created_at) VALUES(?,?,?,?,?)',[ticketId,'USER',String(req.user.id),s.data.message,t]);});res.json({ticket_id:ticketId})});
api.get('/favorites',requireUser,(req,res)=>{const uid=requireUserId(req,res);if(!uid)return;const bots=query(`SELECT b.*,c.name category_name,COALESCE(AVG(r.rating),0) rating,COUNT(r.rating) rating_count FROM favorites f JOIN bots b ON b.id=f.bot_id LEFT JOIN categories c ON c.id=b.category_id LEFT JOIN ratings r ON r.bot_id=b.id WHERE f.user_id=? AND b.status='APPROVED' GROUP BY b.id ORDER BY f.created_at DESC`,[uid]).map(botRow);res.json({bots});});
api.get('/stats',userRateLimit(60),(req,res)=>{const stats={bots:Number(get("SELECT COUNT(*) c FROM bots WHERE status='APPROVED'")?.c||0),users:Number(get('SELECT COUNT(*) c FROM users')?.c||0),views:Number(get("SELECT COALESCE(SUM(views),0) c FROM bots WHERE status='APPROVED'")?.c||0),opens:Number(get("SELECT COALESCE(SUM(opens),0) c FROM bots WHERE status='APPROVED'")?.c||0)};res.json({stats})});
