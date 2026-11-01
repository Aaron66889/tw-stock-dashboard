/* Read-only Gate-blocked live opportunity ledger. Loaded only in Model / Validation. */
(function(root){
'use strict';
let cache=null,inflight=null,lastLoad=0,tradeProvider=null;
function setTradeProvider(fn){tradeProvider=typeof fn==='function'?fn:null;}
const el=()=>document.getElementById('gateBlockedLedger');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=x=>Number.isFinite(Number(x))&&x!==null?Number(x).toFixed(2)+'%':'—';
const num=x=>Number.isFinite(Number(x))&&x!==null?String(x):'—';
function stat(x){
 if(!x?.matured)return'未到期';
 return num(x.matured)+'筆｜平均 '+pct(x.meanNetPct)+'｜勝率 '+pct(x.winRatePct)+'｜MAE '+pct(x.meanMAEPct);
}

const classificationLabel=t=>({
 DERIVED_OVERLAP:'綜合環境重複計票候選',
 INDEPENDENT_BLOCK:'至少兩項獨立急跌風險',
 UNKNOWN:'缺少足夠原始證據'
})[t]||'未分類';
function octAuditHtml(d){
 const core=root.GateAuditCore;
 if(!core?.audit)return'<div class="notice">10月稽核模組未載入，請重新整理。</div>';
 let trades=null;
 try{if(tradeProvider)trades=tradeProvider()}catch(_){}
 const a=core.audit(d.events||[],trades);
 let out='<section style="margin:12px 0"><div class="sectiontitle">2026年10月｜舊版 Gate 擋下的真實觀察（歷史封存）</div>'+
  '<div class="reading">已留存 '+num(a.observations)+' 筆真實盤中被擋觀察，分布在 '+num(a.uniqueDays)+' 個交易日、'+num(a.uniqueCodeDays)+
  ' 個 ETF／交易日。<b>重複計票候選 '+num(a.classification.DERIVED_OVERLAP)+' 筆</b>｜至少兩項獨立風險仍阻擋 '+
  num(a.classification.INDEPENDENT_BLOCK)+' 筆｜資料不足 '+num(a.classification.UNKNOWN)+' 筆。</div>';
 if(!a.observations)out+='<div class="note">10月沒有已存的真實被擋觀察；不能把事後最低價當成當時曾觸價。</div>';
 for(const [key,label] of [['DERIVED_OVERLAP','重複計票候選'],['INDEPENDENT_BLOCK','獨立風險仍阻擋']]){
  const g=a.groups[key];
  out+='<div class="reading" style="margin-top:6px"><b>'+label+'：'+num(g.observations)+'筆</b>'+
   [5,20,60].map(h=>{const m=g.horizons[h];return h+'日成熟 '+m.matured+'/'+g.observations+
    '｜平均假設淨報酬 '+pct(m.meanNetPct)+'｜MAE '+pct(m.meanMAEPct)}).join('<br>')+'</div>';
 }
 if(a.trades.available){
  const tp=a.tradePerformance||{};
  out+='<div class="reading" style="margin-top:8px"><b>本裝置／已同步實戰紀錄（2026年10月）</b>：自主買入 '+
   num(a.trades.manual)+' 筆、模型買入 '+num(a.trades.model)+' 筆、其他 '+num(a.trades.other)+
   ' 筆。交易紀錄只在本裝置對照，不上傳至本研究 API。<br>'+
   [5,20,60].map(h=>{const m=tp.manual?.[h],z=tp.model?.[h];return h+'日：自主 '+num(m?.matured??0)+'筆'+
    (m?.meanTotalReturnPct==null?'（未到期／未更新）':'、平均總報酬 '+pct(m.meanTotalReturnPct))+
    '；模型 '+num(z?.matured??0)+'筆'+
    (z?.meanTotalReturnPct==null?'（未到期／未更新）':'、平均總報酬 '+pct(z.meanTotalReturnPct));}).join('<br>')+
   '</div>';
 }else out+='<div class="note">個人交易資料未載入；僅呈現公開 Gate 前向事件，並不假設當天沒有實際買入。</div>';
 if(a.detailed.length){
  out+='<div style="overflow-x:auto;margin-top:8px"><table style="width:100%;white-space:nowrap"><thead><tr><th>觀測（台灣時間）</th>'+
   '<th>ETF / 層</th><th>觀察價</th><th>研究分類</th><th>同日正式模型買入（觀察前/後）</th><th>同日自主買入（前/後）</th><th>5日假設淨報酬</th></tr></thead><tbody>';
  for(const x of a.detailed){
   const e=x.event,t=x.sameDayTrades,o=e.outcome?.horizons||{};
   let stamp='—';try{stamp=new Date(e.observedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})}catch(_){}
   out+='<tr><td>'+esc(stamp)+'</td><td>'+esc(e.code)+' L'+num(e.layer)+'</td><td>'+num(e.price)+'</td>'+
    '<td>'+esc(classificationLabel(x.category))+'</td>'+
    '<td>'+ (a.trades.available?num(t.modelBefore)+' / '+num(t.modelAfter):'—')+'</td>'+
    '<td>'+ (a.trades.available?num(t.manualBefore)+' / '+num(t.manualAfter):'—')+'</td>'+
    '<td>'+pct(o[5]?.netReturnPct)+'</td></tr>';
  }
  out+='</tbody></table></div>';
 }
 out+='<div class="note" style="margin-top:9px"><b>驗證界線：</b>'+
  '這些是假設以當時觀測價進場的事後日K代理報酬，並非成交或正式模型放行。當日其他時段仍可能已正式確認。'+
  '未滿5／20／60交易日不得計為贏或輸。自主／模型實際成交使用含權息總報酬、研究代理使用估計往返成本，兩者口徑及樣本不同，不可用平均值直接判定誰優。'+
  '樣本只有'+num(a.observations)+'筆，不能據此證明新版 Gate 長期績效更好。現行 Gate 已改為獨立風險計票；持股與實際交易紀錄沒有因本次研究而修改。</div></section>';
 return out;
}

function dedupForwardHtml(data){
 const d=data?.dedupForward;if(!d)return'<div class="note">新版去重 Gate 前向績效尚未開放或伺服器仍是舊版。</div>';
 const n=d.eventCount||0,o=d.summary?.byHorizon||{};
 let html='<section class="reading" style="margin:12px 0"><div class="sectiontitle">新版急跌 Gate｜去重後可觀察買點（獨立前向帳簿）</div>'+
  '<div class="note">舊版會因綜合環境重複計票而阻擋；新版獨立硬 Gate 未阻擋，但<b>仍不代表止跌確認、正式模型放行或已成交</b>。</div>'+
  '<div>真實盤中首次落帶觀察 '+num(n)+'筆｜5日 '+stat(o[5])+'｜20日 '+stat(o[20])+'｜60日 '+stat(o[60])+'</div>';
 if(n){
  html+='<div style="overflow-x:auto;margin-top:8px"><table style="width:100%;white-space:nowrap"><thead><tr>'+
   '<th>時間（台灣）</th><th>ETF</th><th>層</th><th>觀察價</th><th>舊／新風險票</th>'+
   '<th>5日假設淨報酬</th><th>20日</th><th>60日</th></tr></thead><tbody>';
  for(const x of (d.events||[]).slice(0,20)){
   let stamp='—';try{stamp=new Date(x.observedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})}catch(_){}
   html+='<tr><td>'+esc(stamp)+'</td><td>'+esc(x.code)+'</td><td>L'+num(x.layer)+'</td><td>'+num(x.price)+'</td>'+
    '<td>'+num(x.legacyCount)+' / '+num(x.independentCount)+'</td><td>'+pct(x.outcome?.horizons?.[5]?.netReturnPct)+
    '</td><td>'+pct(x.outcome?.horizons?.[20]?.netReturnPct)+'</td><td>'+pct(x.outcome?.horizons?.[60]?.netReturnPct)+'</td></tr>';
  }
  html+='</tbody></table></div>';
 }else html+='<div class="note">目前沒有符合新條件的真實盤中觀測。系統不會用歷史最低價倒填假紀錄。</div>';
 return html+'</section>';
}

function render(data){
 const dest=el();if(!dest)return;
 if(!data?.ok){dest.textContent='紀錄暫時無法載入：'+(data?.error||'請稍後重試');return}
 if(!data.storageReady){dest.innerHTML='<div class="notice">雲端保存尚未啟用；沒有假裝背景追蹤成功。'+esc(data.error||'')+'</div>';return}
 const sm=data.summary||{},n=data.eventCount||0;
 let html=octAuditHtml(data)+dedupForwardHtml(data)+'<div class="reading">累積觀察 '+num(n)+'筆（最近最多500筆）｜觀察日期至 '+esc(data.asOf)+
  '｜<b>僅研究、未下單、不列入持股或正式交易績效</b>。記錄限於背景真正看見的報價，無法回填已錯過的盤中最低價。</div>';
 html+='<div class="grid4" style="margin-top:12px">';
 for(const code of ['0050','0056','00878','00919']){
  const s=sm.byCode?.[code]||{};
  html+='<div class="box"><b>'+code+'</b><small>擋下觀察 '+num(s.events||0)+'筆｜L1 '+
   num(s.byLayer?.L1?.events||0)+'／L2 '+num(s.byLayer?.L2?.events||0)+
   '／L3 '+num(s.byLayer?.L3?.events||0)+'</small>'+
   '<small>5日：'+stat(s.byHorizon?.[5])+'</small><small>20日：'+stat(s.byHorizon?.[20])+
   '</small><small>60日：'+stat(s.byHorizon?.[60])+'</small></div>';
 }
 html+='</div>';
 if(n){
  html+='<div class="sectiontitle" style="margin-top:12px">最近30筆被擋觀察</div><div style="overflow-x:auto"><table style="width:100%;white-space:nowrap"><thead><tr>'+
   '<th>觀察時間</th><th>ETF</th><th>層級</th><th>當時現價</th><th>Gate</th><th>5日淨報酬</th><th>20日淨報酬</th><th>60日淨報酬</th><th>60日MAE</th></tr></thead><tbody>';
  for(const x of (data.events||[]).slice(0,30)){
   const o=x.outcome?.horizons||{};
   html+='<tr><td>'+esc(x.observedAt?.replace('T',' ').slice(0,16)||'—')+' UTC</td>'+
    '<td>'+esc(x.code)+'</td><td>L'+num(x.layer)+'</td><td>'+num(x.price)+'</td>'+
    '<td>'+esc(x.reason||'硬Gate')+'</td><td>'+pct(o[5]?.netReturnPct)+'</td>'+
    '<td>'+pct(o[20]?.netReturnPct)+'</td><td>'+pct(o[60]?.netReturnPct)+'</td>'+
    '<td>'+pct(o[60]?.maePct)+'</td></tr>';
  }
  html+='</tbody></table></div>';
 }else html+='<div class="reading">尚無符合條件且已在背景實際觀測到的Gate阻擋事件。功能啟用前的歷史觸價不會補成假紀錄。</div>';
 const st=data.scanStatus||{};
 html+='<div class="note" style="margin-top:12px">掃描：'+
  (st.lastSuccessAt?'最近成功 '+esc(st.lastSuccessAt.replace('T',' ').slice(0,19))+' UTC':'尚無成功寫入')+
  (st.error?'｜錯誤：'+esc(st.error):'')+
  '。'+esc(data.limitations||'')+'</div>';
 dest.innerHTML=html;
}
async function load(force=false){
 const dest=el();if(!dest)return;
 if(inflight)return inflight;
 if(!force&&cache&&Date.now()-lastLoad<60000){render(cache);return}
 dest.textContent='背景觀察摘要讀取中（不影響即時行情與買入模型）…';
 inflight=(async()=>{
  const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),18000);
  try{
   const response=await fetch('/api/gate-blocked-forward',{cache:'no-store',credentials:'same-origin',signal:ctl.signal});
   if(!response.ok)throw Error('HTTP '+response.status);
   const d=await response.json();if(d.ok){cache=d;lastLoad=Date.now()}render(d);
  }catch(e){dest.textContent='觀察摘要暫時無法取得：'+(e?.message||String(e))}
  finally{clearTimeout(timeout);inflight=null}
 })();
 return inflight;
}
root.GateBlockedUI={load,render,setTradeProvider};
})(window);
