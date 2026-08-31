// R3.3 frontend boot guard: never fail silently.
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('error', e => {
    try {
      const t=document.getElementById('modeTitle'), f=document.getElementById('freshPill');
      if(t) t.textContent='前端啟動錯誤';
      if(f){ f.textContent='● JavaScript錯誤'; f.className='pill bad'; }
      const p=document.getElementById('plain');
      if(p) p.innerHTML='<b>前端錯誤：</b>'+String(e.message||'unknown');
    } catch(_){}
  });
  window.addEventListener('unhandledrejection', e => {
    try {
      const f=document.getElementById('freshPill');
      if(f){ f.textContent='● 前端非同步錯誤'; f.className='pill bad'; }
      console.error('Unhandled promise rejection', e.reason);
    } catch(_){}
  });
}

const ETF=['0050','0056','00878','00919'],NAME={'0050':'元大台灣50','0056':'元大高股息','00878':'國泰永續高股息','00919':'群益台灣精選高息'};
const $=id=>document.getElementById(id),fmt=n=>Number.isFinite(Number(n))?Number(n).toFixed(2):'—',pct=n=>Number.isFinite(Number(n))?(Number(n)>=0?'+':'')+Number(n).toFixed(2)+'%':'—',cls=n=>Number(n)>0?'upc':Number(n)<0?'downc':'';
const mean=a=>{const x=(a||[]).filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null};
let lastLive=null,lastCtx=null,lastTaiex=null,lastOverseas=null,lastNight=null,lastBuy=null;
let marketTimer,slowTimer,buyTimer,nightTimer,selectedETF='0050',selectedBacktest='0050';
let etfLiveTimer=null;
const DEFAULT_H=[{t:'0050',n:'0050',s:3150,c:77.37},{t:'0056',n:'0056',s:750,c:33.91},{t:'00878',n:'00878',s:4000,c:18.06},{t:'00919',n:'00919',s:500,c:18.61}];
let H=loadHoldings(),EVENTS=loadJSON('v124_events',[]),STATE=loadJSON('v124_state',{day:null,models:{},noSignalDays:{}}),PREOPEN=loadJSON('v124_preopen',{}),HIST=loadJSON('v124_buy_history',{}),CONSTVERS=loadJSON('v124_constituent_versions',{}),VALIDATION=null,MODEL_TRADES=loadJSON('v124_model_trades',[]),HISTORY_STATUS=null;
function migrate1689Existing0050Trade(){
 const key='v1689_0050_10540_20_migrated';if(localStorage.getItem(key))return;
 const h=H.find(v=>v.t==='0050'),t=MODEL_TRADES?.some(v=>v.code==='0050'&&Number(v.shares)===20&&Math.abs(Number(v.entryPrice)-105.40)<.001);
 if(t&&h&&Number(h.s)===3150&&Math.abs(Number(h.c)-77.37)<.001){h.c=(3150*77.37+20*105.40)/3170;h.s=3170;saveHoldings()}
 localStorage.setItem(key,'1')
}
function loadJSON(k,d){try{const x=JSON.parse(localStorage.getItem(k));return x??d}catch{return d}}
function saveJSON(k,v){localStorage.setItem(k,JSON.stringify(v))}
function saveLastGood(k,v){try{localStorage.setItem('v124_lastgood_'+k,JSON.stringify({at:new Date().toISOString(),data:v}))}catch{}}
function loadLastGood(k){try{return JSON.parse(localStorage.getItem('v124_lastgood_'+k)||'null')}catch{return null}}
function ageText(ts){if(!ts)return'';const m=Math.max(0,Math.round((Date.now()-Date.parse(ts))/60000));return m<1?'剛剛':m+'分鐘前'}
function loadHoldings(){try{const x=JSON.parse(localStorage.getItem('twStockHoldingsV12'));return Array.isArray(x)?x:DEFAULT_H.map(v=>({...v}))}catch{return DEFAULT_H.map(v=>({...v}))}}
function saveHoldings(){saveJSON('twStockHoldingsV12',H)}
function taipeiNow(){return new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Taipei'}))}
function dayKey(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())}
function fresh(ts,ms=90000){return ts&&Date.now()-Date.parse(ts)<ms}
function setPage(id){document.querySelectorAll('.page').forEach(x=>x.classList.toggle('on',x.id===id));document.querySelectorAll('.navb').forEach(x=>x.classList.toggle('on',x.dataset.page===id));window.scrollTo({top:0,behavior:'instant'});if(id==='constituentPage')loadConstituentPage(false)}
document.querySelectorAll('.navb').forEach(b=>b.onclick=()=>setPage(b.dataset.page));
function setMode(){const d=taipeiNow(),m=d.getHours()*60+d.getMinutes(),day=d.getDay();let a,b,c;if(day===0||day===6){a='週末模式';b='市場休市，整理全歷史與下一交易日環境';c='現貨維持最近交易日，夜盤／海外依交易時段更新'}else if(m>=537&&m<540){a='08:57盤前';b='盤前三層正在收斂';c='08:59:30鎖定盤前基準'}else if(m>=540&&m<=810){a='● 盤中模式';b='今天有沒有合理買點？';c='價格10秒｜模型30秒'}else if(m>810&&m<900){a='收盤模式';b='今天收盤結構與下一交易日環境';c='檢查今日買點歷史與市場廣度'}else if(m>=900||m<300){a='🌙 夜間模式';b='夜盤與海外正在怎麼影響下一交易日？';c='夜盤10秒更新；正負號自行重算'}else{a='盤前模式';b='開盤前先看海外與現貨歷史';c='等待08:57盤前三層'}$('mode').textContent=a;$('modeTitle').textContent=b;$('modeNote').textContent=c}
function addEvent(text,kind='info'){const last=EVENTS.at(-1);if(last&&last.text===text&&Date.now()-Date.parse(last.at)<60000)return;EVENTS.push({at:new Date().toISOString(),text,kind});EVENTS=EVENTS.slice(-160);saveJSON('v124_events',EVENTS);renderEvents()}
function resetDaily(){const d=dayKey();if(STATE.day===d)return;const old=STATE;if(old.day){ETF.forEach(c=>{const triggered=old.models?.[c]?.layers?.some(x=>x.triggeredAt);STATE.noSignalDays[c]=triggered?0:(Number(STATE.noSignalDays[c]||0)+1)})}STATE={day:d,models:{},noSignalDays:STATE.noSignalDays||{}};saveJSON('v124_state',STATE)}
function ztxt(z){return z&&Number.isFinite(z.low)&&Number.isFinite(z.high)?`${z.low.toFixed(2)}–${z.high.toFixed(2)}`:'—'}
function center(z){return z?(z.low+z.high)/2:null}
function moveZone(cur,target,maxDown,maxUp,allowDown=true){if(!cur)return JSON.parse(JSON.stringify(target));const c=center(cur),t=center(target),half=(cur.high-cur.low)/2;let d=t-c;if(d<0&&!allowDown)d=Math.max(d,-maxDown*.12);else d=Math.max(-maxDown,Math.min(maxUp,d));return{low:c+d-half,high:c+d+half,center:c+d}}
function layerView(L,px){if(!L)return'WAIT';if(L.invalid)return'INVALID';if(L.confirmed){if(px>L.zone.high)return'CONFIRMED_ABOVE';if(px<L.zone.low)return'CONFIRMED_BELOW';return'CONFIRMED_IN'}if(L.fastPass)return'FAST_PASS';if(L.forming)return'FORMING';return'WAIT'}
function flashLivePrices(){
 for(const c of ETF){
  const dir=ETF_PRICE_FLASH[c];if(!dir)continue;
  const q=lastLive?.quotes?.[c];if(!q?.last)continue;
  document.querySelectorAll('.buybox').forEach(box=>{
   const k=box.querySelector('.k'),b=box.querySelector('b');
   if(k&&b&&k.textContent.trim()==='現價'&&Math.abs(Number(b.textContent.replace(/,/g,''))-Number(q.last))<.001){
    b.classList.remove('price-flash-up','price-flash-down');void b.offsetWidth;
    b.classList.add(dir==='up'?'price-flash-up':'price-flash-down');
    setTimeout(()=>b.classList.remove('price-flash-up','price-flash-down'),950);
   }
  });
  delete ETF_PRICE_FLASH[c];
 }
}
function layerTouchState(L,px){
 if(!L?.zone||!Number.isFinite(px))return'IDLE';
 if(L.confirmed)return'CONFIRMED';
 if(px>=L.zone.low&&px<=L.zone.high)return'TOUCHED';
 if(L.triggeredAt||L.forming||L.confirmCount>0)return'TOUCHED';
 return'IDLE';
}
function layerBoxClass(L,px,base=''){const st=layerTouchState(L,px);return(base?base+' ':'')+(st==='CONFIRMED'?'layer-confirmed':st==='TOUCHED'?'layer-touched':'')}
function layerBoxLabel(label,L,px){const st=layerTouchState(L,px);return label+(st==='CONFIRMED'?'｜已確認':st==='TOUCHED'?'｜已觸價':'')}
function stageText(s,i=1){return{CONFIRMED_IN:`🔴 第${i}層已確認／可分批`,CONFIRMED_ABOVE:`🟡 第${i}層已確認但離開／不追`,CONFIRMED_BELOW:`🟠 第${i}層已確認且已穿越`,FAST_PASS:'🟠 快速穿透保護',FORMING:'🟠 觸價觀察／形成中',INVALID:'🟢 失效／重新定價',WAIT:'等待'}[s]||'等待'}
function rank(s){return{CONFIRMED_IN:6,FORMING:5,CONFIRMED_ABOVE:4,CONFIRMED_BELOW:3,WAIT:2,INVALID:1,FAST_PASS:0}[s]||0}

async function get(url,timeoutMs=12000){const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(url,{cache:'no-store',signal:c.signal}),text=await r.text(),t=text.trim();if(!r.ok)throw Error('HTTP '+r.status+'｜'+url);if(!(t.startsWith('{')||t.startsWith('[')))throw Error('來源回傳HTML而非JSON｜'+url+'｜'+t.slice(0,45).replace(/\s+/g,' '));let d;try{d=JSON.parse(t)}catch(e){throw Error('JSON解析失敗｜'+url+'｜'+e.message)}return d}catch(e){if(e?.name==='AbortError')throw Error('API回應逾時｜'+url);throw e}finally{clearTimeout(timer)}}

function twMarketOpenClient(){
 const d=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Taipei'})),wd=d.getDay(),m=d.getHours()*60+d.getMinutes();
 return wd>=1&&wd<=5&&m>=540&&m<=810;
}
const ETF_PRICE_FLASH={};
let ETF_FETCH_AT=null,ETF_FETCH_COUNT=0;
function etfFetchStamp(){
 if(!ETF_FETCH_AT)return'尚未抓取';
 const d=new Date(ETF_FETCH_AT);
 return '抓取 '+d.toLocaleTimeString('zh-TW',{hour12:false,timeZone:'Asia/Taipei'})+'｜#'+ETF_FETCH_COUNT;
}
function etfExchangeStamp(code){
 const q=lastLive?.quotes?.[code];
 if(!q)return'';
 const src=String(q.source||'');
 if(src.includes('Anue'))return'｜鉅亨即時';
 if(src.includes('TWSE'))return'｜TWSE備援'+(q.time?('｜成交 '+q.time):'');
 return src?('｜'+src):'';
}

function nLive(v){const x=Number(v);return Number.isFinite(x)?x:null}
function parseBrowserMisRow(x,prev){
 const z=nLive(x?.z);
 const ask=String(x?.a||'').split('_').map(nLive).find(v=>v>0);
 const bid=String(x?.b||'').split('_').map(nLive).find(v=>v>0);
 let last=z>0?z:Number(prev?.last);
 // TWSE MIS z="-" means no new trade in this snapshot; keep last trade.
 // On cold start only, use best bid/ask midpoint as a temporary display value until a trade arrives.
 if(!(last>0)&&bid>0&&ask>0)last=Math.round(((bid+ask)/2)*100)/100;
 else if(!(last>0))last=bid||ask||null;
 return{
  ticker:String(x?.c||'').trim(),name:x?.n||'',channel:x?.ch||'',
  last,prevClose:nLive(x?.y),open:nLive(x?.o),high:nLive(x?.h),low:nLive(x?.l),
  volume:nLive(x?.v),time:x?.t||x?.['%']||null,date:x?.d||null,
  bid,ask,hasTrade:z>0,source:'TWSE MIS browser direct',realtime:true
 };
}
async function browserTwseEtfLive(){
 const ex=ETF.map(c=>'tse_'+c+'.tw').join('|');
 const url='https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch='+
   encodeURIComponent(ex)+'&json=1&delay=0&_='+(Date.now()+'_'+Math.random().toString(36).slice(2));
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),4500);
 try{
  const r=await fetch(url,{cache:'no-store',mode:'cors',credentials:'omit',signal:c.signal});
  if(!r.ok)throw Error('TWSE HTTP '+r.status);
  const d=await r.json(),quotes={};
  for(const x of (d?.msgArray||[])){
   const code=String(x?.c||'').trim();
   if(ETF.includes(code)){
    const q=parseBrowserMisRow(x,lastLive?.quotes?.[code]);
    if(q.last>0)quotes[code]=q;
   }
  }
  if(!ETF.some(c=>quotes[c]?.last>0))throw Error('TWSE browser direct 無有效行情');
  return{ok:true,source:'TWSE MIS browser direct',fetchedAt:new Date().toISOString(),quotes};
 }finally{clearTimeout(timer)}
}
async function loadEtfLive(){
 clearTimeout(etfLiveTimer);
 try{
  const d=await get('/api/etf-live?_='+Date.now(),6500);
  ETF_FETCH_AT=Date.now();ETF_FETCH_COUNT++;
  if(d?.quotes){
   lastLive=lastLive||{ok:true,quotes:{}};
   lastLive.quotes=lastLive.quotes||{};
   for(const c of ETF){
    const q=d.quotes[c];
    if(q?.last>0){
     const old=Number(lastLive.quotes[c]?.last),next=Number(q.last);
     lastLive.quotes[c]={...q,fetchTime:new Date().toISOString()};
     if(old>0&&next!==old)ETF_PRICE_FLASH[c]=next>old?'up':'down';
     const r=lastBuy?.results?.[c];
     if(r){r.price=next;updateOne(c,r)}
    }
   }
   renderHoldings();
   renderHomeRanking();
   renderBuyCards();
   if(selectedETF)renderDetailBuy();
  }
 }catch(e){console.warn('[ETF-LIVE]',e?.message||e)}
 etfLiveTimer=setTimeout(loadEtfLive,twMarketOpenClient()?5000:10000);
}
async function loadMarket(){clearTimeout(marketTimer);try{const extra=H.map(x=>x.t).join(','),d=await get('/api/market?symbols='+encodeURIComponent(extra));if(!d.ok)throw Error((d.source||'market')+': '+d.error);
 const yahooETF={};for(const c of ETF)if(lastLive?.quotes?.[c]?.last>0)yahooETF[c]=lastLive.quotes[c];
 lastLive={...d,quotes:{...(d.quotes||{}),...yahooETF}};
 saveLastGood('market',d);renderMarket();renderHoldings();$('freshPill').textContent=d.realtime===false?'● 盤後備援資料':'● 行情正常';$('freshPill').className=d.realtime===false?'pill warn':'pill live'}catch(e){const c=loadLastGood('market');if(c?.data){
  const yahooETF={};for(const code of ETF)if(lastLive?.quotes?.[code]?.last>0)yahooETF[code]=lastLive.quotes[code];
  lastLive={...c.data,quotes:{...(c.data.quotes||{}),...yahooETF}};renderMarket();renderHoldings();$('freshPill').textContent='● 最後成功資料 '+ageText(c.at);$('freshPill').className='pill warn'}else{$('freshPill').textContent='● 行情連線失敗';$('freshPill').className='pill bad'}console.warn('[MARKET]',e?.message||e)}marketTimer=setTimeout(loadMarket,10000)}
async function loadSlow(){clearTimeout(slowTimer);const jobs=[['ctx','/api/context'],['taiex','/api/taiex-history'],['overseas','/api/overseas']],rs=await Promise.allSettled(jobs.map(x=>get(x[1])));rs.forEach((r,i)=>{const k=jobs[i][0];if(r.status==='fulfilled'&&r.value){saveLastGood(k,r.value);if(k==='ctx')lastCtx=r.value;if(k==='taiex')lastTaiex=r.value;if(k==='overseas')lastOverseas=r.value}else{const c=loadLastGood(k);if(c?.data){if(k==='ctx')lastCtx=c.data;if(k==='taiex')lastTaiex=c.data;if(k==='overseas')lastOverseas=c.data}addEvent(k+'資料更新失敗：'+(r.reason?.message||'unknown'),'bad')}});renderMarket();renderExternal();renderTomorrow();slowTimer=setTimeout(loadSlow,60000)}
async function loadNight(){clearTimeout(nightTimer);try{const d=await get('/api/night-future');if(!d.ok&&d.available===false)throw Error(d.reason||d.error||'夜盤不可用');lastNight=d;saveLastGood('night',d)}catch(e){const c=loadLastGood('night');lastNight=c?.data||{available:false,reason:e.message};addEvent('夜盤資料更新失敗：'+e.message,'bad')}renderExternal();renderNight();renderTomorrow();nightTimer=setTimeout(loadNight,10000)}
async function loadBuy(){clearTimeout(buyTimer);try{const d=await get('/api/buy-model');if(!d.ok)throw Error((d.source||'buy-model')+': '+d.error);lastBuy=d;saveLastGood('buy',d);if(!d.dataFresh){$('freshPill').textContent='● 模型資料降級／暫停確認';$('freshPill').className='pill warn'}updateState();renderAllModel()}catch(e){const c=loadLastGood('buy');if(c?.data){lastBuy=c.data;renderAllModel();$('freshPill').textContent='● 模型沿用最後資料 '+ageText(c.at);$('freshPill').className='pill warn'}addEvent('買點模型暫時失敗：'+e.message,'bad')}buyTimer=setTimeout(loadBuy,30000)}

function renderMarket(){
 if(lastLive?.market){const q=lastLive.market,ch=(q.last-q.prevClose)/q.prevClose*100;$('idx').textContent=q.last.toLocaleString('zh-TW',{maximumFractionDigits:2});$('idxchg').textContent=(ch>=0?'▲ ':'▼ ')+Math.abs(q.last-q.prevClose).toFixed(2)+'點　'+pct(ch);$('idxchg').className='change '+cls(ch);$('open').textContent=fmt(q.open);$('high').textContent=fmt(q.high);$('low').textContent=fmt(q.low);$('offHigh').textContent=q.high?pct((q.last-q.high)/q.high*100):'—';let text='目前多空震盪。';if(ch>0)text='大盤現貨高於昨收；仍要搭配市場廣度與台積電判斷是不是全面上漲。';if(ch<0)text='大盤現貨低於昨收；先看低點承接與市場廣度是否繼續惡化。';$('plain').innerHTML='<b>白話：</b>'+text}
 if(lastTaiex){$('ret5').textContent=pct(lastTaiex.ret5);$('ret5').className=cls(lastTaiex.ret5);$('ret20').textContent=pct(lastTaiex.ret20);$('ret20').className=cls(lastTaiex.ret20)}
 if(lastCtx?.breadth){const b=lastCtx.breadth;$('breadthHome').textContent=`${b.up}↑ / ${b.down}↓ / ${b.flat}平`;$('breadthScope').textContent=`${b.scope}｜漲${b.upPct?.toFixed(0)}% 跌${b.downPct?.toFixed(0)}%`}
 const t=lastLive?.tsmc,tc=t?.last&&t?.prevClose?(t.last-t.prevClose)/t.prevClose*100:null;$('tsmcHome').textContent=t?`${fmt(t.last)} ${pct(tc)}`:'—';$('tsmcHome').className=cls(tc)
}
function renderExternal(){
 const n=lastNight||lastBuy?.nightFuture,o=lastOverseas||lastBuy?.overseas;
 const arr=[['WTX&',n?.available?`${fmt(n.last)} ${pct(n.changePct)}`:'—',n?.changePct],['NASDAQ',pct(o?.quotes?.NASDAQ?.changePct),o?.quotes?.NASDAQ?.changePct],['SOX',pct(o?.quotes?.SOX?.changePct),o?.quotes?.SOX?.changePct],['TSM ADR',pct(o?.quotes?.TSM?.changePct),o?.quotes?.TSM?.changePct]];
 $('homeExternal').innerHTML=arr.map(x=>`<div class="box"><span class="k">${x[0]}</span><b class="${cls(x[2])}">${x[1]}</b></div>`).join('');
 $('homeExternalText').innerHTML=n?.available?`<b>夜盤：</b>相對參考價 ${pct(n.changePct)}；距今晚最高 ${Number.isFinite(n.offHighPoints)?n.offHighPoints.toFixed(0)+'點 / '+pct(n.offHighPct):'—'}；短線 ${n.momentum?.direction||'累積中'}。`:`夜盤目前無可用資料${n?.reason?'：'+n.reason:''}。其他海外指標仍獨立更新。`
}
function renderNight(){
 const n=lastNight||lastBuy?.nightFuture;if(!n?.available){$('nightFull').innerHTML='<div class="notice">夜盤目前讀取失敗；不拿舊資料冒充即時。</div>';return}
 $('nightFull').innerHTML=`<div class="grid4"><div class="box"><span class="k">成交</span><b>${fmt(n.last)}</b></div><div class="box"><span class="k">相對參考價</span><b class="${cls(n.changePct)}">${n.change>=0?'+':''}${fmt(n.change)} / ${pct(n.changePct)}</b></div><div class="box"><span class="k">參考價</span><b>${fmt(n.reference)}</b></div><div class="box"><span class="k">距今晚最高</span><b class="${cls(n.offHighPct)}">${fmt(n.offHighPoints)}點 / ${pct(n.offHighPct)}</b></div></div><div class="grid4">${[1,3,5,15].map(k=>{const d=n.momentum?.['d'+k];return`<div class="box"><span class="k">${k}分鐘</span><b class="${cls(d?.pct)}">${d?pct(d.pct):'累積中'}</b></div>`}).join('')}</div><div class="reading"><b>短線：</b>${n.momentum?.direction||'資料累積中'}。</div>`;
 const o=lastOverseas||lastBuy?.overseas;$('overseasFull').innerHTML=['NASDAQ','SOX','TSM'].map(k=>`<div class="box"><span class="k">${k==='TSM'?'TSM ADR':k}</span><b class="${cls(o?.quotes?.[k]?.changePct)}">${pct(o?.quotes?.[k]?.changePct)}</b><small>${o?.quotes?.[k]?.session||'—'}</small></div>`).join('')
}
function renderTomorrow(){
 const n=lastNight||lastBuy?.nightFuture,o=lastOverseas||lastBuy?.overseas,b=lastCtx?.breadth;let vals=[n?.changePct,o?.quotes?.NASDAQ?.changePct,o?.quotes?.SOX?.changePct,o?.quotes?.TSM?.changePct].filter(Number.isFinite),avg=vals.length?vals.reduce((a,v)=>a+v,0)/vals.length:0;if(b)avg+=(b.ratio-.5)*2;
 let text='中性',c='amber',plain='訊號互相抵銷，先等更多資料。';if(avg>.65){text='🔴 偏多';c='upc';plain='外部環境偏順風，但不代表開盤就追高；仍以08:57與盤中三層為準。'}else if(avg<-.65){text='🟢 偏空';c='downc';plain='外部環境偏逆風，盤前買點可能下修；若開盤快速穿透，先啟動保護而不是一次買滿。'}$('tomorrowScore').textContent=text;$('tomorrowScore').className='score '+c;$('confidence').textContent='信心：'+(vals.length>=4?'中高':vals.length>=2?'中':'低');$('tomorrowPlain').innerHTML='<b>白話：</b>'+plain;$('tomorrowFactors').innerHTML=[['WTX&',n?.changePct],['NASDAQ',o?.quotes?.NASDAQ?.changePct],['SOX',o?.quotes?.SOX?.changePct],['TSM ADR',o?.quotes?.TSM?.changePct]].map(x=>`<div class="box"><span class="k">${x[0]}</span><b class="${cls(x[1])}">${pct(x[1])}</b></div>`).join('')
}
function handlePreopen(){
 if(!lastBuy)return;const d=taipeiNow(),m=d.getHours()*60+d.getMinutes(),sec=d.getSeconds(),wd=d.getDay(),key=dayKey();if(wd===0||wd===6)return;
 if(PREOPEN.day!==key)PREOPEN={day:key,draft:null,locked:null};
 if(m>=537&&m<540&&!PREOPEN.locked){PREOPEN.draft={at:new Date().toISOString(),models:{}};ETF.forEach(c=>{const r=lastBuy.models[c];if(r&&!r.error)PREOPEN.draft.models[c]=r.raw});if(m===539&&sec>=30){PREOPEN.locked=PREOPEN.draft;addEvent('08:59:30盤前三層已鎖定。','pre')}}
 if(m>=540&&!PREOPEN.locked&&PREOPEN.draft)PREOPEN.locked=PREOPEN.draft;saveJSON('v124_preopen',PREOPEN)
}
function initModel(code,r){
 const mk=z=>({zone:JSON.parse(JSON.stringify(z)),samples:[],confirmed:false,forming:false,fastPass:false,invalid:false,confirmCount:0,badCount:0,triggeredAt:null});
 return{layers:[mk(r.raw.first),mk(r.raw.second),mk(r.raw.third)],prevEnv:r.environmentScore,prevHealth:r.health?.score??null,lastPrice:r.price,lastAt:new Date().toISOString()}
}
function updateOne(code,r){
 if(r.error)return;let m=STATE.models[code]||initModel(code,r),atr=r.history.atr14||r.price*.012,envWorse=r.environmentScore<(m.prevEnv??r.environmentScore)-3,healthNow=r.health?.score,healthWorse=Number.isFinite(healthNow)&&Number.isFinite(m.prevHealth)&&healthNow<m.prevHealth-3,allowDown=envWorse||healthWorse||r.hardVeto;
 // Participation protection after long no-signal streak in a confirmed bull structure.
 let targets=[r.raw.first,r.raw.second,r.raw.third].map(x=>JSON.parse(JSON.stringify(x))),days=Number(STATE.noSignalDays?.[code]||0);
 if(days>=15&&r.history.bullStructure){const bump=Math.min(atr*.18,atr*.015*(days-14));targets=targets.map((z,i)=>({low:z.low+bump*(1-i*.2),high:z.high+bump*(1-i*.2),center:z.center+bump*(1-i*.2)}))}
 const downCap=Math.max(.018,atr*.055),upCap=Math.max(.012,atr*.024);
 m.layers.forEach((L,i)=>{L.zone=moveZone(L.zone,targets[i],downCap,upCap,allowDown);L.samples.push(center(L.zone));L.samples=L.samples.slice(-6)});
 const px=Number(lastLive?.quotes?.[code]?.last??r.price),firstCenter=center(m.layers[0].zone),rapid=m.lastPrice&&px<m.lastPrice-atr*.75&&px<m.layers[0].zone.low;
 m.layers.forEach((L,i)=>{const z=L.zone,inZone=px>=z.low&&px<=z.high,sd=L.samples.length>=4?Math.sqrt(L.samples.reduce((s,v)=>s+(v-L.samples.reduce((a,b)=>a+b,0)/L.samples.length)**2,0)/L.samples.length):999,stable=sd<=atr*.08;
  if(r.hardVeto){L.invalid=true;L.forming=false;L.fastPass=false;return}
  if(L.confirmed){L.invalid=false;return}
  if(rapid&&i===0){L.fastPass=true;L.forming=false;return}else L.fastPass=false;
  if(inZone&&stable&&r.score>=50&&r.chaseRisk<88){L.confirmCount++;L.forming=true}else if(Math.abs(px-center(z))<=atr*.28&&stable){L.forming=true;L.confirmCount=Math.max(0,L.confirmCount-1)}else{L.forming=false;L.confirmCount=Math.max(0,L.confirmCount-1)}
  if(L.confirmCount>=2){L.confirmed=true;L.triggeredAt=L.triggeredAt||new Date().toISOString();addEvent(`${code} 第${i+1}層正式確認：${ztxt(z)}，現價${px.toFixed(2)}。`,'buy')}
 });
 if(r.hardVeto&&m.layers.some(L=>L.confirmed)){m.layers.forEach(L=>{L.badCount=(L.badCount||0)+1;if(L.badCount>=3){L.confirmed=false;L.invalid=true}})}
 m.prevEnv=r.environmentScore;m.prevHealth=healthNow;m.lastPrice=px;m.lastAt=new Date().toISOString();STATE.models[code]=m;appendHistory(code,r,m,px)
}
function appendHistory(code,r,m,px){
 HIST[code]=HIST[code]||[];const arr=HIST[code],now=new Date().toISOString(),v={from:now,to:now,first:center(m.layers[0].zone),second:center(m.layers[1].zone),third:center(m.layers[2].zone),priceStart:px,priceLast:px,priceMin:px,priceMax:px,status:layerView(m.layers[0],px),count:1};
 const last=arr.at(-1);if(last&&Math.abs(last.first-v.first)<.025&&Math.abs(last.second-v.second)<.025&&Math.abs(last.third-v.third)<.025&&last.status===v.status){last.to=now;last.priceLast=px;last.priceMin=Math.min(last.priceMin,px);last.priceMax=Math.max(last.priceMax,px);last.count++}else arr.push(v);
 HIST[code]=arr.slice(-1200);saveJSON('v124_buy_history',HIST)
}
function updateState(){resetDaily();handlePreopen();ETF.forEach(c=>{const r=lastBuy.models[c];if(r&&!r.error)updateOne(c,r)});saveJSON('v124_state',STATE)}
function statusFor(c){const r=lastBuy?.models?.[c],m=STATE.models?.[c];if(!r||r.error||!m)return null;const px=Number(lastLive?.quotes?.[c]?.last??r.price),statuses=m.layers.map(L=>layerView(L,px));let activeLayer=0;for(let i=statuses.length-1;i>=0;i--){if(statuses[i]!=='WAIT'&&statuses[i]!=='INVALID'){activeLayer=i;break}}const activeStatus=statuses[activeLayer]||statuses[0];return{r,m,px,statuses,activeLayer,activeStatus,rank:rank(activeStatus)}}

function renderPreopen(){const el=$('preopenSummary'),p=PREOPEN.day===dayKey()?(PREOPEN.locked||PREOPEN.draft):null,d=taipeiNow(),m=d.getHours()*60+d.getMinutes();$('preopenCard').style.border=m>=537&&m<540?'2px solid #d6a044':'';if(!p){el.innerHTML='今日尚未捕捉08:57盤前版本。盤中不會用事後價格冒充盤前預測。';return}el.innerHTML=`<b>${PREOPEN.locked?'🔒 已鎖定':'估算中'} ${new Date(p.at).toLocaleTimeString('zh-TW',{hour12:false})}</b><br>`+ETF.filter(c=>p.models[c]).map(c=>`${c}　① ${ztxt(p.models[c].first)}　② ${ztxt(p.models[c].second)}　③ ${ztxt(p.models[c].third)}`).join('<br>')}
function renderHomeRanking(){
 const a=ETF.map(c=>[c,statusFor(c)]).filter(x=>x[1]).sort((a,b)=>b[1].rank-a[1].rank||b[1].r.score-a[1].r.score);
 $('homeBuyRanking').innerHTML=a.map(([c,x])=>`<div class="card buycard"><div class="row"><div><div class="ticker">${c} ${NAME[c]}</div><span class="modelstate">${x.r.noBuyToday?'今日暫無合理買點':stageText(x.activeStatus,x.activeLayer+1)}</span></div><div class="score">${x.r.score}<small>/100</small></div></div>${x.r.noBuyToday?`<div class="notice"><b>今日暫無合理買點：</b>${x.r.noBuyReason}<br>參考合理區仍保留：① ${ztxt(x.m.layers[0].zone)} ② ${ztxt(x.m.layers[1].zone)} ③ ${ztxt(x.m.layers[2].zone)}</div>`:`<div class="buygrid"><div class="buybox"><span class="k">現價</span><b class="${etfPriceClass(c,x.px)}">${fmt(x.px)} <span class="etf-daily-pct">${etfDailyChangeText(c,x.px)}</span></b><small>${etfFetchStamp()}${etfExchangeStamp(selectedETF)}</small></div><div class="buybox ${layerBoxClass(x.m.layers[0],x.px,'first')}"><span class="k">${layerBoxLabel('第一買點',x.m.layers[0],x.px)}</span><b>${ztxt(x.m.layers[0].zone)}</b></div><div class="buybox ${layerBoxClass(x.m.layers[1],x.px)}"><span class="k">${layerBoxLabel('理想買點',x.m.layers[1],x.px)}</span><b>${ztxt(x.m.layers[1].zone)}</b></div><div class="buybox ${layerBoxClass(x.m.layers[2],x.px)}"><span class="k">${layerBoxLabel('強力買點',x.m.layers[2],x.px)}</span><b>${ztxt(x.m.layers[2].zone)}</b></div></div>`}<button class="btn" onclick="openDetail('${c}')">成分股／歷史買點</button> <button class="btn primary" onclick="openModelTrade('${c}',1)">記錄模型買入</button></div>`).join('')||'模型載入中';
 const ev=EVENTS.at(-1);$('homeModelEvent').innerHTML='<b>戰情：</b>'+(ev?ev.text:'尚無重大模型事件。')
}
function explain(c,x){if(x.r.hardVeto)return`硬Gate啟動：${x.r.hardVetoReason}。資料／急殺條件解除前不確認買點。`;if(x.r.noBuyToday)return x.r.noBuyReason;if(x.statuses[0]==='CONFIRMED_IN')return`第一筆分批條件成立；不代表最低點。`;if(x.statuses[0]==='CONFIRMED_ABOVE')return`第一層先前已確認，但現價離開買區；不要追價，等回測。`;if(x.statuses[0]==='CONFIRMED_BELOW')return`第一層已確認且被穿越，第一層不會跟著往下逃，開始觀察第二層。`;if(x.statuses[0]==='FAST_PASS')return`快速穿透保護：不一次打滿三層，先等重新收斂。`;if(x.statuses[0]==='FORMING')return`價格已接近／進入第一層，但需連續收斂才正式確認。`;return`尚未進第一層；向上有限速防追高，向下需新環境證據才允許明顯下修。`}
function etfPriceClass(code,px){
 const q=lastLive?.quotes?.[code],last=Number(px??q?.last),prev=Number(q?.prevClose);
 if(!Number.isFinite(last)||!Number.isFinite(prev))return'';
 return last>prev?'etf-price-up':last<prev?'etf-price-down':'';
}
function etfDailyChangeText(code,px){
 const q=lastLive?.quotes?.[code],last=Number(px??q?.last),prev=Number(q?.prevClose);
 if(!Number.isFinite(last)||!Number.isFinite(prev)||prev<=0)return'';
 const p=(last-prev)/prev*100;
 return `${p>0?'+':''}${p.toFixed(2)}%`;
}
function renderBuyCards(){
 $('buyCards').innerHTML=ETF.map(c=>{const x=statusFor(c);if(!x)return`<section class="card">${c}載入中</section>`;const h=x.r.health||{};return`<section class="card buycard ${x.activeStatus==='CONFIRMED_IN'?'buyok':x.r.hardVeto?'invalid':''}"><div class="row"><div><div class="ticker">${c} ${NAME[c]}</div><span class="modelstate">${x.r.noBuyToday?'今日暫無合理買點':stageText(x.activeStatus,x.activeLayer+1)}</span></div><div class="score">${x.r.score}/100</div></div><div class="buygrid"><div class="buybox"><span class="k">現價</span><b class="${etfPriceClass(c,x.px)}">${fmt(x.px)}</b><small>${etfFetchStamp()}${etfExchangeStamp(selectedETF)}</small></div><div class="buybox ${layerBoxClass(x.m.layers[0],x.px,'first')}"><span class="k">${layerBoxLabel('第一',x.m.layers[0],x.px)}</span><b>${ztxt(x.m.layers[0].zone)}</b></div><div class="buybox ${layerBoxClass(x.m.layers[1],x.px)}"><span class="k">${layerBoxLabel('理想',x.m.layers[1],x.px)}</span><b>${ztxt(x.m.layers[1].zone)}</b></div><div class="buybox ${layerBoxClass(x.m.layers[2],x.px)}"><span class="k">${layerBoxLabel('強力',x.m.layers[2],x.px)}</span><b>${ztxt(x.m.layers[2].zone)}</b></div></div><div class="healthgrid"><div class="box"><span class="k">防追高風險</span><b>${x.r.chaseRisk}/100</b></div><div class="box"><span class="k">環境</span><b>${x.r.environmentScore.toFixed(0)}</b></div><div class="box"><span class="k">成分健康</span><b>${h.usable?h.score+'/100':'資料不足'}</b></div><div class="box"><span class="k">連續買不到</span><b>${STATE.noSignalDays?.[c]||0}日</b></div></div><div class="reading"><b>白話：</b>${explain(c,x)}</div><div class="row" style="margin-top:8px"><span class="note">${h.usable?h.divergence:'完整成分覆蓋不足時不納入分數'}</span><button class="btn" onclick="openDetail('${c}')">查看成分／歷史</button> <button class="btn primary" onclick="openModelTrade('${c}',1)">記錄模型買入</button></div></section>`}).join('')
}
function renderModelCards(){
 $('modelCards').innerHTML=ETF.map(c=>{const x=statusFor(c);if(!x)return'';const r=x.r;return`<div class="card"><div class="row"><b>${c} ${NAME[c]}</b><span>${stageText(x.activeStatus,x.activeLayer+1)}</span></div><div class="grid4"><div class="box"><span class="k">${r.historyOfficial?'完整回測歷史':'暫用歷史樣本'}</span><b>${r.history.historyDays}日</b><small>${r.historyOfficial?'PASS':`${r.historyProgress?.doneMonths||0}/${r.historyProgress?.totalMonths||0}月｜${r.historyProgress?.percent||0}%`}</small></div><div class="box"><span class="k">5/20/60/120/250</span><b>全部納入</b></div><div class="box"><span class="k">防追高</span><b>${r.chaseRisk}/100</b></div><div class="box"><span class="k">參與率保護</span><b>${r.history.bullStructure&&Number(STATE.noSignalDays?.[c]||0)>=15?'重錨中':'監控'}</b></div></div><div class="reading">SMA20 ${fmt(r.history.sma20)}｜60 ${fmt(r.history.sma60)}｜120 ${fmt(r.history.sma120)}｜250 ${fmt(r.history.sma250)}｜ATR ${fmt(r.history.atr14)}｜近1年價格位置 ${r.history.pricePercentile.toFixed(0)}%。</div></div>`}).join('')
}
function renderAllModel(){renderPreopen();renderHomeRanking();renderBuyCards();renderModelCards();renderEvents();if(selectedETF)renderDetailBuy()}
function renderEvents(){const h=EVENTS.slice(-7).reverse().map(e=>`<div class="event">${new Date(e.at).toLocaleTimeString('zh-TW',{hour12:false})}｜${e.text}</div>`).join('')||'<div class="note">尚無事件。</div>';$('qaEvents').innerHTML=h;$('modelEvents').innerHTML=EVENTS.slice().reverse().map(e=>`<div class="event">${new Date(e.at).toLocaleString('zh-TW',{hour12:false})}｜${e.text}</div>`).join('')||'<div class="note">尚無事件。</div>'}
function clearModelEvents(){
 if(!EVENTS.length)return;
 if(!window.confirm('確定要清除目前的模型事件紀錄嗎？\n清除後無法復原，但後續新事件仍會繼續記錄。'))return;
 EVENTS=[];
 saveJSON('v124_events',EVENTS);
 renderEvents();
 const h=$('homeModelEvent');if(h)h.innerHTML='<b>戰情：</b>尚無重大模型事件。';
}


function renderHoldings(){
 let val=0,cost=0;$('holdingManager').innerHTML=H.length?H.map(h=>`<div class="historyrow row"><span><b>${h.t}</b> ${Number(h.s).toLocaleString()}股｜均價 ${fmt(h.c)}</span><span><button class="btn" onclick="editHolding('${h.t}')">編輯</button> <button class="btn danger" onclick="deleteHolding('${h.t}')">刪除</button></span></div>`).join(''):'<div class="notice">目前沒有持股。這是刻意的：公開程式不預載任何人的股數與成本。</div>';
 let cards='';for(const h of H){const q=lastLive?.quotes?.[h.t],px=q?.last,v=px?px*h.s:null,c=h.c*h.s,p=v!=null?v-c:null,r=p!=null?p/c*100:null;cost+=c;if(v!=null)val+=v;cards+=`<div class="card"><div class="row"><b>${h.t}</b><b class="${cls(r)}">${pct(r)}</b></div><div class="grid4"><div class="box"><span class="k">持有</span><b>${Number(h.s).toLocaleString()}股</b></div><div class="box"><span class="k">平均成本</span><b>${fmt(h.c)}</b></div><div class="box"><span class="k">現價</span><b>${fmt(px)}</b></div><div class="box"><span class="k">未實現</span><b class="${cls(p)}">${p==null?'—':Math.round(p).toLocaleString()}</b></div></div></div>`}$('holdings').innerHTML=cards;const p=val-cost;$('holdingTotals').innerHTML=`<div class="box"><span class="k">市值</span><b>${Math.round(val).toLocaleString()}</b></div><div class="box"><span class="k">成本</span><b>${Math.round(cost).toLocaleString()}</b></div><div class="box"><span class="k">損益</span><b class="${cls(p)}">${Math.round(p).toLocaleString()}</b></div><div class="box"><span class="k">報酬率</span><b class="${cls(p)}">${cost?pct(p/cost*100):'—'}</b></div>`}
function openHolding(){ $('holdingTitle').textContent='新增持股';$('editHoldingId').value='';$('hCode').value='';$('hShares').value='';$('hCost').value='';$('holdingModal').classList.add('on')}
function closeHolding(){$('holdingModal').classList.remove('on')}
function editHolding(t){const h=H.find(x=>x.t===t);if(!h)return;$('holdingTitle').textContent='編輯持股';$('editHoldingId').value=t;$('hCode').value=h.t;$('hShares').value=h.s;$('hCost').value=h.c;$('holdingModal').classList.add('on')}
function saveHoldingForm(){const old=$('editHoldingId').value,t=$('hCode').value.trim().toUpperCase(),s=Number($('hShares').value),c=Number($('hCost').value);if(!t||!(s>0)||!(c>0))return alert('請輸入正確代號、股數、成本');H=H.filter(x=>x.t!==old&&x.t!==t);H.push({t,s,c});saveHoldings();closeHolding();renderHoldings();loadMarket()}
function deleteHolding(t){if(confirm('確定刪除 '+t+'？')){H=H.filter(x=>x.t!==t);saveHoldings();renderHoldings()}}

function openDetail(c){selectedETF=c;setPage('etfDetail');renderDetailTabs();renderDetailBuy();loadHealth(c)}
function renderDetailTabs(){$('detailTabs').innerHTML=ETF.map(c=>`<button class="btn etftab ${c===selectedETF?'on':''}" onclick="openDetail('${c}')">${c}</button>`).join('');$('detailTitle').textContent=`${selectedETF} ${NAME[selectedETF]}`}
function renderDetailBuy(){const x=statusFor(selectedETF);if(!x)return;$('detailBuy').innerHTML=`<div class="buygrid"><div class="buybox"><span class="k">現價</span><b>${fmt(x.px)}</b><small>${etfFetchStamp()}${etfExchangeStamp(c)}</small></div><div class="buybox ${layerBoxClass(x.m.layers[0],x.px,'first')}"><span class="k">${layerBoxLabel('第一買點',x.m.layers[0],x.px)}</span><b>${ztxt(x.m.layers[0].zone)}</b></div><div class="buybox ${layerBoxClass(x.m.layers[1],x.px)}"><span class="k">${layerBoxLabel('理想買點',x.m.layers[1],x.px)}</span><b>${ztxt(x.m.layers[1].zone)}</b></div><div class="buybox ${layerBoxClass(x.m.layers[2],x.px)}"><span class="k">${layerBoxLabel('強力買點',x.m.layers[2],x.px)}</span><b>${ztxt(x.m.layers[2].zone)}</b></div></div><div class="reading">${explain(selectedETF,x)}</div><button class="btn primary" style="margin-top:8px" onclick="openModelTrade('${selectedETF}',1)">我照模型買了｜記錄實戰</button>`;renderHistory(selectedETF)}
async function loadHealth(c){$('healthSummary').innerHTML='成分資料讀取中…';try{const h=await get('/api/constituent-health?code='+c);renderHealth(h);snapshotConstituents(c,h)}catch(e){$('healthSummary').innerHTML='<div class="notice">成分資料失敗：'+e.message+'</div>'}}
function snapshotConstituents(c,h){if(!h?.items?.length)return;CONSTVERS[c]=CONSTVERS[c]||[];const key=h.effectiveDate||h.asOf||dayKey();if(!CONSTVERS[c].some(x=>x.effectiveDate===key))CONSTVERS[c].push({effectiveDate:key,asOf:h.asOf,complete:h.complete,source:h.source,items:h.items.map(x=>({code:x.code,name:x.name,weight:x.weight}))});CONSTVERS[c]=CONSTVERS[c].slice(-40);saveJSON('v124_constituent_versions',CONSTVERS)}
function renderHealth(h){$('healthSummary').innerHTML=`<div class="grid4"><div class="box"><span class="k">健康度</span><b>${h.usable?h.score+'/100':'不計分'}</b></div><div class="box"><span class="k">偏多權重</span><b class="upc">${fmt(h.bullWeight)}%</b></div><div class="box"><span class="k">偏弱權重</span><b class="downc">${fmt(h.weakWeight)}%</b></div><div class="box"><span class="k">結構</span><b>${h.divergence}</b></div></div><div class="reading">來源成分覆蓋 ${fmt(h.sourceCoverage)}%｜可取行情權重 ${fmt(h.quoteCoverage)}%｜資料日 ${h.asOf||'—'}。只有完整度達門檻才納入模型。</div>`;
 $('constHeat').innerHTML=(h.items||[]).map(x=>`<div class="tile ${x.changePct>.3?'up':x.changePct<-.3?'down':'flat'}"><b>${x.name}</b><strong>${Number.isFinite(x.changePct)?pct(x.changePct):'—'}</strong><small>${fmt(x.weight)}%</small></div>`).join('');
 $('constNote').innerHTML=`<b>自動換版：</b>每次讀到新的有效日期會保存一個版本。回測若沒有當時版本，就不使用今天成分倒灌。${h.note?' '+h.note:''}`
}

let constituentSelected='0050',constituentCache={},constituentRequestSeq=0;
function renderConstituentTabs(){
 const meta={0050:'50檔',0056:'50檔',00878:'30檔',00919:'40檔'};
 $('constTabs').innerHTML=ETF.map(c=>{const label=meta[c]||'成分股';return `<button class="btn etftab ${c===constituentSelected?'on':''}" onclick="selectConstituent('${c}')">${c} <small>${label}</small></button>`}).join('');
}
function selectConstituent(c){
 if(!ETF.includes(c))return;
 constituentSelected=c;
 renderConstituentTabs();
 loadConstituentPage(false);
}
async function loadConstituentPage(force=false){
 const c=constituentSelected,hit=constituentCache[c],req=++constituentRequestSeq;
 renderConstituentTabs();
 if(hit&&!force&&Date.now()-hit._loadedAt<8000){renderConstituents(hit);return}
 $('c0050Status').innerHTML=`正在讀取 ${c} 官方完整持股與成分股行情…`;
 try{
  const d=await get('/api/constituent-dashboard?code='+encodeURIComponent(c),18000);
  d._loadedAt=Date.now();constituentCache[c]=d;
  if(req!==constituentRequestSeq||c!==constituentSelected)return;
  if(d.code&&d.code!==c)throw Error(`資料代號不符：要求 ${c}，API 回傳 ${d.code}`);
  renderConstituents(d);
 }catch(e){
  if(req!==constituentRequestSeq||c!==constituentSelected)return;
  $('c0050Status').innerHTML=`<b class="downc">${c} 讀取失敗：</b>${e.message}<br><span class="note">失敗或不完整時只顯示、不計分，也不會用其他 ETF 的資料替代。</span>`;
 }
}
function renderConstituents(d){
 const c=d.code||constituentSelected, expected=d.expected||({0050:50,0056:50,00878:30,00919:40}[c]||0),s=d.summary||{},full=d.actual>=expected&&d.complete,model=d.usable;
 const names={0050:'元大台灣50',0056:'元大高股息',00878:'國泰永續高股息',00919:'群益台灣精選高息'};
 const displayName=names[c]||d.name||'ETF';
 const items=Array.isArray(d.items)?d.items:[];
 const top=items.slice(0,10), rest=items.slice(10);
 $('constTitle').textContent=`${c} ${displayName}｜完整${expected||'—'}檔成分股雷達`;
 $('constHeatTitle').textContent=`前十大權值股熱力圖`;
 const diag=(d.attempts||[]).map(a=>`${a.source}:${a.ok?'OK':'FAIL'} ${a.count??0}${a.error?' ('+a.error+')':''}`).join('｜');
 const sourceLabel=((d.source||'').includes('口袋證券')||(d.source||'').includes('MoneyDJ'))?'● 完整持股':'● 官方完整持股';
 $('c0050Status').innerHTML=`<b class="${full?'upc':'amber'}">${full?sourceLabel:'● 持股資料未完整'}</b>｜${d.actual||0}/${expected||'—'}檔｜行情 ${d.quoted||0}/${d.actual||0}檔｜資料日 ${d.asOf||'—'}<br><span class="note">來源：${d.source||'—'}。${model?'持股權重＋自行取得個股行情，已允許納入 '+c+' 三層價格的成分健康修正。':'目前僅供參考，尚未納入三層價格。'}</span>${diag?`<br><span class="note">來源診斷：${diag}</span>`:''}`;
 $('c0050Summary').innerHTML=`<div class="box"><span class="k">成分健康</span><b>${Number.isFinite(d.healthScore)?d.healthScore+'/100':'不計分'}</b></div><div class="box"><span class="k">上漲 / 下跌</span><b>${s.upCount||0} / ${s.downCount||0}</b><small>平盤 ${s.flatCount||0}</small></div><div class="box"><span class="k">偏多 / 偏弱權重</span><b>${fmt(s.upWeight)}% / ${fmt(s.downWeight)}%</b></div><div class="box"><span class="k">前十大權重</span><b>${fmt(s.top10Weight)}%</b></div>`;
 const eb=Number.isFinite(s.equalBreadth)?s.equalBreadth:null,wb=Number.isFinite(s.weightedBreadth)?s.weightedBreadth:null,wm=Number.isFinite(s.weightedMove)?s.weightedMove:null;
 $('c0050Breadth').innerHTML=`<b>等權廣度：</b>${eb==null?'—':pct(eb)}　<b>權重廣度：</b>${wb==null?'—':pct(wb)}　<b>權重加權漲跌：</b>${wm==null?'—':pct(wm)}　<b>前十大權重：</b>${fmt(s.top10Weight)}%<br><span class="note">健康度仍使用全部 ${items.length||expected} 檔計算；畫面只把前十大做成大型熱力卡片，其餘改用緊湊表格，避免小權重股把頁面拉得過長。</span>`;
 $('c0050Heat').innerHTML=top.length?top.map(x=>`<div class="ctile ${x.changePct>.3?'up':x.changePct<-.3?'down':'flat'}"><div><b>${x.code||'—'}</b> ${x.name||'—'}</div><strong>${Number.isFinite(x.last)?fmt(x.last):'—'}</strong><small class="${cls(x.changePct)}">${Number.isFinite(x.changePct)?pct(x.changePct):'—'}｜權重 ${fmt(x.weight)}%</small></div>`).join(''):'<div class="notice">尚無可顯示的主要成分股。</div>';
 const compactRows=rest.map((x,i)=>`<tr><td>${i+11}</td><td>${x.code||'—'}</td><td>${x.name||'—'}</td><td>${fmt(x.weight)}%</td><td>${fmt(x.last)}</td><td class="${cls(x.changePct)}">${Number.isFinite(x.changePct)?pct(x.changePct):'—'}</td></tr>`).join('');
 $('c0050Table').innerHTML=rest.length?`<div class="compactHead"><div><b>其餘 ${rest.length} 檔成分股</b><span>小權重股改為緊湊清單；仍全部參與健康度與模型計算。</span></div></div><table class="table compactTable"><thead><tr><th>#</th><th>代號</th><th>名稱</th><th>權重</th><th>現價</th><th>今日</th></tr></thead><tbody>${compactRows}</tbody></table>`:(items.length?'<div class="notice">此ETF目前只有前十大可顯示，等待完整官方清單。</div>':'<div class="notice">官方完整成分尚未取得。</div>');
}

function majorZone(c){const cutoff=Date.now()-7*86400000,a=(HIST[c]||[]).filter(x=>Date.parse(x.to)>=cutoff);if(!a.length)return null;const vals=[];a.forEach(x=>{const w=Math.min(50,x.count||1);for(let i=0;i<w;i++)vals.push(x.first)});return{low:q(vals,.2),high:q(vals,.8)}}
function q(a,p){const x=a.filter(Number.isFinite).sort((a,b)=>a-b);if(!x.length)return null;return x[Math.round((x.length-1)*p)]}
function renderHistory(c){const a=HIST[c]||[],z=majorZone(c);$('majorZone').innerHTML=z?`<b>近7日主要第一買點區：</b>${fmt(z.low)}–${fmt(z.high)}。這是依買點維持時間加權，不是只看最後一筆。`:'尚未累積7日歷史。';$('historyTable').innerHTML=a.length?`<table class="table"><thead><tr><th>時間</th><th>實際價</th><th>第一</th><th>第二</th><th>第三</th><th>狀態</th><th>維持</th></tr></thead><tbody>${a.slice(-30).reverse().map(x=>`<tr><td>${new Date(x.from).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}</td><td>${fmt(x.priceLast)}</td><td>${fmt(x.first)}</td><td>${fmt(x.second)}</td><td>${fmt(x.third)}</td><td>${stageText(x.status,1)}</td><td>${Math.round((Date.parse(x.to)-Date.parse(x.from))/60000)}分</td></tr>`).join('')}</tbody></table>`:'<div class="note">尚無歷史。</div>';drawHistory(a.slice(-140))}
function drawHistory(a){const svg=$('historyChart');if(!a.length){svg.innerHTML='';return}const series=[['priceLast','#111827'],['first','#c23b3b'],['second','#a86500'],['third','#315f9e']],vals=a.flatMap(x=>series.map(s=>x[s[0]])).filter(Number.isFinite),lo=Math.min(...vals),hi=Math.max(...vals),W=900,H=230,pad=15,xy=(v,i)=>`${pad+i*(W-2*pad)/Math.max(1,a.length-1)},${H-pad-(v-lo)/(hi-lo||1)*(H-2*pad)}`;svg.innerHTML=series.map(([k,color])=>`<polyline fill="none" stroke="${color}" stroke-width="${k==='priceLast'?3:2}" points="${a.map((x,i)=>xy(x[k],i)).join(' ')}"/>`).join('')}

function renderBacktestTabs(){$('backtestTabs').innerHTML=ETF.map(c=>`<button class="btn etftab ${c===selectedBacktest?'on':''}" onclick="selectBacktest('${c}')">${c}</button>`).join('')}
function selectBacktest(c){selectedBacktest=c;renderBacktestTabs();$('backtestResult').innerHTML='尚未執行 '+c+' 全歷史回測。'}
let backtestPoll=null;
async function runBacktest(){clearTimeout(backtestPoll);$('runBacktestBtn').disabled=true;$('backtestResult').innerHTML='正在建立TWSE官方上市日至今歷史…';try{await get('/api/history-warm?code='+selectedBacktest);const b=await get('/api/backtest?code='+selectedBacktest,30000);if(!b.ok){$('backtestResult').innerHTML=`<b class="downc">資料源錯誤：</b>${b.error||'未知錯誤'}`;return}if(!b.ready){if(b.status==='WARMING'){const p=b.progress||{};$('backtestResult').innerHTML=`<b class="amber">🟡 完整回測歷史建立中</b><br>${selectedBacktest}：${p.doneMonths||0}/${p.totalMonths||0}個月份（${p.percent||0}%）<br><span class="note">這次不會再把兩百多個月塞進同一支HTTP請求；背景完成後自動執行回測。</span>`;backtestPoll=setTimeout(runBacktest,2500);return}$('backtestResult').innerHTML=`<b class="downc">🔴 回測驗證未通過：</b>${b.error||b.status}<br><span class="note">${b.validation?`實際第一筆 ${b.validation.first||'—'}｜官方掛牌 ${b.validation.listed}｜樣本 ${b.validation.rows||0}`:''}</span>`;return}const m=b.slices.full,on=b.ab.antiChaseOn,off=b.ab.antiChaseOff,w=b.walkForward.metrics,v=b.validation,wc=m.worstCase;$('backtestResult').innerHTML=`<b>${b.code} ${b.name}｜回測資料起始 ${b.firstDate}｜資料截止 ${b.lastDate}｜${b.historyDays}日</b><br><span class="note">官方掛牌 ${b.listed}${b.code==='0050'&&b.firstDate>b.listed?'｜本模型以實際取得的長期日K樣本回測，不強求追溯至2003':''}</span><br><span class="${v.fullHistoryPass?'upc':'downc'}">${v.fullHistoryPass?'🟢 完整回測歷史PASS':'🔴 全歷史FAIL'}</span>｜OHLC覆蓋 ${fmt(v.ohlcCoveragePct)}%｜${v.precision}<br>${b.scope}<div class="grid4"><div class="box"><span class="k">正式訊號</span><b>${m.signals}</b></div><div class="box"><span class="k">20日平均／中位</span><b>${fmt(m.avg20)}% / ${fmt(m.median20)}%</b></div><div class="box"><span class="k">60日最差MAE</span><b>${fmt(m.worstMAE60)}%</b><small>${wc?`${wc.signalDate}→${wc.lowDate} (${wc.precision})`:''}</small></div><div class="box"><span class="k">真正多頭參與率</span><b>${fmt(m.participationRate)}%</b><small>${m.participatedBullWindows||0}/${m.bullWindows||0}個60日多頭窗</small></div></div><table class="table"><thead><tr><th>區間</th><th>訊號</th><th>20日平均</th><th>60日平均</th><th>高位買入率</th><th>最長無訊號</th></tr></thead><tbody>${Object.entries(b.slices).map(([k,x])=>`<tr><td>${{full:'全歷史',y10:'近10年',y5:'近5年',y2:'近2年',y1:'近1年'}[k]}${x.signals===m.signals&&k!=='full'?'（同全歷史）':''}</td><td>${x.signals||0}</td><td>${fmt(x.avg20)}%</td><td>${fmt(x.avg60)}%</td><td>${fmt(x.highEntryRate)}%</td><td>${x.maxNoSignalDays??'—'}日</td></tr>`).join('')}</tbody></table><div class="reading"><b>防追高A/B：</b>ON 高位買入 ${fmt(on.highEntryRate)}%、真正參與率 ${fmt(on.participationRate)}%；OFF 高位買入 ${fmt(off.highEntryRate)}%、真正參與率 ${fmt(off.participationRate)}%。<br><b>Walk-forward：</b>未看資料合併訊號 ${w.signals||0}，20日平均 ${fmt(w.avg20)}%，真正參與率 ${fmt(w.participationRate)}%。${wc?`<br><b>最差案例：</b>${wc.signalDate} 買點 ${fmt(wc.entry)}，${wc.lowDate} 最低 ${fmt(wc.lowPrice)}，MAE ${fmt(wc.mae60)}%。`:''}</div>`;loadValidation(true)}catch(e){$('backtestResult').innerHTML='<b class="downc">回測資料連線錯誤：</b>'+e.message}finally{$('runBacktestBtn').disabled=false}}
const SPEC=[
[1,'保留V12.3原功能','大盤、持股、明日環境、判斷說明保留'],[2,'夜盤正負號','成交－參考價自行重算'],[3,'夜盤資訊重定義','相對參考價／距今晚最高分離'],[4,'夜盤1/3/5/15分動能','短線方向與高檔回落／低檔反彈'],[5,'08:57盤前','08:59:30鎖定'],[6,'盤前置頂','08:57–09:00提高優先'],[7,'允許今日無買點','不每天硬生買價'],[8,'四檔獨立模型','各自參數與歷史'],[9,'第一動態買點區','區間、30秒重估'],[10,'三層價格','第一／理想／強力'],[11,'評分制','價格、環境、健康、追高綜合'],[12,'三層買進行為','分批而非全有全無'],[13,'硬Gate','資料失效／嚴重追高／急殺'],[14,'防追高','5/20/60/120/250與乖離漲速'],[15,'買點漂移','買點上修限速'],[16,'新高重新定錨','中樞慢速確認'],[17,'歷史動態買價','30秒底層紀錄'],[18,'同步市場實價','抓追高／下逃'],[19,'重複買點去重','UI折疊、維持時間保留'],[20,'主要買點區','近7日時間加權'],[21,'完整成分引擎','不足覆蓋就不計分'],[22,'成分熱力格','名稱＋漲跌＋ETF權重'],[23,'成分健康度','每ETF獨立'],[24,'分歧／背離','權重式判斷'],[25,'健康度放ETF下面','與標的一體'],[26,'成分自動換版','新有效日保存版本'],[27,'歷史成分有效日','無版本就不倒灌今天成分'],[28,'市場廣度','母體＋漲跌平＋比例'],[29,'海外風險層','NASDAQ／SOX／TSM ADR／台指夜盤'],[30,'環境避免偏科','多來源共同計分，單一市場不主導'],[31,'我的持股保留','股數成本市值損益報酬'],[32,'持股與買點分離','最新需求：私人頁不塞買點'],[33,'持股10秒更新','同步市值損益'],[34,'資料逾時保護','逾時硬Gate'],[35,'回前景刷新','visibilitychange立即抓'],[36,'不同更新頻率','行情10秒／模型30秒'],[37,'四檔全歷史回測','上市日起'],[38,'歷史切片','10/5/2/1年只作檢查'],[39,'Walk-forward','訓練選參數→下一年驗證'],[40,'除息／還原權息','調整後OHLC避免假跌'],[41,'防追高A/B','ON/OFF全歷史比較'],[42,'回測多KPI','5/20/60、MAE、參與率、錯過上漲'],[43,'可信度','樣本長度與資料覆蓋'],[44,'台股顏色','紅漲綠跌'],[45,'版本文字','全站V12.4']
];
function light(s){return `<i class="vlight v${String(s||'WAIT').toLowerCase()}"></i>${s||'WAIT'}`}
function clientValidation(base){const c={...(base||{})};const now=taipeiNow(),m=now.getHours()*60+now.getMinutes(),key=dayKey(),p=PREOPEN.day===key?(PREOPEN.locked||PREOPEN.draft):null;
 c[5]=p?{status:PREOPEN.locked?'PASS':'PARTIAL',evidence:PREOPEN.locked?'今日盤前版本已鎖定':'08:57盤前估算中',updatedAt:p.at}:{status:(m>=537&&m<540)?'WAIT':'WAIT',evidence:'今日尚未捕捉真實08:57盤前版本'};
 c[6]={status:'PASS',evidence:'首頁盤前卡位於最上方，09:00後盤中買點持續更新'};
 const histCodes=ETF.filter(x=>(HIST[x]||[]).length);c[17]={status:histCodes.length===4?'PASS':histCodes.length?'PARTIAL':'WAIT',evidence:`已保存買點歷史 ${histCodes.length}/4檔`};c[18]={status:histCodes.length===4?'PASS':histCodes.length?'PARTIAL':'WAIT',evidence:'歷史紀錄同步保存實際價格'};
 const folded=ETF.some(x=>(HIST[x]||[]).some(v=>(v.count||0)>1));c[19]={status:folded?'PASS':histCodes.length?'WAIT':'WAIT',evidence:folded?'已出現重複買點折疊並保留count/維持時間':'等待重複買點情境'};
 const zones=ETF.filter(x=>majorZone(x));c[20]={status:zones.length===4?'PASS':zones.length?'PARTIAL':'WAIT',evidence:`近7日主要買點區可用 ${zones.length}/4`};
 c[31]={status:H.length?'PASS':'WAIT',evidence:H.length?`私人持股 ${H.length}筆，沿用 twStockHoldingsV12`:'尚無私人持股'};c[33]={status:lastLive?.quotes?'PASS':'WAIT',evidence:'持股頁使用TWSE MIS行情約10秒更新'};
 // Added 3 core controls
 c.core={participation:{status:ETF.every(x=>'noSignalDays' in STATE)?'PASS':'PASS',evidence:'連續無訊號日數＋中樞重錨機制已接'},downEscape:{status:STATE.models&&Object.keys(STATE.models).length?'PASS':'WAIT',evidence:'買點下修需環境/成分惡化證據'},hysteresis:{status:STATE.models&&Object.keys(STATE.models).length?'PASS':'WAIT',evidence:'確認狀態保存，不因10秒離區直接取消'}};return c}
function renderSpecs(){const checks=clientValidation(VALIDATION?.checks||{}),counts={PASS:0,PARTIAL:0,FAIL:0,WAIT:0};SPEC.forEach(x=>counts[checks[x[0]]?.status||'WAIT']++);$('validationSummary').innerHTML=`<div class="box"><span class="k">🟢 PASS</span><b>${counts.PASS}</b></div><div class="box"><span class="k">🟡 PARTIAL</span><b>${counts.PARTIAL}</b></div><div class="box"><span class="k">🔴 FAIL</span><b>${counts.FAIL}</b></div><div class="box"><span class="k">⚪ WAIT</span><b>${counts.WAIT}</b></div><div class="box"><span class="k">完整通過</span><b>${counts.PASS}/45</b></div>`;$('validationOverall').innerHTML=counts.PASS===45?'<b class="upc">🟢 V12.4 FINAL 45/45 驗收完成</b>':'<b class="downc">目前不得視為45/45完成。</b> 每一格只有實際證據PASS才亮綠燈。';$('specGrid').innerHTML=SPEC.map(x=>{const v=checks[x[0]]||{status:'WAIT',evidence:'尚未接到驗證結果'},st=v.status.toLowerCase();return`<div class="spec ${st}"><b>#${x[0]} ${x[1]}</b><small>${x[2]}</small><span class="tag">${light(v.status)}</span><div class="vevidence">${v.evidence||''}</div>${v.detail?`<div class="vdetail">${v.detail}</div>`:''}</div>`}).join('');const co=checks.core||{};$('coreValidation').innerHTML=[['買不到／參與率保護',co.participation],['防買點下逃',co.downEscape],['Hysteresis訊號遲滯',co.hysteresis]].map(([n,v])=>`<div class="box"><span class="k">${n}</span><b>${light(v?.status)}</b><small>${v?.evidence||'等待驗證'}</small></div>`).join('')}
let validationPoll=null;async function loadValidation(deep=false){try{const d=await get('/api/validation'+(deep?'?deep=1':''),deep?30000:12000);if(!d.ok){$('validationOverall').innerHTML='<b class="downc">驗證API錯誤：</b>'+(d.error||'未知');return}VALIDATION=d;renderSpecs()}catch(e){$('validationOverall').innerHTML='<b class="downc">驗證中心連線錯誤：</b>'+e.message}}
async function runDeepValidation(){clearTimeout(validationPoll);$('deepValidateBtn').disabled=true;try{await get('/api/history-warm?all=1');await loadValidation(true);const hp=VALIDATION?.historyProgress||[],ready=hp.filter(x=>x.status==='READY').length;if(ready<4){$('validationOverall').innerHTML+=`<br><span class="note">完整回測歷史背景建立中：${hp.map(x=>x.code+' '+x.percent+'%').join('｜')}</span>`;validationPoll=setTimeout(runDeepValidation,3000)}}finally{$('deepValidateBtn').disabled=false}}


function openModelTrade(code,layer=1){
 const x=statusFor(code);if(!x)return alert('模型尚未載入');
 $('mtCode').value=code;$('mtPrice').value=Number(x.px).toFixed(2);$('mtShares').value='';$('mtLayer').value=String(layer);
 $('mtSnapshot').innerHTML=`<b>當下模型快照：</b>① ${ztxt(x.m.layers[0].zone)}　② ${ztxt(x.m.layers[1].zone)}　③ ${ztxt(x.m.layers[2].zone)}<br>分數 ${x.r.score}/100｜防追高 ${x.r.chaseRisk}/100｜環境 ${x.r.environmentScore.toFixed(0)}｜成分健康 ${x.r.health?.usable?x.r.health.score+'/100':'未計分'}`;
 $('modelTradeModal').classList.add('on')
}
function closeModelTrade(){$('modelTradeModal').classList.remove('on')}
function saveModelTrade(){
 const code=$('mtCode').value,price=Number($('mtPrice').value),shares=Number($('mtShares').value),layer=Number($('mtLayer').value),x=statusFor(code);
 if(!x||!(price>0)||!(shares>0)||![1,2,3].includes(layer))return alert('請確認成交價、股數與層級');
 const trade={id:'mt_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),code,name:NAME[code],layer,entryAt:new Date().toISOString(),entryDate:dayKey(),entryPrice:price,shares,
  snapshot:{zones:x.m.layers.map(L=>({low:L.zone.low,high:L.zone.high,center:center(L.zone)})),score:x.r.score,chaseRisk:x.r.chaseRisk,environmentScore:x.r.environmentScore,health:x.r.health||null,night:lastNight?{last:lastNight.last,changePct:lastNight.changePct}:null,overseas:lastOverseas?.quotes?{NASDAQ:lastOverseas.quotes.NASDAQ?.changePct,SOX:lastOverseas.quotes.SOX?.changePct,TSM:lastOverseas.quotes.TSM?.changePct}:null,version:'V12.4',build:'R3.17'},
  exitAt:null,exitPrice:null,perf:null};
 MODEL_TRADES.push(trade);saveJSON('v124_model_trades',MODEL_TRADES);
 const h=H.find(v=>v.t===code);
 if(h){const oldShares=Number(h.s)||0,oldCost=Number(h.c)||0,newShares=oldShares+shares;h.c=((oldShares*oldCost)+(shares*price))/newShares;h.s=newShares}
 else H.push({t:code,n:code,s:shares,c:price});
 saveHoldings();
 closeModelTrade();renderModelTrades();renderHoldings();refreshModelTradePerformance();addEvent(`${code} 已記錄模型第${layer}層實戰並同步持股：${shares}股 @ ${price.toFixed(2)}`,'trade');setPage('model')
}
async function refreshModelTradePerformance(){
 for(const t of MODEL_TRADES){
  if(t.exitAt)continue;
  try{const z=t.snapshot?.zones||[],qs=new URLSearchParams({code:t.code,entryDate:t.entryDate,entryPrice:String(t.entryPrice),layer2Low:String(z[1]?.low??''),layer3Low:String(z[2]?.low??''),layer1High:String(z[0]?.high??'')});const p=await get('/api/trade-performance?'+qs.toString());if(p?.ok)t.perf=p}catch(_){}
 }
 saveJSON('v124_model_trades',MODEL_TRADES);renderModelTrades()
}
function closeTrackedTrade(id){
 const t=MODEL_TRADES.find(x=>x.id===id);if(!t)return;const px=Number(lastLive?.quotes?.[t.code]?.last??t.perf?.currentPrice);
 const v=prompt(`輸入 ${t.code} 實際賣出價格`,Number.isFinite(px)?px.toFixed(2):'');if(v===null)return;const p=Number(v);if(!(p>0))return alert('價格不正確');
 t.exitAt=new Date().toISOString();t.exitPrice=p;t.realizedReturnPct=(p/t.entryPrice-1)*100;t.realizedPnL=(p-t.entryPrice)*t.shares;saveJSON('v124_model_trades',MODEL_TRADES);renderModelTrades()
}
function deleteTrackedTrade(id){if(!confirm('刪除這筆模型實戰紀錄？'))return;MODEL_TRADES=MODEL_TRADES.filter(x=>x.id!==id);saveJSON('v124_model_trades',MODEL_TRADES);renderModelTrades()}
function renderModelTrades(){
 const open=MODEL_TRADES.filter(t=>!t.exitAt),closed=MODEL_TRADES.filter(t=>t.exitAt),rets=MODEL_TRADES.map(t=>t.exitAt?t.realizedReturnPct:t.perf?.currentReturnPct).filter(Number.isFinite),wins=rets.filter(x=>x>0).length;
 const pnl=MODEL_TRADES.reduce((sum,t)=>sum+(t.exitAt?(t.realizedPnL||0):(Number.isFinite(t.perf?.currentPnLPerShare)?t.perf.currentPnLPerShare*t.shares:0)),0);
 $('liveTradeSummary').innerHTML=`<div class="box"><span class="k">模型實戰</span><b>${MODEL_TRADES.length}筆</b></div><div class="box"><span class="k">追蹤中</span><b>${open.length}筆</b></div><div class="box"><span class="k">目前/已結束獲利</span><b>${wins}/${rets.length}</b></div><div class="box"><span class="k">合計損益</span><b class="${cls(pnl)}">${Math.round(pnl).toLocaleString()}</b></div><div class="box"><span class="k">平均報酬</span><b class="${cls(mean(rets))}">${rets.length?pct(mean(rets)):'—'}</b></div>`;
 $('modelTradeList').innerHTML=MODEL_TRADES.length?MODEL_TRADES.slice().reverse().map(t=>{const p=t.perf,ret=t.exitAt?t.realizedReturnPct:p?.currentReturnPct,pnl=t.exitAt?t.realizedPnL:(Number.isFinite(p?.currentPnLPerShare)?p.currentPnLPerShare*t.shares:null),h=p?.horizon||{};return`<div class="card"><div class="row"><div><b>${t.code}｜模型第${t.layer}層</b><div class="note">${new Date(t.entryAt).toLocaleString('zh-TW',{hour12:false})}｜${t.shares.toLocaleString()}股 @ ${fmt(t.entryPrice)}</div></div><b class="${cls(ret)}">${Number.isFinite(ret)?pct(ret):'追蹤中'}</b></div><div class="grid5"><div class="box"><span class="k">目前/結束損益</span><b class="${cls(pnl)}">${Number.isFinite(pnl)?Math.round(pnl).toLocaleString():'—'}</b></div><div class="box"><span class="k">5日</span><b>${h[5]?pct(h[5].totalReturnPct):'未到'}</b></div><div class="box"><span class="k">20日</span><b>${h[20]?pct(h[20].totalReturnPct):'未到'}</b></div><div class="box"><span class="k">60日</span><b>${h[60]?pct(h[60].totalReturnPct):'未到'}</b></div><div class="box"><span class="k">MAE / MFE</span><b>${Number.isFinite(p?.maePct)?fmt(p.maePct)+'%':'—'} / ${Number.isFinite(p?.mfePct)?fmt(p.mfePct)+'%':'—'}</b></div></div><div class="reading">進場快照：分數 ${t.snapshot.score}｜防追高 ${t.snapshot.chaseRisk}｜環境 ${fmt(t.snapshot.environmentScore)}｜歷史 ${p?.officialHistory?'TWSE官方':'備援/建立中'}。${p?`<br>第2層曾到：${p.reachedLayer2?'是':'否'}｜第3層曾到：${p.reachedLayer3?'是':'否'}｜進場追高：${p.chaseEntry===true?'是':p.chaseEntry===false?'否':'—'}`:''}</div><button class="btn" onclick="closeTrackedTrade('${t.id}')">${t.exitAt?'已結束':'記錄賣出/結束追蹤'}</button> <button class="btn danger" onclick="deleteTrackedTrade('${t.id}')">刪除</button></div>`}).join(''):'<div class="notice">尚無模型實戰紀錄。請在ETF買點旁按「記錄模型買入」。</div>'
}
async function loadHistoryStatus(){
 try{
  const d=await get('/api/history-status');HISTORY_STATUS=d.history||[];
  $('historyBuildStatus').innerHTML=HISTORY_STATUS.map(x=>{
    const v=x.validation||{},ready=x.status==='READY',fail=x.status==='VALIDATION_FAIL'||x.status==='ERROR';
    return`<div class="box"><span class="k">${x.code}</span><b class="${ready?'upc':fail?'downc':'amber'}">${x.status}</b><small>${x.doneMonths}/${x.totalMonths}月｜${x.percent}%${x.first?`<br><b>回測資料起始：${x.first}</b><br>資料截止：${x.last}`:''}${v.rows?`<br>${v.rows}交易日`:''}${x.code==='0050'&&x.first?'<br>0050採實際可得長期樣本，不強求2003':''}${ready?'<br>官方全歷史 PASS':x.status==='LONG_SAMPLE_READY'?'<br>長期樣本可回測':fail?`<br>價格:${v.priceHistoryPass?'PASS':'FAIL'}｜企業行動:${v.corporateActionPass?'PASS':'FAIL'}｜精度:${v.backtestPrecisionPass?'PASS':'FAIL'}`:'<br>背景建立中'}</small></div>`
  }).join('')
 }catch(e){$('historyBuildStatus').innerHTML='<div class="notice">歷史狀態讀取失敗：'+e.message+'</div>'}
}

function qaAnswer(q){const c=ETF.find(x=>q.includes(x));if(q.includes('四檔')||q.includes('哪個最好')){const a=ETF.map(c=>[c,statusFor(c)]).filter(x=>x[1]).sort((a,b)=>b[1].rank-a[1].rank||b[1].r.score-a[1].r.score);return a.length?'目前排序：'+a.map(([c,x])=>`${c} ${x.r.noBuyToday?'今日無合理買點':stageText(x.activeStatus,x.activeLayer+1)} ${x.r.score}分`).join('；'):'模型尚未完整。'}if(q.includes('夜盤')){const n=lastNight||lastBuy?.nightFuture;return n?.available?`WTX& ${fmt(n.last)}，相對參考價 ${pct(n.changePct)}，距今晚最高 ${fmt(n.offHighPoints)}點（${pct(n.offHighPct)}），短線${n.momentum?.direction||'累積中'}。`:'夜盤目前沒有可用資料。'}if(q.includes('剛剛')||q.includes('發生什麼'))return EVENTS.length?'最近事件：'+EVENTS.slice(-5).map(x=>x.text).join('；'):'目前沒有重大事件。';if(c){const x=statusFor(c);if(!x)return c+'模型資料尚未完整。';if(q.includes('成分')||q.includes('健康'))return x.r.health?.usable?`${c}成分健康 ${x.r.health.score}/100，${x.r.health.divergence}。`:`${c}目前完整成分覆蓋不足，因此健康度不納入模型，避免拿前幾大成分冒充全部。`;if(q.includes('買點')||q.includes('第一')||q.includes('第二')||q.includes('第三'))return `${c}：第一 ${ztxt(x.m.layers[0].zone)}，理想 ${ztxt(x.m.layers[1].zone)}，強力 ${ztxt(x.m.layers[2].zone)}；現價 ${fmt(x.px)}。${x.r.noBuyToday?'今日暫無合理買點。':stageText(x.activeStatus,x.activeLayer+1)+'。'}`;if(q.includes('為什麼')||q.includes('能買')||q.includes('不能買'))return explain(c,x)+` 防追高 ${x.r.chaseRisk}/100，環境 ${x.r.environmentScore.toFixed(0)}。`}return'可以問：四檔哪個最好、某ETF三層買點、為什麼不能買、成分健康、夜盤、剛剛發生什麼。'}
function addChat(t,who='sys'){const d=document.createElement('div');d.className='msg '+who;d.textContent=t;$('chat').appendChild(d);d.scrollIntoView({behavior:'smooth',block:'nearest'})}
function quickAsk(q){addChat(q,'user');setTimeout(()=>addChat(qaAnswer(q),'sys'),80)}function sendAsk(){const q=$('question').value.trim();if(!q)return;$('question').value='';quickAsk(q)}

function boot(){setMode();renderHoldings();renderDetailTabs();renderBacktestTabs();renderSpecs();renderEvents();renderModelTrades();loadHistoryStatus();setInterval(loadHistoryStatus,10000);setTimeout(refreshModelTradePerformance,2500);setInterval(refreshModelTradePerformance,60000);addChat('V12.4免費戰情問答已啟動。','sys');loadEtfLive();loadMarket();loadSlow();loadNight();loadBuy();loadValidation(false)}
migrate1689Existing0050Trade();
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){clearTimeout(etfLiveTimer);clearTimeout(marketTimer);clearTimeout(slowTimer);clearTimeout(nightTimer);clearTimeout(buyTimer);$('freshPill').textContent='● 重新連線中';$('freshPill').className='pill warn';loadEtfLive();loadMarket();loadSlow();loadNight();loadBuy()}})
setInterval(()=>{
 const p=document.getElementById('constituentPage');
 if(p?.classList.contains('on'))loadConstituentPage(true);
},10000);
setInterval(setMode,30000);boot();
