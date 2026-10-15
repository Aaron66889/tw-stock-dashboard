/* Read-only Gate-blocked live opportunity ledger. Loaded only in Model / Validation. */
(function(root){
'use strict';
let cache=null,inflight=null,lastLoad=0;
const el=()=>document.getElementById('gateBlockedLedger');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=x=>Number.isFinite(Number(x))&&x!==null?Number(x).toFixed(2)+'%':'—';
const num=x=>Number.isFinite(Number(x))&&x!==null?String(x):'—';
function stat(x){
 if(!x?.matured)return'未到期';
 return num(x.matured)+'筆｜平均 '+pct(x.meanNetPct)+'｜勝率 '+pct(x.winRatePct)+'｜MAE '+pct(x.meanMAEPct);
}
function render(data){
 const dest=el();if(!dest)return;
 if(!data?.ok){dest.textContent='紀錄暫時無法載入：'+(data?.error||'請稍後重試');return}
 if(!data.storageReady){dest.innerHTML='<div class="notice">雲端保存尚未啟用；沒有假裝背景追蹤成功。'+esc(data.error||'')+'</div>';return}
 const sm=data.summary||{},n=data.eventCount||0;
 let html='<div class="reading">累積觀察 '+num(n)+'筆（最近最多500筆）｜觀察日期至 '+esc(data.asOf)+
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
root.GateBlockedUI={load,render};
})(window);
