import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { isIPv6 } from 'node:net';
import { z } from 'zod';


function clientRateLimitKey(ip){
  const value=String(ip||'unknown');

  // Express may expose IPv4 clients as IPv4-mapped IPv6 addresses.
  // Normalize them to their real IPv4 address so they keep a stable bucket.
  const mapped=value.match(/^::ffff:(?:\d{1,3}\.){3}\d{1,3}$/i);
  if(mapped) return value.slice(7);

  // For real IPv6 addresses, use express-rate-limit's official helper.
  // This keeps IPv6 clients in safe, consistent buckets and avoids
  // the ERR_ERL_KEY_GEN_IPV6 validation error.
  if(isIPv6(value)){
    return ipKeyGenerator(value);
  }

  return value;
}


export const httpsUrl=z.string().trim().url().max(500).refine(v=>{
  try {
    return new URL(v).protocol==='https:';
  } catch {
    return false;
  }
},'HTTPS_REQUIRED');


export const telegramBotUrl=z.string().trim().url().max(500).refine(v=>{
  try {
    const u=new URL(v);

    if(
      u.protocol!=='https:' ||
      !['t.me','telegram.me','www.t.me'].includes(u.hostname.toLowerCase()) ||
      u.username ||
      u.password ||
      u.hash
    ) return false;

    const parts=u.pathname.split('/').filter(Boolean);

    return parts.length===1 &&
      /^[A-Za-z0-9_]{3,64}$/.test(parts[0]);
  } catch {
    return false;
  }
},'TELEGRAM_URL_REQUIRED');


const limiterFactory=(limit,windowMs)=>rateLimit({
  windowMs,
  limit,
  standardHeaders:'draft-7',
  legacyHeaders:false,
  skipSuccessfulRequests:false,

  // Telegram-authenticated users get their own bucket.
  // Unauthenticated clients are rate-limited by a normalized IP key.
  keyGenerator:req=>{
    if(req.user?.id){
      return `tg:${req.user.id}`;
    }

    return `ip:${clientRateLimitKey(req.ip)}`;
  },

  handler:(_,res)=>res.status(429).json({
    error:'RATE_LIMITED'
  }),

  message:{
    error:'RATE_LIMITED'
  }
});


export const userRateLimit=(limit,windowMs=60_000)=>
  limiterFactory(limit,windowMs);

export const sensitiveRateLimit=(limit,windowMs=60_000)=>
  limiterFactory(limit,windowMs);


export function normalizeBotUsername(value){
  return String(value||'')
    .trim()
    .replace(/^@/,'')
    .toLowerCase();
}


export function telegramUrlMatchesUsername(url,username){
  try {
    const u=new URL(url);
    const host=u.hostname.toLowerCase();

    if(
      !['t.me','telegram.me','www.t.me'].includes(host) ||
      u.protocol!=='https:' ||
      u.username ||
      u.password ||
      u.hash
    ) return false;

    const parts=u.pathname.split('/').filter(Boolean);

    return parts.length===1 &&
      normalizeBotUsername(parts[0])===
      normalizeBotUsername(username);
  } catch {
    return false;
  }
}


export function safeExternalImage(value){
  if(!value) return '';

  try {
    const u=new URL(value);

    if(
      u.protocol!=='https:' ||
      u.username ||
      u.password
    ) return '';

    return u.toString().slice(0,500);
  } catch {
    return '';
  }
}


export function escapeLike(value){
  return String(value||'').replace(/[\\%_]/g,m=>'\\'+m);
}


export function isSafeBotUsername(value){
  return /^[A-Za-z0-9_]{3,64}$/.test(String(value||''));
}


export function validRequestTarget(req,max=4096){
  if(!req || typeof req.originalUrl!=='string') return false;

  const raw=req.originalUrl;

  if(raw.length>max) return false;

  // Reject literal control characters.
  if(/[\u0000-\u001f\u007f]/.test(raw)) return false;

  // Reject malformed percent-encoding.
  if(/%(?![0-9A-Fa-f]{2})/.test(raw)) return false;

  // Decode repeatedly so encoded control characters such as %00,
  // %2500 and %252500 cannot bypass the validation.
  let decoded=raw;

  for(let i=0;i<3;i++){
    try {
      const next=decodeURIComponent(decoded);

      if(next===decoded) break;

      decoded=next;
    } catch {
      return false;
    }

    if(decoded.length>max) return false;

    if(/[\u0000-\u001f\u007f]/.test(decoded)){
      return false;
    }
  }

  return true;
}


export function isAllowedOrigin(origin,host){
  if(!origin) return true;

  try {
    const u=new URL(origin);

    // Development mode keeps the existing local-development behavior.
    if(
      process.env.NODE_ENV!=='production' &&
      ['http:','https:'].includes(u.protocol)
    ){
      return true;
    }

    // Same-origin requests.
    if(host && u.host===host) return true;

    // Explicitly configured production origins.
    const configured=(process.env.ALLOWED_ORIGINS||'')
      .split(',')
      .map(x=>x.trim())
      .filter(Boolean);

    if(configured.includes(origin)) return true;

    // Telegram web clients.
    return u.protocol==='https:' &&
      /(^|\.)telegram\.org$/i.test(u.hostname);

  } catch {
    return false;
  }
}