/* Signal alerts v1: presentation only; never mutates L1/L2/L3, TREND_BUY or model trades. */
(function(root){
 'use strict';
 const ETF=['0050','0056','00878','00919'],KEY='twstock_signal_alerts_v1',SEEN='twstock_signal_alert_seen_v1',HISTORY='twstock_signal_alert_history_v1';
 const LIMIT=180,ALERT_DAY_LIMIT=24;
 function read(key,fallback){try{const x=JSON.parse(localStorage.getItem(key)||'null');return x??fallback}catch{return fallback}}
 function write(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch(_){}}
 const settings=read(KEY,{enabled:false,sound:true});
 let enabled=settings.enabled===true,sound=settings.sound!==false,seen=read(SEEN,{}),history=read(HISTORY,[]),audio=null;
 const fmt=n=>Number.isFinite(Number(n))?Number(n).toFixed(2):'—';
 const nowDay=(d=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(d);
 function marketOpen(d=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(d).map(x=>[x.type,x.value]));
  return ['Mon','Tue','Wed','Thu','Fri'].includes(parts.weekday)&&Number(parts.hour)*60+Number(parts.minute)>=540&&Number(parts.hour)*60+Number(parts.minute)<=810;
 }
 function fresh(ts,maxMs=90000){const t=Date.parse(ts||'');return Number.isFinite(t)&&Date.now()>=t-15000&&Date.now()-t<=maxMs}
 function quoteOkay(q,requiresServer=false){
  if(!q||!(Number(q.last)>0)||q.lastGoodFallback===true||q.corporateActionReferenceMissing===true||q.referenceReliable===false)return false;
  if(q.date&&q.date!==nowDay())return false;
  if(requiresServer)return q.realtime===true&&fresh(q.serverFetchedAt,105000)&&q.date===nowDay();
  return q.realtime!==false&&fresh(q.fetchTime||q.serverFetchedAt,90000);
 }
 function syncState(){write(KEY,{enabled,sound})}
 function prune(){
  const day=nowDay(),pairs=Object.entries(seen).filter(([key])=>key.startsWith(day+'|')).slice(-LIMIT);
  seen=Object.fromEntries(pairs);history=Array.isArray(history)?history.slice(-LIMIT):[];
  write(SEEN,seen);write(HISTORY,history);
 }
 function setText(id,v){const el=document.getElementById(id);if(el)el.textContent=v}
 function render(){
  const supported=typeof root.Notification==='function';
  const permission=supported?root.Notification.permission:'unsupported';
  setText('signalAlertStatus',!enabled?'提醒已關閉':permission==='granted'?'提醒已啟用｜桌面通知＋站內提醒':permission==='denied'?'提醒已啟用｜瀏覽器已封鎖桌面通知，僅站內提醒':'提醒已啟用｜站內提醒（桌面通知尚未允許）');
  const on=document.getElementById('signalAlertEnable');
  if(on)on.textContent=enabled?'關閉提醒':'啟用提醒';
  const b=document.getElementById('signalAlertSound');
  if(b)b.textContent='提示音：'+(sound?'開':'關');
  const list=document.getElementById('signalAlertRecent');
  if(list)list.textContent=history.length?'最近通知：'+history.slice(-3).reverse().map(x=>x.display).join('　｜　'):'尚無訊號提醒；不會補送啟用前已失效的訊號。';
 }
 function prepareAudio(){
  if(!audio&&typeof (root.AudioContext||root.webkitAudioContext)==='function'){
   try{audio=new (root.AudioContext||root.webkitAudioContext)()}catch(_){}
  }
  if(audio&&audio.state==='suspended')audio.resume().catch(()=>{});
 }
 function beep(){
  if(!sound||!audio)return;
  try{
   if(audio.state==='suspended')audio.resume().catch(()=>{});
   const osc=audio.createOscillator(),gain=audio.createGain(),t=audio.currentTime;
   osc.type='sine';osc.frequency.setValueAtTime(830,t);
   osc.frequency.setValueAtTime(1047,t+.12);
   gain.gain.setValueAtTime(.001,t);gain.gain.exponentialRampToValueAtTime(.09,t+.015);gain.gain.exponentialRampToValueAtTime(.001,t+.34);
   osc.connect(gain);gain.connect(audio.destination);osc.start(t);osc.stop(t+.35);
  }catch(_){}
 }
 function toast(title,body){
  const region=document.getElementById('signalAlertToasts');if(!region)return;
  const item=document.createElement('div');item.className='signal-alert-toast';
  const strong=document.createElement('strong');strong.textContent=title;
  const detail=document.createElement('div');detail.textContent=body;
  item.appendChild(strong);item.appendChild(detail);region.appendChild(item);
  while(region.children.length>4)region.removeChild(region.firstChild);
  setTimeout(()=>{try{item.remove()}catch(_){}},15000);
 }
 function emit(code,type,title,body,page){
  if(!enabled||!marketOpen())return false;
  const key=nowDay()+'|'+code+'|'+type;
  // Cross-tab refresh; dedup also survives reloads.
  seen=read(SEEN,seen);
  if(seen[key])return false;
  if(Object.keys(seen).filter(k=>k.startsWith(nowDay()+'|')).length>=ALERT_DAY_LIMIT)return false;
  const at=new Date().toISOString(),display=code+' '+title+' '+new Date(at).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false});
  seen[key]=at;history.push({at,code,type,title,body,page,display});prune();
  toast(code+' '+title,body);beep();render();
  if(typeof root.Notification==='function'&&root.Notification.permission==='granted'){
   try{const n=new root.Notification('台股戰情｜'+code+' '+title,{body,tag:'twstock-'+key,renotify:false,icon:'/icon.svg'});
    n.onclick=()=>{try{root.focus()}catch(_){};if(typeof root.setPage==='function')root.setPage(page);try{n.close()}catch(_){}};
   }catch(e){console.warn('[SIGNAL-ALERT] desktop notification unavailable',e?.message||e)}
  }
  return true;
 }
 async function enable(){
  if(enabled){enabled=false;syncState();render();return false}
  enabled=true;syncState();prepareAudio();
  // Must happen in direct click handler. A denial still permits on-page toasts.
  if(typeof root.Notification==='function'&&root.Notification.permission==='default'){
   try{await root.Notification.requestPermission()}catch(_){}
  }
  render();
  if(typeof root.loadTrendBuy==='function')void root.loadTrendBuy(false);
  return true;
 }
 function toggleSound(){sound=!sound;syncState();if(sound)prepareAudio();render();return sound}
 function test(){
  prepareAudio();toast('通知測試','如果Chrome通知已允許，桌面也會收到這則測試訊息。');beep();
  if(typeof root.Notification==='function'&&root.Notification.permission==='granted')try{new root.Notification('台股戰情｜通知測試',{body:'四檔ETF買點提醒已準備就緒。',tag:'twstock-test'})}catch(_){}
 }
 function observeLayers(state,buy,live){
  if(!enabled||!marketOpen()||!buy?.ok||buy.dataFresh!==true||!fresh(buy.fetchedAt,95000))return;
  for(const code of ETF){
   const m=state?.models?.[code],r=buy.models?.[code],q=live?.quotes?.[code];
   if(!m?.layers||!r||r.error||!quoteOkay(q))continue;
   for(let i=0;i<3;i++){
    const layer=m.layers[i],px=Number(q.last),z=layer?.confirmedZone||layer?.zone;
    if(!layer?.confirmed||layer.gateBlocked||r.hardVeto||r.noBuyToday||!z)continue;
    const hi=Number.isFinite(layer.executionHigh)?layer.executionHigh:z.high;
    const lo=Number.isFinite(layer.executionLow)?layer.executionLow:z.low;
    if(!(px>=lo&&px<=hi))continue;
    if(!layer.confirmedAt||String(layer.confirmedAt).slice(0,10)!==nowDay())continue;
    const name=['L1 第一層','L2 理想','L3 強力'][i];
    emit(code,'L'+(i+1),name+'正式確認','現價 '+fmt(px)+'元｜執行區 '+fmt(lo)+'～'+fmt(hi)+'元｜評分 '+fmt(r.score)+'｜硬Gate通過。到站後仍請重新確認。','buy');
   }
  }
 }
 function observeTrend(data,live){
  if(!enabled||!marketOpen()||!data?.ok||!fresh(data.fetchedAt,90000))return;
  for(const code of ETF){
   const m=data.models?.[code],q=data.quoteSnapshots?.[code];
   if(!m?.ok||m.status!=='TREND_BUY'||!quoteOkay(q,true))continue;
   const liveQ=live?.quotes?.[code],useLive=quoteOkay(liveQ),px=useLive?Number(liveQ.last):Number(m.price),lv=m.levels||{};
   if(!(Number.isFinite(px)&&px>=Number(lv.entryLow)&&px<=Number(lv.entryHigh)&&px<=Number(lv.maxChase)))continue;
   const b=m.shadowB?.status||'未取得';
   emit(code,'TREND_A','強勢加碼A版成立','現價 '+fmt(px)+'元｜執行帶 '+fmt(lv.entryLow)+'～'+fmt(lv.entryHigh)+'元｜最高追價 '+fmt(lv.maxChase)+'元｜A版'+fmt(m.score)+'分｜B版 '+b+'。請重新確認行情。','trendBuyPage');
  }
 }
 root.SignalAlerts={enable,toggleSound,test,monitoring:()=>enabled,observeLayers,observeTrend,render,marketOpen};
 if(root.addEventListener)root.addEventListener('storage',e=>{if(e.key===KEY){const v=read(KEY,{enabled:false,sound:true});enabled=v.enabled===true;sound=v.sound!==false;render()}if(e.key===SEEN){seen=read(SEEN,{})}});
 prune();
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render);else render();
})(window);
