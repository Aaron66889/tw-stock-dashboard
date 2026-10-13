/* Read-only forward Shadow A/B evidence, separate from trade/holding synchronization. */
(function(){
 'use strict';
 const el=document.getElementById('trendForwardLedger');
 if(!el)return;
 const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const num=(x,units='%')=>x==null||!Number.isFinite(Number(x))?'—':(Number(x)>=0?'+':'')+Number(x).toFixed(2)+units;
 const head='<div class="row"><div><div class="sectiontitle">A／B 前向實盤訊號帳簿</div><div class="note">只有模型訊號，不是你的實際下單。跨裝置共用雲端紀錄，10個交易日內同一ETF僅計一波；每次A首次訊號價格固定，B在同波首次通過時另記價格。</div></div><button class="btn" id="trendLedgerReload">更新驗證</button></div>';
 let busy=false,last=0;
 const periodLine=(label,values)=>'<tr><td>'+label+'</td>'+
  ['a','b','aWhenBMatched','aWhenBExcluded'].map(k=>{
    const x=values?.[k]||{};return'<td>'+esc(x.samples??0)+'筆｜'+num(x.avgNetPct)+'<small style="display:block">勝率 '+num(x.winPct)+'｜MAE '+num(x.avgMAEPct)+'</small></td>';
  }).join('')+'</tr>';
 function render(d){
   const events=Array.isArray(d.events)?d.events:[],s=d.summary||{},st=d.storageReady===false;
   let html=head;
   if(st)html+='<div class="notice"><b class="downc">前向紀錄尚未啟用</b>：'+esc(d.error||'雲端儲存未設定')+'。不會以瀏覽器本機資料假裝已備份。</div>';
   else html+='<div class="grid4">'+
    [['獨立A訊號',s.events??0],['其中B也通過',s.bPassedEvents??0],['A通過但B未通過',s.bPendingEvents??0],['最近掃描啟動',d.lastScanAt?new Date(d.lastScanAt).toLocaleString('zh-TW',{hour12:false}):'尚未啟動']].
    map(([k,v])=>'<div class="box"><span class="k">'+esc(k)+'</span><b>'+esc(v)+'</b></div>').join('')+'</div>';
   if(!events.length){
     html+='<div class="reading" style="margin-top:10px">尚未記錄到符合正式A版強勢加碼的有效盤中訊號。系統僅在台股交易時段09:03～13:25自動掃描；不回填、也不把歷史回測訊號當作前向實測。</div>';
   }else{
     html+='<div class="sectiontitle" style="margin-top:12px">成熟5／20／60交易日比較</div>'+
      '<div style="overflow:auto"><table class="table" style="min-width:680px"><thead><tr><th>期間</th><th>A全數</th><th>B首次通過</th><th>A且B通過事件</th><th>A但B未通過</th></tr></thead><tbody>'+
      [5,20,60].map(n=>periodLine(n+'日',s.byPeriod?.[n])).join('')+'</tbody></table></div>'+
      '<div class="note">5日假突破率：A '+num(s.fakeBreak5?.a?.ratePct)+'（'+esc(s.fakeBreak5?.a?.samples??0)+'樣本），B '+num(s.fakeBreak5?.b?.ratePct)+'（'+esc(s.fakeBreak5?.b?.samples??0)+'樣本）。績效須滿期才進分母；B未通過的訊號不會有B模擬績效。不能把選擇性過濾後的B績效當成同一批交易的直接勝負。</div>';
     const rows=events.slice(0,35).map(e=>{
       const a=e.a||{},b=e.b||{},a20=e.outcomes?.a?.horizons?.[20],b20=e.outcomes?.b?.horizons?.[20];
       const a5=e.outcomes?.a?.horizons?.[5],b5=e.outcomes?.b?.horizons?.[5],a60=e.outcomes?.a?.horizons?.[60],b60=e.outcomes?.b?.horizons?.[60];
       return'<tr><td>'+esc(e.day)+'</td><td><b>'+esc(e.code)+'</b><small style="display:block">'+esc(e.firstObservedAt?new Date(e.firstObservedAt).toLocaleTimeString('zh-TW',{hour12:false}):'—')+'</small></td>'+
        '<td>'+num(a.entryPrice,'元')+'<small style="display:block">分數 '+esc(a.score??'—')+'</small></td>'+
        '<td>'+(b.entryPrice?'<b class="upc">B已通過</b> '+num(b.entryPrice,'元'):'<b class="amber">B未通過</b>')+'<small style="display:block">'+esc(b.reason||e.lastBVerdict?.reason||'—')+'</small></td>'+
        '<td>'+num(a5?.netReturnPct)+' / '+num(b5?.netReturnPct)+'</td>'+
        '<td>'+num(a20?.netReturnPct)+' / '+num(b20?.netReturnPct)+'</td>'+
        '<td>'+num(a60?.netReturnPct)+' / '+num(b60?.netReturnPct)+'</td></tr>';
     }).join('');
     html+='<div class="sectiontitle" style="margin-top:12px">獨立訊號紀錄（新至舊，顯示最多35筆）</div>'+
      '<div style="overflow-x:auto"><table class="table" style="min-width:780px"><thead><tr><th>日期</th><th>ETF／時間</th><th>A首筆參考價</th><th>B候選</th><th>5日 A/B</th><th>20日 A/B</th><th>60日 A/B</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
   }
   html+='<div class="reading" style="margin-top:10px"><b>重要：</b>前向訊號從此功能正式上線後才開始，不追溯舊交易。績效以日K還原權息後的價格代理計算，減去估計來回費用0.385%；未計最低手續費及滑價，進場當日K線的MAE/MFE不納入。日K成熟判斷至少延後到下一台灣日期，缺資料會顯示「—」。<br><span class="note">每5分鐘嘗試掃描，網路或歷史資料不可用時可能漏記；目前不等於逐筆成交級實盤重播。'+esc(d.collection||'')+'</span></div>';
   el.innerHTML=html;
   el.querySelector('#trendLedgerReload')?.addEventListener('click',()=>load(true));
 }
 async function load(force=false){
   if(document.hidden||!document.getElementById('trendBuyPage')?.classList.contains('on')||busy)return;
   if(!force&&Date.now()-last<30000)return;
   busy=true;if(!last)el.innerHTML=head+'<div class="reading">正在讀取雲端前向訊號帳簿…</div>';
   try{
     const res=await fetch('/api/trend-ab-forward',{cache:'no-store'});
     if(!res.ok)throw Error('HTTP '+res.status);
     const d=await res.json();if(!d.ok)throw Error(d.error||'資料暫不可用');
     last=Date.now();render(d);
   }catch(e){
     el.innerHTML=head+'<div class="notice">A／B前向紀錄讀取失敗：'+esc(e.message)+'。不影響正式模型或交易紀錄。</div>';
     el.querySelector('#trendLedgerReload')?.addEventListener('click',()=>load(true));
   }finally{busy=false}
 }
 document.querySelectorAll('[data-page="trendBuyPage"]').forEach(x=>x.addEventListener('click',()=>setTimeout(()=>load(false),0)));
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)load(false)});
 setInterval(()=>load(false),60000);
 if(document.getElementById('trendBuyPage')?.classList.contains('on'))load(false);
})();