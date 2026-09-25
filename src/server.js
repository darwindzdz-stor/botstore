import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { isIPv6 } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, now, flush, pruneEvents, pruneSessions } from './db/index.js';
import { api } from './routes/api.js';
import { adminApi } from './routes/admin.js';
import { bot } from './bot/index.js';
import { authenticateRequest } from './middleware/auth.js';
import { validRequestTarget, isAllowedOrigin } from './security.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
await initDb();
const retentionDays=Math.min(Math.max(Number(process.env.EVENT_RETENTION_DAYS||90)||90,7),3650);
pruneEvents(retentionDays);
const retentionTimer=setInterval(()=>{ try { pruneEvents(retentionDays); pruneSessions(); } catch(err) { console.error('HOUSEKEEPING_FAILED',err?.message||err); } },24*60*60*1000);
retentionTimer.unref();
const app=express();
app.disable('x-powered-by');
const trustedProxy=process.env.TRUST_PROXY||'0';
app.set('trust proxy', /^\d+$/.test(trustedProxy) ? Number(trustedProxy) : false);
app.use(helmet({
  contentSecurityPolicy:{directives:{
    defaultSrc:["'self'"],
    scriptSrc:["'self'",'https://telegram.org','https://imasdk.googleapis.com'],
    connectSrc:["'self'",'https://imasdk.googleapis.com','https://pubads.g.doubleclick.net','https://googleads.g.doubleclick.net'],
    imgSrc:["'self'",'data:','blob:','https:'],
    mediaSrc:["'self'",'blob:','https:'],
    frameSrc:["'self'",'https://googleads.g.doubleclick.net','https://imasdk.googleapis.com'],
    styleSrc:["'self'"],
    objectSrc:["'none'"],
    baseUri:["'self'"],
    formAction:["'self'"],
    frameAncestors:["'self'",'https://web.telegram.org']
  },reportOnly:false},
  referrerPolicy:{policy:'no-referrer'},
  crossOriginEmbedderPolicy:false
}));
app.use((req,res,next)=>{ if(!validRequestTarget(req)) return res.status(414).json({error:'URI_TOO_LONG'}); next(); });
app.use(express.json({limit:'128kb',strict:true}));
app.use('/api',(req,res,next)=>{
  if(['POST','PATCH','PUT','DELETE'].includes(req.method)){
    const ct=req.get('content-type')||'';
    if(!/^application\/json(?:\s*;|$)/i.test(ct)) return res.status(415).json({error:'JSON_REQUIRED'});
    if(!isAllowedOrigin(req.get('origin'),req.get('host'))) return res.status(403).json({error:'BAD_ORIGIN'});
  }
  next();
});
const limiter=(limit,windowMs=60_000)=>rateLimit({
  windowMs,limit,standardHeaders:'draft-7',legacyHeaders:false,
  keyGenerator:req=>req.user?.id?`tg:${req.user.id}`:`ip:${req.ip}`,
  handler:(req,res)=>res.status(429).json({error:'RATE_LIMITED'})
});
app.use(limiter(180));
app.use('/api',(req,res,next)=>{ res.set('Cache-Control','no-store'); next(); });
app.use((req,res,next)=>{ authenticateRequest(req); next(); });
app.post('/telegram/webhook', async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error('TELEGRAM_WEBHOOK_ERROR', err);
    res.sendStatus(500);
  }
});

app.get('/health',(_,res)=>res.set('Cache-Control','no-store').json({ok:true,service:'botstore',time:now()}));
app.get('/ready',(_,res)=>res.set('Cache-Control','no-store').json({ok:true,service:'botstore',ready:true}));
app.use('/api/admin',adminApi);
app.use('/api',api);
app.use('/api',(_,res)=>res.status(404).json({error:'NOT_FOUND'}));
app.use(express.static(path.join(__dirname,'../public'),{maxAge:'5m',etag:true,setHeaders:(res,file)=>{if(file.endsWith('.html'))res.set('Cache-Control','no-cache');}}));
app.get('/admin',(req,res)=>res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}).sendFile(path.join(__dirname,'../public/admin.html')));
app.get('/{*splat}',(_,res)=>res.sendFile(path.join(__dirname,'../public/index.html')));
app.use((err,req,res,next)=>{
  if(err?.type==='entity.parse.failed') return res.status(400).json({error:'INVALID_JSON'});
  console.error('REQUEST_ERROR',err?.message||err);
  if(res.headersSent) return next(err);
  res.status(500).json({error:'INTERNAL_ERROR'});
});
if(process.env.NODE_ENV==='production' && !process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required in production');
const port=Number(process.env.PORT||8787);
if(!Number.isInteger(port)||port<1||port>65535) throw new Error('Invalid PORT');
const host=process.env.HOST||'127.0.0.1';
const server=app.listen(port,host,async()=>{
  console.log(`BotStore running on http://${host}:${port}`);

  try {
    await bot.init();
    console.log('Telegram bot initialized');
  } catch (err) {
    console.error('TELEGRAM_BOT_INIT_FAILED', err);
  }

  const webhookUrl = process.env.WEBAPP_URL
    ? `${process.env.WEBAPP_URL.replace(/\/$/, '')}/telegram/webhook`
    : null;

  if (webhookUrl) {
    try {
      await bot.api.setWebhook(webhookUrl);
      console.log(`Telegram webhook set: ${webhookUrl}`);
    } catch (err) {
      console.error('TELEGRAM_WEBHOOK_SETUP_FAILED', err);
    }
  }
});
server.requestTimeout=30_000;
server.headersTimeout=10_000;
server.keepAliveTimeout=5_000;
let shuttingDown=false;
const shutdown=async(signal)=>{
  if(shuttingDown) return;
  shuttingDown=true;
  console.log(`BotStore ${signal}: shutting down`);
  try { flush(); } catch (err) { console.error('FINAL_FLUSH_FAILED',err); process.exitCode=1; }
  clearInterval(retentionTimer);
  server.close(()=>process.exit(process.exitCode||0));
  setTimeout(()=>process.exit(1),8_000).unref();
};
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
process.on('uncaughtException',err=>{ console.error('UNCAUGHT_EXCEPTION',err); shutdown('uncaughtException'); });
process.on('unhandledRejection',err=>{ console.error('UNHANDLED_REJECTION',err); });
