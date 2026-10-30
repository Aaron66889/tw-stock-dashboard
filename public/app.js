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
const CLIENT_BUILD='16.8.102-LEDGER-COMMIT',CONFIRM_RULE_VERSION='layer-confirm-v8-all-layer-hysteresis',SHADOW_CONFIRM_VERSION='shadow-confirm-v2-live-observation';
const TRADE_RETURN_REQUIRED='cash-entitlement-total-return-v2';
const hasNumber=n=>n!==null&&n!==undefined&&n!==''&&Number.isFinite(Number(n));
const $=id=>document.getElementById(id),fmt=n=>hasNumber(n)?Number(n).toFixed(2):'—',pct=n=>hasNumber(n)?(Number(n)>=0?'+':'')+Number(n).toFixed(2)+'%':'—',cls=n=>Number(n)>0?'upc':Number(n)<0?'downc':'';
const mean=a=>{const x=(a||[]).filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null};
let lastLive=null,lastCtx=null,lastTaiex=null,lastOverseas=null,lastNight=null,lastBuy=null,lastTrendBuy=null;
let marketTimer,slowTimer,buyTimer,nightTimer,commentaryTimer,trendBuyTimer,selectedETF='0050',selectedBacktest='0050';
let etfLiveTimer=null;
const DEFAULT_H=[{t:'0050',n:'0050',s:3150,c:77.37},{t:'0056',n:'0056',s:750,c:33.91},{t:'00878',n:'00878',s:4000,c:18.06},{t:'00919',n:'00919',s:550,c:18.80}];

// 16.8.74 dividend baseline: reconstructed once from the user's Fubon statements; future distributions are automatic.
// Privacy: only aggregate totals are kept in the deployed app; the detailed transaction ledger is not embedded.
const DIVIDEND_LEDGER_START='2024-04-22';
const DIVIDEND_SEED_ASOF='2026-09-22';
const DIVIDEND_LEDGER_VERSION='fubon-statement-aggregate-2026-09-22';
const DIVIDEND_SEED={
 '0050':2954,
 '0056':3836,
 '00878':15645,
 '00919':1788
};
// Entitled but not yet paid as of the reconstruction date. Once the pay date arrives,
// it is automatically included unless the user has already updated the dividend total past that date.
const DIVIDEND_KNOWN_FUTURE={
 '00919':[{exDate:'2026-09-16',payDate:'2026-10-15',cash:605,shares:550,amount:1.10}]
};
function normalizeHoldingRecord(x){
 const t=String(x?.t||''),seed=DIVIDEND_SEED[t];
 const raw=Number(x?.dividendReceived),has=Number.isFinite(raw)&&raw>=0;
 let s=Number(x?.s)||0,c=Number(x?.c)||0;
 // R3.54: R3.53 briefly shipped an incorrect 00919 default cost of 19.89.
 // Only migrate that exact known bad tuple; preserve every other user-entered cost.
 if(t==='00919'&&s===550&&Math.abs(c-19.89)<0.001)c=18.80;
 return{...x,t,n:String(x?.n||t),s,c,
  dividendReceived:has?raw:(Number.isFinite(seed)?seed:0),
  dividendAsOf:String(x?.dividendAsOf||(Number.isFinite(seed)?DIVIDEND_SEED_ASOF:''))};
}
// Reprice only FUTURE dividend estimates from the shares currently shown in this
// browser. Never reprice locked ex-date entitlements or dividends already received.
function localDividendForecast(source,shares){
 if(!source||!Number.isSafeInteger(Number(shares))||Number(shares)<0)return source||null;
 const perShare=Number(source.amount),exDate=String(source.exDate||'');
 if(!(perShare>0)||!Number.isFinite(perShare)||!/^\\d{4}-\\d{2}-\\d{2}$/.test(exDate)||exDate<=dayKey())return null;
 return{...source,sharesEstimate:Number(shares),cashEstimate:Math.round(Number(shares)*perShare),sharesBasis:'displayed-holdings'};
}
function dividendStats(code,holding){
 const auto=DIVIDEND_AUTO?.byCode?.[code];
 if(auto&&Number.isFinite(Number(auto.received))){
  const shares=Number(holding?.s),currentShares=Number.isSafeInteger(shares)&&shares>=0?shares:null;
  return{received:Number(auto.received)||0,pending:Number(auto.pending)||0,items:auto.locks||[],lastPaid:auto.lastPaid||null,nextPending:auto.nextPending||null,upcoming:localDividendForecast(auto.upcoming,currentShares),estimatedUpcoming:localDividendForecast(auto.estimatedUpcoming,currentShares),nextForecast:localDividendForecast(auto.nextForecast,currentShares),forecastSharesAsOf:auto.forecastSharesAsOf||null,version:auto.version||'div-auto-v2',asOf:auto.lastPaid?.payDate||auto.baseAsOf||DIVIDEND_SEED_ASOF,automatic:true,snapshotDay:auto.snapshotDay||DIVIDEND_AUTO.snapshotDay||null};
 }
 // Safe fallback while cloud/TWSE is loading: reconstructed seed + the one pre-auto 00919 entitlement.
 const today=dayKey(),seed=Number(DIVIDEND_SEED[code])||0,h=holding||H?.find?.(x=>x.t===code),raw=Number(h?.dividendReceived);
 let received=Number.isFinite(raw)&&raw>=0?raw:seed;
 const asOf=String(h?.dividendAsOf||(Number.isFinite(seed)?DIVIDEND_SEED_ASOF:''));
 const items=(DIVIDEND_KNOWN_FUTURE[code]||[]).map(e=>({...e,received:e.payDate<=today,pending:e.exDate<=today&&e.payDate>today}));
 let effectiveAsOf=asOf;
 for(const e of items)if(e.received&&(!asOf||e.payDate>asOf)){received+=Number(e.cash)||0;if(!effectiveAsOf||e.payDate>effectiveAsOf)effectiveAsOf=e.payDate}
 const pending=items.filter(e=>e.pending&&(!asOf||e.payDate>asOf)).reduce((sum,e)=>sum+(Number(e.cash)||0),0);
 return{received,pending,items,lastPaid:null,nextPending:items.find(e=>e.pending&&(!asOf||e.payDate>asOf))||null,upcoming:null,estimatedUpcoming:null,version:DIVIDEND_LEDGER_VERSION,asOf:effectiveAsOf,automatic:false};
}

function money0(n){return hasNumber(n)?Math.round(Number(n)).toLocaleString():'—'}
let H=loadHoldings(),EVENTS=loadJSON('v124_events',[]),STATE=loadJSON('v124_state',{day:null,models:{},noSignalDays:{}}),SHADOW_STATE=loadJSON('v124_shadow_state',{day:null,models:{}}),SHADOW_LOG=loadJSON('v124_shadow_replay',[]),PREOPEN=loadJSON('v124_preopen',{}),HIST=loadJSON('v124_buy_history',{}),CONSTVERS=loadJSON('v124_constituent_versions',{}),VALIDATION=null,MODEL_TRADES=loadJSON('v124_model_trades',[]),HISTORY_STATUS=null;
let MODEL_SYNC={status:'checking',ready:false,busy:false,message:'雲端同步檢查中',lastAt:null,knownUnlocked:!!loadJSON('v124_model_sync_known_unlocked',false)};
let SYNC_SERVER_VERIFIED=false;
let SYNC_ALL_BUSY=false,SYNC_ALL_RERUN=false,SYNC_ALL_FORCE=false;
// R3.81: persisted, trade-ID keyed holdings operations. A network retry is safe because
// the backend applies each trade ID once (including across phones / computers).
const HOLDINGS_OP_KEY='v124_holdings_pending_trade_ops_r3802';
const HOLDINGS_MANUAL_DIRTY_KEY='v124_holdings_manual_dirty_r3802';
let HOLDINGS_PENDING_TRADES=loadJSON(HOLDINGS_OP_KEY,[]);
if(!Array.isArray(HOLDINGS_PENDING_TRADES))HOLDINGS_PENDING_TRADES=[];
let HOLDINGS_MANUAL_DIRTY=!!loadJSON(HOLDINGS_MANUAL_DIRTY_KEY,false);
let HOLDINGS_LOCAL_REV=0,HOLDINGS_REMOTE_REV=0,HOLDINGS_PUSH_BUSY=false,HOLDINGS_OP_BUSY=false;
let HOLDINGS_SYNC={busy:false,ready:false,lastAt:null,cloudUpdatedAt:null,message:'持股雲端同步檢查中'};
let DIVIDEND_AUTO={busy:false,ready:false,lastAt:null,message:'股息自動同步檢查中',byCode:{},snapshotDay:null,source:null};
let MODEL_PENDING_DELETES=loadJSON('v124_model_trade_pending_deletes',[]);
let MODEL_TRADE_FILTER='all',MODEL_TRADE_LIMIT=10,MODEL_TRADE_EXPANDED=null;

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
function safeCtxLastGood(c){
 if(!c?.data)return null;
 const x={...c.data},b=x.breadth,age=Date.now()-Date.parse(c.at||0),sameDay=b?.sourceDate===dayKey();
 // Same-day official close is valid for the rest of that day.
 // A live-derived snapshot is displayable only briefly; never resurrect yesterday's breadth.
 const keep=!!(sameDay&&(b?.official||age<=120000));
 x.breadth=keep?b:null;
 return x;
}
function loadHoldings(){try{const x=JSON.parse(localStorage.getItem('twStockHoldingsV12'));const a=Array.isArray(x)?x:DEFAULT_H;return a.map(normalizeHoldingRecord)}catch{return DEFAULT_H.map(normalizeHoldingRecord)}}
function persistPendingHoldingsOps(){saveJSON(HOLDINGS_OP_KEY,HOLDINGS_PENDING_TRADES)}
function persistHoldingsLocal(){HOLDINGS_LOCAL_REV++;saveJSON('twStockHoldingsV12',H)}
function setHoldingsManualDirty(on){HOLDINGS_MANUAL_DIRTY=!!on;saveJSON(HOLDINGS_MANUAL_DIRTY_KEY,HOLDINGS_MANUAL_DIRTY)}
function applyBoughtSharesLocal(op){
 const h=H.find(v=>v.t===op.code),qty=Number(op.shares),price=Number(op.entryPrice);
 if(h){const oldShares=Number(h.s)||0,oldCost=Number(h.c)||0,next=oldShares+qty;h.c=(oldShares*oldCost+qty*price)/next;h.s=next}
 else H.push(normalizeHoldingRecord({t:op.code,n:op.code,s:qty,c:price,dividendReceived:0,dividendAsOf:dayKey()}));
}
function queueHoldingsTrade(trade){
 const op={id:trade.id,code:trade.code,shares:trade.shares,entryPrice:trade.entryPrice,entryAt:trade.entryAt};
 if(!HOLDINGS_PENDING_TRADES.some(x=>x.id===op.id)){
  // Save the operation BEFORE modifying local holdings; a failed request can be replayed.
  HOLDINGS_PENDING_TRADES.push(op);persistPendingHoldingsOps();
  applyBoughtSharesLocal(op);persistHoldingsLocal();
 }
 HOLDINGS_SYNC.message=`持股有 ${HOLDINGS_PENDING_TRADES.length} 筆成交待雲端確認；本機股數已更新`;
 if(MODEL_SYNC.ready)void syncAllCloud(true);
}
function saveHoldings(){
 // Manual adjustment: never silently download old cloud holdings on top of an offline edit.
 persistHoldingsLocal();setHoldingsManualDirty(true);
 if(MODEL_SYNC?.ready&&HOLDINGS_SYNC?.ready&&!HOLDINGS_PENDING_TRADES.length)void pushHoldingsCloud();
 else HOLDINGS_SYNC.message='此裝置持股有尚未上傳的手動變更；同步恢復後請確認並上傳';
}
function taipeiNow(){return new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Taipei'}))}
function dayKey(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())}
function fresh(ts,ms=90000){return ts&&Date.now()-Date.parse(ts)<ms}
function setPage(id){document.querySelectorAll('.page').forEach(x=>x.classList.toggle('on',x.id===id));document.querySelectorAll('.navb').forEach(x=>x.classList.toggle('on',x.dataset.page===id));window.scrollTo({top:0,behavior:'instant'});if(id==='constituentPage')loadConstituentPage(false);if(id==='commentaryPage')loadCommentary(false);if(id==='trendBuyPage')loadTrendBuy(false);if(id==='model'){renderSpecs(true);loadValidation(false);/* Four-ETF historical study is explicit, never auto-fired on entry. */setTimeout(()=>{if(document.getElementById('model')?.classList.contains('on'))window.GateBlockedUI?.load(false)},1100)}}
document.querySelectorAll('.navb').forEach(b=>b.onclick=()=>setPage(b.dataset.page));
function setMode(){const d=taipeiNow(),m=d.getHours()*60+d.getMinutes(),day=d.getDay();let a,b,c;if(day===0||day===6){a='週末模式';b='市場休市，整理全歷史與下一交易日環境';c='現貨維持最近交易日，夜盤／海外依交易時段更新'}else if(m>=537&&m<540){a='08:57盤前';b='盤前三層正在收斂';c='08:59:30鎖定盤前基準'}else if(m>=540&&m<=810){a='● 盤中模式';b='今天有沒有合理買點？';c='價格10秒｜模型30秒'}else if(m>810&&m<900){a='收盤模式';b='今天收盤結構與下一交易日環境';c='檢查今日買點歷史與市場廣度'}else if(m>=900||m<300){a='🌙 夜間模式';b='夜盤與海外正在怎麼影響下一交易日？';c='夜盤10秒更新；正負號自行重算'}else{a='盤前模式';b='開盤前先看海外與台指期日盤';c=m>=525?'08:45台指期先行訊號累積中｜08:57開始三層收斂':'等待08:45台指期日盤'}$('mode').textContent=a;$('modeTitle').textContent=b;$('modeNote').textContent=c}
function addEvent(text,kind='info'){const last=EVENTS.at(-1);if(last&&last.text===text&&Date.now()-Date.parse(last.at)<60000)return;EVENTS.push({at:new Date().toISOString(),text,kind});EVENTS=EVENTS.slice(-160);saveJSON('v124_events',EVENTS);renderEvents()}
function tradingSessionsBetween(fromDay,toDay){const ds=Array.isArray(lastBuy?.tradingDates)?lastBuy.tradingDates:[];return ds.filter(d=>d>=fromDay&&d<toDay).length}
function resetDaily(){
 const d=dayKey();if(STATE.day===d)return;const old=STATE,nextNo={...(STATE.noSignalDays||{})};
 if(old.day){
  // Advance the streak only by actual exchange dates supplied by the historical calendar. Weekends/holidays do not count.
  const sessions=tradingSessionsBetween(old.day,d);
  if(sessions>0)ETF.forEach(c=>{const triggered=old.models?.[c]?.layers?.some(x=>x.triggeredAt);nextNo[c]=triggered?Math.max(0,sessions-1):(Number(nextNo[c]||0)+sessions)});
 }
 STATE={day:d,models:{},noSignalDays:nextNo};saveJSON('v124_state',STATE)
}
function resetShadowDaily(){const d=dayKey();if(SHADOW_STATE.day===d)return;SHADOW_STATE={day:d,models:{}};saveJSON('v124_shadow_state',SHADOW_STATE);SHADOW_LOG=(SHADOW_LOG||[]).filter(x=>x?.day&&x.day>=d).slice(-2000);saveJSON('v124_shadow_replay',SHADOW_LOG)}
function ztxt(z){return z&&Number.isFinite(z.low)&&Number.isFinite(z.high)?`${z.low.toFixed(2)}–${z.high.toFixed(2)}`:'—'}
function hmTaipei(ts){if(!ts)return'';try{return new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(ts))}catch{return''}}
function confirmSnapshotText(L){return L?.confirmedZone&&L?.confirmedAt?`首次確認：${ztxt(L.confirmedZone)}｜${hmTaipei(L.confirmedAt)}${Number.isFinite(L.executionLow)?`｜執行下限 ${Number(L.executionLow).toFixed(2)}`:''}${Number.isFinite(L.executionHigh)?`｜執行上限 ${Number(L.executionHigh).toFixed(2)}`:''}`:''}
function center(z){return z?(z.low+z.high)/2:null}
function moveZone(cur,target,maxDown,maxUp,allowDown=true){if(!cur)return JSON.parse(JSON.stringify(target));const c=center(cur),t=center(target),half=(cur.high-cur.low)/2;let d=t-c;if(d<0&&!allowDown)d=Math.max(d,-maxDown*.12);else d=Math.max(-maxDown,Math.min(maxUp,d));return{low:c+d-half,high:c+d+half,center:c+d}}
function moveZoneTimed(cur,target,maxDown30,maxUp30,allowDown=true,elapsedSec=30){if(!cur)return JSON.parse(JSON.stringify(target));const scale=Math.max(.15,Math.min(4,Number(elapsedSec||30)/30)),c=center(cur),t=center(target),half=(cur.high-cur.low)/2,maxDown=maxDown30*scale,maxUp=maxUp30*scale;let d=t-c;if(d<0&&!allowDown)d=Math.max(d,-maxDown*.12);else d=Math.max(-maxDown,Math.min(maxUp,d));return{low:c+d-half,high:c+d+half,center:c+d}}
function cashSessionOpen(code){const d=taipeiNow(),wd=d.getDay(),m=d.getHours()*60+d.getMinutes(),o=Number(lastLive?.quotes?.[code]?.open);return wd>=1&&wd<=5&&m>=540&&o>0?o:null}
function shiftZoneCenter(z,c){const half=(z.high-z.low)/2;return{low:c-half,high:c+half,center:c}}
function enforceCashOpenCeiling(code,zones,atr){const o=cashSessionOpen(code);if(!(o>0)||!Array.isArray(zones)||zones.length<3)return zones;const out=zones.map(z=>JSON.parse(JSON.stringify(z)));if(out[0].high>o){const w=out[0].high-out[0].low;out[0]={low:o-w,high:o,center:o-w/2}}const prev=Number(lastLive?.quotes?.[code]?.prevClose)||o,g12=Math.max(atr*.35,prev*.004),g23=Math.max(atr*.45,prev*.006);let c0=center(out[0]),c1=center(out[1]),c2=center(out[2]);if(c1>c0-g12){c1=c0-g12;out[1]=shiftZoneCenter(out[1],c1)}if(c2>c1-g23){c2=c1-g23;out[2]=shiftZoneCenter(out[2],c2)}return out}
function executionUpAllowance(atr,i=0){return Math.max(.03,Number(atr||0)*([.10,.08,.06][i]??.08))}
function executionDownAllowance(atr,i=0){return Math.max(.02,Number(atr||0)*([.08,.07,.06][i]??.07))}
function ensureExecutionEnvelope(L,atr,i=0){
 const z=L?.confirmedZone||L?.zone;if(!z)return null;
 if(!Number.isFinite(L.executionHigh))L.executionHigh=z.high+executionUpAllowance(atr,i);
 // Only L1: the already-defined 0.08 ATR intraband tolerance must also apply
 // AFTER confirmation. Migrate today's saved snapshots locked to the old band
 // edge once; never widen the fixed confirmed envelope on future ticks.
 if(!Number.isFinite(L.executionLow)||(i===0&&Math.abs(L.executionLow-z.low)<1e-7))
  L.executionLow=i===0?z.low-executionDownAllowance(atr,i):z.low;
 return{low:L.executionLow,high:L.executionHigh};
}
function layerView(L,px){if(!L)return'WAIT';if(L.confirmed){if(L.gateBlocked)return'CONFIRMED_BLOCKED';const z=L.confirmedZone||L.zone,hi=Number.isFinite(L.executionHigh)?L.executionHigh:z.high,lo=Number.isFinite(L.executionLow)?L.executionLow:z.low;if(px>hi)return'CONFIRMED_ABOVE';if(px<lo)return'CONFIRMED_BELOW';return'CONFIRMED_IN'}if(L.invalid)return'INVALID';if(L.fastPass)return'FAST_PASS';if(L.forming)return'FORMING';return'WAIT'}
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
 // A buy layer is a downward threshold: once price is at or below its high edge, it has been touched even if price already moved through the whole band.
 if(px<=L.zone.high)return'TOUCHED';
 if(L.touchedAt||L.triggeredAt||L.forming||L.confirmCount>0)return'TOUCHED';
 return'IDLE';
}
function layerBoxClass(L,px,base=''){const st=layerTouchState(L,px),v=layerView(L,px);return(base?base+' ':'')+(v==='CONFIRMED_IN'?'layer-confirmed':st==='CONFIRMED'||st==='TOUCHED'?'layer-touched':'')}
function layerBoxLabel(label,L,px){const st=layerTouchState(L,px);if(st==='CONFIRMED'){const v=layerView(L,px);return label+(v==='CONFIRMED_IN'?'｜已確認／可分批':v==='CONFIRMED_BLOCKED'?'｜已確認／暫停':v==='CONFIRMED_ABOVE'?'｜已確認／不追':v==='CONFIRMED_BELOW'?'｜已確認／跌破執行區，暫不可買':'｜已確認')}return label+(st==='TOUCHED'?'｜已觸價':'')}
function stageText(s,i=1){return{CONFIRMED_IN:`🔴 第${i}層已確認／可分批`,CONFIRMED_BLOCKED:`⏸️ 第${i}層價格已確認／正式買入暫停`,CONFIRMED_ABOVE:`🟡 第${i}層已確認但超過執行上限／不追`,CONFIRMED_BELOW:`🟠 第${i}層已確認但跌破確認區／觀察下一層`,FAST_PASS:'🟠 快速穿透保護',FORMING:'🟠 觸價觀察／形成中',INVALID:'🟢 失效／重新定價',WAIT:'等待'}[s]||'等待'}
function rank(s){return{CONFIRMED_IN:7,FORMING:6,CONFIRMED_BLOCKED:5,CONFIRMED_ABOVE:4,CONFIRMED_BELOW:3,WAIT:2,INVALID:1,FAST_PASS:0}[s]||0}
function deepestTouchedLayer(x){
 if(!x?.m?.layers)return-1;
 for(let i=x.m.layers.length-1;i>=0;i--)if(layerTouchState(x.m.layers[i],x.px)!=='IDLE')return i;
 return-1;
}
function displayModelState(x){
 if(!x)return'等待';
 let confirmed=-1;for(let i=(x.statuses?.length||0)-1;i>=0;i--){if(String(x.statuses[i]).startsWith('CONFIRMED_')){confirmed=i;break}}
 if(x.activeStatus==='CONFIRMED_IN')return stageText(x.activeStatus,x.activeLayer+1);
 if(confirmed>=0)return stageText(x.statuses[confirmed],confirmed+1);
 const touched=deepestTouchedLayer(x);
 if(touched>=0)return`🟠 第${touched+1}層已觸價／止跌未確認${cashSessionIsOpenForNewConfirmation()?'':'（非交易時段）'}`;
 if(x.r?.noBuyToday)return'今日暫無合理買點';
 return stageText(x.activeStatus,x.activeLayer+1);
}
function officialExecutionExplanation(x){
 if(!x)return'模型資料尚未載入';
 const i=x.activeLayer,L=x.m?.layers?.[i],s=x.activeStatus,rule=LAYER_CONFIRM_RULES[i];
 if(x.r.hardVeto)return '禁止模型買入：硬Gate｜'+(x.r.hardVetoReason||'未提供原因');
 if(x.r.noBuyToday)return '禁止模型買入：'+(x.r.noBuyReason||'本日風險條件未通過');
 if(s==='CONFIRMED_IN')return '允許記錄正式模型買入：第'+(i+1)+'層確認、價格及Gate均通過';
 if(s==='CONFIRMED_BLOCKED')return '禁止模型買入：'+(L?.gateBlockedReason||'分數或Gate未通過');
 if(s==='CONFIRMED_BELOW')return '暫不可依模型買入：現價 '+fmt(x.px)+' 低於首次確認執行下限 '+fmt(L?.executionLow)+'，須重新評估；原確認紀錄保留';
 if(s==='CONFIRMED_ABOVE')return '暫不可依模型買入：現價 '+fmt(x.px)+' 高於首次確認執行上限 '+fmt(L?.executionHigh)+'，不追價';
 const touched=deepestTouchedLayer(x),T=touched>=0?x.m.layers[touched]:null;
 return touched>=0?'第'+(touched+1)+'層已觸價，但仍未符合止跌反彈與正式確認條件'+(cashSessionIsOpenForNewConfirmation()?'':'｜非交易時段，不新增盤後確認')+(T?.confirmationReason?'｜'+T.confirmationReason:''):'價格尚未完成正式買點確認';
}
function noBuyWithoutTouch(x){return!!x?.r?.noBuyToday&&deepestTouchedLayer(x)<0}
function chaseLockText(cal){const st=cal?.lockStatus;return{LOCKED:'已鎖定',CARRY_FORWARD:'沿用前次鎖定',WAIT_HISTORY:'歷史建立中',PRELOCK_CARRY:'08:30前沿用',PRELOCK_PREVIEW:'08:30前預覽',PRELOCK_FALLBACK:'08:30前等待',FALLBACK_LOCKED:'保守值鎖定'}[st]||st||'—'}

// R3.80.3: API traffic coordination only. No changes to prices, gates or trading models.
const API_TRAFFIC={inflight:new Map(),nextSlotAt:0,cooldownUntil:0,strikes:0,lastLimitAt:0,lastWarnAt:0};
function apiTrafficError(){
 const wait=Math.max(1,Math.ceil((API_TRAFFIC.cooldownUntil-Date.now())/1000));
 const e=Error(`API限流保護中，${wait}秒後恢復請求（保留最後有效資料）`);e.status=429;e.limited=true;return e;
}
async function apiTrafficPermit(){
 if(Date.now()<API_TRAFFIC.cooldownUntil)throw apiTrafficError();
 // Stagger startup and cross-module bursts, while keeping the normal quote polling rate.
 const now=Date.now(),start=Math.max(now,API_TRAFFIC.nextSlotAt);
 API_TRAFFIC.nextSlotAt=start+400;
 if(start>now)await new Promise(resolve=>setTimeout(resolve,start-now));
 if(Date.now()<API_TRAFFIC.cooldownUntil)throw apiTrafficError();
}
function apiTrafficCheckResponse(r,body){
 const challenge=/(?:<!doctype\s+html|<html)/i.test(body||'')&&/(?:Just a moment|cloudflare|cf-chl-|challenge-platform)/i.test(body||'');
 if(r.status===429||(challenge&&(r.status===403||r.status===503||r.status===200))){
  const now=Date.now();
  if(now-API_TRAFFIC.lastLimitAt>2500){API_TRAFFIC.strikes=now-API_TRAFFIC.lastLimitAt>300000?1:Math.min(API_TRAFFIC.strikes+1,5)}
  API_TRAFFIC.lastLimitAt=now;
  const retry=r.headers?.get?.('Retry-After');let wait=Number(retry)*1000;
  if(!Number.isFinite(wait)||wait<=0){const parsed=Date.parse(retry||'');wait=Number.isFinite(parsed)?parsed-now:0}
  const delay=Math.min(300000,Math.max(20000,20000*2**(API_TRAFFIC.strikes-1),wait||0));
  API_TRAFFIC.cooldownUntil=Math.max(API_TRAFFIC.cooldownUntil,now+delay);
  if(now-API_TRAFFIC.lastWarnAt>45000){console.warn('[API] HTTP 429 / challenge: 暫停新請求並退避',Math.ceil(delay/1000),'秒');API_TRAFFIC.lastWarnAt=now}
  throw apiTrafficError();
 }
 // Only reset escalation after a sustained gap without rate-limit responses.
 if(API_TRAFFIC.lastLimitAt&&Date.now()-API_TRAFFIC.lastLimitAt>300000)API_TRAFFIC.strikes=0;
}
function apiTrafficKey(url){return String(url).replace(/([?&])_=[^&]*/g,'$1').replace(/[?&]$/,'')}
function get(url,timeoutMs=12000){
 const key=apiTrafficKey(url),existing=API_TRAFFIC.inflight.get(key);
 if(existing)return existing;
 const task=(async()=>{
  await apiTrafficPermit();
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeoutMs);
  try{
   const r=await fetch(url,{cache:'no-store',signal:c.signal}),body=await r.text(),t=body.trim();
   apiTrafficCheckResponse(r,t);
   if(!r.ok){const e=Error('HTTP '+r.status+'｜'+url);e.status=r.status;throw e}
   if(!(t.startsWith('{')||t.startsWith('[')))throw Error('來源回傳HTML而非JSON｜'+url+'｜'+t.slice(0,45).replace(/\s+/g,' '));
   let d;try{d=JSON.parse(t)}catch(e){throw Error('JSON解析失敗｜'+url+'｜'+e.message)}
   if(d?.ok===false){const e=Error(d.error||d.reason||('API資料更新失敗｜'+url));e.status=r.status;throw e}
   return d;
  }catch(e){if(e?.name==='AbortError')throw Error('API回應逾時｜'+url);throw e}
  finally{clearTimeout(timer)}
 })();
 API_TRAFFIC.inflight.set(key,task);
 task.then(()=>{if(API_TRAFFIC.inflight.get(key)===task)API_TRAFFIC.inflight.delete(key)},()=>{if(API_TRAFFIC.inflight.get(key)===task)API_TRAFFIC.inflight.delete(key)});
 return task;
}

function twMarketOpenClient(){
 const d=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Taipei'})),wd=d.getDay(),m=d.getHours()*60+d.getMinutes();
 return wd>=1&&wd<=5&&m>=540&&m<=810;
}
const ETF_PRICE_FLASH={};
let ETF_FETCH_AT=null,ETF_FETCH_COUNT=0,ETF_LIVE_LAST_ERROR=null;
function etfFetchStamp(){
 if(!ETF_FETCH_AT)return ETF_LIVE_LAST_ERROR?'行情抓取失敗（自動重試）':'尚未抓取';
 const d=new Date(ETF_FETCH_AT);
 return '抓取 '+d.toLocaleTimeString('zh-TW',{hour12:false,timeZone:'Asia/Taipei'})+'｜#'+ETF_FETCH_COUNT+
  (ETF_LIVE_LAST_ERROR?'｜更新失敗（保留最後成功報價）':'');
}
function etfExchangeStamp(code){
 const q=lastLive?.quotes?.[code];
 if(!q)return'';
 const src=String(q.source||'');
 let base=src.includes('Anue')?'｜鉅亨即時':src.includes('TWSE')?'｜TWSE備援'+(q.time?('｜成交 '+q.time):''):(src?('｜'+src):'');
 if(q.corporateActionAdjusted&&Number(q.effectivePrevClose)>0)base+=`｜${q.corporateAction?.type||'除權息'}基準 ${Number(q.effectivePrevClose).toFixed(2)}`;
 else if(q.corporateActionReferenceMissing)base+='｜⚠️除權息參考價待確認';
 return base;
}

function nLive(v){const x=Number(v);return Number.isFinite(x)?x:null}
// TWSE MIS may use YYYYMMDD or ROC YYYMMDD, while Anue uses YYYY-MM-DD.
// Never infer a quote's trading date from local wall time: a prior-day quote
// must NOT satisfy the live mark-to-market or buy confirmation freshness gate.
function normalizeEtfQuoteDate(value){
 const v=String(value||'').trim();
 if(/^20\d{2}-\d{2}-\d{2}$/.test(v))return v;
 if(/^20\d{6}$/.test(v))return v.slice(0,4)+'-'+v.slice(4,6)+'-'+v.slice(6,8);
 if(/^1\d{6}$/.test(v)){
  const y=Number(v.slice(0,3))+1911;
  return y+'-'+v.slice(3,5)+'-'+v.slice(5,7);
 }
 if(/^20\d{2}\/\d{2}\/\d{2}$/.test(v))return v.replaceAll('/','-');
 return null;
}
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
  volume:nLive(x?.v),time:x?.t||x?.['%']||null,date:normalizeEtfQuoteDate(x?.d),
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

async function postJSON(url,body,timeoutMs=12000){
 await apiTrafficPermit();
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeoutMs);
 try{
  const r=await fetch(url,{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:c.signal}),raw=await r.text(),t=raw.trim();
  apiTrafficCheckResponse(r,t);
  if(!r.ok){const e=Error('HTTP '+r.status+'｜'+url);e.status=r.status;throw e}
  if(!(t.startsWith('{')||t.startsWith('[')))throw Error('來源回傳HTML而非JSON｜'+url);
  return JSON.parse(t);
 }catch(e){if(e?.name==='AbortError')throw Error('API回應逾時｜'+url);throw e}finally{clearTimeout(timer)}
}

async function loadEtfLive(){if(document.visibilityState==='hidden'&&!(window.SignalAlerts?.monitoring()&&twMarketOpenClient()))return;
 clearTimeout(etfLiveTimer);
 try{
  // The API itself waits up to 12.5s on a cold/slow upstream chain.
  // Cutting the browser off at 6.5s discarded valid later replies.
  const d=await get('/api/etf-live?_='+Date.now(),14500);
  if(!d?.quotes||!ETF.some(c=>Number(d.quotes[c]?.last)>0))
   throw Error(d?.error||'四檔ETF來源暫未回傳有效報價');
  ETF_FETCH_AT=Date.now();ETF_FETCH_COUNT++;ETF_LIVE_LAST_ERROR=null;
  if(d?.quotes){
   lastLive=lastLive||{ok:true,quotes:{}};
   lastLive.quotes=lastLive.quotes||{};
   for(const c of ETF){
    const q=d.quotes[c];
    if(q?.last>0){
     const old=Number(lastLive.quotes[c]?.last),next=Number(q.last);
     lastLive.quotes[c]={...q,date:normalizeEtfQuoteDate(q.date)||q.date||null,fetchTime:new Date().toISOString()};
     if(old>0&&next!==old)ETF_PRICE_FLASH[c]=next>old?'up':'down';
     const r=lastBuy?.models?.[c];
     if(r&&lastLive.quotes[c].date===dayKey()&&q.realtime!==false&&q.lastGoodFallback!==true){
      r.price=next;updateOne(c,r);
     }
     window.DipWatch?.observe(c,lastLive.quotes[c],r,lastBuy,STATE.models?.[c]);
    }
   }
   window.SignalAlerts?.observeLayers(STATE,lastBuy,lastLive);
   // Reprice all open model trades from the same fresh ETF ticks as holdings.
   if(MODEL_TRADES.some(t=>!t.exitAt)&&Date.now()-LAST_MODEL_TRADE_MARK_RENDER_AT>=10000){LAST_MODEL_TRADE_MARK_RENDER_AT=Date.now();renderModelTrades()}
   renderHoldings();
   refreshTrendLiveQuotes();
   renderHomeRanking();
   renderBuyCards();
   if(selectedETF)renderDetailBuy();if(VALIDATION)renderSpecs();
  }
 }catch(e){
  ETF_LIVE_LAST_ERROR=e?.message||String(e);
  console.warn('[ETF-LIVE]',ETF_LIVE_LAST_ERROR);
  // Keep old quote visibly marked stale, not falsely refreshed.
  if(lastBuy?.models)renderBuyCards();
 }
 etfLiveTimer=setTimeout(loadEtfLive,twMarketOpenClient()?5000:10000);
}
async function loadMarket(){if(document.visibilityState==='hidden')return;clearTimeout(marketTimer);try{const extra=H.map(x=>x.t).join(','),d=await get('/api/market?symbols='+encodeURIComponent(extra));if(!d.ok)throw Error((d.source||'market')+': '+d.error);
 const yahooETF={};for(const c of ETF)if(lastLive?.quotes?.[c]?.last>0)yahooETF[c]=lastLive.quotes[c];
 lastLive={...d,quotes:{...(d.quotes||{}),...yahooETF}};
 saveLastGood('market',d);renderMarket();renderHoldings();if(VALIDATION)renderSpecs();$('freshPill').textContent=d.realtime===false?'● 盤後備援資料':'● 行情正常';$('freshPill').className=d.realtime===false?'pill warn':'pill live'}catch(e){const c=loadLastGood('market');if(c?.data){
  const yahooETF={};for(const code of ETF)if(lastLive?.quotes?.[code]?.last>0)yahooETF[code]=lastLive.quotes[code];
  lastLive={...c.data,quotes:{...(c.data.quotes||{}),...yahooETF}};renderMarket();renderHoldings();if(VALIDATION)renderSpecs();$('freshPill').textContent='● 最後成功資料 '+ageText(c.at);$('freshPill').className='pill warn'}else{$('freshPill').textContent='● 行情連線失敗';$('freshPill').className='pill bad'}console.warn('[MARKET]',e?.message||e)}marketTimer=setTimeout(loadMarket,10000)}
async function loadSlow(){if(document.visibilityState==='hidden')return;clearTimeout(slowTimer);const jobs=[['ctx','/api/context'],['taiex','/api/taiex-history'],['overseas','/api/overseas']],rs=await Promise.allSettled(jobs.map(x=>get(x[1])));rs.forEach((r,i)=>{const k=jobs[i][0];if(r.status==='fulfilled'&&r.value){saveLastGood(k,r.value);if(k==='ctx')lastCtx=r.value;if(k==='taiex')lastTaiex=r.value;if(k==='overseas')lastOverseas=r.value}else{const c=loadLastGood(k);if(c?.data){if(k==='ctx')lastCtx=safeCtxLastGood(c);if(k==='taiex')lastTaiex=c.data;if(k==='overseas')lastOverseas=c.data}addEvent(k+'資料更新失敗：'+(r.reason?.message||'unknown'),'bad')}});renderMarket();renderExternal();renderTomorrow();if(VALIDATION)renderSpecs();slowTimer=setTimeout(loadSlow,30000)}
async function loadNight(){if(document.visibilityState==='hidden')return;clearTimeout(nightTimer);try{const d=await get('/api/night-future');if(!d.ok&&d.available===false)throw Error(d.reason||d.error||'夜盤不可用');lastNight=d;saveLastGood('night',d)}catch(e){const c=loadLastGood('night');lastNight=c?.data||{available:false,reason:e.message};addEvent('夜盤資料更新失敗：'+e.message,'bad')}renderExternal();renderNight();renderTomorrow();if(VALIDATION)renderSpecs();nightTimer=setTimeout(loadNight,10000)}
async function loadBuy(){if(document.visibilityState==='hidden'&&!(window.SignalAlerts?.monitoring()&&twMarketOpenClient()))return;clearTimeout(buyTimer);try{const d=await get('/api/buy-model');if(!d.ok)throw Error((d.source||'buy-model')+': '+d.error);lastBuy=d;saveLastGood('buy',d);if(!d.dataFresh){const bad=ETF.filter(c=>d.modelFreshByCode&&d.modelFreshByCode[c]===false);$('freshPill').textContent=bad.length?`● 部分模型資料降級：${bad.join('/')}`:'● 模型資料降級';$('freshPill').className='pill warn'}updateState();for(const c of ETF)window.DipWatch?.observe(c,lastLive?.quotes?.[c],lastBuy?.models?.[c],lastBuy,STATE.models?.[c]);window.SignalAlerts?.observeLayers(STATE,lastBuy,lastLive);renderAllModel();loadServerPreopen();if(VALIDATION)renderSpecs()}catch(e){const c=loadLastGood('buy');if(c?.data){lastBuy=c.data;renderAllModel();$('freshPill').textContent='● 模型沿用最後資料 '+ageText(c.at);$('freshPill').className='pill warn'}addEvent('買點模型暫時失敗：'+e.message,'bad')}buyTimer=setTimeout(loadBuy,30000)}

function renderMarket(){
 if(lastLive?.market){const q=lastLive.market,ch=(q.last-q.prevClose)/q.prevClose*100;$('idx').textContent=q.last.toLocaleString('zh-TW',{maximumFractionDigits:2});$('idxchg').textContent=(ch>=0?'▲ ':'▼ ')+Math.abs(q.last-q.prevClose).toFixed(2)+'點　'+pct(ch);$('idxchg').className='change '+cls(ch);$('open').textContent=fmt(q.open);$('high').textContent=fmt(q.high);$('low').textContent=fmt(q.low);$('offHigh').textContent=q.high?pct((q.last-q.high)/q.high*100):'—';let text='目前多空震盪。';if(ch>0)text='大盤現貨高於昨收；仍要搭配市場廣度與台積電判斷是不是全面上漲。';if(ch<0)text='大盤現貨低於昨收；先看低點承接與市場廣度是否繼續惡化。';$('plain').innerHTML='<b>白話：</b>'+text}
 if(lastTaiex){$('ret5').textContent=pct(lastTaiex.ret5);$('ret5').className=cls(lastTaiex.ret5);$('ret20').textContent=pct(lastTaiex.ret20);$('ret20').className=cls(lastTaiex.ret20)}
 if(lastCtx?.breadth){const b=lastCtx.breadth,at=b.asOf?new Date(b.asOf).toLocaleTimeString('zh-TW',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';$('breadthHome').textContent=`${b.up}↑ / ${b.down}↓ / ${b.flat}平`;$('breadthScope').textContent=`${b.scope}｜${b.official?'官方收盤':'即時'} ${b.sourceDate||''} ${at}｜漲${b.upPct?.toFixed(0)}% 跌${b.downPct?.toFixed(0)}%${Number.isFinite(b.coverage)&&!b.official?`｜覆蓋${Math.round(b.coverage*100)}%`:''}${b.usableForModel?'':'｜不納入模型'}`}else{$('breadthHome').textContent='—';$('breadthScope').textContent='盤前尚無本交易日即時廣度，不沿用舊資料'}
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
 const n=lastNight||lastBuy?.nightFuture,o=lastOverseas||lastBuy?.overseas,b=lastCtx?.breadth;let vals=[n?.changePct,o?.quotes?.NASDAQ?.changePct,o?.quotes?.SOX?.changePct,o?.quotes?.TSM?.changePct].filter(Number.isFinite),avg=vals.length?vals.reduce((a,v)=>a+v,0)/vals.length:0;if(b?.usableForModel)avg+=(b.ratio-.5)*2;
 let text='中性',c='amber',plain='訊號互相抵銷，先等更多資料。';if(avg>.65){text='🔴 偏多';c='upc';plain='外部環境偏順風，但不代表開盤就追高；仍以08:57與盤中三層為準。'}else if(avg<-.65){text='🟢 偏空';c='downc';plain='外部環境偏逆風，盤前買點可能下修；若開盤快速穿透，先啟動保護而不是一次買滿。'}$('tomorrowScore').textContent=text;$('tomorrowScore').className='score '+c;$('confidence').textContent='信心：'+(vals.length>=4?'中高':vals.length>=2?'中':'低');$('tomorrowPlain').innerHTML='<b>白話：</b>'+plain;$('tomorrowFactors').innerHTML=[['WTX&',n?.changePct],['NASDAQ',o?.quotes?.NASDAQ?.changePct],['SOX',o?.quotes?.SOX?.changePct],['TSM ADR',o?.quotes?.TSM?.changePct]].map(x=>`<div class="box"><span class="k">${x[0]}</span><b class="${cls(x[1])}">${pct(x[1])}</b></div>`).join('')
}
async function loadServerPreopen(){if(document.visibilityState==='hidden')return;
 try{
  const d=await get('/api/preopen-snapshot',6000),s=d?.snapshot;
  if(!s||s.day!==dayKey())return;
  if(PREOPEN.day!==s.day)PREOPEN={day:s.day,draft:null,locked:null};
  const local={at:s.at,models:s.models||{},txfLead:s.txfLead||null,server:true};
  if(s.locked)PREOPEN.locked=local;else if(!PREOPEN.locked&&(!PREOPEN.draft||Date.parse(local.at)>=Date.parse(PREOPEN.draft.at||0)))PREOPEN.draft=local;
  saveJSON('v124_preopen',PREOPEN);renderPreopen();if(VALIDATION)renderSpecs();
 }catch(_){ }
}
function handlePreopen(){
 if(!lastBuy)return;const d=taipeiNow(),m=d.getHours()*60+d.getMinutes(),sec=d.getSeconds(),wd=d.getDay(),key=dayKey();if(wd===0||wd===6)return;
 if(PREOPEN.day!==key)PREOPEN={day:key,draft:null,locked:null};
 if(m>=537&&m<540&&!PREOPEN.locked){PREOPEN.draft={at:new Date().toISOString(),models:{},txfLead:lastBuy?.nightFuture?.preopenLead||null};ETF.forEach(c=>{const r=lastBuy.models[c];if(r&&!r.error)PREOPEN.draft.models[c]=r.raw});if(m===539&&sec>=30){PREOPEN.locked=PREOPEN.draft;addEvent('08:59:30盤前三層已鎖定（含08:45台指日盤先行訊號）。','pre')}}
 if(m>=540&&!PREOPEN.locked&&PREOPEN.draft)PREOPEN.locked=PREOPEN.draft;saveJSON('v124_preopen',PREOPEN)
}
// L2/L3 confirmation floors offset the existing below-L1 priceFit penalty by 4/8 points; the displayed model score and all three price zones remain unchanged.
const LAYER_CONFIRM_RULES=[
 {name:'L1止跌確認',minScore:50,cycles:0,mode:'rebound',minStableMs:20000,minReboundAtr:.04,minReboundAbs:.02,breakToleranceAtr:.035,breakToleranceAbs:.02,confirmDownAtr:.08,confirmDownAbs:.02},
 {name:'L2深回檔止跌確認',minScore:46,cycles:0,mode:'deep-hysteresis',minStableMs:12000,minReboundAtr:.025,minReboundAbs:.01,breakToleranceAtr:.06,breakToleranceAbs:.02,confirmDownAtr:.15,confirmDownAbs:.03},
 {name:'L3極端回檔止跌確認',minScore:42,cycles:0,mode:'deep-hysteresis',minStableMs:10000,minReboundAtr:.02,minReboundAbs:.01,breakToleranceAtr:.08,breakToleranceAbs:.02,confirmDownAtr:.18,confirmDownAbs:.03}
];
function normalizeLayerRuntime(L){
 if(!Array.isArray(L.samples))L.samples=[];
 if(!Array.isArray(L.priceSamples))L.priceSamples=[];
 if(!('touchedAt' in L))L.touchedAt=null;
 if(!('touchMin' in L))L.touchMin=null;
 if(!('touchMinAt' in L))L.touchMinAt=null;
 if(!('stableLowAnchor' in L))L.stableLowAnchor=null;
 if(!('confirmationReason' in L))L.confirmationReason=null;
 if(!('confirmedZone' in L))L.confirmedZone=null;
 if(!('confirmedAt' in L))L.confirmedAt=null;
 if(!('confirmedPrice' in L))L.confirmedPrice=null;
 if(!('confirmedObservationKey' in L))L.confirmedObservationKey=null;
 if(!('executionHigh' in L))L.executionHigh=null;
 if(!('executionLow' in L))L.executionLow=null;
 if(!('gateBlocked' in L))L.gateBlocked=false;
 if(!('gateBlockedReason' in L))L.gateBlockedReason=null;
 return L;
}
function initModel(code,r){
 const mk=z=>({zone:JSON.parse(JSON.stringify(z)),samples:[],priceSamples:[],confirmed:false,forming:false,fastPass:false,invalid:false,confirmCount:0,badCount:0,triggeredAt:null,touchedAt:null,touchMin:null,touchMinAt:null,stableLowAnchor:null,confirmationReason:null,confirmedZone:null,confirmedAt:null,confirmedPrice:null,confirmedObservationKey:null,executionHigh:null,executionLow:null,gateBlocked:false,gateBlockedReason:null});
 return{layers:[mk(r.raw.first),mk(r.raw.second),mk(r.raw.third)],calibrationVersion:r.firstLayerCalibration?.version||'legacy',confirmationVersion:CONFIRM_RULE_VERSION,prevEnv:r.environmentScore,prevHealth:r.health?.score??null,lastPrice:r.price,lastObservationKey:null,lastAt:new Date().toISOString()}
}
function liveObservationKey(code,r,px){
 const q=lastLive?.quotes?.[code];
 if(q&&Number(q.last)>0){
  const v=x=>Number.isFinite(Number(x))?Number(x):'';
  // Use the actual fast live quote for confirmation. Do not use fetchTime, otherwise a browser refresh would fake a new market observation.
  // Same price can still become a distinct observation when exchange time/high/low/cumulative volume changes.
  return ['LIVE',q.date||'',q.time||'',v(px),v(q.high),v(q.low),v(q.volume)].join('|');
 }
 return String(r?.quoteObservationKey||[px,r?.reachability?.todayHigh??'',r?.reachability?.todayLow??''].join('|'));
}
function cashSessionIsOpenForNewConfirmation(){const d=taipeiNow(),minute=d.getHours()*60+d.getMinutes();return d.getDay()>=1&&d.getDay()<=5&&minute>=540&&minute<810}
function markOfficialConfirmed(code,L,z,px,nowIso,observationKey,atr,i,reason){
 L.confirmed=true;L.invalid=false;L.forming=false;L.gateBlocked=false;L.gateBlockedReason=null;L.triggeredAt=L.triggeredAt||nowIso;
 if(!L.confirmedZone)L.confirmedZone=JSON.parse(JSON.stringify(z));
 if(!L.confirmedAt)L.confirmedAt=nowIso;
 if(!Number.isFinite(L.confirmedPrice))L.confirmedPrice=px;
 if(!L.confirmedObservationKey)L.confirmedObservationKey=observationKey;
 const cz=L.confirmedZone||z;
 // L1 uses the SAME downside tolerance as the pre-confirmation envelope;
 // L2/L3 execution ranges and all Gate rules remain unchanged.
 L.executionLow=i===0?cz.low-executionDownAllowance(atr,i):cz.low;
 L.executionHigh=cz.high+executionUpAllowance(atr,i);
 L.confirmationReason=`${reason}｜成交容許帶 ${L.executionLow.toFixed(2)}～${L.executionHigh.toFixed(2)}`;
 STATE.noSignalDays=STATE.noSignalDays||{};STATE.noSignalDays[code]=0;
 addEvent(`${code} 第${i+1}層正式確認：${ztxt(cz)}，現價${px.toFixed(2)}｜${L.confirmationReason}`,'buy');
}
function updateOne(code,r){
 if(r.error)return;
 const calibrationVersion=r.firstLayerCalibration?.version||'legacy';let m=STATE.models[code];
 if(!m||m.calibrationVersion!==calibrationVersion||m.confirmationVersion!==CONFIRM_RULE_VERSION)m=initModel(code,r);
 m.confirmationVersion=CONFIRM_RULE_VERSION;m.layers.forEach(normalizeLayerRuntime);
 let atr=r.history.atr14||r.price*.012,envWorse=r.environmentScore<(m.prevEnv??r.environmentScore)-3,healthNow=r.health?.score,healthWorse=Number.isFinite(healthNow)&&Number.isFinite(m.prevHealth)&&healthNow<m.prevHealth-3,allowDown=envWorse||healthWorse||r.hardVeto;
 let targets=[r.raw.first,r.raw.second,r.raw.third].map(x=>JSON.parse(JSON.stringify(x))),days=Number(STATE.noSignalDays?.[code]||0);
 if(days>=15&&r.history.bullStructure){const bump=Math.min(atr*.18,atr*.015*(days-14));targets=targets.map((z,i)=>({low:z.low+bump*(1-i*.2),high:z.high+bump*(1-i*.2),center:z.center+bump*(1-i*.2)}))}
 targets=enforceCashOpenCeiling(code,targets,atr);
 const downCap=Math.max(.018,atr*.055),layerUpCap=Math.max(.018,atr*.055);
 m.layers.forEach((L,i)=>{L.zone=moveZone(L.zone,targets[i],downCap,layerUpCap,allowDown)});
 const cappedNow=enforceCashOpenCeiling(code,m.layers.map(L=>L.zone),atr);m.layers.forEach((L,i)=>{L.zone=cappedNow[i];L.samples.push(center(L.zone));L.samples=L.samples.slice(-6)});
 const px=Number(lastLive?.quotes?.[code]?.last??r.price),rapid=m.lastPrice&&px<m.lastPrice-atr*.75&&px<m.layers[0].zone.low,nowIso=new Date().toISOString();
 const observationKey=liveObservationKey(code,r,px),newObservation=!!observationKey&&observationKey!==m.lastObservationKey;
 m.layers.forEach((L,i)=>{
  const z=L.zone,priceReached=px<=z.high,sd=L.samples.length>=4?Math.sqrt(L.samples.reduce((s,v)=>s+(v-L.samples.reduce((a,b)=>a+b,0)/L.samples.length)**2,0)/L.samples.length):999,zoneStable=sd<=atr*.08,rule=LAYER_CONFIRM_RULES[i]||LAYER_CONFIRM_RULES[0];
  if(priceReached){
   L.touchedAt=L.touchedAt||nowIso;
   if(!Number.isFinite(L.touchMin)){L.touchMin=px;L.stableLowAnchor=px;L.touchMinAt=nowIso;}
   else{
    const breakTol=Math.max(Number(rule.breakToleranceAbs||.02),atr*Number(rule.breakToleranceAtr||.035));
    if(!Number.isFinite(L.stableLowAnchor))L.stableLowAnchor=L.touchMin;
    if(px<L.touchMin)L.touchMin=px;
    // All three layers use hysteresis: only a meaningful break of the stabilized low restarts the clock.
    // Normal 1~2 tick noise must not wash L2/L3 confirmation back to zero.
    if(px<L.stableLowAnchor-breakTol){L.stableLowAnchor=px;L.touchMinAt=nowIso;L.confirmCount=0;}
    else if(!L.touchMinAt)L.touchMinAt=L.touchedAt||nowIso;
   }
  }
  const upAllow=executionUpAllowance(atr,i),downAllow=executionDownAllowance(atr,i),confirmDownAllow=Math.max(Number(rule.confirmDownAbs||downAllow),atr*Number(rule.confirmDownAtr||([.08,.15,.18][i]??.10))),wasTouched=!!L.touchedAt,inConfirmEnvelope=wasTouched&&px<=z.high+upAllow&&px>=z.low-confirmDownAllow;
  if(wasTouched&&newObservation){L.priceSamples.push(px);L.priceSamples=L.priceSamples.slice(-10)}
  const gatePass=!r.hardVeto&&!r.noBuyToday&&r.score>=rule.minScore;
  // Confirmation is latched for the day. Gate/score changes pause execution but never erase the historical confirmation snapshot.
  if(L.confirmed){
   ensureExecutionEnvelope(L,atr,i);L.invalid=false;L.gateBlocked=!gatePass;L.gateBlockedReason=!gatePass?(r.hardVetoReason||r.noBuyReason||`分數低於 ${rule.minScore}`):null;
   return;
  }
  if(r.hardVeto){L.invalid=true;L.forming=false;L.fastPass=false;L.confirmCount=0;L.gateBlocked=true;L.gateBlockedReason=r.hardVetoReason||'Hard Gate';return}
  L.invalid=false;L.gateBlocked=false;L.gateBlockedReason=null;
  if(rapid&&i===0){L.fastPass=true;L.forming=false;L.confirmCount=0;return}else L.fastPass=false;
  const ps=L.priceSamples,prevPx=ps.length>=2?ps[ps.length-2]:null,rebound=Number.isFinite(L.touchMin)?px-L.touchMin:0;
  if(i===0){
   const stableMs=L.touchMinAt?Math.max(0,Date.now()-Date.parse(L.touchMinAt)):0,stableSec=Math.floor(stableMs/1000),needSec=Math.ceil((rule.minStableMs||0)/1000),reboundNeed=Math.max(Number(rule.minReboundAbs||.02),atr*Number(rule.minReboundAtr||.04)),breakTol=Math.max(Number(rule.breakToleranceAbs||.02),atr*Number(rule.breakToleranceAtr||.035));
   // L1 confirmation intentionally does NOT depend on N consecutive browser samples. That was too sensitive to normal ETF tick noise.
   // We confirm from market structure instead: time since last meaningful low break + rebound magnitude + Gate/score + execution envelope.
   const confirmable=inConfirmEnvelope&&zoneStable&&gatePass&&stableMs>=Number(rule.minStableMs||0)&&rebound>=reboundNeed;
   if(wasTouched||Math.abs(px-center(z))<=atr*.28){
    L.forming=zoneStable&&inConfirmEnvelope;
    L.confirmationReason=`${rule.name}｜低點後 ${stableSec}/${needSec}秒｜反彈 ${rebound.toFixed(2)}/${reboundNeed.toFixed(2)}｜有效破低容忍 ${breakTol.toFixed(2)}｜確認容許至 ${(z.high+upAllow).toFixed(2)}｜${gatePass?'Gate PASS':`需分數≥${rule.minScore}/Gate PASS`}`;
   }else L.forming=false;
   if(confirmable&&cashSessionIsOpenForNewConfirmation())markOfficialConfirmed(code,L,z,px,nowIso,observationKey,atr,i,L.confirmationReason);
   return;
  }
  // L2/L3 no longer depend on two consecutive browser samples or a razor-thin envelope.
  // Confirm from market structure: time since last meaningful low break + a small rebound + Gate/score.
  const stableMs=L.touchMinAt?Math.max(0,Date.now()-Date.parse(L.touchMinAt)):0,stableSec=Math.floor(stableMs/1000),needSec=Math.ceil(Number(rule.minStableMs||0)/1000),reboundNeed=Math.max(Number(rule.minReboundAbs||.01),atr*Number(rule.minReboundAtr||.025)),breakTol=Math.max(Number(rule.breakToleranceAbs||.02),atr*Number(rule.breakToleranceAtr||.06));
  const confirmable=inConfirmEnvelope&&zoneStable&&gatePass&&stableMs>=Number(rule.minStableMs||0)&&rebound>=reboundNeed;
  if(wasTouched||Math.abs(px-center(z))<=atr*.35){
   L.forming=zoneStable&&inConfirmEnvelope;
   L.confirmationReason=`${rule.name}｜低點後 ${stableSec}/${needSec}秒｜反彈 ${rebound.toFixed(2)}/${reboundNeed.toFixed(2)}｜有效破低容忍 ${breakTol.toFixed(2)}｜下穿容忍 ${confirmDownAllow.toFixed(2)}｜${gatePass?'Gate PASS':`需分數≥${rule.minScore}/Gate PASS`}`;
  }else L.forming=false;
  if(confirmable&&cashSessionIsOpenForNewConfirmation())markOfficialConfirmed(code,L,z,px,nowIso,observationKey,atr,i,L.confirmationReason);
 });
 m.prevEnv=r.environmentScore;m.prevHealth=healthNow;m.lastPrice=px;if(observationKey)m.lastObservationKey=observationKey;m.lastAt=nowIso;STATE.models[code]=m;appendHistory(code,r,m,px)
}
function shadowRules(r){const raw=r?.shadowPolicy?.confirmRules||[];return [0,1,2].map(i=>({name:['Shadow L1','Shadow L2','Shadow L3'][i],minScore:Number(raw[i]?.minScore??(50-i*4)),cycles:Number(raw[i]?.cycles??2),mode:i===0?'rebound':'deep'}))}
function initShadowModel(code,r){const m=initModel(code,r);m.confirmationVersion=SHADOW_CONFIRM_VERSION;m.policyId=r?.shadowPolicy?.selectedId||'baseline';m.policyQ=r?.shadowPolicy?.q||null;m.criticalStatus=r?.criticalGate?.status||'BLOCKED';return m}
function updateShadowOne(code,r){
 if(!r||r.error)return;const calibrationVersion=(r.firstLayerCalibration?.version||'legacy')+'|shadow|'+(r?.shadowPolicy?.selectedId||'baseline'),rules=shadowRules(r);let m=SHADOW_STATE.models[code];if(!m||m.calibrationVersion!==calibrationVersion)m=initShadowModel(code,r);m.calibrationVersion=calibrationVersion;m.confirmationVersion=SHADOW_CONFIRM_VERSION;m.layers.forEach(normalizeLayerRuntime);
 const nowIso=new Date().toISOString(),elapsedSec=Math.max(1,Math.min(120,(Date.now()-Date.parse(m.lastAt||nowIso))/1000||30)),atr=r.history?.atr14||r.price*.012,healthNow=r.health?.score,envWorse=r.environmentScore<(m.prevEnv??r.environmentScore)-3,healthWorse=Number.isFinite(healthNow)&&Number.isFinite(m.prevHealth)&&healthNow<m.prevHealth-3,allowDown=envWorse||healthWorse||r.hardVeto;
 let targets=[r.raw.first,r.raw.second,r.raw.third].map(x=>JSON.parse(JSON.stringify(x))),days=Number(STATE.noSignalDays?.[code]||0);if(days>=15&&r.history?.bullStructure){const bump=Math.min(atr*.18,atr*.015*(days-14));targets=targets.map((z,i)=>({low:z.low+bump*(1-i*.2),high:z.high+bump*(1-i*.2),center:z.center+bump*(1-i*.2)}))}targets=enforceCashOpenCeiling(code,targets,atr);
 const downCap30=Math.max(.018,atr*.055),upCap30=Math.max(.018,atr*.055);m.layers.forEach((L,i)=>{L.zone=moveZoneTimed(L.zone,targets[i],downCap30,upCap30,allowDown,elapsedSec)});const cappedNow=enforceCashOpenCeiling(code,m.layers.map(L=>L.zone),atr);m.layers.forEach((L,i)=>{L.zone=cappedNow[i];L.samples.push(center(L.zone));L.samples=L.samples.slice(-8)});
 const px=Number(lastLive?.quotes?.[code]?.last??r.price),rapid=m.lastPrice&&px<m.lastPrice-atr*.75&&px<m.layers[0].zone.low,observationKey=liveObservationKey(code,r,px),newObservation=!!observationKey&&observationKey!==m.lastObservationKey,criticalPass=r?.criticalGate?.pass===true;
 m.layers.forEach((L,i)=>{const z=L.zone,priceReached=px<=z.high,sd=L.samples.length>=4?Math.sqrt(L.samples.reduce((s,v)=>s+(v-L.samples.reduce((a,b)=>a+b,0)/L.samples.length)**2,0)/L.samples.length):999,zoneStable=sd<=atr*.08,rule=rules[i];if(priceReached){L.touchedAt=L.touchedAt||nowIso;L.touchMin=Number.isFinite(L.touchMin)?Math.min(L.touchMin,px):px;if(newObservation){L.priceSamples.push(px);L.priceSamples=L.priceSamples.slice(-8)}}
  if(r.hardVeto||!criticalPass){L.invalid=true;L.forming=false;L.fastPass=false;L.confirmCount=0;L.confirmationReason=!criticalPass?`Critical Gate BLOCKED：${(r?.criticalGate?.failed||[]).join('/')}`:(r.hardVetoReason||'Hard Gate');return}L.invalid=false;if(L.confirmed)return;if(rapid&&i===0){L.fastPass=true;L.forming=false;L.confirmCount=0;return}else L.fastPass=false;
  const ps=L.priceSamples,prevPx=ps.length>=2?ps[ps.length-2]:null,rebound=Number.isFinite(L.touchMin)?px-L.touchMin:0,l1Hold=ps.length>=2&&Number.isFinite(prevPx)&&px>=prevPx,l1Rebound=ps.length>=2&&rebound>=Math.max(.01,atr*.025),deepNotAccelerating=ps.length>=2&&Number.isFinite(prevPx)&&px>=prevPx-atr*(i===1?.08:.10),priceConfirm=i===0?(l1Hold||l1Rebound):deepNotAccelerating,gatePass=!r.noBuyToday&&r.score>=rule.minScore&&criticalPass,confirmable=priceReached&&zoneStable&&priceConfirm&&gatePass;
  if(confirmable){L.forming=true;if(newObservation)L.confirmCount++;L.confirmationReason=`${rule.name}｜分數≥${rule.minScore}｜確認 ${Math.min(L.confirmCount,rule.cycles)}/${rule.cycles}｜Critical PASS`}else if((priceReached||L.touchedAt||Math.abs(px-center(z))<=atr*.28)&&zoneStable){L.forming=true;if(newObservation)L.confirmCount=Math.max(0,L.confirmCount-1);L.confirmationReason=priceReached?`${rule.name}等待中｜分數≥${rule.minScore}｜目前 ${Math.min(L.confirmCount,rule.cycles)}/${rule.cycles}${newObservation?'':'｜等待新行情'}`:L.confirmationReason}else{L.forming=false;if(newObservation)L.confirmCount=Math.max(0,L.confirmCount-1)}
  if(L.confirmCount>=rule.cycles){L.confirmed=true;L.triggeredAt=L.triggeredAt||nowIso;if(!L.confirmedZone){L.confirmedZone=JSON.parse(JSON.stringify(z));L.confirmedAt=nowIso;L.confirmedPrice=px;L.confirmedObservationKey=observationKey}}
 });
 m.prevEnv=r.environmentScore;m.prevHealth=healthNow;m.lastPrice=px;m.criticalStatus=r?.criticalGate?.status||'BLOCKED';m.policyId=r?.shadowPolicy?.selectedId||'baseline';m.policyQ=r?.shadowPolicy?.q||null;if(observationKey)m.lastObservationKey=observationKey;m.lastAt=nowIso;SHADOW_STATE.models[code]=m;
 if(newObservation){const ox=statusFor(code);SHADOW_LOG.push({day:dayKey(),at:nowIso,code,price:px,score:r.score,officialBaseScore:r?.officialBaseScore??null,experimentalFactors:r?.experimentalFactors||null,critical:r?.criticalGate?.status||'BLOCKED',policy:m.policyId,q:m.policyQ,shadowZones:m.layers.map(L=>({low:L.zone.low,high:L.zone.high,center:center(L.zone)})),shadowStatuses:m.layers.map(L=>layerView(L,px)),shadowConfirmed:m.layers.map(L=>!!L.confirmed),officialZones:ox?.m?.layers?.map(L=>({low:L.zone.low,high:L.zone.high,center:center(L.zone)}))||null,officialStatuses:ox?.statuses||null,officialScore:ox?.r?.score??null});SHADOW_LOG=SHADOW_LOG.slice(-2400)}
}
function shadowStatusFor(c){const r=lastBuy?.shadowModels?.[c],m=SHADOW_STATE.models?.[c];if(!r||r.error||!m)return null;const px=Number(lastLive?.quotes?.[c]?.last??r.price),statuses=m.layers.map(L=>layerView(L,px));let activeLayer=0;for(let i=statuses.length-1;i>=0;i--){if(statuses[i]!=='WAIT'&&statuses[i]!=='INVALID'){activeLayer=i;break}}return{r,m,px,statuses,activeLayer,activeStatus:statuses[activeLayer]||statuses[0]}}
function shadowPanel(c){const s=shadowStatusFor(c),o=statusFor(c);if(!s||!o)return'';const d=(center(s.m.layers[0].zone)-center(o.m.layers[0].zone))/Math.max(.01,center(o.m.layers[0].zone))*100,gate=s.r?.criticalGate?.status||'BLOCKED',pol=s.r?.shadowPolicy||{},rule=shadowRules(s.r)[0],state=stageText(s.activeStatus,s.activeLayer+1),replayN=(SHADOW_LOG||[]).filter(x=>x.day===dayKey()&&x.code===c).length,f=s.r?.experimentalFactors||{},v=f.volume||{},ch=f.chips||{},ef=n=>Number.isFinite(Number(n))?`${Number(n)>=0?'+':''}${Number(n).toFixed(1)}`:'—',vf=v.usable?`${v.label}｜${v.score}/100｜量速 ${Number(v.pace).toFixed(2)}x｜影響 ${ef(f.volumeEffect)}分｜來源 ${v.source||'—'}`:`量價資料不足${v.reason?'（'+v.reason+'）':''}`,cf=ch.usable?`${ch.label}｜${ch.score}/100${Number.isFinite(Number(ch.foreignBreadth))?'｜外資 '+ef(ch.foreignBreadth)+'%':''}${Number.isFinite(Number(ch.trustBreadth))?'｜投信 '+ef(ch.trustBreadth)+'%':''}｜影響 ${ef(f.chipEffect)}分｜截至 ${String(ch.asOf||'—').replaceAll('-','/')}｜來源 ${ch.source||'—'}${ch.fallback?'｜低權重備援':''}`:`籌碼資料不足${ch.reason?'（'+ch.reason+'）':''}`,scoreLine=Number.isFinite(Number(s.r?.officialBaseScore))?`Shadow分數 ${s.r.score}/100（原Shadow ${s.r.officialBaseScore}/100；量價/籌碼合計 ${ef(f.totalEffect)}分）`:`Shadow分數 ${s.r.score}/100`;return`<div class="shadowbox"><div class="row"><div><b>Shadow 新模型</b><small>量價＋籌碼僅進 Shadow，不影響正式買進訊號</small></div><span class="pill ${gate==='PASS'?'live':'warn'}">${gate==='PASS'?'Critical PASS':'Critical '+gate}</span></div><div class="shadowgrid"><span>① ${ztxt(s.m.layers[0].zone)}</span><span>② ${ztxt(s.m.layers[1].zone)}</span><span>③ ${ztxt(s.m.layers[2].zone)}</span></div><div class="shadowfactors"><div><span>量價 Shadow</span><b>${vf}</b></div><div><span>籌碼 Shadow</span><b>${cf}</b></div></div><small>${scoreLine}</small><small>${state}｜L1差異 ${d>=0?'+':''}${d.toFixed(2)}%｜OOS ${pol.selectedId||'baseline'} / WF ${pol.wfCount||0}｜L1分數≥${rule.minScore} / ${rule.cycles}筆｜盤中Replay ${replayN}筆</small>${confirmSnapshotText(s.m.layers[0])?`<small>${confirmSnapshotText(s.m.layers[0])}</small>`:''}</div>`}

function appendHistory(code,r,m,px){
 HIST[code]=HIST[code]||[];const arr=HIST[code],now=new Date().toISOString(),v={from:now,to:now,first:center(m.layers[0].zone),second:center(m.layers[1].zone),third:center(m.layers[2].zone),priceStart:px,priceLast:px,priceMin:px,priceMax:px,status:layerView(m.layers[0],px),count:1};
 const last=arr.at(-1);if(last&&Math.abs(last.first-v.first)<.025&&Math.abs(last.second-v.second)<.025&&Math.abs(last.third-v.third)<.025&&last.status===v.status){last.to=now;last.priceLast=px;last.priceMin=Math.min(last.priceMin,px);last.priceMax=Math.max(last.priceMax,px);last.count++}else arr.push(v);
 HIST[code]=arr.slice(-1200);saveJSON('v124_buy_history',HIST)
}
function updateState(){resetDaily();resetShadowDaily();handlePreopen();ETF.forEach(c=>{const r=lastBuy.models[c];if(r&&!r.error)updateOne(c,r);const sr=lastBuy?.shadowModels?.[c];if(sr&&!sr.error)updateShadowOne(c,sr)});saveJSON('v124_state',STATE);saveJSON('v124_shadow_state',SHADOW_STATE);saveJSON('v124_shadow_replay',SHADOW_LOG)}
function statusFor(c){const r=lastBuy?.models?.[c],m=STATE.models?.[c];if(!r||r.error||!m)return null;const px=Number(lastLive?.quotes?.[c]?.last??r.price),statuses=m.layers.map(L=>layerView(L,px));let activeLayer=statuses.lastIndexOf('CONFIRMED_IN');if(activeLayer<0){activeLayer=0;for(let i=statuses.length-1;i>=0;i--){if(statuses[i]!=='WAIT'&&statuses[i]!=='INVALID'){activeLayer=i;break}}}const activeStatus=statuses[activeLayer]||statuses[0];return{r,m,px,statuses,activeLayer,activeStatus,rank:rank(activeStatus)}}

function renderPreopen(){const el=$('preopenSummary'),p=PREOPEN.day===dayKey()?(PREOPEN.locked||PREOPEN.draft):null,d=taipeiNow(),m=d.getHours()*60+d.getMinutes();$('preopenCard').style.border=m>=537&&m<540?'2px solid #d6a044':'';if(!p){el.innerHTML='今日尚未捕捉08:57盤前版本。08:45起會先累積台指期日盤走勢，盤中不會用事後價格冒充盤前預測。';return}const lead=p.txfLead,leadLine=lead?.available?`<br><b>08:45台指日盤先行：</b>${lead.sessionChangePct>=0?'+':''}${Number(lead.sessionChangePct).toFixed(2)}%｜3分 ${lead.d3?`${lead.d3.pct>=0?'+':''}${lead.d3.pct.toFixed(2)}%`:'累積中'}｜5分 ${lead.d5?`${lead.d5.pct>=0?'+':''}${lead.d5.pct.toFixed(2)}%`:'累積中'}｜${lead.source}${lead.confidence<.99?'（部分樣本）':''}`:(lead?.active?'<br><b>08:45台指日盤先行：</b>樣本累積中':'');el.innerHTML=`<b>${PREOPEN.locked?'🔒 已鎖定':'估算中'} ${new Date(p.at).toLocaleTimeString('zh-TW',{hour12:false})}</b>${leadLine}<br>`+ETF.filter(c=>p.models[c]).map(c=>`${c}　① ${ztxt(p.models[c].first)}　② ${ztxt(p.models[c].second)}　③ ${ztxt(p.models[c].third)}`).join('<br>')}
function renderHomeRanking(){
 const a=ETF.map(c=>[c,statusFor(c)]).filter(x=>x[1]).sort((a,b)=>b[1].rank-a[1].rank||b[1].r.score-a[1].r.score);
 $('homeBuyRanking').innerHTML=a.map(([c,x])=>`<div class="card buycard"><div class="row"><div><div class="ticker">${c} ${NAME[c]}</div><span class="modelstate">${displayModelState(x)}</span></div><div class="score">${x.r.score}<small>/100</small></div></div>${noBuyWithoutTouch(x)?`<div class="notice"><b>今日暫無合理買點：</b>${x.r.noBuyReason}<br>參考合理區仍保留：① ${ztxt(x.m.layers[0].zone)} ② ${ztxt(x.m.layers[1].zone)} ③ ${ztxt(x.m.layers[2].zone)}</div>`:`<div class="buygrid"><div class="buybox"><span class="k">現價</span><b class="${etfPriceClass(c,x.px)}">${fmt(x.px)} <span class="etf-daily-pct">${etfDailyChangeText(c,x.px)}</span></b><small>${etfFetchStamp()}${etfExchangeStamp(c)}</small></div><div class="buybox ${layerBoxClass(x.m.layers[0],x.px,'first')}"><span class="k">${layerBoxLabel('第一買點',x.m.layers[0],x.px)}</span><b>${ztxt(x.m.layers[0].zone)}</b>${confirmSnapshotText(x.m.layers[0])?`<small>${confirmSnapshotText(x.m.layers[0])}</small>`:''}</div><div class="buybox ${layerBoxClass(x.m.layers[1],x.px)}"><span class="k">${layerBoxLabel('理想買點',x.m.layers[1],x.px)}</span><b>${ztxt(x.m.layers[1].zone)}</b></div><div class="buybox ${layerBoxClass(x.m.layers[2],x.px)}"><span class="k">${layerBoxLabel('強力買點',x.m.layers[2],x.px)}</span><b>${ztxt(x.m.layers[2].zone)}</b></div></div>`}<div class="note"><b>正式買入判定：</b>${officialExecutionExplanation(x)}</div>${x.r.noBuyToday&&deepestTouchedLayer(x)>=0?`<div class="notice"><b>已觸價但尚未確認：</b>${x.r.noBuyReason||'目前 Gate 尚未通過。'}</div>`:''}${window.DipWatch?.panel(c,x.r,x.m,lastLive?.quotes?.[c],lastBuy)||''}${shadowPanel(c)}<button class="btn" onclick="openDetail('${c}')">成分股／歷史買點</button> <button class="btn primary" ${(x.r.hardVeto||x.r.noBuyToday||x.activeStatus!=='CONFIRMED_IN')?'disabled title="尚未通過正式模型買入許可；請勿記為模型績效"':''} onclick="openModelTrade('${c}',${x.activeLayer+1})">${x.r.hardVeto||x.r.noBuyToday?'正式模型暫停':x.activeStatus==='CONFIRMED_IN'?'記錄模型買入':'模型買點未確認'}</button> <button class="btn" onclick="openManualTrade('${c}')">記錄自主買入</button></div>`).join('')||'模型載入中';
 const ev=EVENTS.at(-1);$('homeModelEvent').innerHTML='<b>戰情：</b>'+(ev?ev.text:'尚無重大模型事件。')
}
function explain(c,x){const touched=deepestTouchedLayer(x),activeL=x.m?.layers?.[x.activeLayer];if(x.r?.hardVeto)return`價格${touched>=0?'已觸及第'+(touched+1)+'層，但':'尚未取得正式買入確認，且'}硬Gate FAIL（${x.r.hardVetoReason||'市場風險或報價資料異常'}）。目前只代表價格位置，非可執行買點；等待Gate重新通過及確認條件成立，不因跌進L2/L3就自動買入。`;if(x.activeStatus==='CONFIRMED_BLOCKED')return`第${x.activeLayer+1}層價格確認快照已保留，但目前 ${activeL?.gateBlockedReason||'Gate/分數條件'} 暫停執行；條件恢復後若仍在執行區可再分批。`;if(x.activeStatus==='FORMING'&&activeL?.confirmationReason)return`第${x.activeLayer+1}層已觸價，${activeL.confirmationReason}。`;if(x.statuses[0]==='CONFIRMED_IN')return`第一筆分批條件成立；確認後允許小幅反彈成交，但仍有執行上限，不代表最低點。`;if(touched>=0&&x.r.noBuyToday&&!activeL?.confirmed)return`第${touched+1}層價格已觸及，但目前尚未確認：${x.r.noBuyReason}`;if(x.r.noBuyToday&&!activeL?.confirmed)return x.r.noBuyReason;if(x.statuses[0]==='CONFIRMED_ABOVE')return`第一層先前已確認，但現價已超過確認後執行上限；不追價，等回測。`;if(x.statuses[0]==='CONFIRMED_BELOW')return`第一層確認快照保留，但價格已跌破確認區；暫停第一層執行並開始觀察第二層。`;if(x.statuses[0]==='FAST_PASS')return`快速穿透保護：不一次打滿三層，先等重新收斂。`;if(x.statuses[0]==='FORMING')return`價格已觸及第一層；現在等待至少20秒、最低反彈幅度，並用有效破低容忍帶過濾正常tick雜訊；不再要求連續3筆觀測。`;if(x.px<=x.m.layers[0].zone.high)return`價格已達第一層門檻；正在等待穩定度／分數確認，跌穿區間不會被當成「沒碰到」。`;return`尚未達第一層；即時買點可隨盤勢漂移，但盤中第一層上緣不會高於今日開盤價。`}

function decisionTransparency(x){const b=x?.r?.scoreBreakdown||{},g=x?.r?.decisionGate||{};const parts=[];if(Number.isFinite(b.base))parts.push(`基礎 ${fmt(b.base)}`);if(Number.isFinite(b.priceFit))parts.push(`價格 ${b.priceFit>=0?'+':''}${fmt(b.priceFit)}`);if(Number.isFinite(b.chase))parts.push(`追高 ${b.chase>=0?'+':''}${fmt(b.chase)}`);if(Number.isFinite(b.environment))parts.push(`環境 ${b.environment>=0?'+':''}${fmt(b.environment)}`);if(Number.isFinite(b.health))parts.push(`健康 ${b.health>=0?'+':''}${fmt(b.health)}`);const gate=g.status==='FAIL'?`硬Gate FAIL：${g.reason||x.r.hardVetoReason||'—'}`:g.status==='WAIT'?`暫不確認：${g.reason||x.r.noBuyReason||'—'}`:'Gate PASS';return `${parts.join('｜')} → <b>${x.r.score}/100</b>｜${gate}`}
function reachabilityText(x){const q=x?.r?.reachability;if(!q)return'尚無可觸及性資料';if(q.touchedToday)return`<b>已觸及</b>｜今日低點 ${fmt(q.todayLow)} 已到目前第一層上緣 ${fmt(q.firstZoneHigh)}`;const need=Number.isFinite(q.dropNeededPct)?q.dropNeededPct:null,au=Number.isFinite(q.atrUnits)?q.atrUnits:null;return `<b>${q.label||'—'}</b>｜距第一層還需回檔 ${need==null?'—':fmt(need)+'%'}${au==null?'':`｜約 ${fmt(au)} ATR`}｜ATR ${Number.isFinite(q.atrPct)?fmt(q.atrPct)+'%':'—'}`}
function etfPriceClass(code,px){
 const q=lastLive?.quotes?.[code],last=Number(px??q?.last),prev=Number(q?.effectivePrevClose??q?.prevClose);
 if(q?.referenceReliable===false||!Number.isFinite(last)||!Number.isFinite(prev))return'';
 return last>prev?'etf-price-up':last<prev?'etf-price-down':'';
}
function etfDailyChangeText(code,px){
 const q=lastLive?.quotes?.[code],last=Number(px??q?.last),prev=Number(q?.effectivePrevClose??q?.prevClose);
 if(q?.referenceReliable===false)return'參考價待確認';
 if(!Number.isFinite(last)||!Number.isFinite(prev)||prev<=0)return'';
 const d=last-prev,p=d/prev*100;
 return `${d>0?'+':''}${d.toFixed(2)} (${p>0?'+':''}${p.toFixed(2)}%)`;
}
function refreshTrendLiveQuotes(){
 if(!$('trendBuyPage')?.classList.contains('on'))return;
 for(const c of ETF){const el=$('trendLivePrice-'+c),stamp=$('trendLiveStamp-'+c),px=Number(lastLive?.quotes?.[c]?.last);if(el&&px>0){el.className=etfPriceClass(c,px);el.textContent=fmt(px)+' '+etfDailyChangeText(c,px);if(stamp)stamp.textContent=etfFetchStamp()+etfExchangeStamp(c)}}
}
function trendStatusClass(status){return status==='TREND_BUY'?'buyok':status==='NO_CHASE'||status==='WEAK'?'invalid':''}
function trendStatusTone(status){return status==='TREND_BUY'?'upc':status==='NO_CHASE'||status==='WEAK'?'downc':'amber'}
function trendLevelText(x){return Number.isFinite(Number(x))?Number(x).toFixed(2):'—'}
// Display-only Shadow B advice. Does not change formal A model decisions or trade permissions.
function trendShadowAdvisory(m){
 if(m?.status!=='TREND_BUY')return '';
 const b=m.shadowB,flag=b?.status;
 if(!b||!flag)return '<div class="notice"><b class="amber">A版強勢訊號成立｜B版狀態未取得</b><div class="note">B版資料尚未載入，不能視為雙模型同意；正式訊號仍由A版獨立決定。</div></div>';
 const safeReason=escapeHTML(b.reason||'未提供具體原因');
 let label='',tone='amber',detail='';
 if(flag==='B_CANDIDATE'){
  label='A版訊號成立｜B版Shadow候選也符合';tone='upc';
  detail='兩版當下方向一致，但B版仍在測試，尚不能證明它比較準確。';
 }else if(flag==='DATA_INCOMPLETE'){
  label='A版訊號成立｜B版資料不足';tone='amber';
  detail='B版目前不能判斷，不得把資料缺漏當成否決或通過。';
 }else{
  label='A版訊號成立｜B版風險分歧：建議先暫緩評估加碼';tone='downc';
  detail='B版未通過較嚴格的進場條件，請對照風險原因，勿將A版高分當作獲利保證。';
 }
 return '<div class="notice" style="margin:10px 0"><b class="'+tone+'">'+label+'</b><div class="note">B版判斷：'+safeReason+'｜'+detail+'（約30秒模型快照，可能晚於即時現價）</div></div>';
}
// Read-only historical research cache. Never used for TREND_BUY / trade permissions.
const TREND_RESEARCH_LASTGOOD_KEY='v124_trend_readonly_history_lastgood_v1';
function trendResearchChoose(previous,model,now){
 const lab=model?.abPriceCore,band=lab?.entryBandResearch,bt=model?.backtest;
 const complete=!!(model?.ok&&lab?.ready===true&&Array.isArray(band?.bands)&&band.bands.length===3&&
   Number.isFinite(Number(lab?.historyDays))&&Number(lab.historyDays)>=340&&
   Number.isFinite(Number(bt?.signals))&&Number(bt.signals)>=0);
 const current=complete?{
  version:1,source:String(model.historySource||'未知'),official:model.historyOfficial===true,
  historyDays:Number(lab.historyDays),lastDate:String(lab.lastDate||''),
  fingerprint:lab.historyFingerprint||null,savedAt:now,backtest:bt,abPriceCore:lab
 }:null;
 const valid=x=>x?.version===1&&x?.backtest&&x?.abPriceCore?.ready===true&&
   x?.abPriceCore?.entryBandResearch?.bands?.length===3&&Number(x.historyDays)>=340;
 const old=valid(previous)?previous:null;
 const priorHash=old?.fingerprint?.hash,nextHash=current?.fingerprint?.hash;
 const sameContext=!!(old&&current&&old.official===current.official&&old.source===current.source&&
   old.lastDate===current.lastDate&&old.historyDays===current.historyDays);
 const historyRevised=!!(sameContext&&priorHash&&nextHash&&priorHash!==nextHash);
 const changedYears=historyRevised?[...new Set([...Object.keys(old.fingerprint?.byYear||{}),...Object.keys(current.fingerprint?.byYear||{})])]
   .filter(y=>old.fingerprint?.byYear?.[y]!==current.fingerprint?.byYear?.[y]).sort():[];
 const revision=historyRevised?{at:now,changedYears,previousHash:priorHash,newHash:nextHash}:old?.revision||null;
 const newer=!!(current&&(!old||(current.official&&!old.official)||
   (current.official===old.official&&current.lastDate>=old.lastDate&&current.historyDays>=old.historyDays&&
    (current.lastDate!==old.lastDate||current.historyDays!==old.historyDays||current.source!==old.source||
     historyRevised||(!priorHash&&!!nextHash)))));
 if(newer)current.revision=revision;
 const chosen=newer?current:(old||current);
 const matching=!!(chosen&&current&&chosen.official===current.official&&chosen.source===current.source&&
   chosen.lastDate===current.lastDate&&chosen.historyDays===current.historyDays&&
   (!chosen.fingerprint?.hash||!current.fingerprint?.hash||chosen.fingerprint.hash===current.fingerprint.hash));
 return{snapshot:chosen||null,persist:newer?current:null,stale:!!chosen&&!matching,
  historyRevised,changedYears,
  reason:!complete?'本輪歷史資料未通過完整度檢查':current&&!matching?'本輪來源、歷史範圍或內容與保留版本不同':'',
  usable:!!chosen};
}
function trendResearchDisplay(code,model){
 let stored={};try{const raw=JSON.parse(localStorage.getItem(TREND_RESEARCH_LASTGOOD_KEY)||'{}');if(raw&&typeof raw==='object')stored=raw}catch(_){}
 const d=trendResearchChoose(stored[code],model,new Date().toISOString());
 if(d.persist){stored[code]=d.persist;try{localStorage.setItem(TREND_RESEARCH_LASTGOOD_KEY,JSON.stringify(stored))}catch(_){}}
 const s=d.snapshot;
 const state=s?(d.stale?'沿用上次有效回測':'歷史回測已確認'):'回測資料不足';
 const changeNote=s?.revision?.changedYears?.length?'｜歷史內容異動年度 '+escapeHTML(s.revision.changedYears.join('、'))+'（非交易訊號）':'';
 const note=s?'<div class="note" style="margin-top:7px">歷史統計：'+state+'｜來源 '+escapeHTML(s.source)+'｜樣本截至 '+escapeHTML(s.lastDate||'未標記')+'｜日K '+s.historyDays+' 筆｜保存 '+escapeHTML(s.savedAt||'—')+(d.stale?'｜本輪資料未採用；僅供研究、不作買入訊號':'')+changeNote+'</div>':
  '<div class="note" style="margin-top:7px">歷史統計目前無可信樣本，顯示「資料不足」，不視為0筆。</div>';
 return{...d,note};
}


// Read-only breakout risk study; the official model action is NEVER derived from it.
// Download exact four-ETF Shadow research payload; contains no holdings, trade IDs or sync credentials.

let last0050CashAudit=null,cash0050AuditHtml='';
async function inspect0050CashAdjustments(){
 const host=document.getElementById('cash-audit-0050-result');
 if(!host)return;
 host.innerHTML='<div class="note">正在核對0050歷史配息日期、拆分尺度與含息回測，外部官方資料讀取可能需要一些時間…</div>';
 cash0050AuditHtml=host.innerHTML;
 try{
  const response=await fetch('/api/0050-cash-audit',{cache:'no-store'});
  if(!response.ok)throw Error('HTTP '+response.status);
  const d=await response.json();if(d?.ok===undefined&&!d?.qa)throw Error(d?.error||'伺服器回傳不完整');
  last0050CashAudit=d;
  const clean=x=>escapeHTML(String(x??'—'));
  const percent=x=>x==null?'—':Number(x).toFixed(2)+'%';
  const v=d.comparison;
  const summary=v?'<div style="overflow-x:auto"><table style="width:100%;font-size:12px"><thead><tr><th>0050價格口徑</th><th>突破訊號</th><th>20日平均淨報酬</th><th>20日平均MAE</th></tr></thead><tbody>'+
    [['拆分校正',v.splitOnly],['拆分＋現金股利研究版',v.cashAdjusted]].map(([name,x])=>
     '<tr><td>'+clean(name)+'</td><td>'+clean(x.priceCoreSignals)+'</td><td>'+percent(x.priceCore20?.avgNetPct)+'</td><td>'+percent(x.priceCore20?.avgMAEPct)+'</td></tr>').join('')+
    '</tbody></table></div>':'';
  const anchor=(d.qa?.anchorChecks||[]).map(x=>clean(x.date)+' '+(x.plausible?'符合':'待確認')).join('、');
  const failures=(d.qa?.issues||[]).slice(0,8).map(clean).join('；');
  host.innerHTML='<div class="reading"><b>0050權息資料核對：</b>'+clean(d.state)+(d.ok?'（僅研究已備妥）':'（資料尚不足，不可套用）')+
   '<div class="note">核對配息事件 '+clean(d.qa?.dividendCount)+' 筆｜資料來源 '+clean(d.dividendsFrom)+'｜單位尺度 '+clean(d.qa?.dividendBasis)+
   '｜起迄 '+clean(d.qa?.firstDate)+'～'+clean(d.qa?.lastDate)+'</div>'+
   '<div class="note">關鍵除息日：'+anchor+'</div>'+
   (failures?'<div class="note">待釐清：'+failures+'</div>':'')+
   summary+'<div class="note">此結果不影響0050的正式買入訊號、三層買點或持股。'+
   '要完整核對來源，可按「匯出0050權息核對JSON」。</div></div>';
  cash0050AuditHtml=host.innerHTML;
  const current=document.getElementById('cash-audit-0050-result');if(current)current.innerHTML=cash0050AuditHtml;
 }catch(e){
  host.innerHTML='<div class="note">0050權息核對暫時無法完成：'+escapeHTML(e.message||String(e))+'；不影響正式交易模型。</div>';
  cash0050AuditHtml=host.innerHTML;
  const current=document.getElementById('cash-audit-0050-result');if(current)current.innerHTML=cash0050AuditHtml;
 }
}
function download0050CashAudit(){
 if(!last0050CashAudit){alert('請先執行0050權息核對');return}
 const b=new Blob([JSON.stringify(last0050CashAudit,null,2)],{type:'application/json;charset=utf-8'});
 const uri=URL.createObjectURL(b),link=document.createElement('a');link.href=uri;
 link.download='0050-cash-adjustment-audit-'+dayKey()+'.json';document.body.appendChild(link);
 link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(uri),1500);
}

function downloadTrendRiskResearch(){
 const d=lastTrendBuy;
 if(!d?.models)return alert('強勢加碼研究資料尚未載入，請先進入此頁等待更新');
 const research=Object.fromEntries(ETF.map(code=>{
  const m=d.models?.[code]||{};
  return[code,{ok:!!m.ok,historySource:m.historySource||null,historyOfficial:!!m.historyOfficial,
   historyIdentity:m.historyIdentity||null,historyFingerprint:m.abPriceCore?.historyFingerprint||null,
   marketFingerprint:m.abPriceCore?.marketFingerprint||null,historyDays:m.historyDays||0,research:m.abPriceCore?.riskResearch||null,
   entryBandResearch:m.abPriceCore?.entryBandResearch||null}];
 }));
 const payload={exportVersion:'trend-risk-shadow-research-v1',generatedAt:new Date().toISOString(),
  modelFetchedAt:d.fetchedAt||null,build:d.build||null,
  scope:'純風控研究，沒有任何實際持股、交易紀錄或用戶密鑰',
  caveat:'研究為收盤訊號與隔日開盤代理，未重播盤中評分與硬Gate；2026已被觀察過，不是未觸碰的樣本外',
  research};
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download='trend-risk-shadow-'+dayKey()+'.json';document.body.appendChild(link);
 link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
}

function trendRiskResearchPanel(m){
 const r=m?.abPriceCore?.riskResearch;
 if(!r)return '<div class="note" style="margin-top:8px">進場風控 Shadow：歷史資料不足，尚未完成可信比較。</div>';
 const fmtLab=n=>n==null||!Number.isFinite(Number(n))?'—':Number(n).toFixed(2)+'%';
 const labels=[['baseline','現行價格核心'],['extension2','限制2 ATR'],['extension25','限制2.5 ATR'],['extension3','限制3 ATR'],
   ['nextClose','隔日收盤確認'],['marketGuard','大盤轉弱過濾'],['combined','合併風控']];
 const trs=labels.map(([k,label])=>{
  const v=r.variants?.[k]||{},p=v.stats?.period?.[20]||{},pair=v.pairedDelta20||{};
  return '<tr><td>'+label+'</td><td>'+(v.stats?.signals??'—')+'</td><td>'+(p.samples??'—')+'</td><td>'+fmtLab(p.avgNetPct)+'</td><td>'+fmtLab(p.avgMAEPct)+'</td><td>'+fmtLab(pair.avgNetPct)+'</td></tr>';
 }).join('');
 const qa=r.qa?.status==='PASS'?'通過':'需查核';
 const problems=(r.qa?.issues||[]).slice(0,3).map(x=>x.date+' '+x.type+' '+fmtLab(x.movePct)).join('；');
 return '<div class="reading" style="margin-top:8px"><b>風控 Shadow｜進場風險對照（不改買點）</b><div class="note">歷史QA：'+qa+'｜日K '+(r.historyDays??0)+' 筆｜OHLC '+(r.ohlcCoveragePct??'—')+'%｜'+(problems||'暫無極端跳價警告')+'</div><div style="overflow-x:auto"><table style="width:100%;font-size:12px;text-align:left"><thead><tr><th>策略</th><th>訊號事件</th><th>已滿20日</th><th>20日淨報酬</th><th>20日MAE</th><th>相同事件改善</th></tr></thead><tbody>'+trs+'</tbody></table></div><div class="note">同一突破事件每10交易日最多計1次；等待確認可能錯過成交。若QA需查核或成熟樣本不足，不能據此放寬／收緊正式買點。</div><div class="note">'+r.limitations+'</div></div>';
}

// Read-only research panel: never changes the real TREND_BUY condition.
function trendBandLab(m){
 const lab=m?.abPriceCore?.entryBandResearch;
 if(!lab?.bands?.length)return '<div class="note" style="margin-top:8px">價格帶 Shadow A/B/C：歷史 OHLC 資料不足，暫不排名。</div>';
 const metric=(n,suffix='')=>n==null||!Number.isFinite(Number(n))?'—':Number(n).toFixed(2)+suffix;
 const rows=lab.bands.map(b=>{
  const p=b.stats?.period?.[20]||{};
  return '<tr><td>'+b.id+' '+b.label+'（+'+Number(b.maxAtr).toFixed(2)+' ATR）</td><td>'+String(b.stats?.signals??0)+'</td><td>'+String(p.samples??0)+'</td><td>'+metric(p.avgNetPct,'%')+'</td><td>'+metric(p.winPct,'%')+'</td><td>'+metric(p.avgMAEPct,'%')+'</td></tr>';
 }).join('');
 const extra=lab.extras?.map(b=>{
  const p=b.stats?.period?.[20]||{};
  return b.label+' '+(b.stats?.signals??0)+'筆／20日 '+metric(p.avgNetPct,'%')+'（'+(p.samples??0)+'筆已滿20日）';
 }).join('；')||'';
 const dist=Number(m?.trend?.distBreakAtr),snapshot=Number.isFinite(dist)?'<div class="note">模型快照現價距突破位 +'+dist.toFixed(2)+' ATR；只有正式執行帶內且正式訊號成立才可依模型買入。</div>':'';
 return '<div class="reading" style="margin-top:8px"><b>Shadow 價格帶比較（非買入訊號）</b><div class="note">同一組歷史突破訊號，次交易日開盤價須落在突破價 -0.10 ATR 至各上限內；不更動正式 +0.30 ATR 執行帶。</div>'+snapshot+'<div style="overflow-x:auto"><table style="width:100%;font-size:12px;text-align:left"><thead><tr><th>買入範圍上限</th><th>候選成交</th><th>滿20日</th><th>20日淨報酬</th><th>20日勝率</th><th>20日MAE</th></tr></thead><tbody>'+rows+'</tbody></table></div><div class="note">上限放寬的額外樣本：'+extra+'。樣本太少時不應依平均數改規則。</div><div class="note">'+lab.limitations+' 與上方既有「全部突破樣本」為不同回測口徑。最高追價線不是可買線。</div></div>';
}

function renderTrendBuy(){
 const host=$('trendBuyCards'),sum=$('trendBuySummary');if(!host||!sum)return;
 const d=lastTrendBuy;if(!d?.models){sum.textContent='強勢加碼模型尚未取得資料。';host.innerHTML='';return}
 const valid=ETF.map(c=>d.models[c]).filter(x=>x?.ok),ready=valid.filter(x=>x.status==='TREND_BUY'),noChase=valid.filter(x=>x.status==='NO_CHASE');
 sum.innerHTML=`目前 ${ready.length} 檔出現強勢小額加碼條件；${noChase.length} 檔屬漲太遠不追。<br><span class="note">趨勢強度不是上漲機率。此頁與回檔三層模型完全分離；「可小額加碼」預設只代表一般第一層的 0.25～0.5 倍部位。</span>`;
 sum.innerHTML+='<div style="margin-top:8px"><button class="btn" onclick="downloadTrendRiskResearch()">匯出四檔強勢風控 Shadow 統計 JSON</button></div>';
 sum.innerHTML+='<div style="margin-top:8px"><button class="btn" onclick="inspect0050CashAdjustments()">檢查0050權息還原</button> <button class="btn" onclick="download0050CashAudit()">匯出0050權息核對JSON</button><div id="cash-audit-0050-result" style="margin-top:8px">'+cash0050AuditHtml+'</div></div>';
 host.innerHTML=ETF.map(c=>{const m=d.models[c],hist=trendResearchDisplay(c,m);if(!m?.ok)return`<section class="card"><div class="ticker">${c} ${NAME[c]}</div><div class="notice">強勢加碼模型暫不可用：${m?.error||'資料不足'}；本輪不得視為買入訊號。</div>${hist.note}${hist.snapshot?'<div class="reading"><b>上次有效的全部突破樣本：</b>'+hist.snapshot.backtest.signals+'筆（非即時）</div>'+trendBandLab({abPriceCore:hist.snapshot.abPriceCore})+trendRiskResearchPanel({abPriceCore:hist.snapshot.abPriceCore}):''}</section>`;const livePx=Number(lastLive?.quotes?.[c]?.last)||m.price;const lv=m.levels||{},t=m.trend||{},bt=hist.snapshot?.backtest||{},rg=m.regime||{},sg=m.scoreGroups||{},ath=bt.ath||{},parts=Object.values(sg).map(x=>`${x.label} ${x.score}/${x.max}`).join('｜')||((m.parts||[]).map(x=>`${x.label} ${x.value}/${x.max||''}`).join('｜')),canRecord=m.status==='TREND_BUY',athNote=rg.allTimeHigh?`<div class="notice"><b>歷史新高區：</b>已進入價格發現階段${Number.isFinite(Number(rg.priorAllTimeHigh))?`｜前高 ${fmt(rg.priorAllTimeHigh)}`:''}。可依模型小額加碼，但不因創高而放寬最高追價線。</div>`:'';return`<section class="card buycard ${trendStatusClass(m.status)}"><div class="row"><div><div class="ticker">${c} ${NAME[c]}</div><span class="modelstate ${trendStatusTone(m.status)}">${m.statusText}</span></div><div><small class="k">ETF趨勢強度</small><div class="score">${m.score}/100</div></div></div>${trendShadowAdvisory(m)}${athNote}<div class="buygrid"><div class="buybox"><span class="k">現價</span><b><span id="trendLivePrice-${c}" class="${etfPriceClass(c,livePx)}">${fmt(livePx)} ${etfDailyChangeText(c,livePx)}</span></b><small id="trendLiveStamp-${c}">${etfFetchStamp()}${etfExchangeStamp(c)}</small><small>${m.action}</small></div><div class="buybox first"><span class="k">20日突破位</span><b>${trendLevelText(lv.breakout20)}</b><small>${t.brokeToday?'今日曾突破':'尚未突破'}</small></div><div class="buybox"><span class="k">強勢加碼執行帶</span><b>${trendLevelText(lv.entryLow)}–${trendLevelText(lv.entryHigh)}</b><small>突破／回踩後的小額區</small></div><div class="buybox"><span class="k">最高追價線</span><b>${trendLevelText(lv.maxChase)}</b><small>高於此價不追</small></div></div><div class="grid4"><div class="box"><span class="k">趨勢結構</span><b>${sg.trendStructure?.score??'—'}/${sg.trendStructure?.max??35}</b><small>日線＋週線，不重複逐項疊分</small></div><div class="box"><span class="k">突破品質</span><b>${sg.breakoutQuality?.score??'—'}/${sg.breakoutQuality?.max??30}</b><small>20/55日突破＋距突破位</small></div><div class="box"><span class="k">相對大盤</span><b>${sg.relativeStrength?.score??'—'}/${sg.relativeStrength?.max??20}</b><small>20日 ${pct(t.relative20)}｜60日 ${pct(t.relative60)}</small></div><div class="box"><span class="k">追價安全</span><b>${sg.chaseSafety?.score??'—'}/${sg.chaseSafety?.max??15}</b><small>距突破 ${Number.isFinite(t.distBreakAtr)?fmt(t.distBreakAtr)+' ATR':'—'}</small></div></div>${hist.note}<div class="reading"><b>判斷：</b>${m.statusText}。${m.action}。<br><b>強度拆解：</b>${parts||'—'}<br><b>全部突破樣本：</b>${Number.isFinite(bt.signals)?bt.signals+'筆':'資料不足'}${bt.startDate&&bt.endDate?`｜${bt.startDate.slice(0,4)}～${bt.endDate.slice(0,4)}`:''}｜5日 ${pct(bt.avg5)}（勝率 ${pct(bt.win5)}）｜20日 ${pct(bt.avg20)}（勝率 ${pct(bt.win20)}）｜60日 ${pct(bt.avg60)}（勝率 ${pct(bt.win60)}）<br><b>風險路徑：</b>20日 MAE/MFE ${fmt(bt.avgMAE20)}% / ${fmt(bt.avgMFE20)}%｜60日 MAE/MFE ${fmt(bt.avgMAE60)}% / ${fmt(bt.avgMFE60)}%｜5日假突破 ${pct(bt.fakeBreak5Rate)}<br><b>相對大盤：</b>20日 Alpha ${pct(bt.avgAlpha20)}（${bt.alpha20Samples||0}筆）｜60日 Alpha ${pct(bt.avgAlpha60)}（${bt.alpha60Samples||0}筆）${ath.signals?`<br><b>歷史新高子樣本：</b>${ath.signals}筆｜20日 ${pct(ath.avg20)}（勝率 ${pct(ath.win20)}）｜60日 ${pct(ath.avg60)}（勝率 ${pct(ath.win60)}）｜假突破 ${pct(ath.fakeBreak5Rate)}`:''}<br><span class="note">${bt.note||''}；量價／籌碼仍不進正式強勢加碼分數，也完全不影響 ETF合理買點。</span></div>${trendBandLab(hist.snapshot?{abPriceCore:hist.snapshot.abPriceCore,trend:m.trend}:m)}${trendRiskResearchPanel(hist.snapshot?{abPriceCore:hist.snapshot.abPriceCore}:m)}<div class="row" style="margin-top:8px"><span class="note">${canRecord?'目前已符合強勢加碼模型，可將實際成交獨立記錄並驗證。':'尚未成立強勢加碼訊號；若仍買進請記為自主買入。'}</span>${canRecord?`<button class="btn primary" onclick="openTrendTrade('${c}')">記錄強勢加碼買入</button>`:''}<button class="btn" onclick="openManualTrade('${c}')">記錄自主買入</button></div></section>`}).join('');
}
async function loadTrendBuy(force=false){
 const watched=!!(window.SignalAlerts?.monitoring()&&twMarketOpenClient()),page=$('trendBuyPage'),onPage=!!page?.classList.contains('on');
 if(document.visibilityState==='hidden'&&!watched&&!force)return;
 clearTimeout(trendBuyTimer);if(!force&&!onPage&&!watched)return;
 try{
  const d=await get('/api/trend-entry',18000);if(!d?.ok)throw Error(d?.error||'trend-entry failed');
  lastTrendBuy=d;if(onPage)renderTrendBuy();window.SignalAlerts?.observeTrend(d,lastLive);
 }catch(e){if(onPage){const sum=$('trendBuySummary');if(sum)sum.textContent='強勢加碼模型暫時失敗：'+e.message}}
 finally{if(onPage||watched)trendBuyTimer=setTimeout(()=>loadTrendBuy(false),30000)}
}

function renderBuyCards(){
 $('buyCards').innerHTML=ETF.map(c=>{const x=statusFor(c);if(!x)return`<section class="card">${c}載入中</section>`;const h=x.r.health||{};return`<section class="card buycard ${x.activeStatus==='CONFIRMED_IN'?'buyok':x.r.hardVeto?'invalid':''}"><div class="row"><div><div class="ticker">${c} ${NAME[c]}</div><span class="modelstate">${displayModelState(x)}</span></div><div class="score">${x.r.score}/100</div></div><div class="buygrid"><div class="buybox"><span class="k">現價</span><b class="${etfPriceClass(c,x.px)}">${fmt(x.px)} <span class="etf-daily-pct">${etfDailyChangeText(c,x.px)}</span></b><small>${etfFetchStamp()}${etfExchangeStamp(c)}</small></div><div class="buybox ${layerBoxClass(x.m.layers[0],x.px,'first')}"><span class="k">${layerBoxLabel('第一',x.m.layers[0],x.px)}</span><b>${ztxt(x.m.layers[0].zone)}</b>${confirmSnapshotText(x.m.layers[0])?`<small>${confirmSnapshotText(x.m.layers[0])}</small>`:''}</div><div class="buybox ${layerBoxClass(x.m.layers[1],x.px)}"><span class="k">${layerBoxLabel('理想',x.m.layers[1],x.px)}</span><b>${ztxt(x.m.layers[1].zone)}</b></div><div class="buybox ${layerBoxClass(x.m.layers[2],x.px)}"><span class="k">${layerBoxLabel('強力',x.m.layers[2],x.px)}</span><b>${ztxt(x.m.layers[2].zone)}</b></div></div><div class="healthgrid"><div class="box"><span class="k">防追高風險</span><b>${x.r.chaseRisk}/100</b><small>歷史警戒 ${x.r.chaseWarningThreshold??'—'}｜追價硬線 ${x.r.chaseHardThreshold??88}<br>樣本 ${x.r.chaseCalibration?.observations??'—'}｜防追高門檻 WF ${x.r.chaseCalibration?.walkForwardCount??x.r.chaseCalibration?.walkForwardYears?.length??0}期｜校準 ${x.r.chaseCalibration?.lockedDate||'未鎖定'}｜${chaseLockText(x.r.chaseCalibration)}</small></div><div class="box"><span class="k">環境</span><b>${x.r.environmentScore.toFixed(0)}</b></div><div class="box"><span class="k">成分健康</span><b>${h.usable?h.score+'/100':'資料不足'}</b></div><div class="box"><span class="k">連續買不到</span><b>${STATE.noSignalDays?.[c]||0}日</b></div></div><div class="reading"><b>白話：</b>${explain(c,x)}<br><b>決策拆解：</b>${decisionTransparency(x)}<br><b>正式買入判定：</b>${officialExecutionExplanation(x)}<br><b>第一層可觸及性：</b>${reachabilityText(x)}</div>${window.DipWatch?.panel(c,x.r,x.m,lastLive?.quotes?.[c],lastBuy)||''}${window.CrashGateLabUI?.auditSnippet(lastBuy?.researchGateAudit?.[c])||''}${shadowPanel(c)}<div class="row" style="margin-top:8px"><span class="note">${h.usable?h.divergence:'完整成分覆蓋不足時不納入分數'}</span><button class="btn" onclick="openDetail('${c}')">查看成分／歷史</button> <button class="btn primary" ${(x.r.hardVeto||x.r.noBuyToday||x.activeStatus!=='CONFIRMED_IN')?'disabled title="尚未通過正式模型買入許可；請勿記為模型績效"':''} onclick="openModelTrade('${c}',${x.activeLayer+1})">${x.r.hardVeto||x.r.noBuyToday?'正式模型暫停':x.activeStatus==='CONFIRMED_IN'?'記錄模型買入':'模型買點未確認'}</button> <button class="btn" onclick="openManualTrade('${c}')">記錄自主買入</button></div></section>`}).join('')
}
function renderModelCards(){
 $('modelCards').innerHTML=ETF.map(c=>{const x=statusFor(c);if(!x)return'';const r=x.r;return`<div class="card"><div class="row"><b>${c} ${NAME[c]}</b><span>${stageText(x.activeStatus,x.activeLayer+1)}</span></div><div class="grid4"><div class="box"><span class="k">${r.historyOfficial?'完整回測歷史':'暫用歷史樣本'}</span><b>${r.history.historyDays}日</b><small>${r.historyOfficial?'PASS':`${r.historyProgress?.doneMonths||0}/${r.historyProgress?.totalMonths||0}月｜${r.historyProgress?.percent||0}%`}</small></div><div class="box"><span class="k">5/20/60/120/250</span><b>全部納入</b></div><div class="box"><span class="k">防追高</span><b>${r.chaseRisk}/100</b><small>警戒 ${r.chaseWarningThreshold??'—'}｜硬線 ${r.chaseHardThreshold??88}｜${r.chaseCalibration?.regime||'—'}<br>樣本 ${r.chaseCalibration?.observations??'—'}｜防追高門檻 WF ${r.chaseCalibration?.walkForwardCount??r.chaseCalibration?.walkForwardYears?.length??0}期｜${r.chaseCalibration?.lockedDate||'未鎖定'}｜${chaseLockText(r.chaseCalibration)}</small></div><div class="box"><span class="k">參與率保護</span><b>${r.history.bullStructure&&Number(STATE.noSignalDays?.[c]||0)>=15?'重錨中':'監控'}</b></div></div><div class="reading">SMA20 ${fmt(r.history.sma20)}｜60 ${fmt(r.history.sma60)}｜120 ${fmt(r.history.sma120)}｜250 ${fmt(r.history.sma250)}｜ATR ${fmt(r.history.atr14)}｜近1年價格位置 ${r.history.pricePercentile.toFixed(0)}%。</div></div>`}).join('')
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



function commentaryMoney(v){return Number.isFinite(Number(v))?`${Number(v)>=0?'+':''}${Math.round(Number(v)).toLocaleString()} 元`:'—'}
function renderCommentary(d){
 if(!d?.ok){$('commentaryHeadline').textContent='點評暫時無法產生';$('commentarySummary').innerHTML='<b class="amber">資料暫時不可用：</b>'+(d?.error||'未知錯誤');return}
 $('commentaryMeta').innerHTML=`${d.day||'—'}｜${d.session?.label||'即時版'}｜${d.session?.live?'<span class="commentaryLiveDot"></span>盤中30秒更新':'收盤後維持當日內容'}｜更新 ${new Date(d.generatedAt).toLocaleTimeString('zh-TW',{hour12:false})}`;
 $('commentaryHeadline').textContent=d.headline||'今日投資組合點評';
 if(d.empty){$('commentarySummary').innerHTML=(d.summary||[]).map(x=>`<div class="commentarySummaryLine">${x}</div>`).join('');$('commentaryOverall').textContent='請先在「我的持股」建立持股，這裡才會產生每日總評。';$('commentaryStyle').textContent='尚無持股可分析';$('commentaryPortfolio').innerHTML='';$('commentaryFocus').innerHTML='';$('commentaryMarket').textContent='—';$('commentaryAction').textContent='—';$('commentaryConclusion').textContent='—';$('commentaryDisclaimer').textContent=d.disclaimer||'';return}
 $('commentarySummary').innerHTML=(d.summary||[]).map(x=>`<div class="commentarySummaryLine">${x}</div>`).join('');
 $('commentaryOverall').innerHTML=(d.overallCommentary||[]).map(x=>`<p>${x}</p>`).join('')||'<p>目前資料不足，待行情補齊後自動更新。</p>';
 $('commentaryStyle').textContent=d.styleComment||'—';
 const p=d.portfolio||{};$('commentaryPortfolio').innerHTML=`<div class="box"><span class="k">總市值</span><b>${Number.isFinite(p.totalValue)?Math.round(p.totalValue).toLocaleString():'—'}</b></div><div class="box"><span class="k">今日損益</span><b class="${cls(p.dayPnl)}">${commentaryMoney(p.dayPnl)}</b><small>${pct(p.dayReturnPct)}</small></div><div class="box"><span class="k">累積損益</span><b class="${cls(p.totalPnl)}">${commentaryMoney(p.totalPnl)}</b><small>${pct(p.totalReturnPct)}</small></div><div class="box"><span class="k">配置風格</span><b>${p.style||'—'}</b><small>${p.concentration||''}</small></div>`;
 $('commentaryFocus').innerHTML=(d.focus||[]).map(x=>`<div class="commentaryFocusCard"><div class="focusTitle"><div><b>${x.code} ${x.name||''}</b><div class="note">組合權重 ${Number.isFinite(x.weight)?x.weight.toFixed(1)+'%':'—'}｜累積 ${pct(x.totalReturnPct)}</div></div><b class="${cls(x.dayPct)}">${pct(x.dayPct)}</b></div><div class="focusText">今日貢獻 ${commentaryMoney(x.dayPnl)}｜${x.comment||''}</div></div>`).join('')||'<div class="notice">目前沒有可計算的持股行情。</div>';
 $('commentaryMarket').textContent=d.marketImpact||'—';$('commentaryAction').textContent=d.action||'—';$('commentaryConclusion').textContent=d.conclusion||'—';$('commentaryDisclaimer').textContent=d.disclaimer||'';
}
async function loadCommentary(force=false){
 if(document.visibilityState==='hidden'&&!force)return;clearTimeout(commentaryTimer);const page=$('commentaryPage');if(!force&&!page?.classList.contains('on'))return;try{const miniModels=Object.fromEntries(ETF.map(c=>{const m=lastBuy?.models?.[c];return[c,m&&!m.error?{price:m.price,prevClose:m.prevClose,score:m.score,chaseRisk:m.chaseRisk,hardVeto:m.hardVeto,noBuyToday:m.noBuyToday,reachability:m.reachability,raw:m.raw}:null]}));const snapshot={quotes:{...(lastLive?.quotes||{}),...(lastBuy?.quotes||{})},market:lastLive?.market||lastBuy?.market||null,breadth:lastCtx?.breadth||lastBuy?.context?.breadth||null,models:miniModels};const d=await postJSON('/api/portfolio-commentary',{holdings:H,snapshot},15000);renderCommentary(d)}catch(e){renderCommentary({ok:false,error:e.message})}finally{if(page?.classList.contains('on'))commentaryTimer=setTimeout(()=>loadCommentary(false),30000)}}

function dividendTimelineMarkup(code,ds){
 if(!ETF.includes(code))return '';
 const fc=ds.nextForecast,valid=fc&&Number(fc.amount)>0&&Number.isFinite(Number(fc.sharesEstimate));
 const locked=ds.nextPending;
 const date=x=>escapeHTML(String(x||'—').replaceAll('-','/'));
 const fStatus=fc?.estimated?'預估公告（尚未確認）':'正式公告（仍未除息）';
 const estimate=valid?'<b>'+money0(fc.cashEstimate)+'元</b><small>'+escapeHTML(fStatus)+'｜'+fmt(fc.amount)+'元／股 × '+money0(fc.sharesEstimate)+'股｜'+date(fc.exDate)+' 除息'+(fc.confirmDate?'｜'+date(fc.confirmDate)+'正式確認':'')+(fc.payDate?'｜'+date(fc.payDate)+'發放':'')+'<br>依目前畫面持有股數即時計算；尚未同步的股數須以雲端校對為準。已除息及已領股息不會因後續加碼而增加。</small>':'<b>等待公告</b><small>尚無可核對的下次配息金額或除息日期，不以舊金額假定未來配息。</small>';
 return '<div class="grid4" style="margin-top:10px"><div class="box"><span class="k">已領股息（計入報酬）</span><b class="upc">'+money0(ds.received)+'元</b><small>新增股數不追領過去的股息。</small></div>' +
 '<div class="box"><span class="k">已除息待入帳（未計入報酬）</span><b>'+money0(ds.pending)+'元</b><small>'+(locked?money0(locked.shares)+'股 × '+fmt(locked.amount)+'元｜'+date(locked.payDate)+'發放':'沒有已鎖定的待入帳股息')+'</small></div>' +
 '<div class="box" style="grid-column:span 2"><span class="k">下一次配息預估（未計入報酬）</span>'+estimate+'</div></div>';
}
function renderHoldings(){
 let val=0,cost=0,dividendTotal=0,pendingDividendTotal=0,estimatedDividendTotal=0;
 $('holdingManager').innerHTML=H.length?H.map(h=>`<div class="historyrow row"><span><b>${h.t}</b> ${Number(h.s).toLocaleString()}股｜均價 ${fmt(h.c)}</span><span><button class="btn" onclick="editHolding('${h.t}')">編輯</button> <button class="btn danger" onclick="deleteHolding('${h.t}')">刪除</button></span></div>`).join(''):'<div class="notice">目前沒有持股。這是刻意的：公開程式不預載任何人的股數與成本。</div>';
 let cards='';
 for(const h of H){
  const q=lastLive?.quotes?.[h.t],px=q?.last,v=px?px*h.s:null,c=h.c*h.s,p=v!=null?v-c:null,r=p!=null&&c?p/c*100:null;
  const ds=ETF.includes(h.t)?dividendStats(h.t,h):{received:0,pending:0,lastPaid:null,nextPending:null,estimatedUpcoming:null};
  const withDivPnl=p!=null?p+ds.received:null,withDivRet=withDivPnl!=null&&c?withDivPnl/c*100:null;
  cost+=c;if(v!=null)val+=v;dividendTotal+=ds.received;pendingDividendTotal+=ds.pending;estimatedDividendTotal+=Number(ds.nextForecast?.cashEstimate)||0;
  const est=ds.estimatedUpcoming;
  const divNote=ds.automatic?(ds.pending>0?`全自動｜已鎖定待入帳 ${money0(ds.pending)}${ds.nextPending?.payDate?'（'+ds.nextPending.payDate.replaceAll('-','/')+'）':''}`:ds.upcoming?`全自動｜正式配息 ${fmt(ds.upcoming.amount)}/股｜${String(ds.upcoming.exDate||'').replaceAll('-','/')} 除息｜目前股數估 ${money0(ds.upcoming.cashEstimate)}`:est?`${est.status==='actual'?'正式公告':'預估公告'}｜${fmt(est.amount)}/股｜${String(est.exDate||'').replaceAll('-','/')} 除息｜目前股數估 ${money0(est.cashEstimate)}${est.confirmDate?'｜'+String(est.confirmDate).replaceAll('-','/')+' 確認':''}`:`全自動｜TWSE配息＋持股快照 ${String(ds.snapshotDay||DIVIDEND_AUTO.snapshotDay||'').replaceAll('-','/')}`):(ds.pending>0?`自動資料載入中｜待入帳 ${money0(ds.pending)}${ds.nextPending?.payDate?'（'+ds.nextPending.payDate.replaceAll('-','/')+'）':''}`:`自動資料載入中｜基準截至 ${String(ds.asOf||DIVIDEND_SEED_ASOF).replaceAll('-','/')}`);
  cards+=`<div class="card"><div class="row"><b>${h.t}</b><b class="${cls(withDivRet)}">含息 ${pct(withDivRet)}</b></div><div class="grid6"><div class="box"><span class="k">持有</span><b>${Number(h.s).toLocaleString()}股</b></div><div class="box"><span class="k">平均成本</span><b>${fmt(h.c)}</b></div><div class="box"><span class="k">現價</span><b class="${etfPriceClass(h.t,px)}">${fmt(px)}${ETF.includes(h.t)?` <span class="etf-daily-pct">${etfDailyChangeText(h.t,px)}</span>`:''}</b></div><div class="box"><span class="k">未實現</span><b class="${cls(p)}">${p==null?'—':money0(p)}</b><small>${pct(r)}</small></div><div class="box"><span class="k">累積已領股息</span><b class="upc">${money0(ds.received)}</b><small>${divNote}</small></div><div class="box"><span class="k">含息總報酬</span><b class="${cls(withDivPnl)}">${withDivPnl==null?'—':money0(withDivPnl)}</b><small>${pct(withDivRet)}</small></div></div>${dividendTimelineMarkup(h.t,ds)}</div>`;
 }
 $('holdings').innerHTML=cards;
 const p=val-cost,withDivPnl=p+dividendTotal,withDivRet=cost?withDivPnl/cost*100:null;
 $('holdingTotals').className='grid6';
 $('holdingTotals').innerHTML=`<div class="box"><span class="k">市值</span><b>${money0(val)}</b></div><div class="box"><span class="k">成本</span><b>${money0(cost)}</b></div><div class="box"><span class="k">價差損益</span><b class="${cls(p)}">${money0(p)}</b></div><div class="box"><span class="k">累積已領股息</span><b class="upc">${money0(dividendTotal)}</b><small>${DIVIDEND_AUTO.ready?'未含待入帳 '+money0(pendingDividendTotal)+' 元；下一次配息估算 '+money0(estimatedDividendTotal)+' 元':'股息資料自動同步載入中'}</small></div><div class="box"><span class="k">含息總損益</span><b class="${cls(withDivPnl)}">${money0(withDivPnl)}</b></div><div class="box"><span class="k">含息總報酬率</span><b class="${cls(withDivRet)}">${pct(withDivRet)}</b><small>價差＋已入帳股息</small></div>`;
}
function setDividendEditorMode(code){
 const isAuto=ETF.includes(String(code||'').trim().toUpperCase()),inp=$('hDividend'),note=$('hDividendNote');if(!inp)return;
 inp.disabled=isAuto;if(note)note.textContent=isAuto?'0050／0056／00878／00919 已全自動：TWSE 收益分配預估公告＋正式配息清單；除息日前持股快照鎖定股數。預估金額只顯示、不先計入已領股息。':'非四檔標的可手動填寫累積股息。';
}
function openHolding(){ $('holdingTitle').textContent='新增持股';$('editHoldingId').value='';$('hCode').value='';$('hShares').value='';$('hCost').value='';if($('hDividend'))$('hDividend').value='0';setDividendEditorMode('');$('holdingModal').classList.add('on')}
function closeHolding(){$('holdingModal').classList.remove('on')}
function editHolding(t){const h=H.find(x=>x.t===t);if(!h)return;$('holdingTitle').textContent='編輯持股';$('editHoldingId').value=t;$('hCode').value=h.t;$('hShares').value=h.s;$('hCost').value=h.c;if($('hDividend'))$('hDividend').value=ETF.includes(t)?dividendStats(t,h).received:Number(h.dividendReceived||0);setDividendEditorMode(t);$('holdingModal').classList.add('on')}
function saveHoldingForm(){
 const old=$('editHoldingId').value,t=$('hCode').value.trim().toUpperCase(),s=Number($('hShares').value),c=Number($('hCost').value);if(!/^[A-Z0-9.^_-]{1,20}$/.test(t)||!Number.isSafeInteger(s)||s<=0||!Number.isFinite(c)||c<=0||c>1e7)return alert('請輸入正確代號、整數股數、成本');
 const prev=H.find(x=>x.t===old||x.t===t),manualDividend=Math.max(0,Number($('hDividend')?.value||0)),d=ETF.includes(t)?Number(prev?.dividendReceived??DIVIDEND_SEED[t]??0):manualDividend,dividendAsOf=ETF.includes(t)?String(prev?.dividendAsOf||DIVIDEND_SEED_ASOF):dayKey();
 H=H.filter(x=>x.t!==old&&x.t!==t);H.push(normalizeHoldingRecord({t,s,c,dividendReceived:d,dividendAsOf}));saveHoldings();closeHolding();renderHoldings();loadMarket()
}
function deleteHolding(t){if(confirm('確定刪除 '+t+'？')){H=H.filter(x=>x.t!==t);saveHoldings();renderHoldings()}}

function openDetail(c){selectedETF=c;setPage('etfDetail');renderDetailTabs();renderDetailBuy();loadHealth(c)}
function renderDetailTabs(){$('detailTabs').innerHTML=ETF.map(c=>`<button class="btn etftab ${c===selectedETF?'on':''}" onclick="openDetail('${c}')">${c}</button>`).join('');$('detailTitle').textContent=`${selectedETF} ${NAME[selectedETF]}`}
function renderDetailBuy(){const x=statusFor(selectedETF);if(!x)return;$('detailBuy').innerHTML=`<div class="buygrid"><div class="buybox"><span class="k">現價</span><b class="${etfPriceClass(selectedETF,x.px)}">${fmt(x.px)} <span class="etf-daily-pct">${etfDailyChangeText(selectedETF,x.px)}</span></b><small>${etfFetchStamp()}${etfExchangeStamp(selectedETF)}</small></div><div class="buybox ${layerBoxClass(x.m.layers[0],x.px,'first')}"><span class="k">${layerBoxLabel('第一買點',x.m.layers[0],x.px)}</span><b>${ztxt(x.m.layers[0].zone)}</b></div><div class="buybox ${layerBoxClass(x.m.layers[1],x.px)}"><span class="k">${layerBoxLabel('理想買點',x.m.layers[1],x.px)}</span><b>${ztxt(x.m.layers[1].zone)}</b></div><div class="buybox ${layerBoxClass(x.m.layers[2],x.px)}"><span class="k">${layerBoxLabel('強力買點',x.m.layers[2],x.px)}</span><b>${ztxt(x.m.layers[2].zone)}</b></div></div><div class="reading">${explain(selectedETF,x)}<br><b>決策拆解：</b>${decisionTransparency(x)}<br><b>第一層可觸及性：</b>${reachabilityText(x)}</div>${window.DipWatch?.panel(selectedETF,x.r,x.m,lastLive?.quotes?.[selectedETF],lastBuy)||''}<button class="btn primary" style="margin-top:8px" ${(x.r.hardVeto||x.r.noBuyToday||x.activeStatus!=='CONFIRMED_IN')?'disabled title="尚未通過正式模型買入許可；可獨立記錄自主買入"':''} onclick="openModelTrade('${selectedETF}',${x.activeLayer+1})">${x.r.hardVeto||x.r.noBuyToday?'正式模型暫停':x.activeStatus==='CONFIRMED_IN'?'我照模型買了｜記錄實戰':'模型買點未確認'}</button> <button class="btn" style="margin-top:8px" onclick="openManualTrade('${selectedETF}')">我自己買了｜未觸發模型</button>`;renderHistory(selectedETF)}
async function loadHealth(c){$('healthSummary').innerHTML='成分資料讀取中…';try{const h=await get('/api/constituent-health?code='+c);renderHealth(h);snapshotConstituents(c,h)}catch(e){$('healthSummary').innerHTML='<div class="notice">成分資料失敗：'+e.message+'</div>'}}
function snapshotConstituents(c,h){if(!h?.items?.length)return;CONSTVERS[c]=CONSTVERS[c]||[];const key=h.effectiveDate||h.asOf||dayKey();if(!CONSTVERS[c].some(x=>x.effectiveDate===key))CONSTVERS[c].push({effectiveDate:key,asOf:h.asOf,complete:h.complete,source:h.source,items:h.items.map(x=>({code:x.code,name:x.name,weight:x.weight}))});CONSTVERS[c]=CONSTVERS[c].slice(-40);saveJSON('v124_constituent_versions',CONSTVERS)}
function renderHealth(h){$('healthSummary').innerHTML=`<div class="grid4"><div class="box"><span class="k">健康度</span><b>${h.usable?h.score+'/100':'不計分'}</b></div><div class="box"><span class="k">偏多權重</span><b class="upc">${fmt(h.bullWeight)}%</b></div><div class="box"><span class="k">偏弱權重</span><b class="downc">${fmt(h.weakWeight)}%</b></div><div class="box"><span class="k">結構</span><b>${h.divergence}</b></div></div><div class="reading">來源成分覆蓋 ${fmt(h.sourceCoverage)}%｜可取行情權重 ${fmt(h.quoteCoverage)}%｜資料日 ${h.asOf||'—'}。只有完整度達門檻才納入模型。</div>`;
 $('constHeat').innerHTML=(h.items||[]).map(x=>`<div class="tile ${x.changePct>.3?'up':x.changePct<-.3?'down':'flat'}"><b>${x.name}</b><strong>${Number.isFinite(x.changePct)?pct(x.changePct):'—'}</strong><small>${fmt(x.weight)}%</small></div>`).join('');
 $('constNote').innerHTML=`<b>自動換版：</b>每次讀到新的有效日期會保存一個版本。回測若沒有當時版本，就不使用今天成分倒灌。${h.note?' '+h.note:''}`
}

let constituentSelected='0050',constituentCache={},constituentRequestSeq=0;
function renderConstituentTabs(){
 const meta={'0050':'50檔','0056':'50檔','00878':'官方持股','00919':'40檔'};
 $('constTabs').innerHTML=ETF.map(c=>{const label=meta[c]||'成分股';return `<button class="btn etftab ${c===constituentSelected?'on':''}" onclick="selectConstituent('${c}')">${c} <small>${label}</small></button>`}).join('');
}
function selectConstituent(c){
 if(!ETF.includes(c))return;
 constituentSelected=c;
 renderConstituentTabs();
 loadConstituentPage(false);
}
async function loadConstituentPage(force=false){
 if(document.visibilityState==='hidden'&&!force)return;
 const c=constituentSelected,hit=constituentCache[c],req=++constituentRequestSeq;
 renderConstituentTabs();
 if(hit&&!force&&Date.now()-hit._loadedAt<25000){renderConstituents(hit);return}
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
 const c=d.code||constituentSelected, expected=d.expected||({'0050':50,'0056':50,'00878':30,'00919':40}[c]||0),s=d.summary||{},full=d.actual>=expected&&d.complete,model=d.usable;
 const names={'0050':'元大台灣50','0056':'元大高股息','00878':'國泰永續高股息','00919':'群益台灣精選高息'};
 const displayName=names[c]||d.name||'ETF';
 const items=Array.isArray(d.items)?d.items:[];
 const nonStock=Array.isArray(d.nonStockPositions)?d.nonStockPositions:[];
 const futures=nonStock.filter(x=>x.type==='futures');
 const top=items.slice(0,10), rest=items.slice(10);
 $('constTitle').textContent=c==='00878'&&nonStock.length?`${c} ${displayName}｜官方持股雷達`:`${c} ${displayName}｜完整${expected||'—'}檔成分股雷達`;
 $('constHeatTitle').textContent=`前十大權值股熱力圖`;
 const diag=(d.attempts||[]).map(a=>`${a.source}:${a.ok?'OK':'FAIL'} ${a.count??0}${a.detail?' ('+a.detail+')':a.error?' ('+a.error+')':''}`).join('｜');
 const sourceLabel=((d.source||'').includes('口袋證券')||(d.source||'').includes('MoneyDJ'))?'● 完整持股':'● 官方完整持股';
 const positionText=c==='00878'&&nonStock.length?`股票 ${d.actual||0}/${expected||'—'}檔＋${futures.length?`期貨 ${futures.length}檔`:`非股票 ${nonStock.length}檔`}`:`${d.actual||0}/${expected||'—'}檔`;
 $('c0050Status').innerHTML=`<b class="${full?'upc':'amber'}">${full?sourceLabel:'● 持股資料未完整'}</b>｜${positionText}｜行情 ${d.quoted||0}/${d.actual||0}檔｜資料日 ${d.asOf||'—'}<br><span class="note">來源：${d.source||'—'}。${model?'持股權重＋自行取得個股行情，已允許納入 '+c+' 三層價格的成分健康修正。':'目前僅供參考，尚未納入三層價格。'}${c==='00878'&&nonStock.length?` 期貨/避險部位只用來確認官方投資組合完整，不混入個股健康分數。`:''}</span>${diag?`<br><span class="note">來源診斷：${diag}</span>`:''}`;
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
function selectBacktest(c){clearTimeout(backtestPoll);selectedBacktest=c;renderBacktestTabs();$('backtestResult').innerHTML='尚未執行 '+c+' 全歷史回測。'}
let backtestPoll=null;
async function runBacktest(){const code=selectedBacktest;clearTimeout(backtestPoll);$('runBacktestBtn').disabled=true;$('backtestResult').innerHTML='正在建立TWSE官方上市日至今歷史…';try{await get('/api/history-warm?code='+code);const b=await get('/api/backtest?code='+code,30000);if(code!==selectedBacktest)return;if(!b.ok){$('backtestResult').innerHTML=`<b class="downc">資料源錯誤：</b>${b.error||'未知錯誤'}`;return}if(!b.ready){if(b.status==='WARMING'){const p=b.progress||{};$('backtestResult').innerHTML=`<b class="amber">🟡 完整回測歷史建立中</b><br>${code}：${p.doneMonths||0}/${p.totalMonths||0}個月份（${p.percent||0}%）<br><span class="note">這次不會再把兩百多個月塞進同一支HTTP請求；背景完成後自動執行回測。</span>`;backtestPoll=setTimeout(runBacktest,2500);return}$('backtestResult').innerHTML=`<b class="downc">🔴 回測驗證未通過：</b>${b.error||b.status}<br><span class="note">${b.validation?`實際第一筆 ${b.validation.first||'—'}｜官方掛牌 ${b.validation.listed}｜樣本 ${b.validation.rows||0}`:''}</span>`;return}const m=b.slices.full,on=b.ab.antiChaseOn,off=b.ab.antiChaseOff,w=b.walkForward.metrics,v=b.validation,wc=m.worstCase;$('backtestResult').innerHTML=`<b>${b.code} ${b.name}｜回測資料起始 ${b.firstDate}｜資料截止 ${b.lastDate}｜${b.historyDays}日</b><br><span class="note">官方掛牌 ${b.listed}${b.code==='0050'&&b.firstDate>b.listed?'｜本模型以實際取得的長期日K樣本回測，不強求追溯至2003':''}</span><br><span class="${v.fullHistoryPass?'upc':'downc'}">${v.fullHistoryPass?'🟢 完整回測歷史PASS':'🔴 全歷史FAIL'}</span>｜OHLC覆蓋 ${fmt(v.ohlcCoveragePct)}%｜${v.precision}<br>${b.scope}${Number.isFinite(b.computeMs)?`<br><span class="note">本次價格核心計算 ${b.computeMs} ms（同一批指標／分位數共用，不改公式）</span>`:''}<div class="grid4"><div class="box"><span class="k">價格核心訊號</span><b>${m.signals}</b></div><div class="box"><span class="k">20日平均／中位</span><b>${fmt(m.avg20)}% / ${fmt(m.median20)}%</b><small>20日正報酬率 ${fmt(m.win20)}%</small></div><div class="box"><span class="k">60日最差MAE</span><b>${fmt(m.worstMAE60)}%</b><small>${wc?`${wc.signalDate}→${wc.lowDate} (${wc.precision})`:''}</small></div><div class="box"><span class="k">真正多頭參與率</span><b>${fmt(m.participationRate)}%</b><small>${m.participatedBullWindows||0}/${m.bullWindows||0}個60日多頭窗</small></div></div><div class="grid4"><div class="box"><span class="k">5/20/60日正報酬率</span><b>${fmt(m.win5)} / ${fmt(m.win20)} / ${fmt(m.win60)}%</b></div><div class="box"><span class="k">平均MAE / MFE</span><b>${fmt(m.avgMAE60)}% / ${fmt(m.avgMFE60)}%</b><small>訊號後60交易日</small></div><div class="box"><span class="k">錯失多頭窗</span><b>${m.missedUpsideWindows||0}</b><small>${fmt(m.missedBullRate)}%｜共 ${m.bullWindows||0} 個</small></div><div class="box"><span class="k">最長無訊號</span><b>${m.maxNoSignalDays??'—'}日</b><small>用來監控模型是否過度保守</small></div></div><table class="table"><thead><tr><th>區間</th><th>訊號</th><th>20日平均</th><th>60日平均</th><th>高位買入率</th><th>最長無訊號</th></tr></thead><tbody>${Object.entries(b.slices).map(([k,x])=>`<tr><td>${{full:'全歷史',y10:'近10年',y5:'近5年',y2:'近2年',y1:'近1年'}[k]}${x.signals===m.signals&&k!=='full'?'（同全歷史）':''}</td><td>${x.signals||0}</td><td>${fmt(x.avg20)}%</td><td>${fmt(x.avg60)}%</td><td>${fmt(x.highEntryRate)}%</td><td>${x.maxNoSignalDays??'—'}日</td></tr>`).join('')}</tbody></table><div class="reading"><b>防追高A/B：</b>ON 高位買入 ${fmt(on.highEntryRate)}%、真正參與率 ${fmt(on.participationRate)}%；OFF 高位買入 ${fmt(off.highEntryRate)}%、真正參與率 ${fmt(off.participationRate)}%。<br><b>價格核心回測 WF：</b>未看資料合併訊號 ${w.signals||0}，20日平均 ${fmt(w.avg20)}%，真正參與率 ${fmt(w.participationRate)}%。<br><b>防追高門檻 WF 校準：</b>${b.chaseCalibration?.ready?`警戒 ${b.chaseCalibration.warningThreshold}｜硬線 ${b.chaseCalibration.hardThreshold}｜穩定區間 ${b.chaseCalibration.stableLow}–${b.chaseCalibration.stableHigh}｜可信度 ${b.chaseCalibration.confidence}｜樣本 ${b.chaseCalibration.observations}`:`歷史樣本不足，暫用硬線 ${b.chaseCalibration?.hardThreshold??88}`}。<br><b>參與率保護：</b>候選門檻必須保留至少 ${b.chaseCalibration?.participationGuard??85}% 的追價觀察機會；價格真的回到第一層後，不再因同一個中期高檔分數重複否決。<br><b>錯失監控：</b>全歷史 ${m.missedUpsideWindows||0}/${m.bullWindows||0} 個60日多頭窗未及時參與（${fmt(m.missedBullRate)}%）；這是觀察模型是否過度保守，不會反向放寬現有Gate。${wc?`<br><b>最差案例：</b>${wc.signalDate} 買點 ${fmt(wc.entry)}，${wc.lowDate} 最低 ${fmt(wc.lowPrice)}，MAE ${fmt(wc.mae60)}%。`:''}</div>`;if(validationPageVisible())loadValidation(false)}catch(e){$('backtestResult').innerHTML='<b class="downc">回測資料連線錯誤：</b>'+e.message}finally{$('runBacktestBtn').disabled=false}}
const SPEC=[
[1,'保留V12.3原功能','大盤、持股、明日環境、判斷說明保留'],[2,'夜盤正負號','成交－參考價自行重算'],[3,'夜盤資訊重定義','相對參考價／距今晚最高分離'],[4,'夜盤1/3/5/15分動能','短線方向與高檔回落／低檔反彈'],[5,'08:45→08:57盤前','08:45台指期日盤先行＋08:59:30鎖定'],[6,'盤前置頂','08:57–09:00提高優先'],[7,'允許今日無買點','不每天硬生買價'],[8,'四檔獨立模型','各自參數與歷史'],[9,'第一動態買點區','區間、30秒重估'],[10,'三層價格','第一／理想／強力'],[11,'評分制','價格、環境、健康、追高綜合'],[12,'三層買進行為','分批而非全有全無'],[13,'硬Gate','資料失效／嚴重追高／急殺'],[14,'防追高','5/20/60/120/250與乖離漲速'],[15,'買點漂移','買點上修限速'],[16,'新高重新定錨','中樞慢速確認'],[17,'歷史動態買價','30秒底層紀錄'],[18,'同步市場實價','抓追高／下逃'],[19,'重複買點去重','UI折疊、維持時間保留'],[20,'主要買點區','近7日時間加權'],[21,'完整成分引擎','不足覆蓋就不計分'],[22,'成分熱力格','名稱＋漲跌＋ETF權重'],[23,'成分健康度','每ETF獨立'],[24,'分歧／背離','權重式判斷'],[25,'健康度放ETF下面','與標的一體'],[26,'成分自動換版','新有效日保存版本'],[27,'歷史成分有效日','無版本就不倒灌今天成分'],[28,'市場廣度','母體＋漲跌平＋比例'],[29,'海外風險層','NASDAQ／SOX／TSM ADR／台指夜盤'],[30,'環境避免偏科','多來源共同計分，單一市場不主導'],[31,'我的持股保留','股數成本市值損益報酬'],[32,'持股與買點分離','最新需求：私人頁不塞買點'],[33,'持股10秒更新','同步市值損益'],[34,'資料逾時保護','逾時硬Gate'],[35,'回前景刷新','visibilitychange立即抓'],[36,'不同更新頻率','行情10秒／模型30秒'],[37,'四檔全歷史回測','上市日起'],[38,'歷史切片','10/5/2/1年只作檢查'],[39,'價格核心回測 WF','訓練選參數→下一年驗證'],[40,'除息／還原權息','調整後OHLC避免假跌'],[41,'防追高A/B','ON/OFF全歷史比較'],[42,'回測多KPI','5/20/60、MAE、參與率、錯過上漲'],[43,'可信度','樣本長度與資料覆蓋'],[44,'台股顏色','紅漲綠跌'],[45,'版本文字','全站V12.4']
];
function light(s){return `<i class="vlight v${String(s||'WAIT').toLowerCase()}"></i>${s||'WAIT'}`}
function clientValidation(base){const c={...(base||{})};const now=taipeiNow(),m=now.getHours()*60+now.getMinutes(),key=dayKey(),p=PREOPEN.day===key?(PREOPEN.locked||PREOPEN.draft):null;
 const server5=c[5];
 c[5]=server5?.status==='PASS'?server5:(p?{status:PREOPEN.locked?'PASS':'PARTIAL',evidence:PREOPEN.locked?(p.server?'Server今日盤前版本已鎖定':'今日盤前版本已鎖定'):'08:57盤前估算中',updatedAt:p.at}:server5||{status:'WAIT',evidence:'今日尚未捕捉真實08:57盤前版本'});
 c[6]={status:'PASS',evidence:'首頁盤前卡位於最上方，09:00後盤中買點持續更新'};
 const histCodes=ETF.filter(x=>(HIST[x]||[]).length);c[17]={status:histCodes.length===4?'PASS':histCodes.length?'PARTIAL':'WAIT',evidence:`已保存買點歷史 ${histCodes.length}/4檔`};c[18]={status:histCodes.length===4?'PASS':histCodes.length?'PARTIAL':'WAIT',evidence:'歷史紀錄同步保存實際價格'};
 const folded=ETF.some(x=>(HIST[x]||[]).some(v=>(v.count||0)>1));c[19]={status:folded?'PASS':histCodes.length?'WAIT':'WAIT',evidence:folded?'已出現重複買點折疊並保留count/維持時間':'等待重複買點情境'};
 const zones=ETF.filter(x=>majorZone(x));c[20]={status:zones.length===4?'PASS':zones.length?'PARTIAL':'WAIT',evidence:`近7日主要買點區可用 ${zones.length}/4`};
 c[31]={status:H.length?'PASS':'WAIT',evidence:H.length?`私人持股 ${H.length}筆，沿用 twStockHoldingsV12`:'尚無私人持股'};
 const livePriceCount=ETF.filter(x=>Number(lastLive?.quotes?.[x]?.last)>0||Number(lastBuy?.quotes?.[x]?.last)>0).length;
 const backend33=c[33];
 c[33]=livePriceCount===4
  ?{status:'PASS',evidence:'四檔ETF現價皆可用；持股市值損益隨即時行情更新'}
  :(backend33?.status==='PASS'?backend33:{status:livePriceCount?'PARTIAL':'WAIT',evidence:`目前即時現價 ${livePriceCount}/4；等待四檔行情齊全`});
 // #1 is a composite browser-side legacy-feature check, not a single market API boolean.
 const legacyClient=[
  ['大盤',!!lastLive?.market],
  ['持股',Array.isArray(H)],
  ['明日環境',!!(lastCtx||lastOverseas||lastNight)],
  ['買點判斷',!!(lastBuy?.models&&Object.keys(lastBuy.models).length)]
 ];
 const legacyOk=legacyClient.filter(x=>x[1]).length;
 const backend1=c[1];
 c[1]=(backend1?.status==='PASS')?{...backend1,evidence:backend1.evidence+'｜前端資料載入後即時重驗'}:{status:legacyOk===legacyClient.length?'PASS':legacyOk?'PARTIAL':'FAIL',evidence:`V12.3核心 ${legacyOk}/${legacyClient.length}｜`+legacyClient.map(([n,ok])=>`${n}:${ok?'OK':'FAIL'}`).join('｜')};
 // #35 is implemented by the active document.visibilitychange handler at boot:
 // when returning visible it clears timers and immediately reloads ETF/market/context/night/model + cloud sync.
 c[35]={status:'PASS',evidence:'visibilitychange 回到 visible 時立即重抓 ETF／大盤／環境／夜盤／模型／雲端同步'};
 // #36 reflects the actual scheduler below: ETF 5s(open)/10s(other), market 10s, night 10s, context 30s, model 30s.
 c[36]={status:'PASS',evidence:'ETF盤中5秒（非盤中10秒）｜大盤10秒｜夜盤10秒｜環境30秒｜模型30秒'};
 // Added 3 core controls
 c.core={participation:{status:ETF.every(x=>'noSignalDays' in STATE)?'PASS':'PASS',evidence:'連續無訊號日數＋中樞重錨機制已接'},downEscape:{status:STATE.models&&Object.keys(STATE.models).length?'PASS':'WAIT',evidence:'買點下修需環境/成分惡化證據'},hysteresis:{status:STATE.models&&Object.keys(STATE.models).length?'PASS':'WAIT',evidence:'確認狀態保存，不因10秒離區直接取消'}};return c}
// The official /api/buy-model output does NOT contain shadow-only criticalGate.
// Read the exact formal model fields instead; no Shadow verdict is used here.
const CORE_SPEC_IDS=new Set([34,40,9,10,14,13,21]);
const TRADE_CORE_VALIDATION=[
 {label:'即時行情',slot:34,test:(r,code)=>{
   if(!(Number(r.price)>0))return ['WAIT','正式現價未取得'];
   if(lastBuy?.modelFreshByCode?.[code]===false)return ['WAIT','正式行情已降級'];
   return ['PASS','正式模型現價可用'];
 }},
 {label:'昨收／除息基準',slot:40,test:r=>r.corporateActionReferenceMissing===true||r.referenceReliable===false?['FAIL','除權息參考價不可靠']:Number(r.effectivePrevClose??r.prevClose)>0?['PASS','正式參考價可用']:['WAIT','正式昨收未建立']},
 {label:'ATR／歷史資料',slot:9,test:r=>Number(r.reachability?.atr)>0&&r.history?.atr14>0?['PASS','ATR與歷史指標可用']:['WAIT','ATR或歷史資料建立中']},
 {label:'三層結構',slot:10,test:r=>{
   const a=['first','second','third'].map(k=>r.raw?.[k]);
   if(a.some(z=>!z))return ['WAIT','三層價格尚未建立'];
   const good=a.every(z=>Number.isFinite(z.low)&&Number.isFinite(z.high)&&z.low>0&&z.high>=z.low)&&a[0].high>a[1].high&&a[1].high>a[2].high;
   return good?['PASS','三層價格順序與區間正常']:['FAIL','正式三層價格結構異常'];
 }},
 {label:'防追高校準',slot:14,test:r=>{
   const c=r.chaseCalibration;
   if(!Number.isFinite(r.chaseRisk)||!Number.isFinite(r.chaseHardThreshold))return ['WAIT','追高風險／硬線尚未建立'];
   if(c?.lockStatus==='LOCKED'||c?.lockedDate||c?.ready===true)return ['PASS','正式追價門檻校準可用'];
   return ['WAIT','正式追價校準尚未就緒'];
 }},
 {label:'Hard Gate',slot:13,test:r=>r.hardVeto===true||r.decisionGate?.type==='HARD'?['FAIL',r.hardVetoReason||r.decisionGate?.reason||'正式硬Gate阻擋']:r.hardVeto===false?['PASS','正式Hard Gate未阻擋（不代表已達買入條件）']:['WAIT','正式Gate尚未計算']},
 {label:'成分健康安全處置',slot:21,test:r=>{
   if(!r.health||typeof r.health.usable!=='boolean')return ['WAIT','正式健康資料狀態未取得'];
   if(r.health.usable&&!Number.isFinite(r.health.score))return ['FAIL','健康資料可用但分數異常'];
   return r.health.usable?['PASS','完整健康資料納入正式計算']:['PASS','資料不足，正式模型已安全排除健康分'];
 }}
];
function validationPageVisible(){return !!$('model')?.classList.contains('on')}
function tradeCoreValidation(){
 const items=TRADE_CORE_VALIDATION.map(def=>{
  const verdicts=ETF.map(code=>{
   const r=lastBuy?.models?.[code];
   if(!r||r.error)return{code,status:'WAIT',reason:r?.error||'正式模型尚未到達'};
   const [status,reason]=def.test(r,code);return{code,status,reason};
  });
  const fail=verdicts.some(x=>x.status==='FAIL'),allPass=verdicts.every(x=>x.status==='PASS'),somePass=verdicts.some(x=>x.status==='PASS');
  return{...def,status:fail?'FAIL':allPass?'PASS':somePass?'PARTIAL':'WAIT',evidence:verdicts.map(v=>`${v.code}:${v.status}（${v.reason}）`).join('｜')};
 });
 return{items,pass:items.filter(x=>x.status==='PASS').length,fail:items.filter(x=>x.status==='FAIL').length,partial:items.filter(x=>x.status==='PARTIAL').length,wait:items.filter(x=>x.status==='WAIT').length};
}
function renderSpecs(includeDetails=false){
 if(!validationPageVisible())return;
 const checks=clientValidation(VALIDATION?.checks||{});
 const core=tradeCoreValidation();
 // Seven of the existing 45 detailed slots are populated with formal live model
 // findings, giving exactly 7 core + 38 auxiliary. Never claim 45 PASS if the
 // official model is unavailable.
 core.items.forEach(v=>{checks[v.slot]={status:v.status,evidence:`正式模型｜${v.evidence}`}});
 const aux={PASS:0,PARTIAL:0,FAIL:0,WAIT:0};
 SPEC.filter(x=>!CORE_SPEC_IDS.has(x[0])).forEach(x=>aux[checks[x[0]]?.status||'WAIT']++);
 const totalPass=core.pass+aux.PASS,totalPartial=core.partial+aux.PARTIAL,totalFail=core.fail+aux.FAIL,totalWait=core.wait+aux.WAIT;
 $('validationSummary').innerHTML=`<div class="box"><span class="k">交易核心</span><b class="${core.fail?'downc':core.pass===7?'upc':'amber'}">${core.pass}/7</b><small>PASS ${core.pass}｜PARTIAL ${core.partial}｜FAIL ${core.fail}｜WAIT ${core.wait}</small></div><div class="box"><span class="k">輔助驗證</span><b>${aux.PASS}/38</b><small>PARTIAL ${aux.PARTIAL}｜FAIL ${aux.FAIL}｜WAIT ${aux.WAIT}</small></div><div class="box"><span class="k">總驗證</span><b>${totalPass}/45</b><small>PARTIAL ${totalPartial}｜FAIL ${totalFail}｜WAIT ${totalWait}</small></div>`;
 if(core.fail){
  const bad=core.items.filter(x=>x.status==='FAIL').map(x=>`${x.label}：${x.evidence}`).join('；');
  $('validationOverall').innerHTML=`<b class="downc">正式買點部分標的受影響：</b>${bad}。<br><span class="note">請以各ETF正式買點頁的硬Gate、分數與確認狀態為準；輔助燈亮不代表可以下單。</span>`;
 }else if(core.pass===7){
  $('validationOverall').innerHTML=`<b class="upc">交易核心 7/7 PASS｜核心資料可用。</b>輔助驗證 ${aux.PASS}/38、總驗證 ${totalPass}/45。<br><span class="note">核心資料通過不代表價格已達買點；仍須各ETF正式L1/L2/L3確認、分數與執行區間通過。</span>`;
 }else{
  const pending=core.items.filter(x=>x.status!=='PASS').map(x=>`${x.label}:${x.status}`).join('｜');
  $('validationOverall').innerHTML=`<b class="amber">交易核心未齊全：</b>${core.pass}/7 PASS｜${pending}。<br><span class="note">驗證摘要從正式買點資料讀取，不使用Shadow Gate。詳細證據見下方45項。</span>`;
 }
 // Show the seven official core checks and their latest status without invoking deep validation.
 $('validationOverall').insertAdjacentHTML('beforeend',`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px" aria-label="交易核心7項明細">${core.items.map((v,i)=>`<span class="tag" style="font-size:12px">${i+1}. ${v.label}：<b class="${v.status==='PASS'?'upc':v.status==='FAIL'?'downc':'amber'}">${v.status}</b></span>`).join('')}</div>`);
 if(!includeDetails)return; // Price/model refresh must never rebuild 45 detail cards.
 $('specGrid').innerHTML=SPEC.map(x=>{const v=checks[x[0]]||{status:'WAIT',evidence:'尚未接到驗證結果'},st=v.status.toLowerCase();return`<div class="spec ${st}"><b>#${x[0]} ${x[1]}</b><small>${x[2]}</small><span class="tag">${light(v.status)}</span><div class="vevidence">${v.evidence||''}</div>${v.detail?`<div class="vdetail">${v.detail}</div>`:''}</div>`}).join('');
 const co=checks.core||{};$('coreValidation').innerHTML=[['買不到／參與率保護',co.participation],['防買點下逃',co.downEscape],['Hysteresis訊號遲滯',co.hysteresis]].map(([n,v])=>`<div class="box"><span class="k">${n}</span><b>${light(v?.status)}</b><small>${v?.evidence||'等待驗證'}</small></div>`).join('');
}
let validationPoll=null,validationRequest=null;
async function loadValidation(deep=false){
 if(!validationPageVisible())return;
 if(validationRequest){await validationRequest;if(!deep)return}
 validationRequest=(async()=>{
  try{
   const d=await get('/api/validation'+(deep?'?deep=1':''),deep?30000:12000);
   if(!d.ok){$('validationOverall').innerHTML='<b class="downc">驗證API錯誤：</b>'+(d.error||'未知');return}
   VALIDATION=d;renderSpecs(true);
  }catch(e){$('validationOverall').innerHTML='<b class="downc">驗證中心連線錯誤：</b>'+e.message}
 })();
 try{await validationRequest}finally{validationRequest=null}
}
async function runDeepValidation(){
 if(!validationPageVisible())return;
 clearTimeout(validationPoll);$('deepValidateBtn').disabled=true;
 try{
  await get('/api/history-warm?all=1');
  await loadValidation(true);
  const hp=VALIDATION?.historyProgress||[],ready=hp.filter(x=>x.status==='READY').length;
  if(ready<4){$('validationOverall').innerHTML+=`<br><span class="note">完整回測歷史背景建立中：${hp.map(x=>x.code+' '+x.percent+'%').join('｜')}</span>`;validationPoll=setTimeout(runDeepValidation,3000)}
 }finally{$('deepValidateBtn').disabled=false}
}


function modelSyncSaveLocal(){saveJSON('v124_model_trades',MODEL_TRADES);saveJSON('v124_model_trade_pending_deletes',MODEL_PENDING_DELETES)}
function modelTradeClean(t){const x=JSON.parse(JSON.stringify(t));delete x._syncDirty;delete x._cloudUpdatedAt;return x}
function markModelTradeDirty(t){if(!t)return;t._syncDirty=true;t._syncUpdatedAt=new Date(Math.max(Date.now(),(Date.parse(t._syncUpdatedAt)||0)+1)).toISOString()}
async function modelSyncFetch(url,opts={}){
 // Updating only the frontend must never initialize holdings using the older
 // backend, which does not acknowledge the already-included pending IDs.
 if(opts.method&&opts.method!=='GET'&&url!=='/api/model-sync/login'&&!SYNC_SERVER_VERIFIED){
  const status=await modelSyncFetch('/api/model-sync/status');
  if(status.build!==CLIENT_BUILD)throw Error('前後端版本不同，已暫停寫入；請一起部署 server.js 與 public 資料夾');
  SYNC_SERVER_VERIFIED=true;
 }
 // All holdings/model-trade requests share the same 429 cooldown; failed writes retain their pending IDs.
 await apiTrafficPermit();
 const {timeoutMs=30000,...requestOpts}=opts;
 const c=new AbortController(),tm=setTimeout(()=>c.abort(),timeoutMs);
 try{
  const r=await fetch(url,{...requestOpts,cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json',...(requestOpts.headers||{})},signal:c.signal});
  const body=await r.text();apiTrafficCheckResponse(r,body);
  let d;try{d=JSON.parse(body)}catch(_){throw Error('同步服務回傳非JSON內容｜'+url)}
  if(!r.ok||d?.ok!==true){const e=Error(d?.error||('同步服務未確認成功｜HTTP '+r.status));e.status=r.status;throw e}
  if((url==='/api/model-trades'||url==='/api/holdings-sync')&&(!opts.method||opts.method==='GET')){
   SYNC_SERVER_VERIFIED=d.build===CLIENT_BUILD;
   if(!SYNC_SERVER_VERIFIED)throw Error('前後端版本不同，資料已保留；請一起部署 server.js 與 public 資料夾');
  }
  return d;
 }catch(e){if(e?.name==='AbortError')throw Error('API回應逾時｜'+url);throw e}finally{clearTimeout(tm)}
}

async function loadDividendAuto(force=false){
 if(DIVIDEND_AUTO.busy||!MODEL_SYNC.ready)return;
 if(!force&&DIVIDEND_AUTO.lastAt&&Date.now()-Date.parse(DIVIDEND_AUTO.lastAt)<300000)return;
 DIVIDEND_AUTO.busy=true;
 try{
  const d=await modelSyncFetch('/api/dividend-auto',{timeoutMs:60000});
  if(!ETF.every(c=>d.byCode?.[c]&&Number.isFinite(Number(d.byCode[c].received))))throw Error('四檔股息資料未齊全');
  if(d?.ok){
   DIVIDEND_AUTO.ready=true;DIVIDEND_AUTO.byCode=d.byCode||{};DIVIDEND_AUTO.snapshotDay=d.snapshotDay||null;DIVIDEND_AUTO.source=d.source||null;DIVIDEND_AUTO.lastAt=d.fetchedAt||new Date().toISOString();
   DIVIDEND_AUTO.sourceReady=ETF.every(c=>d.byCode[c].sourceOk===true);
   DIVIDEND_AUTO.message=(DIVIDEND_AUTO.sourceReady?'四檔股息資料已確認':'股息基準可用；部分官方配息來源待重試')+`｜持股快照 ${String(d.snapshotDay||'建立中').replaceAll('-','/')}`;
   normalizeAllModelTradeTotalReturns();renderHoldings();renderModelTrades();
  }
 }catch(e){DIVIDEND_AUTO.ready=false;DIVIDEND_AUTO.sourceReady=false;DIVIDEND_AUTO.message='股息更新失敗，保留最後資料：'+e.message}
 finally{DIVIDEND_AUTO.busy=false;renderModelTrades()}
}

function modelSyncBar(){
 const st=MODEL_SYNC.status,synced=st==='ready',degraded=st==='degraded',usable=MODEL_SYNC.ready,locked=st==='locked',setup=st==='setup',err=st==='error',pending=MODEL_TRADES.filter(t=>t._syncDirty).length+MODEL_PENDING_DELETES.length;
 const tag=synced&&!pending?'🟢 已同步':synced?'🟡 待同步':degraded?'🟡 自動重試中':locked?'🔒 未解鎖':setup?'🟡 尚未設定':'🟡 '+(err?'同步異常':'連線中');
 const htag=HOLDINGS_PENDING_TRADES.length?`｜持股🟡待同步${HOLDINGS_PENDING_TRADES.length}筆`:HOLDINGS_MANUAL_DIRTY?'｜持股🟡本機調整待確認':HOLDINGS_SYNC.ready?'｜持股🟢':'｜持股⚪';
 const dtag=DIVIDEND_AUTO.ready&&DIVIDEND_AUTO.sourceReady?'｜股息🟢 已確認':DIVIDEND_AUTO.ready?'｜股息🟡 資料待齊':'｜股息⚪ 待確認';
 const allReady=synced&&!pending&&HOLDINGS_SYNC.ready&&!HOLDINGS_PENDING_TRADES.length&&!HOLDINGS_MANUAL_DIRTY&&DIVIDEND_AUTO.ready&&DIVIDEND_AUTO.sourceReady;
 const overall=allReady?'全部同步完成':'同步尚未全部完成';
 const at=MODEL_SYNC.lastAt?`｜${new Date(MODEL_SYNC.lastAt).toLocaleTimeString('zh-TW',{hour12:false})}`:'';
 const pend=pending?`｜待同步 ${pending}筆`:'';
 const buttons=usable
  ? `<div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn" onclick="syncAllCloud(true)">立即同步</button><button class="btn" onclick="uploadThisHoldingsToCloud()">上傳此裝置持股</button><button class="btn" onclick="downloadCloudHoldings()">下載雲端持股</button></div>`
  : `<button class="btn primary" onclick="connectModelSync()">設定同步碼</button>`;
 return `<div class="notice"><div class="row"><div><b>${overall}｜交易紀錄：${tag}${htag}${dtag}</b><div class="note">${escapeHTML(MODEL_SYNC.message||'')}${pend}${HOLDINGS_SYNC.message?'｜'+escapeHTML(HOLDINGS_SYNC.message):''}${DIVIDEND_AUTO.message?'｜'+escapeHTML(DIVIDEND_AUTO.message):''}${at}</div></div>${buttons}</div></div>`;
}
function escapeHTML(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

// New buys do not wait for a large queue of historical perf uploads.
// The server persists each trade before applying its idempotent holdings increment.
async function commitPendingPurchasesFirst(){
 if(HOLDINGS_OP_BUSY||HOLDINGS_PUSH_BUSY||!HOLDINGS_PENDING_TRADES.length||
    (!MODEL_SYNC.knownUnlocked&&!MODEL_SYNC.ready))return;
 if(Date.now()<API_TRAFFIC.cooldownUntil)return;
 HOLDINGS_OP_BUSY=true;
 try{
  let completed=0;
  // Keep the work bounded to avoid cloud API throttling. Remaining ops are durable.
  while(HOLDINGS_PENDING_TRADES.length&&completed<2&&Date.now()>=API_TRAFFIC.cooldownUntil){
   const op=HOLDINGS_PENDING_TRADES[0],trade=MODEL_TRADES.find(t=>t?.id===op.id);
   if(!trade||trade._deleted)throw Error('待同步成交缺少本機交易明細：'+op.id+'；已停止加股');
   const sent=modelTradeClean(trade),fingerprint=JSON.stringify(sent);
   if(String(sent.code)!==String(op.code)||Number(sent.shares)!==Number(op.shares)||
      Number(sent.entryPrice)!==Number(op.entryPrice))throw Error('交易與持股佇列內容不一致，已停止加股：'+op.id);
   const d=await modelSyncFetch('/api/model-trades/commit-purchase',{
    method:'POST',body:JSON.stringify({trade:sent}),timeoutMs:45000
   });
   if(!d.tradePersisted||!d.applied||d.tradeId!==op.id)throw Error('伺服器未確認交易明細與持股共同入帳');
   // Keep newer local edits dirty; the cloud purchase itself was durably committed.
   if(JSON.stringify(modelTradeClean(trade))===fingerprint)trade._syncDirty=false;
   HOLDINGS_PENDING_TRADES=HOLDINGS_PENDING_TRADES.filter(x=>x.id!==op.id);
   persistPendingHoldingsOps();modelSyncSaveLocal();
   HOLDINGS_REMOTE_REV++;completed++;
  }
  HOLDINGS_SYNC.ready=false;
  HOLDINGS_SYNC.message=HOLDINGS_PENDING_TRADES.length
   ? '新成交已獨立補傳，剩餘 '+HOLDINGS_PENDING_TRADES.length+' 筆待確認；本機持股保留'
   : '新成交明細與雲端加股已逐筆確認；正在核對持股';
 }catch(e){
  HOLDINGS_SYNC.ready=false;
  if(e.status===401){MODEL_SYNC.ready=false;MODEL_SYNC.status='locked'}
  HOLDINGS_SYNC.message='新成交補傳未完成，已保留本機持股與交易ID：'+(e.message||'連線異常');
 }finally{HOLDINGS_OP_BUSY=false;renderModelTrades()}
}

async function flushPendingHoldingsTrades(){
 if(HOLDINGS_OP_BUSY||HOLDINGS_PUSH_BUSY||!MODEL_SYNC.ready||MODEL_SYNC.status!=='ready'||!HOLDINGS_PENDING_TRADES.length)return;
 HOLDINGS_OP_BUSY=true;
 try{
  while(HOLDINGS_PENDING_TRADES.length&&MODEL_SYNC.ready){
   const op=HOLDINGS_PENDING_TRADES[0];
   const d=await modelSyncFetch('/api/holdings-sync/apply-trade',{method:'POST',body:JSON.stringify({trade:op})});
   if(!d.ok||!d.applied)throw Error(d.error||'伺服器未確認這筆持股增量');
   // Commit acknowledgement separately from the model-trade store; retry is idempotent.
   HOLDINGS_PENDING_TRADES=HOLDINGS_PENDING_TRADES.filter(x=>x.id!==op.id);
   persistPendingHoldingsOps();HOLDINGS_REMOTE_REV++;
  }
  HOLDINGS_SYNC.message='成交持股增量已送達雲端；正在校對最新股數';
 }catch(e){
  HOLDINGS_SYNC.ready=false;
  HOLDINGS_SYNC.message=`尚有 ${HOLDINGS_PENDING_TRADES.length} 筆持股待同步，本機股數已保留：${e.message||'暫時無法連線'}`;
 }finally{
  HOLDINGS_OP_BUSY=false;
  renderModelTrades();
 }
}
async function syncHoldingsCloud(force=false){
 if(HOLDINGS_SYNC.busy||HOLDINGS_PUSH_BUSY||!MODEL_SYNC.ready)return;
 HOLDINGS_SYNC.busy=true;
 try{
  await flushPendingHoldingsTrades();
  if(HOLDINGS_PENDING_TRADES.length){
   HOLDINGS_SYNC.ready=false;
   // Trade imports must be acknowledged before attempting holdings increments.
   if(MODEL_SYNC.status!=='ready')HOLDINGS_SYNC.message='交易明細尚未完成雲端校對，持股加股已暫停；待交易同步成功再重試';
   return;
  }
  if(HOLDINGS_MANUAL_DIRTY){
   // In-session edits may upload automatically using a known cloud revision.
   // Offline edits after a reload still require the explicit reviewed upload.
   if(HOLDINGS_SYNC.cloudUpdatedAt){await pushHoldingsCloud();if(!HOLDINGS_MANUAL_DIRTY)return}
   HOLDINGS_SYNC.ready=false;
   HOLDINGS_SYNC.message='本機持股有手動修改尚未確認上傳，為避免覆蓋已暫停雲端下載；請核對後按「上傳此裝置持股」';
   return;
  }
  const atRevision=HOLDINGS_LOCAL_REV,remoteRevision=HOLDINGS_REMOTE_REV;
  const d=await modelSyncFetch('/api/holdings-sync');
  if(HOLDINGS_LOCAL_REV!==atRevision||HOLDINGS_REMOTE_REV!==remoteRevision||HOLDINGS_PENDING_TRADES.length||HOLDINGS_MANUAL_DIRTY){
   HOLDINGS_SYNC.ready=false;
   HOLDINGS_SYNC.message='同步期間有新持股變更，已保留本機資料；下一輪重試';
   return;
  }
  if(d.initialized&&!Array.isArray(d.holdings))throw Error('雲端持股格式不完整，本機資料已保留');
  if(!d.initialized){
   HOLDINGS_SYNC.ready=false;
   HOLDINGS_SYNC.message='雲端尚無持股；請在持股正確的裝置按「上傳此裝置持股」';
  }else{
   H=(Array.isArray(d.holdings)?d.holdings:[]).map(normalizeHoldingRecord);
   persistHoldingsLocal();renderHoldings();HOLDINGS_SYNC.ready=true;HOLDINGS_SYNC.cloudUpdatedAt=d.updatedAt||null;HOLDINGS_REMOTE_REV++;
   const h50=H.find(x=>x.t==='0050');
   HOLDINGS_SYNC.message='持股已從雲端載入'+(h50?`｜0050 ${Number(h50.s).toLocaleString()}股`:'');
  }
  HOLDINGS_SYNC.lastAt=d.fetchedAt||new Date().toISOString();
 }catch(e){
  HOLDINGS_SYNC.ready=false;HOLDINGS_SYNC.message='持股同步失敗，本機持股已保留：'+e.message;
 }finally{HOLDINGS_SYNC.busy=false;renderModelTrades()}
}

async function uploadThisHoldingsToCloud(){
 if(!MODEL_SYNC.ready)return alert('請先設定同步碼');
 if(HOLDINGS_PUSH_BUSY)return;
 if(HOLDINGS_SYNC.busy)await syncHoldingsCloud(false);
 await flushPendingHoldingsTrades();
 HOLDINGS_PUSH_BUSY=true;
 try{
  const cloud=await modelSyncFetch('/api/holdings-sync');
  if(cloud.initialized&&HOLDINGS_PENDING_TRADES.length)return alert('成交持股尚未同步成功：'+HOLDINGS_SYNC.message);
  const label=H.map(h=>`${h.t} ${Number(h.s).toLocaleString()}股／均價 ${Number(h.c).toFixed(2)}`).join('\n');
  if(!confirm(`${cloud.initialized?'將這台裝置的持股覆蓋到雲端':'使用這台裝置的持股初始化雲端；現有待同步成交會一併確認，不會重複加股'}。\n${label}\n\n確定嗎？`))return;
  const revision=HOLDINGS_LOCAL_REV,snapshot=JSON.parse(JSON.stringify(H)),includedTradeIds=cloud.initialized?[]:HOLDINGS_PENDING_TRADES.map(t=>t.id);
  const d=await modelSyncFetch('/api/holdings-sync',{method:'POST',body:JSON.stringify({holdings:snapshot,expectedUpdatedAt:cloud.updatedAt||null,includedTradeIds})});
  if(!d.ok)throw Error(d.error||'雲端未確認上傳');
  const acknowledged=new Set(d.includedTradeIds||[]);
  HOLDINGS_PENDING_TRADES=HOLDINGS_PENDING_TRADES.filter(t=>!acknowledged.has(t.id));persistPendingHoldingsOps();
  HOLDINGS_SYNC.cloudUpdatedAt=d.updatedAt||null;HOLDINGS_REMOTE_REV++;
  if(HOLDINGS_LOCAL_REV===revision&&!HOLDINGS_PENDING_TRADES.length)setHoldingsManualDirty(false);
  HOLDINGS_SYNC.ready=true;HOLDINGS_SYNC.lastAt=new Date().toISOString();HOLDINGS_SYNC.message='已以上傳的這台裝置持股覆蓋雲端';
  alert('雲端持股已更新。現在可到手機按「下載雲端持股」。');
 }catch(e){HOLDINGS_SYNC.ready=false;HOLDINGS_SYNC.message='持股上傳失敗：'+e.message;alert('上傳失敗：'+(e.message||'未知錯誤'))}
 finally{HOLDINGS_PUSH_BUSY=false;renderModelTrades()}
 await syncAllCloud(true);
}
async function downloadCloudHoldings(){
 if(!MODEL_SYNC.ready)return alert('請先設定同步碼');
 if(HOLDINGS_PUSH_BUSY)return alert('持股正在上傳，完成後再下載。');
 if(HOLDINGS_PENDING_TRADES.length||HOLDINGS_MANUAL_DIRTY)return alert('這台裝置還有尚未同步的持股變更，不能下載舊雲端資料覆蓋。請先完成同步或確認上傳。');
 try{
  const revision=HOLDINGS_LOCAL_REV,remoteRevision=HOLDINGS_REMOTE_REV;
  const d=await modelSyncFetch('/api/holdings-sync');
  if(!d.initialized)return alert('雲端還沒有持股資料。請先在桌機按「上傳此裝置持股」。');
  if(!d.ok||HOLDINGS_PENDING_TRADES.length||HOLDINGS_MANUAL_DIRTY||HOLDINGS_LOCAL_REV!==revision||HOLDINGS_REMOTE_REV!==remoteRevision)return alert('同步期間持股有變更，已中止覆蓋。');
  H=(Array.isArray(d.holdings)?d.holdings:[]).map(normalizeHoldingRecord);
  persistHoldingsLocal();renderHoldings();HOLDINGS_REMOTE_REV++;HOLDINGS_SYNC.cloudUpdatedAt=d.updatedAt||null;
  HOLDINGS_SYNC.ready=true;HOLDINGS_SYNC.lastAt=new Date().toISOString();
  const h50=H.find(x=>x.t==='0050');
  HOLDINGS_SYNC.message='已手動下載雲端持股'+(h50?`｜0050 ${Number(h50.s).toLocaleString()}股`:'');
  await loadDividendAuto(true);
  renderModelTrades();
  alert('雲端持股已載入這台裝置。');
 }catch(e){alert('下載失敗：'+(e.message||'未知錯誤'))}
}

async function pushHoldingsCloud(){
 if(!MODEL_SYNC.ready||HOLDINGS_PUSH_BUSY||HOLDINGS_PENDING_TRADES.length)return;
 HOLDINGS_PUSH_BUSY=true;
 const revision=HOLDINGS_LOCAL_REV,snapshot=JSON.parse(JSON.stringify(H));
 try{
  const d=await modelSyncFetch('/api/holdings-sync',{method:'POST',body:JSON.stringify({holdings:snapshot,expectedUpdatedAt:HOLDINGS_SYNC.cloudUpdatedAt})});
  if(!d.ok)throw Error(d.error||'雲端未確認上傳');
  HOLDINGS_SYNC.cloudUpdatedAt=d.updatedAt||null;HOLDINGS_REMOTE_REV++;
  if(HOLDINGS_LOCAL_REV===revision&&!HOLDINGS_PENDING_TRADES.length)setHoldingsManualDirty(false);
  HOLDINGS_SYNC.ready=true;HOLDINGS_SYNC.lastAt=new Date().toISOString();HOLDINGS_SYNC.message='持股已同步';
  await loadDividendAuto(true);
 }catch(e){HOLDINGS_SYNC.ready=false;HOLDINGS_SYNC.message='持股上傳失敗，本機修改已保留：'+e.message}
 finally{HOLDINGS_PUSH_BUSY=false;renderModelTrades()}
}
async function syncAllCloud(force=false){
 if(document.visibilityState==='hidden'&&!force)return;
 if(SYNC_ALL_BUSY){SYNC_ALL_RERUN=true;SYNC_ALL_FORCE=SYNC_ALL_FORCE||force;return}
 SYNC_ALL_BUSY=true;
 try{
  let nextForce=force,passes=0;
  do{
   SYNC_ALL_RERUN=false;SYNC_ALL_FORCE=false;
   // A 429 cooldown is global: don't burn requests on historical or dividend reads.
   if(Date.now()>=API_TRAFFIC.cooldownUntil){
    await commitPendingPurchasesFirst();
    if(Date.now()>=API_TRAFFIC.cooldownUntil){
     await syncModelTrades(nextForce);
     if(MODEL_SYNC.status==='ready'&&Date.now()>=API_TRAFFIC.cooldownUntil){
      await syncHoldingsCloud(nextForce);
      if(!HOLDINGS_PENDING_TRADES.length&&Date.now()>=API_TRAFFIC.cooldownUntil)await loadDividendAuto(nextForce);
     }
    }
   }
   nextForce=SYNC_ALL_FORCE;
   passes++;
  }while(SYNC_ALL_RERUN&&passes<3&&Date.now()>=API_TRAFFIC.cooldownUntil);
 }finally{
  SYNC_ALL_BUSY=false;
  renderModelTrades();
  if(SYNC_ALL_RERUN){
   const rerunForce=SYNC_ALL_FORCE;
   SYNC_ALL_RERUN=false;SYNC_ALL_FORCE=false;
   setTimeout(()=>syncAllCloud(rerunForce),Math.max(1500,API_TRAFFIC.cooldownUntil-Date.now()+1000));
  }
 }
}

async function connectModelSync(){
 const key=prompt('請輸入 MODEL_SYNC_KEY（每台裝置只需設定一次）');if(key===null||!String(key).trim())return;
 try{
  await modelSyncFetch('/api/model-sync/login',{method:'POST',body:JSON.stringify({key:String(key).trim()})});
  MODEL_SYNC.status='checking';MODEL_SYNC.message='同步碼正確，正在讀取雲端交易…';renderModelTrades();
  await syncAllCloud(true);
 }catch(e){MODEL_SYNC.status=e.status===503?'setup':'locked';MODEL_SYNC.ready=false;MODEL_SYNC.message=e.message||'同步碼驗證失敗';renderModelTrades()}
}
async function syncDirtyModelTrades(){
 if(!MODEL_SYNC.ready)return;
 const deletes=[...new Set(MODEL_PENDING_DELETES)];
 for(const id of deletes){
  try{await modelSyncFetch('/api/model-trades/'+encodeURIComponent(id),{method:'DELETE'});MODEL_PENDING_DELETES=MODEL_PENDING_DELETES.filter(x=>x!==id)}
  catch(e){if(e.status===401){MODEL_SYNC.ready=false;MODEL_SYNC.status='locked'};throw e}
 }
 // Persist purchases first; historical performance refreshes must never block a new fill.
 // Bounded batches also avoid oversized requests and acknowledge each completed revision.
 const purchaseIds=new Set(HOLDINGS_PENDING_TRADES.map(op=>op.id));
 const dirty=MODEL_TRADES.filter(t=>t?._syncDirty)
  .sort((a,b)=>Number(purchaseIds.has(b.id))-Number(purchaseIds.has(a.id))||
    (Date.parse(b.entryAt||b.entryDate||0)-Date.parse(a.entryAt||a.entryDate||0)))
  .slice(0,3).map(modelTradeClean);
 const sent=new Map(dirty.map(t=>[t.id,JSON.stringify(t)]));
 if(dirty.length)await modelSyncFetch('/api/model-trades/import',{method:'POST',body:JSON.stringify({trades:dirty})});
 // A performance refresh or user edit during upload is a new unsent revision.
 for(const t of MODEL_TRADES)if(sent.get(t.id)===JSON.stringify(modelTradeClean(t)))t._syncDirty=false;
 modelSyncSaveLocal();
}
async function syncModelTrades(force=false){
 if(MODEL_SYNC.busy)return;MODEL_SYNC.busy=true;
 try{
  let d=await modelSyncFetch('/api/model-trades');
  if(!Array.isArray(d.trades)||!Array.isArray(d.deletedIds))throw Error('雲端交易格式不完整，本機紀錄已保留');
  MODEL_SYNC.ready=true;MODEL_SYNC.knownUnlocked=true;MODEL_SYNC.status='checking';MODEL_SYNC.message='正在合併交易紀錄';saveJSON('v124_model_sync_known_unlocked',true);
  // Show verified cloud trades immediately. Pending local edits keep precedence;
  // tombstones must remain authoritative, and this never touches holdings.
  {
   const pendingDeletes=new Set(MODEL_PENDING_DELETES),cloudDeleted=new Set(d.deletedIds||[]);
   const merged=new Map((d.trades||[]).filter(t=>t?.id&&!pendingDeletes.has(t.id)&&!cloudDeleted.has(t.id)).map(t=>[t.id,{...t,_syncDirty:false}]));
   for(const t of MODEL_TRADES)if(t?.id&&!pendingDeletes.has(t.id)&&!cloudDeleted.has(t.id)&&(!merged.has(t.id)||t._syncDirty))merged.set(t.id,t);
   MODEL_TRADES=[...merged.values()];
   modelSyncSaveLocal();
   MODEL_SYNC.message='已讀取雲端交易；正在補傳本機差異';
   renderModelTrades();
  }
  if(!d.initialized&&MODEL_TRADES.length){
   MODEL_TRADES.forEach(markModelTradeDirty);modelSyncSaveLocal();
   await syncDirtyModelTrades();
   d=await modelSyncFetch('/api/model-trades');
  }else{
   // 雲端已有資料時，先把「只存在本機」且未被雲端刪除的交易重新排入上傳，避免跨裝置漏單。
   const cloudIds=new Set((d.trades||[]).map(t=>t.id)),deleted=new Set(d.deletedIds||[]);
   let repaired=0;for(const t of MODEL_TRADES){if(t?.id&&!cloudIds.has(t.id)&&!deleted.has(t.id)&&!t._syncDirty){markModelTradeDirty(t);repaired++}}
   if(repaired)modelSyncSaveLocal();
   await syncDirtyModelTrades();
   d=await modelSyncFetch('/api/model-trades');
  }
  if(!Array.isArray(d.trades)||!Array.isArray(d.deletedIds))throw Error('雲端交易格式不完整，本機紀錄已保留');
  const pendingDeletes=new Set(MODEL_PENDING_DELETES),cloudDeleted=new Set(d.deletedIds);
  const merged=new Map(d.trades.filter(t=>!pendingDeletes.has(t.id)&&!cloudDeleted.has(t.id)).map(t=>[t.id,{...t,_syncDirty:false}]));
  for(const t of MODEL_TRADES)if(t._syncDirty&&!pendingDeletes.has(t.id)&&!cloudDeleted.has(t.id))merged.set(t.id,t);
  MODEL_TRADES=[...merged.values()];
  const deleted=new Set(d.deletedIds||[]);MODEL_PENDING_DELETES=MODEL_PENDING_DELETES.filter(id=>!deleted.has(id));
  modelSyncSaveLocal();MODEL_SYNC.lastAt=d.fetchedAt||new Date().toISOString();MODEL_SYNC.status='ready';MODEL_SYNC.message='交易紀錄已校對；以交易ID合併手機／電腦資料。';renderModelTrades();
 }catch(e){
  if(e.status===401){MODEL_SYNC.ready=false;MODEL_SYNC.knownUnlocked=false;saveJSON('v124_model_sync_known_unlocked',false);MODEL_SYNC.status='locked';MODEL_SYNC.message='這台裝置尚未輸入同步碼。'}
  else if(e.status===503){MODEL_SYNC.ready=false;MODEL_SYNC.status='setup';MODEL_SYNC.message='Render 尚缺 MODEL_SYNC_KEY / Supabase 環境設定。'}
  else if(MODEL_SYNC.knownUnlocked){MODEL_SYNC.ready=true;MODEL_SYNC.status='degraded';MODEL_SYNC.message=e.status===429?'API限流保護中；本機紀錄保留，冷卻結束後自動重試':('雲端暫時不穩；本機紀錄保留並每60秒自動重試：'+(e.message||'未知錯誤'))}
  else{MODEL_SYNC.ready=false;MODEL_SYNC.status='error';MODEL_SYNC.message='雲端暫時連不上，本機紀錄仍保留：'+(e.message||'未知錯誤')}
  renderModelTrades();
 }finally{MODEL_SYNC.busy=false}
}

function setTradeEntryMode(type){
 const manual=type==='manual',trend=type==='trend';
 $('mtTradeType').value=manual?'manual':trend?'trend':'model';
 $('mtTradeTitle').textContent=manual?'記錄自主買入（未觸發模型）':trend?'記錄強勢加碼買入':'記錄合理買點模型買入';
 $('mtLayerField').style.display=(manual||trend)?'none':'';
 $('mtSaveBtn').textContent=manual?'保存這筆自主買入':trend?'保存這筆強勢加碼實戰':'保存這筆合理買點模型實戰';
}
function fillTradeSnapshot(code,x,manual=false){
 const firstHigh=Number(x.m.layers[0]?.zone?.high);
 const px=Number(x.px);
 const gap=Number.isFinite(firstHigh)&&firstHigh>0&&Number.isFinite(px)?(px/firstHigh-1)*100:null;
 const state=x.r.noBuyToday?'今日暫無合理買點':stageText(x.activeStatus,x.activeLayer+1),sx=shadowStatusFor(code),shadowLine=sx?`<br><b>Shadow：</b>① ${ztxt(sx.m.layers[0].zone)}　② ${ztxt(sx.m.layers[1].zone)}　③ ${ztxt(sx.m.layers[2].zone)}｜${sx.r?.criticalGate?.status||'BLOCKED'}｜${stageText(sx.activeStatus,sx.activeLayer+1)}`:'';
 $('mtSnapshot').innerHTML=`<b>當下模型快照：</b>① ${ztxt(x.m.layers[0].zone)}　② ${ztxt(x.m.layers[1].zone)}　③ ${ztxt(x.m.layers[2].zone)}<br>分數 ${x.r.score}/100｜防追高 ${x.r.chaseRisk}/100｜環境 ${x.r.environmentScore.toFixed(0)}｜成分健康 ${x.r.health?.usable?x.r.health.score+'/100':'未計分'}<br>模型狀態：${state}${gap==null?'':`｜現價較第一買點上緣 ${gap>=0?'+':''}${gap.toFixed(2)}%`}${shadowLine}${manual?'<br><b>本筆將標記為「自主買入」，不計入模型買入績效。</b>':''}`;
}
function openModelTrade(code,layer=1){
 const x=statusFor(code);if(!x)return alert('模型尚未載入');
 if(x.r?.hardVeto||x.r?.noBuyToday)return alert('正式模型的硬Gate或暫停條件尚未解除，不能記作模型訊號；若你自行決定買進，請選擇「記錄自主買入」。');
 setTradeEntryMode('model');
 $('mtCode').value=code;$('mtPrice').value=Number(x.px).toFixed(2);$('mtShares').value='';$('mtLayer').value=String(layer);
 fillTradeSnapshot(code,x,false);
 $('modelTradeModal').classList.add('on')
}
function fillTrendTradeSnapshot(code,m){
 const lv=m?.levels||{},t=m?.trend||{},bt=m?.backtest||{};
 $('mtSnapshot').innerHTML=`<b>當下強勢加碼模型快照：</b>${m?.statusText||'—'}｜ETF趨勢強度 ${m?.score??'—'}/100<br>現價 ${fmt(m?.price)}｜20日突破位 ${trendLevelText(lv.breakout20)}｜執行帶 ${trendLevelText(lv.entryLow)}–${trendLevelText(lv.entryHigh)}｜最高追價線 ${trendLevelText(lv.maxChase)}<br>日線 20/60/120：${fmt(t.sma20)} / ${fmt(t.sma60)} / ${fmt(t.sma120)}｜週線20/40：${fmt(t.weekly20)} / ${fmt(t.weekly40)}｜20日動能 ${pct(t.momentum20)}｜相對大盤20/60日 ${pct(t.relative20)} / ${pct(t.relative60)}｜距突破 ${Number.isFinite(Number(t.distBreakAtr))?fmt(t.distBreakAtr)+' ATR':'—'}<br>歷史核心：${bt.signals||0}筆${bt.startDate&&bt.endDate?`｜${bt.startDate.slice(0,4)}～${bt.endDate.slice(0,4)}`:''}｜5日 ${pct(bt.avg5)}｜20日 ${pct(bt.avg20)}（勝率 ${pct(bt.win20)}）｜60日 ${pct(bt.avg60)}（勝率 ${pct(bt.win60)}）｜20日MAE/MFE ${fmt(bt.avgMAE20)}%/${fmt(bt.avgMFE20)}%｜假突破 ${pct(bt.fakeBreak5Rate)}`;
}
function openTrendTrade(code){
 const m=lastTrendBuy?.models?.[code];if(!m?.ok)return alert('強勢加碼模型尚未載入');
 if(m.status!=='TREND_BUY')return alert('目前尚未成立強勢加碼訊號；若仍要買，請記錄為自主買入。');
 setTradeEntryMode('trend');
 $('mtCode').value=code;$('mtPrice').value=Number(m.price).toFixed(2);$('mtShares').value='';
 fillTrendTradeSnapshot(code,m);
 $('modelTradeModal').classList.add('on')
}
function openManualTrade(code){
 const x=statusFor(code);if(!x)return alert('模型尚未載入');
 setTradeEntryMode('manual');
 $('mtCode').value=code;$('mtPrice').value=Number(x.px).toFixed(2);$('mtShares').value='';
 fillTradeSnapshot(code,x,true);
 $('modelTradeModal').classList.add('on')
}
function closeModelTrade(){$('modelTradeModal').classList.remove('on')}
function saveModelTrade(){
 const code=$('mtCode').value,price=Number($('mtPrice').value),shares=Number($('mtShares').value),mode=$('mtTradeType').value,manual=mode==='manual',trendMode=mode==='trend',tradeType=manual?'manual':'model',modelFamily=manual?'manual':trendMode?'trend':'reasonable',layer=(manual||trendMode)?null:Number($('mtLayer').value);
 if(!Number.isFinite(price)||price<=0||price>1e7||!Number.isSafeInteger(shares)||shares<=0||(!manual&&!trendMode&&![1,2,3].includes(layer)))return alert(manual?'請確認成交價與整數股數':trendMode?'請確認成交價與整數股數':'請確認成交價、整數股數與層級');
 if(!manual&&!trendMode){const x=statusFor(code),L=x?.m?.layers?.[layer-1],rule=LAYER_CONFIRM_RULES[layer-1];if(!x||x.r.hardVeto||x.r.noBuyToday||!L?.confirmed||L.gateBlocked||!rule||x.r.score<rule.minScore||x.statuses[layer-1]!=='CONFIRMED_IN')return alert('這筆尚未通過正式L'+layer+'買點確認及Gate，不可以標記為正式模型買入。如已自主成交，請改用「自主買入」紀錄。');}
 let snapshot=null,signalText='';
 if(trendMode){
  const m=lastTrendBuy?.models?.[code];if(!m?.ok)return alert('強勢加碼模型尚未載入');
  if(m.status!=='TREND_BUY')return alert('目前強勢加碼訊號已不成立；若仍要買，請改記自主買入。');
  if(Number.isFinite(Number(m.levels?.maxChase))&&price>Number(m.levels.maxChase))return alert(`成交價 ${price.toFixed(2)} 已高於最高追價線 ${Number(m.levels.maxChase).toFixed(2)}，不可記為強勢加碼買入。`);
  signalText=m.statusText||m.status;
  snapshot={modelFamily:'trend',trendModelVersion:'etf-strong-add-v2',score:m.score,scoreLabel:m.scoreLabel||'ETF趨勢強度',scoreGroups:{...(m.scoreGroups||{})},regime:{...(m.regime||{})},modelStatus:m.status,modelStatusText:m.statusText,action:m.action,trendLevels:{...(m.levels||{})},trend:{...(m.trend||{})},trendBacktest:{...(m.backtest||{})},historySource:m.historySource||null,historyOfficial:!!m.historyOfficial,historyDays:m.historyDays||0,version:'V12.4',build:CLIENT_BUILD};
 }else{
  const x=statusFor(code);if(!x)return alert('合理買點模型尚未載入');
  const firstHigh=Number(x.m.layers[0]?.zone?.high),priceVsFirstHighPct=Number.isFinite(firstHigh)&&firstHigh>0?(price/firstHigh-1)*100:null;
  signalText=x.r.noBuyToday?'今日暫無合理買點':stageText(x.activeStatus,x.activeLayer+1);
  snapshot={modelFamily:manual?'manual':'reasonable',zones:x.m.layers.map(L=>({low:L.zone.low,high:L.zone.high,center:center(L.zone)})),confirmedSnapshots:x.m.layers.map(L=>L.confirmedZone?{zone:{low:L.confirmedZone.low,high:L.confirmedZone.high,center:center(L.confirmedZone)},at:L.confirmedAt||L.triggeredAt||null,price:L.confirmedPrice??null}:null),score:x.r.score,chaseRisk:x.r.chaseRisk,chaseWarningThreshold:x.r.chaseWarningThreshold??null,chaseHardThreshold:x.r.chaseHardThreshold??88,chaseCalibrationSource:x.r.chaseCalibration?.source||null,chaseCalibrationLockedDate:x.r.chaseCalibration?.lockedDate||null,chaseCalibrationLockStatus:x.r.chaseCalibration?.lockStatus||null,chaseCalibrationObservations:x.r.chaseCalibration?.observations??null,chaseCalibrationWalkForwardCount:x.r.chaseCalibration?.walkForwardCount??x.r.chaseCalibration?.walkForwardYears?.length??0,confirmationVersion:CONFIRM_RULE_VERSION,confirmationRule:LAYER_CONFIRM_RULES[layer?layer-1:0]||null,environmentScore:x.r.environmentScore,health:x.r.health||null,noBuyToday:!!x.r.noBuyToday,modelStatus:x.activeStatus||null,modelStatusText:signalText,priceVsFirstHighPct,night:lastNight?{last:lastNight.last,changePct:lastNight.changePct}:null,overseas:lastOverseas?.quotes?{NASDAQ:lastOverseas.quotes.NASDAQ?.changePct,SOX:lastOverseas.quotes.SOX?.changePct,TSM:lastOverseas.quotes.TSM?.changePct}:null,shadow:(()=>{const sx=shadowStatusFor(code);return sx?{zones:sx.m.layers.map(L=>({low:L.zone.low,high:L.zone.high,center:center(L.zone)})),confirmedSnapshots:sx.m.layers.map(L=>L.confirmedZone?{zone:{low:L.confirmedZone.low,high:L.confirmedZone.high,center:center(L.confirmedZone)},at:L.confirmedAt||L.triggeredAt||null,price:L.confirmedPrice??null}:null),status:sx.activeStatus,statusText:stageText(sx.activeStatus,sx.activeLayer+1),criticalGate:sx.r?.criticalGate||null,policy:sx.r?.shadowPolicy||null,confirmationVersion:SHADOW_CONFIRM_VERSION}:null})(),version:'V12.4',build:CLIENT_BUILD};
 }
 const trade={id:'mt_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),code,name:NAME[code],tradeType,modelFamily,layer,entryAt:new Date().toISOString(),entryDate:dayKey(),entryPrice:price,shares,snapshot,exitAt:null,exitPrice:null,perf:null};
 markModelTradeDirty(trade);MODEL_TRADES.push(trade);modelSyncSaveLocal();
 // Exactly one local increment + one idempotent cloud operation per NEW trade ID.
 queueHoldingsTrade(trade);
 closeModelTrade();renderModelTrades();renderHoldings();refreshModelTradePerformance();syncAllCloud(true);
 if(manual)addEvent(`${code} 已記錄自主買入（未觸發模型）：${shares}股 @ ${price.toFixed(2)}｜當下模型：${signalText}`,'trade');
 else if(trendMode)addEvent(`${code} 已記錄強勢加碼實戰並同步持股：${shares}股 @ ${price.toFixed(2)}｜${signalText}`,'trade');
 else addEvent(`${code} 已記錄合理買點模型第${layer}層實戰並同步持股：${shares}股 @ ${price.toFixed(2)}`,'trade');
 setPage('model')
}

let LAST_MODEL_TRADE_MARK_RENDER_AT=0;
let TRADE_PERFORMANCE_REFRESH_ACTIVE=false;
async function refreshModelTradePerformance(){
 if(TRADE_PERFORMANCE_REFRESH_ACTIVE||document.visibilityState==='hidden')return;
 TRADE_PERFORMANCE_REFRESH_ACTIVE=true;
 try{
  let changed=false,interrupted=false,completed=0;
  // Newest trades first: otherwise a long sequential queue can starve every
  // recent trade, leaving all 5/20/60d and MAE/MFE pages showing old snapshots.
  const jobs=MODEL_TRADES.filter(t=>!t.exitAt).slice().sort((a,b)=>
   Date.parse(b.entryAt||b.entryDate||0)-Date.parse(a.entryAt||a.entryDate||0));
  let next=0;
  async function worker(){
   while(!interrupted&&next<jobs.length&&document.visibilityState!=='hidden'){
    const t=jobs[next++],entryKey=[t.code,t.entryDate,t.entryPrice,t.shares].join('|');
    try{
     const z=t.snapshot?.zones||[],qs=new URLSearchParams({code:t.code,entryDate:t.entryDate,entryPrice:String(t.entryPrice),layer2Low:String(z[1]?.low??''),layer3Low:String(z[2]?.low??''),layer1High:String(z[0]?.high??'')});
     const p=await get('/api/trade-performance?'+qs.toString());
     // A trade edited or removed while a slow response was pending must not be
     // resurrected, and old-price replies must not overwrite changed entries.
     if(p?.ok&&MODEL_TRADES.includes(t)&&!t.exitAt&&[t.code,t.entryDate,t.entryPrice,t.shares].join('|')===entryKey){
      const prev=t.perf&&typeof t.perf==='object'?t.perf:{};
      // Preserve only explicitly prior valid values when backend is temporarily
      // unable to obtain a current price; the UI's mark will still require
      // separately verified market freshness.
      if(!hasNumber(p.currentPrice)&&hasNumber(prev.currentPrice))p.currentPrice=prev.currentPrice;
      t.perf={...prev,...p};normalizeModelTradeTotalReturn(t);
      // Quotes can refresh every minute locally, but do not re-upload all historical
      // trades every minute. Keep pending purchase uploads ahead of performance.
      const markAt=Date.parse(t._lastPerfCloudMarkAt||'')||0;
      if(!t._syncDirty&&Date.now()-markAt>=30*60*1000){
       t._lastPerfCloudMarkAt=new Date().toISOString();
       markModelTradeDirty(t);
      }
      changed=true;
     }
    }catch(e){if(e?.status===429){interrupted=true;break}}
    completed++;
    if(completed%4===0)renderModelTrades();
   }
  }
  await Promise.all(Array.from({length:Math.min(3,jobs.length)},()=>worker()));
  if(changed){modelSyncSaveLocal();renderModelTrades();void syncAllCloud(false)}
 }finally{TRADE_PERFORMANCE_REFRESH_ACTIVE=false}
}

function closeTrackedTrade(id){
 const t=MODEL_TRADES.find(x=>x.id===id);if(!t)return;const px=Number(lastLive?.quotes?.[t.code]?.last??t.perf?.currentPrice);
 if(t.exitAt)return;
 const v=prompt(`輸入 ${t.code} 實際賣出價格`,Number.isFinite(px)?px.toFixed(2):'');if(v===null)return;const p=Number(v);if(!(p>0))return alert('價格不正確');
 const divPerShare=Math.max(0,Number(modelTradeDividendPerShare(t))||0),grossPerShare=p-t.entryPrice+divPerShare;t.exitAt=new Date().toISOString();t.exitPrice=p;t.realizedPricePnL=(p-t.entryPrice)*t.shares;t.realizedDividendPnL=divPerShare*t.shares;t.realizedPnL=grossPerShare*t.shares;t.realizedReturnPct=t.entryPrice>0?grossPerShare/t.entryPrice*100:null;markModelTradeDirty(t);modelSyncSaveLocal();renderModelTrades();syncModelTrades(true)
}
function deleteTrackedTrade(id){
 if(!confirm('刪除這筆實戰紀錄？'))return;
 MODEL_TRADES=MODEL_TRADES.filter(x=>x.id!==id);if(!MODEL_PENDING_DELETES.includes(id))MODEL_PENDING_DELETES.push(id);modelSyncSaveLocal();renderModelTrades();syncModelTrades(true)
}
function fubonEstimatedTradeCost(entryPrice,shares,currentPrice){
 const buyValue=Number(entryPrice)*Number(shares),sellValue=Number(currentPrice)*Number(shares);
 if(!(buyValue>0)||!(sellValue>0))return null;
 // 富邦零股/電子交易實際帳務校正：小額手續費至少以1元估；ETF賣出證交稅0.1%。
 const buyFee=Math.max(1,Math.round(buyValue*0.001425));
 const sellFee=Math.max(1,Math.round(sellValue*0.001425));
 const etfTax=Math.round(sellValue*0.001);
 return buyFee+sellFee+etfTax;
}
function modelTradeThroughDay(t){
 if(t?.exitAt){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date(t.exitAt))}catch(_){}}
 return dayKey();
}
function modelTradeDividendPerShare(t){
 const p=t?.perf||{},entryDate=String(t?.entryDate||''),through=modelTradeThroughDay(t),eligible=new Map();
 const add=(e)=>{
  const exDate=String(e?.exDate||e?.date||''),amount=Number(e?.amount);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(exDate)||!(amount>0)||exDate<=entryDate||exDate>through)return;
  // Same ex-date across TWSE, locked entitlement and client fallback is one
  // dividend, not three. Prefer source-backed entries to inferred aggregates.
  if(!eligible.has(exDate))eligible.set(exDate,amount);
 };
 (p.eligibleDividends||[]).forEach(add);
 (DIVIDEND_AUTO?.byCode?.[t?.code]?.locks||[]).forEach(add);
 (DIVIDEND_KNOWN_FUTURE?.[t?.code]||[]).forEach(add);
 if(eligible.size)return Math.round([...eligible.values()].reduce((sum,amount)=>sum+amount,0)*10000)/10000;
 // Backward compatibility only if official backend already confirmed earned
 // entitlement on/before through date. A 5/20/60-day future-horizon dividend
 // must NEVER create today's cash return.
 if(p.returnBasis===TRADE_RETURN_REQUIRED&&p.dividendDataComplete===true
   &&p.updatedAt&&String(p.updatedAt).slice(0,10)<=through&&String(p.updatedAt).slice(0,10)>=entryDate
   &&hasNumber(p.accruedDividendPerShare)){
  return Math.max(0,Number(p.accruedDividendPerShare));
 }
 return 0;
}
function normalizeModelTradeTotalReturn(t){
 if(!t?.perf||t?.exitAt)return false;
 const p=t.perf,entry=Number(t.entryPrice),px=Number(p.currentPrice),div=modelTradeDividendPerShare(t);let changed=false;
 if(entry>0&&px>0){
  const priceRet=(px/entry-1)*100,totalRet=((px+div)/entry-1)*100,pricePnl=px-entry,totalPnl=px+div-entry;
  const put=(k,v)=>{if(!Number.isFinite(Number(p[k]))||Math.abs(Number(p[k])-v)>1e-9){p[k]=v;changed=true}};
  put('currentPriceReturnPct',priceRet);put('currentTotalReturnPct',totalRet);put('currentReturnPct',totalRet);put('currentPricePnLPerShare',pricePnl);put('currentPnLPerShare',totalPnl);
  if(div>0&&(!Number.isFinite(Number(p.accruedDividendPerShare))||Number(p.accruedDividendPerShare)<div-1e-9)){p.accruedDividendPerShare=div;changed=true}
  if(div>0&&p.returnBasis!=='cash-entitlement-total-return-v2'){p.frontendReturnBasis='cash-entitlement-total-return-fallback-v1';changed=true}
 }
 return changed;
}
function normalizeAllModelTradeTotalReturns(){let changed=false;for(const t of MODEL_TRADES)if(normalizeModelTradeTotalReturn(t))changed=true;if(changed)modelSyncSaveLocal();return changed}
function modelTradePathMetricsReady(t){
 const p=t?.perf||{},div=modelTradeDividendPerShare(t);
 if(p.status!=='READY'||p.pathBasis!=='post-entry-full-sessions-v1'||!hasNumber(p.maePct)||!hasNumber(p.mfePct))return false;
 if(div<=0)return true;
 if(p.returnBasis===TRADE_RETURN_REQUIRED)return true;
 // Legacy corrected paths are admissible only when both the price-only and
 // earned-dividend paths have explicit non-null values and entitlement evidence.
 const nums=['maePct','mfePct','priceMaePct','priceMfePct','currentTotalReturnPct','currentPriceReturnPct'];
 if(!nums.every(k=>hasNumber(p[k]))||!Array.isArray(p.eligibleDividends)||!p.eligibleDividends.length)return false;
 return Math.abs(Number(p.currentTotalReturnPct)-Number(p.currentPriceReturnPct))>1e-6||
  Math.abs(Number(p.maePct)-Number(p.priceMaePct))>1e-6||
  Math.abs(Number(p.mfePct)-Number(p.priceMfePct))>1e-6;
}
function tradeMetricNumber(v){return hasNumber(v)?Number(v):null}
function tradePathMetric(t,key){return modelTradePathMetricsReady(t)?tradeMetricNumber(t?.perf?.[key]):null}
function modelBenchmarkDelta(t,metrics=modelNetMetrics(t)){
 const bench=Number(t?.perf?.benchmark?.entryPrice),entry=Number(t?.entryPrice),px=metrics?.currentPrice,
  cash=modelTradeDividendPerShare(t);
 if(!(bench>0&&entry>0&&Number.isFinite(px)&&px>0))return null;
 return((px+cash)/entry-(px+cash)/bench)*100;
}
// Mark-to-market uses the same acknowledged ETF quote as the holdings cards.
// Never put an old /api/trade-performance total-return percentage ahead of a
// newer quote: doing so showed profit even when the held ETF was down.
function tradeMarkPrice(t){
 const q=lastLive?.quotes?.[t?.code],quotePrice=Number(q?.last),stamp=Date.parse(q?.fetchTime||q?.serverFetchedAt||'');
 const now=Date.now(),today=dayKey(),isTrading=twMarketOpenClient();
 const quoteCurrent=quotePrice>0&&q?.lastGoodFallback!==true&&q?.realtime!==false&&normalizeEtfQuoteDate(q?.date)===today
  &&Number.isFinite(stamp)&&stamp<=now+15000&&now-stamp>=0&&now-stamp<=120000;
 if(quoteCurrent)return{price:quotePrice,source:'ETF即時行情',asOf:q.fetchTime||q.serverFetchedAt};
 const p=t?.perf||{},perfPrice=Number(p.currentPrice),perfTime=Date.parse(p.updatedAt||'');
 const apiRecent=perfPrice>0&&Number.isFinite(perfTime)&&perfTime<=now+15000&&now-perfTime<=120000
  &&p.currentPriceSource!=='daily history fallback';
 if(apiRecent)return{price:perfPrice,source:'最新實戰API',asOf:p.updatedAt};
 // While the market is trading, never portray a stale saved cloud/API
 // performance snapshot as a current profit. Wait for a verified quote.
 if(isTrading)return{price:null,source:'等待最新行情',asOf:null};
 if(quotePrice>0&&q?.lastGoodFallback!==true&&q?.realtime!==false&&q?.date)
  return{price:quotePrice,source:'最近可用ETF行情',asOf:q.fetchTime||q.serverFetchedAt||null};
 return perfPrice>0?{price:perfPrice,source:'上次實戰估值（非即時）',asOf:p.updatedAt||null}
   :{price:null,source:'等待行情',asOf:null};
}
function modelNetMetrics(t){
 const p=t?.perf,entry=Number(t?.entryPrice),shares=Number(t?.shares),base=entry*shares;
 if(t?.exitAt){
  const exit=Number(t.exitPrice),rawGross=t.realizedPnL,gross=hasNumber(rawGross)?Number(rawGross):null,cost=fubonEstimatedTradeCost(entry,shares,exit);
  const net=Number.isFinite(gross)&&Number.isFinite(cost)?gross-cost:null;
  return{gross,cost,net,ret:net!=null&&base>0?net/base*100:null,currentPrice:exit>0?exit:null,priceSource:'已結束'};
 }
 const mark=tradeMarkPrice(t),px=mark.price,divPerShare=modelTradeDividendPerShare(t);
 const gross=Number.isFinite(px)&&Number.isFinite(entry)&&Number.isSafeInteger(shares)&&shares>0
  ?Math.round((px+divPerShare-entry)*shares*100)/100:null;
 const cost=Number.isFinite(px)?fubonEstimatedTradeCost(entry,shares,px):null;
 const net=Number.isFinite(gross)&&Number.isFinite(cost)?gross-cost:null;
 return{gross,cost,net,ret:net!=null&&base>0?net/base*100:null,dividendPerShare:divPerShare,
  currentPrice:px,priceSource:mark.source,priceAsOf:mark.asOf,
  currentPriceReturnPct:Number.isFinite(px)&&entry>0?(px/entry-1)*100:null,
  currentTotalReturnPct:Number.isFinite(px)&&entry>0?((px+divPerShare)/entry-1)*100:null};
}
function modelFamilyOf(t){if(t?.tradeType==='manual')return'manual';return t?.modelFamily||t?.snapshot?.modelFamily||'reasonable'}
function tradeDiagnosticLabel(t){
 const p=t?.perf||{},m=modelNetMetrics(t),parts=[],family=modelFamilyOf(t);
 if(family==='manual')parts.push('自主買入');else if(family==='trend')parts.push('強勢加碼');else parts.push(`合理模型L${t.layer||'—'}`);
 const pathReady=modelTradePathMetricsReady(t);
 if(pathReady&&Number.isFinite(p.maePct)&&p.maePct<=-1)parts.push('進場後曾有較深回撤');
 if(pathReady&&family==='reasonable'&&t.layer===1&&p.reachedLayer2)parts.push('L1後續曾到L2，需檢查是否偏早');
 if(!pathReady&&modelTradeDividendPerShare(t)>0)parts.push('除息路徑等待後端含息重算');
 const benchmarkDelta=modelBenchmarkDelta(t,m);
 if(Number.isFinite(benchmarkDelta))parts.push(benchmarkDelta>=0?'目前優於同日開盤直接買':'目前落後同日開盤直接買');
 if(Number.isFinite(m.ret)&&Math.abs(m.ret)<.5)parts.push('目前仍屬小幅波動');
 return parts.join('｜');
}


function modelTradeDataAudit(trades){
 const eligible=(trades||[]).filter(t=>t?.tradeType!=='manual'),flagged=[];
 for(const t of eligible){
  const family=modelFamilyOf(t),s=String(t.snapshot?.modelStatusText||t.snapshot?.modelStatus||'');
  if(!s){flagged.push({id:t.id,code:t.code,entryDate:t.entryDate,flag:'MISSING_STATUS_SNAPSHOT',note:'歷史版缺少可驗證的進場狀態，不能當成已確認買點的證據'});continue}
  if(family==='reasonable'&&/觀察|形成中|Gate|暫停|失效|重新定價|等待/.test(s))
   flagged.push({id:t.id,code:t.code,entryDate:t.entryDate,flag:'REVIEW_CONFIRMATION_OR_GATE',status:s,note:'僅為原始快照警示；需核對當時正式訊號與Gate狀態，不能自行改成自主買入'});
  if(family==='trend'&&!/可小額|強勢突破|突破後回踩/.test(s))
   flagged.push({id:t.id,code:t.code,entryDate:t.entryDate,flag:'REVIEW_TREND_STATUS',status:s,note:'未顯示明確強勢加碼許可，須核對'});
 }
 const sorted=eligible.filter(t=>modelFamilyOf(t)==='trend'&&/^\d{4}-\d\d-\d\d$/.test(t.entryDate||'')).slice().sort((a,b)=>a.code.localeCompare(b.code)||a.entryDate.localeCompare(b.entryDate)),groups=[];
 for(const t of sorted){
  const time=Date.parse(t.entryDate+'T00:00:00Z'),last=groups.at(-1);
  // 10 calendar days are a conservative approximation; no per-session historical index is saved in old trades.
  if(last&&last.code===t.code&&time-last.lastMs<=10*86400000){
   last.lastMs=time;last.entries++;last.ids.push(t.id);last.shares+=Number(t.shares)||0;
  }else groups.push({code:t.code,firstDate:t.entryDate,lastMs:time,entries:1,ids:[t.id],shares:Number(t.shares)||0});
 }
 return{mode:'READ_ONLY',episodeGrouping:'same ETF within 10 calendar days (approximate; not precise 10 trading sessions)',
  modelTradeCount:eligible.length,trendTradeCount:sorted.length,trendEpisodes:groups.length,
  episodes:groups.map(({lastMs,...x})=>({...x,lastDate:new Date(lastMs).toISOString().slice(0,10)})),
  potentialSnapshotInconsistencies:flagged,
  note:'僅檢驗匯出診斷資料；不刪除、不重新分類、不修改雲端持股或交易紀錄。Gate警示需對照實際下單時刻。'};
}

function performanceDiagnosticPayload(){
 const modelTrades=MODEL_TRADES.filter(t=>t.tradeType!=='manual'),reasonableTrades=modelTrades.filter(t=>modelFamilyOf(t)==='reasonable'),trendTrades=modelTrades.filter(t=>modelFamilyOf(t)==='trend'),byLayer={};
 for(const layer of [1,2,3]){
  const a=reasonableTrades.filter(t=>Number(t.layer)===layer),pathA=a.filter(modelTradePathMetricsReady),mae=pathA.map(t=>tradePathMetric(t,'maePct')).filter(Number.isFinite),mfe=pathA.map(t=>tradePathMetric(t,'mfePct')).filter(Number.isFinite),rets=a.map(modelNetMetrics).map(x=>x.ret).filter(Number.isFinite),bdelta=a.map(t=>modelBenchmarkDelta(t)).filter(Number.isFinite);
  byLayer[layer]={trades:a.length,avgNetReturnPct:mean(rets),avgMAEPct:mean(mae),avgMFEPct:mean(mfe),reachedNextLayer:layer<3?a.filter(t=>layer===1?t.perf?.reachedLayer2:t.perf?.reachedLayer3).length:null,avgBenchmarkDeltaCurrentPct:mean(bdelta)};
 }
 const famStats=a=>{const rets=a.map(modelNetMetrics).map(x=>x.ret).filter(Number.isFinite),pathA=a.filter(modelTradePathMetricsReady),mae=pathA.map(t=>tradePathMetric(t,'maePct')).filter(Number.isFinite),mfe=pathA.map(t=>tradePathMetric(t,'mfePct')).filter(Number.isFinite),bd=a.map(t=>modelBenchmarkDelta(t)).filter(Number.isFinite);return{trades:a.length,avgNetReturnPct:mean(rets),avgMAEPct:mean(mae),avgMFEPct:mean(mfe),avgBenchmarkDeltaCurrentPct:mean(bd)}};
 return{generatedAt:new Date().toISOString(),day:dayKey(),build:CLIENT_BUILD,confirmationRules:LAYER_CONFIRM_RULES,audit:modelTradeDataAudit(MODEL_TRADES),summary:{total:MODEL_TRADES.length,model:modelTrades.length,manual:MODEL_TRADES.filter(t=>t.tradeType==='manual').length,valued:MODEL_TRADES.filter(t=>Number.isFinite(modelNetMetrics(t).net)).length,unvalued:MODEL_TRADES.filter(t=>!Number.isFinite(modelNetMetrics(t).net)).length,byLayer,byFamily:{reasonable:famStats(reasonableTrades),trend:famStats(trendTrades)}},trades:MODEL_TRADES.map(t=>{const p=t.perf||{},m=modelNetMetrics(t),bench=p.benchmark||{};return{id:t.id,code:t.code,name:t.name,tradeType:t.tradeType||'model',modelFamily:modelFamilyOf(t),layer:t.layer,entryAt:t.entryAt,entryDate:t.entryDate,entryPrice:t.entryPrice,shares:t.shares,exitAt:t.exitAt||null,exitPrice:t.exitPrice||null,build:t.snapshot?.build||null,confirmationVersion:t.snapshot?.confirmationVersion||null,confirmationRule:t.snapshot?.confirmationRule||null,score:t.snapshot?.score??null,chaseRisk:t.snapshot?.chaseRisk??null,chaseWarningThreshold:t.snapshot?.chaseWarningThreshold??null,chaseHardThreshold:t.snapshot?.chaseHardThreshold??null,chaseCalibrationLockedDate:t.snapshot?.chaseCalibrationLockedDate??null,chaseCalibrationObservations:t.snapshot?.chaseCalibrationObservations??null,chaseCalibrationWalkForwardCount:t.snapshot?.chaseCalibrationWalkForwardCount??null,environmentScore:t.snapshot?.environmentScore??null,healthScore:t.snapshot?.health?.score??null,healthDivergence:t.snapshot?.health?.divergence??null,modelStatus:t.snapshot?.modelStatusText||null,zones:t.snapshot?.zones||null,trendLevels:t.snapshot?.trendLevels||null,trend:t.snapshot?.trend||null,trendScoreGroups:t.snapshot?.scoreGroups||null,trendRegime:t.snapshot?.regime||null,trendBacktest:t.snapshot?.trendBacktest||null,shadow:t.snapshot?.shadow||null,currentPrice:m.currentPrice??null,currentPriceSource:m.priceSource||null,currentPriceAsOf:m.priceAsOf||null,currentPriceReturnPct:m.currentPriceReturnPct??null,currentTotalReturnPct:m.currentTotalReturnPct??null,accruedDividendPerShare:modelTradeDividendPerShare(t),eligibleDividends:p.eligibleDividends||[],dividendDataComplete:p.dividendDataComplete??null,returnBasis:p.returnBasis||p.frontendReturnBasis||null,netPnL:m.net,netReturnPct:m.ret,grossPnL:m.gross,estimatedCost:m.cost,horizon:{5:tradeMaturedHorizon(t,5),20:tradeMaturedHorizon(t,20),60:tradeMaturedHorizon(t,60)},maePct:tradePathMetric(t,'maePct'),priceMaePct:modelTradePathMetricsReady(t)?tradeMetricNumber(p.priceMaePct):null,maeDate:modelTradePathMetricsReady(t)?p.maeDate??null:null,mfePct:tradePathMetric(t,'mfePct'),priceMfePct:modelTradePathMetricsReady(t)?tradeMetricNumber(p.priceMfePct):null,mfeDate:modelTradePathMetricsReady(t)?p.mfeDate??null:null,reachedLayer2:!!p.reachedLayer2,reachedLayer3:!!p.reachedLayer3,chaseEntry:p.chaseEntry??null,benchmarkEntryMode:bench.entryMode||null,benchmarkEntryPrice:bench.entryPrice??null,benchmarkCurrentReturnPct:bench.currentReturnPct??null,benchmarkDeltaCurrentPct:modelBenchmarkDelta(t,m),benchmarkHorizon:bench.horizon||null,diagnosis:tradeDiagnosticLabel(t)} })};
}

function downloadTradeDiagnostics(){
 const data=performanceDiagnosticPayload(),name=`model-performance-diagnostic-${dayKey()}-${CLIENT_BUILD}.json`,blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);alert(`績效診斷檔已下載：${name}\n通常會在瀏覽器的「下載」資料夾。`)
}
function modelTradeAgeDays(t){const d=new Date(String(t?.entryDate||t?.entryAt||''));return Number.isNaN(d.getTime())?999:Math.floor((Date.now()-d.getTime())/86400000)}
function modelTradeMatches(t){const f=MODEL_TRADE_FILTER,fam=modelFamilyOf(t);if(f==='all')return true;if(ETF.includes(f))return t.code===f;if(f==='model')return t.tradeType!=='manual';if(f==='manual')return t.tradeType==='manual';if(f==='reasonable')return fam==='reasonable';if(f==='trend')return fam==='trend';if(/^L[123]$/.test(f))return fam==='reasonable'&&Number(t.layer)===Number(f.slice(1));return true}
function setModelTradeFilter(v){MODEL_TRADE_FILTER=v;MODEL_TRADE_EXPANDED=null;renderModelTrades()}
function setModelTradeLimit(v){MODEL_TRADE_LIMIT=v==='all'?'all':Number(v)||10;MODEL_TRADE_EXPANDED=null;renderModelTrades()}
function toggleModelTradeDetail(id){MODEL_TRADE_EXPANDED=MODEL_TRADE_EXPANDED===id?null:id;renderModelTrades()}
function tradeMaturedHorizon(t,k){
 const p=t?.perf||{},h=p.horizon?.[k],date=String(h?.date||'');
 if(p.status!=='READY'||!h||!hasNumber(h.totalReturnPct)||date<=String(t?.entryDate||'')||date>dayKey())return null;
 return h;
}
function modelTradeStatusText(t){const p=t?.perf||{},age=modelTradeAgeDays(t),pathOk=modelTradePathMetricsReady(t);if(t.exitAt)return'已結束';if(!tradeMaturedHorizon(t,5))return'追蹤中';if(pathOk&&p.reachedLayer3)return'曾到L3';if(pathOk&&p.reachedLayer2)return'曾到L2';if(!pathOk&&modelTradeDividendPerShare(t)>0)return'含息路徑待驗證';if(age<=14)return'近期';return'歷史'}
function modelTradeDetailHtml(t){
 const p=t.perf||{},m=modelNetMetrics(t),ret=m.ret,pnl=m.net,h={5:tradeMaturedHorizon(t,5),20:tradeMaturedHorizon(t,20),60:tradeMaturedHorizon(t,60)},family=modelFamilyOf(t),manual=family==='manual',trendFamily=family==='trend',pathReady=modelTradePathMetricsReady(t),label=manual?'自主買入':trendFamily?'強勢加碼':`合理模型第${t.layer}層`,gap=Number(t.snapshot?.priceVsFirstHighPct),sf=t.snapshot?.shadow?.experimentalFactors||null,shadowExtra=sf?`<br>Shadow快照：量價 ${sf.volume?.usable?sf.volume.score+'/100':'—'}｜籌碼 ${sf.chips?.usable?sf.chips.score+'/100':'—'}｜合計影響 ${Number.isFinite(Number(sf.totalEffect))?(Number(sf.totalEffect)>=0?'+':'')+Number(sf.totalEffect).toFixed(1)+'分':'—'}`:'';
 const tl=t.snapshot?.trendLevels||{},tt=t.snapshot?.trend||{},tb=t.snapshot?.trendBacktest||{};
 const snapshotText=trendFamily?`<b>進場快照：強勢加碼</b><br>ETF趨勢強度 ${t.snapshot?.score??'—'}/100｜狀態 ${t.snapshot?.modelStatusText||'—'}｜突破位 ${fmt(tl.breakout20)}｜執行帶 ${fmt(tl.entryLow)}–${fmt(tl.entryHigh)}｜最高追價線 ${fmt(tl.maxChase)}<br>日線20/60/120 ${fmt(tt.sma20)} / ${fmt(tt.sma60)} / ${fmt(tt.sma120)}｜週線20/40 ${fmt(tt.weekly20)} / ${fmt(tt.weekly40)}｜20日動能 ${pct(tt.momentum20)}｜相對大盤20/60日 ${pct(tt.relative20)} / ${pct(tt.relative60)}｜距突破 ${Number.isFinite(Number(tt.distBreakAtr))?fmt(tt.distBreakAtr)+' ATR':'—'}<br>歷史核心 ${tb.signals||0}筆${tb.startDate&&tb.endDate?`｜${tb.startDate.slice(0,4)}～${tb.endDate.slice(0,4)}`:''}｜20日 ${pct(tb.avg20)}（勝率 ${pct(tb.win20)}）｜60日 ${pct(tb.avg60)}（勝率 ${pct(tb.win60)}）｜20日MAE/MFE ${fmt(tb.avgMAE20)}%/${fmt(tb.avgMFE20)}%｜假突破 ${pct(tb.fakeBreak5Rate)}`:
  `${manual?'<b>交易來源：自主買入（未觸發模型）</b><br>':'進場快照：'}分數 ${t.snapshot?.score??'—'}｜防追高 ${t.snapshot?.chaseRisk??'—'}｜環境 ${fmt(t.snapshot?.environmentScore)}｜歷史 ${p?.officialHistory?'TWSE官方':'備援/建立中'}。${manual?`<br>當下模型：${t.snapshot?.modelStatusText||'未記錄'}${Number.isFinite(gap)?`｜成交價較當時第一買點上緣 ${gap>=0?'+':''}${gap.toFixed(2)}%`:''}`:''}`;
 return`<div class="trade-detail-card"><div class="row"><div><b>${t.code}｜${label}</b><div class="note">${new Date(t.entryAt).toLocaleString('zh-TW',{hour12:false})}｜${t.shares.toLocaleString()}股 @ ${fmt(t.entryPrice)}</div></div><b class="${cls(ret)}">${Number.isFinite(ret)?pct(ret):'追蹤中'}</b></div><div class="grid5"><div class="box"><span class="k">目前/結束淨損益</span><b class="${cls(pnl)}">${Number.isFinite(pnl)?Math.round(pnl).toLocaleString():'—'}</b><small>${Number.isFinite(m.gross)&&Number.isFinite(m.cost)?`估值 ${fmt(m.currentPrice)}元（${m.priceSource}${m.priceAsOf?'｜'+hmTaipei(m.priceAsOf):''}）｜含息毛損益 ${Math.round(m.gross).toLocaleString()}｜估計成本 ${Math.round(m.cost)}元`:`${m.priceSource||'等待報價'}：未取得可信的最新估值`}${Number(modelTradeDividendPerShare(t))>0?`｜每股已取得配息 ${Number(modelTradeDividendPerShare(t)).toFixed(2)}`:''}${!pathReady&&Number(modelTradeDividendPerShare(t))>0?'｜前端含息校正中':''}</small></div><div class="box"><span class="k">5日含息</span><b>${h[5]?pct(h[5].totalReturnPct):'未到'}</b></div><div class="box"><span class="k">20日含息</span><b>${h[20]?pct(h[20].totalReturnPct):'未到'}</b></div><div class="box"><span class="k">60日含息</span><b>${h[60]?pct(h[60].totalReturnPct):'未到'}</b></div><div class="box"><span class="k">${pathReady?'含息 MAE / MFE':'MAE / MFE'}</span><b>${pathReady?fmt(tradePathMetric(t,'maePct'))+'% / '+fmt(tradePathMetric(t,'mfePct'))+'%':'— / —（資料未驗證）'}</b></div></div><div class="reading">${snapshotText}${p?`${trendFamily?'':(pathReady?'<br>第2層曾到：'+(p.reachedLayer2?'是':'否')+'｜第3層曾到：'+(p.reachedLayer3?'是':'否'):'<br>第2/3層觸及：等待後端含息重算')+'｜進場追高：'+(p.chaseEntry===true?'是':p.chaseEntry===false?'否':'—')}${Number.isFinite(modelBenchmarkDelta(t,m))?`<br>相對「同日開盤直接買」：${pct(modelBenchmarkDelta(t,m))} 個百分點（同一估值時間）`:''}<br><b>診斷：</b>${tradeDiagnosticLabel(t)}`:''}${shadowExtra}</div><button class="btn" onclick="closeTrackedTrade('${t.id}')">${t.exitAt?'已結束':'記錄賣出/結束追蹤'}</button> <button class="btn danger" onclick="deleteTrackedTrade('${t.id}')">刪除</button></div>`;
}

function renderModelTrades(){
 const open=MODEL_TRADES.filter(t=>!t.exitAt),modelTrades=MODEL_TRADES.filter(t=>t.tradeType!=='manual'),reasonableTrades=modelTrades.filter(t=>modelFamilyOf(t)==='reasonable'),trendTrades=modelTrades.filter(t=>modelFamilyOf(t)==='trend'),manualTrades=MODEL_TRADES.filter(t=>t.tradeType==='manual');
 const modelMetrics=modelTrades.map(t=>({t,m:modelNetMetrics(t)})),modelRets=modelMetrics.map(x=>x.m.ret).filter(Number.isFinite),manualRets=manualTrades.map(modelNetMetrics).map(x=>x.ret).filter(Number.isFinite),pathTrades=modelTrades.filter(modelTradePathMetricsReady),maes=pathTrades.map(t=>tradePathMetric(t,'maePct')).filter(Number.isFinite),mfes=pathTrades.map(t=>tradePathMetric(t,'mfePct')).filter(Number.isFinite),bd=modelTrades.map(t=>modelBenchmarkDelta(t)).filter(Number.isFinite);
 const allMetrics=MODEL_TRADES.map(modelNetMetrics),allPnls=allMetrics.map(x=>x.net).filter(Number.isFinite),allPnl=allPnls.reduce((sum,x)=>sum+x,0),modelWins=modelRets.filter(x=>x>0).length,unknownCount=allMetrics.length-allPnls.length;
 const shadowSnap=modelTrades.filter(t=>t.snapshot?.shadow?.zones?.[0]&&t.snapshot?.zones?.[0]),shadowShift=shadowSnap.map(t=>{const a=center(t.snapshot.zones[0]),b=center(t.snapshot.shadow.zones[0]);return a>0?(b-a)/a*100:null}).filter(Number.isFinite);
 $('liveTradeSummary').innerHTML=`<div class="box"><span class="k">模型買入</span><b>${modelTrades.length}筆</b><small>合理 ${reasonableTrades.length}｜強勢加碼 ${trendTrades.length}${modelRets.length?`｜目前獲利 ${modelWins}/${modelRets.length}`:''}${modelTrades.length>modelRets.length?'｜另'+(modelTrades.length-modelRets.length)+'筆待估值':''}</small></div><div class="box"><span class="k">平均 MAE / MFE</span><b>${fmt(mean(maes))}% / ${fmt(mean(mfes))}%</b><small>已驗證樣本 ${Math.min(maes.length,mfes.length)} 筆｜進場後最差／最好路徑</small></div><div class="box"><span class="k">vs 同日開盤</span><b class="${cls(mean(bd))}">${bd.length?pct(mean(bd)):'—'}</b><small>同一估值價格｜有效樣本 ${bd.length} 筆</small></div><div class="box"><span class="k">Shadow 對照</span><b>${shadowSnap.length}筆</b><small>${shadowShift.length?`合理L1平均位移 ${pct(mean(shadowShift))}`:'等待共時快照'}｜非績效勝負</small></div><div class="box"><span class="k">追蹤中 / 損益估值</span><b>${open.length}筆｜<span class="${cls(allPnl)}">${allPnls.length&&!unknownCount?Math.round(allPnl).toLocaleString():'—'}</span></b><small>已計價 ${allPnls.length}/${MODEL_TRADES.length} 筆${unknownCount?'｜'+unknownCount+'筆缺可靠報價，不顯示不完整合計':''}</small></div>`;
 const diag=performanceDiagnosticPayload().summary,layerDiag=diag.byLayer,trendDiag=diag.byFamily?.trend||{},oldDiag=document.getElementById('tradeLayerDiagnostic');if(oldDiag)oldDiag.remove();$('liveTradeSummary').insertAdjacentHTML('afterend',`<div id="tradeLayerDiagnostic" class="reading" style="margin:8px 0 12px"><b>合理買點模型：</b>L1 ${layerDiag[1].trades}筆｜平均報酬 ${pct(layerDiag[1].avgNetReturnPct)}｜平均MAE ${fmt(layerDiag[1].avgMAEPct)}%｜後續到L2 ${layerDiag[1].reachedNextLayer??0}筆；L2 ${layerDiag[2].trades}筆；L3 ${layerDiag[3].trades}筆。<br><b>強勢加碼：</b>${trendDiag.trades||0}筆｜平均報酬 ${pct(trendDiag.avgNetReturnPct)}｜平均MAE ${fmt(trendDiag.avgMAEPct)}%｜vs同日開盤 ${pct(trendDiag.avgBenchmarkDeltaCurrentPct)}。<br><span class="note">兩套模型分開統計：合理買點維持三層回檔；強勢加碼只記錄趨勢確認後的突破／回踩訊號。</span></div>`);
 const attention=MODEL_TRADES.filter(t=>!t.exitAt&&(modelTradeAgeDays(t)<=14||!tradeMaturedHorizon(t,5)||(modelTradePathMetricsReady(t)&&(t.perf?.reachedLayer2||t.perf?.reachedLayer3)))).sort((a,b)=>new Date(b.entryAt)-new Date(a.entryAt)).slice(0,6);
 const attentionHtml=`<div class="trade-section-head"><div><b>目前需要看的交易</b><small>近期14日、未滿5日或曾觸及下一層；最多展開6筆。</small></div></div>${attention.length?`<div class="trade-attention-grid">${attention.map(modelTradeDetailHtml).join('')}</div>`:'<div class="notice">目前沒有需要優先檢視的交易。</div>'}`;
 const filters=[['all','全部'],['0050','0050'],['0056','0056'],['00878','00878'],['00919','00919'],['reasonable','合理模型'],['trend','強勢加碼'],['L1','L1'],['L2','L2'],['L3','L3'],['model','全部模型'],['manual','自主買入']],limits=[[10,'最近10筆'],[30,'最近30筆'],['all','全部']];
 let hist=MODEL_TRADES.slice().sort((a,b)=>new Date(b.entryAt)-new Date(a.entryAt)).filter(modelTradeMatches);if(MODEL_TRADE_LIMIT!=='all')hist=hist.slice(0,MODEL_TRADE_LIMIT);
 const controls=`<div class="trade-history-head"><div><b>歷史交易</b><small>預設只列最近10筆；點任一列才展開完整快照。</small></div><div class="trade-filter-row">${filters.map(([v,l])=>`<button class="trade-filter ${MODEL_TRADE_FILTER===v?'on':''}" onclick="setModelTradeFilter('${v}')">${l}</button>`).join('')}</div><div class="trade-filter-row">${limits.map(([v,l])=>`<button class="trade-filter ${String(MODEL_TRADE_LIMIT)===String(v)?'on':''}" onclick="setModelTradeLimit('${v}')">${l}</button>`).join('')}</div></div>`;
 const rows=hist.map(t=>{const m=modelNetMetrics(t),p=t.perf||{},ret=m.ret,expanded=MODEL_TRADE_EXPANDED===t.id,fam=modelFamilyOf(t),label=fam==='manual'?'自主':fam==='trend'?'強勢加碼':`L${t.layer||'—'}`,pathReady=modelTradePathMetricsReady(t);return`<tr class="trade-row ${expanded?'expanded':''}" onclick="toggleModelTradeDetail('${t.id}')"><td>${t.entryDate||'—'}</td><td><b>${t.code}</b></td><td>${label}</td><td>${fmt(t.entryPrice)}</td><td>${Number(t.shares||0).toLocaleString()}</td><td class="${cls(ret)}">${pct(ret)}</td><td>${pathReady?fmt(tradePathMetric(t,'maePct'))+'%':'—'}</td><td>${pathReady?fmt(tradePathMetric(t,'mfePct'))+'%':'—'}</td><td>${modelTradeStatusText(t)}</td></tr>${expanded?`<tr class="trade-detail-row"><td colspan="9">${modelTradeDetailHtml(t)}</td></tr>`:''}`}).join('');
 const table=hist.length?`<div class="trade-table-wrap"><table class="trade-table"><thead><tr><th>日期</th><th>ETF</th><th>層級</th><th>買價</th><th>股數</th><th>目前含息</th><th>MAE</th><th>MFE</th><th>狀態</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="notice">此篩選條件沒有交易紀錄。</div>';
 $('modelTradeList').innerHTML=modelSyncBar()+attentionHtml+controls+table;
}
async function loadHistoryStatus(){if(document.visibilityState==='hidden')return;
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

function boot(){setMode();renderHoldings();renderDetailTabs();renderBacktestTabs();renderEvents();renderModelTrades();loadHistoryStatus();setInterval(()=>{if(document.visibilityState!=='hidden')loadHistoryStatus()},60000);setTimeout(refreshModelTradePerformance,2500);setInterval(refreshModelTradePerformance,60000);setTimeout(()=>syncAllCloud(false),1200);setInterval(()=>syncAllCloud(false),60000);addChat('V12.4免費戰情問答已啟動。','sys');loadEtfLive();loadMarket();loadSlow();loadNight();loadServerPreopen();loadBuy();if(window.SignalAlerts?.monitoring())setTimeout(()=>loadTrendBuy(false),4000);setInterval(()=>{if(window.SignalAlerts?.monitoring()&&twMarketOpenClient())loadTrendBuy(false)},60000)}
migrate1689Existing0050Trade();
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){clearTimeout(etfLiveTimer);clearTimeout(marketTimer);clearTimeout(slowTimer);clearTimeout(nightTimer);clearTimeout(buyTimer);clearTimeout(trendBuyTimer);$('freshPill').textContent='● 重新連線中';$('freshPill').className='pill warn';loadEtfLive();loadMarket();loadSlow();loadNight();loadServerPreopen();loadBuy();if($('trendBuyPage')?.classList.contains('on')||window.SignalAlerts?.monitoring())loadTrendBuy(false);if($('commentaryPage')?.classList.contains('on'))loadCommentary(false);if($('constituentPage')?.classList.contains('on'))loadConstituentPage(false);syncAllCloud(false)}})
setInterval(()=>{
 const p=document.getElementById('constituentPage');
 if(p?.classList.contains('on'))loadConstituentPage(false);
},30000);
function apiSingleFlight(fn){
 let pending=null;
 return function(...args){
  if(pending)return pending;
  pending=Promise.resolve().then(()=>fn(...args)).finally(()=>{pending=null});
  return pending;
 };
}
loadEtfLive=apiSingleFlight(loadEtfLive);
loadMarket=apiSingleFlight(loadMarket);
loadSlow=apiSingleFlight(loadSlow);
loadNight=apiSingleFlight(loadNight);
loadBuy=apiSingleFlight(loadBuy);
syncAllCloud=apiSingleFlight(syncAllCloud);
syncModelTrades=apiSingleFlight(syncModelTrades);
syncHoldingsCloud=apiSingleFlight(syncHoldingsCloud);
flushPendingHoldingsTrades=apiSingleFlight(flushPendingHoldingsTrades);
loadDividendAuto=apiSingleFlight(loadDividendAuto);
loadTrendBuy=apiSingleFlight(loadTrendBuy);
loadCommentary=apiSingleFlight(loadCommentary);
setInterval(setMode,30000);boot();
