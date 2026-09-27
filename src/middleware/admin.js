const ids=()=>new Set((process.env.ADMIN_TELEGRAM_IDS||'').split(',').map(x=>x.trim()).filter(Boolean));
export function requireAdmin(req,res,next){if(!req.user || !ids().has(String(req.user.id))) return res.status(403).json({error:'ADMIN_REQUIRED'}); next();}
