const tg=window.Telegram?.WebApp || null; if(tg){tg.ready();tg.expand();}
const $=s=>document.querySelector(s); let sessionToken=''; let botsRequestSeq=0; let searchTimer=null; const state={q:'',category:'',page:1,pages:1,limit:12,sort:'relevance'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function headers(){const h={'Content-Type':'application/json'};if(sessionToken)h['x-botstore-session']=sessionToken;return h}
async function bootstrapAuth(){
  for(let attempt=1;attempt<=10;attempt++){
    try{
      const webApp=window.Telegram?.WebApp;

      if(!webApp){
        console.warn('TELEGRAM_WEBAPP_MISSING',attempt);
        await new Promise(r=>setTimeout(r,300));
        continue;
      }

      webApp.ready();
      webApp.expand();

      if(!webApp.initData){
        console.warn('TELEGRAM_INIT_DATA_MISSING',attempt);
        await new Promise(r=>setTimeout(r,300));
        continue;
      }

      const r=await fetch('/api/auth/telegram',{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'x-telegram-init-data':webApp.initData
        }
      });

      let j={};
      try{j=await r.json()}catch{}

      if(!r.ok){
        console.error('TELEGRAM_AUTH_FAILED',r.status,j);
        return false;
      }

      if(!j.session){
        console.error('TELEGRAM_SESSION_MISSING',j);
        return false;
      }

      sessionToken=j.session;
      console.log('TELEGRAM_AUTH_OK');
      return true;
    }catch(e){
      console.error('TELEGRAM_AUTH_ERROR',e);
    }

    await new Promise(r=>setTimeout(r,300));
  }

  console.error('TELEGRAM_AUTH_RETRIES_EXHAUSTED');
  return false;
}

async function api(path,opt={}){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);try{const r=await fetch('/api'+path,{...opt,headers:{...headers(),...(opt.headers||{})},signal:controller.signal});let j={};try{j=await r.json()}catch{}if(!r.ok)throw Object.assign(new Error(j.error||'REQUEST_FAILED'),{status:r.status,data:j});return j}finally{clearTimeout(timer)}}
function toast(msg){const x=$('#toast');x.textContent=msg;x.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>x.classList.remove('show'),2400)}
function show(html){$('#modalContent').innerHTML=html;$('#modal').classList.remove('hidden');document.body.classList.add('locked')};function close(){ $('#modal').classList.add('hidden');document.body.classList.remove('locked') }
function syncModalViewport(){
  const vv=window.visualViewport;
  const top=vv?.offsetTop||0;
  const left=vv?.offsetLeft||0;
  const width=vv?.width||window.innerWidth;
  const height=vv?.height||window.innerHeight;

  ['modal','adModal'].forEach(id=>{
    const el=document.getElementById(id);
    if(!el)return;
    el.style.position='fixed';
    el.style.top=top+'px';
    el.style.left=left+'px';
    el.style.width=width+'px';
    el.style.height=height+'px';
    el.style.inset='auto';
  });
}

syncModalViewport();

if(window.visualViewport){
  window.visualViewport.addEventListener('resize',syncModalViewport);
  window.visualViewport.addEventListener('scroll',syncModalViewport);
}

window.addEventListener('resize',syncModalViewport);

function needLogin(){sessionToken='';toast('انتهت الجلسة، أعد فتح المتجر من داخل Telegram');}

let adConfig=null, pendingOpenUrl=null, adManager=null, adDisplayContainer=null, adsLoader=null, adSkipTimer=null;
async function getAdConfig(){if(adConfig!==null)return adConfig;try{adConfig=await api('/ad-config')}catch{adConfig={enabled:false,vastTag:'',everyOpen:false}}return adConfig}
function botMini(b){return `<button class="mini-bot" data-discover-id="${b.id}"><span class="mini-icon">${b.image_url?`<img src="${esc(b.image_url)}" alt="">`:'🤖'}</span><span><b>${esc(b.name)}</b><small>${b.verified?'✓ موثوق · ':''}⭐ ${Number(b.rating).toFixed(1)} · ${Number(b.opens||0).toLocaleString('ar')} فتح</small></span></button>`}
async function loadDiscovery(){const box=$('#discoverySections');if(!box)return;box.innerHTML='<div class="discover-loading">جاري تجهيز القوائم…</div>';try{const j=await api('/discover');const groups=[['featured','⭐ مختارات مميزة','بوتات مختارة بعناية'],['popular','🔥 الأكثر رواجًا','الأكثر تفاعلًا وفتحًا'],['rated','🏆 الأعلى تقييمًا','تقييمات المجتمع'],['newest','✨ وصل حديثًا','أحدث البوتات المعتمدة']];box.innerHTML=groups.map(([key,title,sub])=>`<div class="discover-group"><div class="discover-head"><div><h3>${title}</h3><small>${sub}</small></div><button data-discover-sort="${key}">عرض الكل</button></div><div class="mini-row">${(j[key]||[]).map(botMini).join('')||'<span class="muted">لا توجد بوتات بعد</span>'}</div></div>`).join('');box.querySelectorAll('[data-discover-id]').forEach(b=>b.onclick=()=>openBot(b.dataset.discoverId));box.querySelectorAll('[data-discover-sort]').forEach(b=>b.onclick=()=>{state.q='';state.category='';state.sort=b.dataset.discoverSort==='newest'?'new':b.dataset.discoverSort==='popular'?'popular':'relevance';state.page=1;$('#listTitle').textContent=b.dataset.discoverSort==='featured'?'⭐ المختارات':b.dataset.discoverSort==='rated'?'🏆 الأعلى تقييمًا':b.dataset.discoverSort==='newest'?'✨ الأحدث':'🔥 الأكثر رواجًا';loadBots();scrollTo({top:document.querySelector('#bots').offsetTop-80,behavior:'smooth'})})}catch{box.innerHTML='<div class="discover-loading">تعذر تحميل قوائم الاكتشاف.</div>'}}
async function loadImaSdk(){if(window.google?.ima)return true;if(window.__imaSdkPromise)return window.__imaSdkPromise;window.__imaSdkPromise=new Promise(resolve=>{const script=document.createElement('script');script.src='https://imasdk.googleapis.com/js/sdkloader/ima3.js';script.async=true;script.onload=()=>resolve(Boolean(window.google?.ima));script.onerror=()=>resolve(false);document.head.appendChild(script)});return window.__imaSdkPromise}
async function showVideoAd(nextUrl){const cfg=await getAdConfig();if(!cfg.enabled||!cfg.vastTag||cfg.everyOpen===false)return false;if(!await loadImaSdk())return false;const modal=$('#adModal'),status=$('#adStatus'),video=$('#adVideo'),container=$('#adContainer');pendingOpenUrl=nextUrl;modal.classList.remove('hidden');document.body.classList.add('locked');status.textContent='إعلان قصير… يمكنك التخطي';let finished=false;const finish=(go=true)=>{if(finished)return;finished=true;clearTimeout(adSkipTimer);try{adManager?.destroy()}catch{};adManager=null;modal.classList.add('hidden');document.body.classList.remove('locked');if(go&&pendingOpenUrl){const u=pendingOpenUrl;pendingOpenUrl=null;openTelegram(u)}};$('#skipAd').onclick=()=>finish(true);try{adDisplayContainer=new google.ima.AdDisplayContainer(container,video);adDisplayContainer.initialize();if(!adsLoader){adsLoader=new google.ima.AdsLoader(adDisplayContainer);adsLoader.addEventListener(google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,e=>{try{adManager=e.getAdsManager(video);adManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR,()=>finish(true));adManager.addEventListener(google.ima.AdEvent.Type.COMPLETE,()=>finish(true));adManager.addEventListener(google.ima.AdEvent.Type.SKIPPED,()=>finish(true));adManager.init(360,640,google.ima.ViewMode.NORMAL);adManager.start()}catch{finish(true)}});adsLoader.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR,()=>finish(true))}const req=new google.ima.AdsRequest();req.adTagUrl=cfg.vastTag;req.linearAdSlotWidth=640;req.linearAdSlotHeight=360;req.setAdWillAutoPlay(true);req.setAdWillPlayMuted(true);adsLoader.requestAds(req);adSkipTimer=setTimeout(()=>finish(true),20000);return true}catch{finish(false);return false}}
function openTelegram(url){if(tg?.openTelegramLink)tg.openTelegramLink(url);else window.open(url,'_blank','noopener,noreferrer')}
function botCard(b){return `<article class="bot" data-id="${b.id}"><div class="bot-head"><div class="bot-icon">${b.image_url?`<img src="${esc(b.image_url)}" alt="">`:'🤖'}</div><span class="badge">${b.verified?'✓ موثوق':b.featured?'مميز':''}</span></div><h3>${esc(b.name)}</h3><p>${esc(b.description)}</p><div class="meta"><span>@${esc(String(b.username).replace(/^@/,''))}</span><span>⭐ ${Number(b.rating).toFixed(1)}</span></div><button class="open" data-id="${b.id}">🚀 فتح التفاصيل</button></article>`}
async function loadStats(){try{const j=await api('/stats');const s=j.stats||{};$('#statBots').textContent=Number(s.bots||0).toLocaleString('ar');$('#statUsers').textContent=Number(s.users||0).toLocaleString('ar');$('#statViews').textContent=Number(s.views||0).toLocaleString('ar');$('#statOpens').textContent=Number(s.opens||0).toLocaleString('ar')}catch{}}
async function loadAds(){try{const j=await api('/ads');const ads=j.ads||[];const box=$('#ads');if(!ads.length){box.classList.add('hidden');return}box.innerHTML=ads.map(a=>`<article class=\"ad-card\">${a.image_url?`<img src=\"${esc(a.image_url)}\" alt=\"\">`:'<div class=\"bot-icon\">📢</div>'}<div><b>${esc(a.title)}</b><p>${esc(a.text)}</p></div>${a.url?`<a href=\"${esc(a.url)}\" target=\"_blank\" rel=\"noopener noreferrer\">عرض</a>`:''}</article>`).join('');box.classList.remove('hidden')}catch{}}
async function loadCats(){const j=await api('/categories');$('#categories').innerHTML=j.categories.map(c=>`<button class="chip ${state.category===c.slug?'selected':''}" data-cat="${esc(c.slug)}">${c.icon} ${esc(c.name)}</button>`).join('');document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{state.category=b.dataset.cat;state.page=1;loadBots()})}
function skeleton(){return Array.from({length:6},()=>'<div class="skel"><i></i><b></b><span></span><span></span></div>').join('')}
async function loadBots(){const requestId=++botsRequestSeq;const box=$('#bots');$('#loading').innerHTML=skeleton();$('#loading').classList.remove('hidden');$('#empty').classList.add('hidden');$('#pager').classList.add('hidden');const p=new URLSearchParams({page:state.page,limit:state.limit});if(state.q)p.set('q',state.q);if(state.category)p.set('category',state.category);if(state.sort)p.set('sort',state.sort);try{const j=await api('/bots?'+p);if(requestId!==botsRequestSeq)return;state.pages=Math.max(1,Number(j.pages)||1);if(state.page>state.pages){state.page=state.pages;return loadBots()}box.innerHTML=(j.bots||[]).map(botCard).join('');$('#loading').classList.add('hidden');if(!j.bots?.length){$('#empty').classList.remove('hidden');return}$('#pager').classList.toggle('hidden',state.pages<=1);$('#pageInfo').textContent=`${state.page} / ${state.pages}`;$('#prev').disabled=state.page<=1;$('#next').disabled=state.page>=state.pages;box.querySelectorAll('.open').forEach(x=>x.onclick=()=>openBot(x.dataset.id))}catch(e){if(requestId!==botsRequestSeq)return;$('#loading').classList.add('hidden');box.innerHTML=e.name==='AbortError'?'<div class="empty"><div>⏱️</div><h3>انتهت مهلة الطلب</h3><p>تحقق من الاتصال وحاول مرة أخرى.</p></div>':'<div class="empty"><div>⚠️</div><h3>تعذر تحميل البوتات</h3><p>تحقق من اتصالك وحاول مرة أخرى.</p></div>'}}
async function openBot(id){try{const j=await api('/bots/'+id);const b=j.bot;let fav=false;if(tg?.initData){try{fav=(await api('/bots/'+id+'/favorite')).favorite}catch{}}show(`<div class="detail"><div class="detail-icon">${b.image_url?`<img src="${esc(b.image_url)}" alt="">`:'🤖'}</div><div class="eyebrow">${b.verified?'✓ موثوق · ':''}${esc(b.category_name||'Bot')}</div><h2>${esc(b.name)}</h2><div class="handle">@${esc(String(b.username).replace(/^@/,''))}</div><p>${esc(b.description)}</p><div class="stats"><span>⭐ <b>${Number(b.rating).toFixed(1)}</b><small>${b.rating_count} تقييم</small></span><span>👁️ <b>${Number(b.views||0)}</b><small>مشاهدة</small></span><span>🚀 <b>${Number(b.opens||0)}</b><small>فتح</small></span></div><div class="tags">${(b.tags||[]).map(t=>`<span>#${esc(t)}</span>`).join('')}</div><div class="actions"><button class="primary" id="go">🚀 فتح البوت</button><button class="secondary" id="fav">${fav?'❤️ محفوظ':'🤍 مفضلة'}</button></div><div class="sub-actions"><button id="rate">⭐ قيّم البوت</button><button id="report">🚨 إبلاغ</button></div><div class="detail-extra"><h3>💬 آخر المراجعات</h3>${(j.reviews||[]).length?(j.reviews||[]).map(r=>`<div class="review"><b>${esc(r.first_name||r.username||'مستخدم')}</b><span>⭐ ${Number(r.rating)}</span><p>${esc(r.review)}</p></div>`).join(''):'<p class="muted">لا توجد مراجعات مكتوبة بعد.</p>'}<h3>🔗 بوتات مشابهة</h3><div class="mini-row">${(j.similar||[]).map(botMini).join('')||'<span class="muted">لا توجد اقتراحات بعد.</span>'}</div></div></div>`);$('#go').onclick=async()=>{try{const x=await api('/bots/'+id+'/open',{method:'POST'});let adShown=false;try{adShown=await showVideoAd(x.url)}catch(e){console.warn('AD_OPEN_FAILED',e)}if(!adShown)openTelegram(x.url)}catch(e){console.error('BOT_OPEN_ERROR',e);if(e?.status===401||e?.status===403)needLogin();else toast('تعذر فتح البوت')}};$('#fav').onclick=async()=>{try{const x=await api('/bots/'+id+'/favorite',{method:'POST'});$('#fav').textContent=x.favorite?'❤️ محفوظ':'🤍 مفضلة';toast(x.favorite?'أضيف إلى المفضلة':'أزيل من المفضلة')}catch{needLogin()}};$('#rate').onclick=()=>rateBot(id);$('#report').onclick=()=>reportBot(id)}catch{toast('تعذر فتح التفاصيل')}}
function rateBot(id){show(`<h2>⭐ تقييم البوت</h2><p class="muted">اختر تقييمك.</p><div class="stars">${[1,2,3,4,5].map(n=>`<button data-rate="${n}">${n} ⭐</button>`).join('')}</div><textarea id="review" maxlength="500" placeholder="مراجعة اختيارية..."></textarea>`);document.querySelectorAll('[data-rate]').forEach(b=>b.onclick=async()=>{try{await api('/bots/'+id+'/rating',{method:'POST',body:JSON.stringify({rating:Number(b.dataset.rate),review:$('#review').value})});toast('تم حفظ تقييمك');close();openBot(id)}catch{needLogin()}})}
function reportBot(id){show(`<h2>🚨 الإبلاغ عن بوت</h2><label class="field"><span>السبب</span><select id="rr"><option>Scam</option><option>Spam</option><option>Malware</option><option>Impersonation</option><option>Broken Bot</option><option>Other</option></select></label><label class="field"><span>التفاصيل</span><textarea id="rt" maxlength="1000" placeholder="اشرح المشكلة..."></textarea></label><button type="button" class="primary wide" id="sendRep">إرسال التقرير</button>`);const btn=$('#sendRep');if(!btn){toast('خطأ: لم يتم إنشاء زر الإرسال');return}btn.onclick=async()=>{toast('تم الضغط على زر الإرسال');console.log('REPORT_BUTTON_CLICKED',id);btn.disabled=true;btn.textContent='جاري الإرسال…';try{await api('/bots/'+id+'/report',{method:'POST',body:JSON.stringify({reason:$('#rr').value,details:$('#rt').value})});toast('تم استلام التقرير');close()}catch(e){console.error('REPORT_ERROR',e);toast(`خطأ ${e.status||''}: ${e.message||'REQUEST_FAILED'}`)}finally{btn.disabled=false;btn.textContent='إرسال التقرير'}}}
function requestBot(){show(`<h2>🔎 اطلب بوتًا</h2><p class="muted">إذا لم تجد ما تريد، أرسل طلبًا وسنراجعه.</p><label class="field"><span>ما الذي تبحث عنه؟</span><input id="rq" maxlength="200" placeholder="مثال: بوت لتحويل PDF"></label><label class="field"><span>حساب Telegram للتواصل (اختياري)</span><input id="rc" maxlength="100" placeholder="@username"></label><label class="field"><span>تفاصيل إضافية</span><textarea id="rd" maxlength="1200"></textarea></label><button class="primary wide" id="sendReq">إرسال الطلب</button>`);$('#sendReq').onclick=async()=>{try{await api('/requests',{method:'POST',body:JSON.stringify({query:$('#rq').value,contact_username:$('#rc').value,details:$('#rd').value})});toast('تم إرسال الطلب');close()}catch{needLogin()}}}
function formSubmit(){show(`<h2>➕ اقتراح بوت</h2><p class="muted">سيبقى البوت قيد المراجعة حتى يتم اعتماده.</p><label class="field"><span>@username</span><input id="su" maxlength="100" placeholder="@example_bot"></label><label class="field"><span>الاسم</span><input id="sn" maxlength="120"></label><label class="field"><span>الوصف</span><textarea id="sd" maxlength="1500"></textarea></label><label class="field"><span>الرابط</span><input id="sl" placeholder="https://t.me/example_bot"></label><label class="field"><span>التصنيف</span><select id="sc"></select></label><button class="primary wide" id="sendSub">إرسال للمراجعة</button>`);api('/categories').then(j=>$('#sc').innerHTML=j.categories.map(c=>`<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`).join(''));$('#sendSub').onclick=async()=>{try{await api('/submissions',{method:'POST',body:JSON.stringify({username:$('#su').value,name:$('#sn').value,description:$('#sd').value,url:$('#sl').value,category_id:Number($('#sc').value),tags:[]})});toast('أرسل للمراجعة');close()}catch(e){toast(e.status===409?'البوت موجود بالفعل':'تحقق من البيانات وافتح المتجر من Telegram')}}}
function support(){show(`<div class="support-modal"><div class="support-profile"><div class="support-avatar">🛡️</div><div><span class="eyebrow">OFFICIAL SUPPORT</span><h2>الدعم الفني والاستجابة للبلاغات</h2><p class="muted">يمكنك فتح تذكرة داخل المتجر أو التواصل مباشرة مع فريق الدعم.</p></div></div><div class="support-contact"><div><b>حساب الدعم</b><span>@DARWIN0DZ</span></div><button class="secondary" id="contactInline">💬 تواصل</button></div><div class="support-tabs"><button class="tab active" id="ticketTab">🆘 تذكرة دعم</button><button class="tab" id="reportTab">🚨 بلاغ</button></div><div id="supportForm"><label class="field"><span>الموضوع</span><input id="ts" maxlength="200" placeholder="مثال: مشكلة في فتح بوت"></label><label class="field"><span>التفاصيل</span><textarea id="tm" maxlength="3000" placeholder="اكتب المشكلة بالتفصيل..."></textarea></label><label class="field"><span>الأولوية</span><select id="tp"><option value="NORMAL">عادية</option><option value="HIGH">عالية</option><option value="LOW">منخفضة</option></select></label><button class="primary wide" id="sendT">إرسال إلى الدعم</button></div></div>`);const contact=()=>{const u='https://t.me/DARWIN0DZ';if(tg?.openTelegramLink)tg.openTelegramLink(u);else window.open(u,'_blank','noopener,noreferrer')};$('#contactInline').onclick=contact;$('#sendT').onclick=async()=>{try{const x=await api('/support/tickets',{method:'POST',body:JSON.stringify({subject:$('#ts').value,message:$('#tm').value,priority:$('#tp').value})});toast('تم إنشاء تذكرة #'+x.ticket_id);close()}catch(e){toast(e.status===429?'لديك تذكرة مفتوحة بالفعل':'يجب فتح المتجر من Telegram')}};$('#reportTab').onclick=()=>{show(`<div class="support-modal"><div class="support-profile"><div class="support-avatar">🚨</div><div><span class="eyebrow">REPORT CENTER</span><h2>مركز البلاغات</h2><p class="muted">إذا كان لديك بوت محدد، افتح تفاصيله ثم استخدم «إبلاغ». للبلاغ العام يمكنك التواصل مع الدعم.</p></div></div><div class="report-guide"><div>🚨</div><b>بلاغ عن بوت</b><p>من بطاقة البوت اختر «فتح التفاصيل» ثم «إبلاغ» واختر السبب وأرسل التفاصيل.</p></div><div class="support-contact"><div><b>استجابة البلاغات</b><span>@DARWIN0DZ</span></div><button class="primary" id="contactReport">إرسال بلاغ</button></div></div>`);$('#contactReport').onclick=contact}}
async function favorites(){try{const j=await api('/favorites');$('#listTitle').textContent='❤️ المفضلة';$('#categories').parentElement.classList.add('hidden');$('#bots').innerHTML=j.bots.map(botCard).join('')||'<div class="empty"><div>❤️</div><h3>لا توجد مفضلة</h3><p>احفظ البوتات التي تريد العودة إليها.</p></div>';document.querySelectorAll('.open').forEach(x=>x.onclick=()=>openBot(x.dataset.id))}catch{needLogin()}}
function home(){state.q='';state.category='';state.sort='relevance';state.page=1;$('#search').value='';$('#listTitle').textContent='🔥 بوتات مقترحة';$('#categories').parentElement.classList.remove('hidden');loadCats();loadBots()}
$('#searchBtn').onclick=()=>{state.q=$('#search').value.trim().slice(0,80);state.sort='relevance';state.page=1;$('#listTitle').textContent=state.q?'🔎 نتائج البحث':'🔥 بوتات مقترحة';loadBots()};$('#search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>$('#searchBtn').click(),350)};$('#search').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(searchTimer);$('#searchBtn').click()}};$('#popularBtn').onclick=()=>{state.q='';state.category='';state.sort='popular';state.page=1;$('#listTitle').textContent='🔥 الأكثر شعبية';loadBots()};$('#newBtn').onclick=()=>{state.q='';state.category='';state.sort='new';state.page=1;$('#listTitle').textContent='✨ أحدث البوتات';loadBots()};$('#refresh').onclick=()=>loadBots();$('#reportCenter').onclick=()=>support();$('#openSupport').onclick=support;$('#contactSupport').onclick=()=>{const u='https://t.me/DARWIN0DZ';if(tg?.openTelegramLink)tg.openTelegramLink(u);else window.open(u,'_blank','noopener,noreferrer')};$('#requestBtn').onclick=requestBot;$('#emptyRequest').onclick=requestBot;$('#closeModal').onclick=close;$('#modal').onclick=e=>{if(e.target.id==='modal')close()};$('#prev').onclick=()=>{if(state.page>1){state.page--;loadBots();scrollTo({top:250,behavior:'smooth'})}};$('#next').onclick=()=>{if(state.page<state.pages){state.page++;loadBots();scrollTo({top:250,behavior:'smooth'})}};$('#allCats').onclick=()=>{state.category='';state.sort='relevance';state.page=1;loadCats();loadBots()};document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');if(b.dataset.page==='home')home();else if(b.dataset.page==='favorites')favorites();else if(b.dataset.page==='submit')formSubmit();else support()});$('#share').onclick=()=>{const u=location.href;if(tg?.switchInlineQuery){tg.switchInlineQuery('شاهد Bot Store واكتشف بوتات مفيدة');}else if(navigator.share){navigator.share({title:'Bot Store',text:'اكتشف بوتات Telegram',url:u}).catch(()=>{})}else{navigator.clipboard?.writeText(u);toast('تم نسخ رابط المتجر')}};$('#ctaSubmit').onclick=formSubmit;$('#discoverRefresh').onclick=loadDiscovery;$('#theme').onclick=()=>{document.body.classList.toggle('light');localStorage.setItem('theme',document.body.classList.contains('light')?'light':'dark')};if(localStorage.getItem('theme')==='light')document.body.classList.add('light');bootstrapAuth().finally(()=>{loadStats();loadAds();loadCats();loadBots();loadDiscovery()});
