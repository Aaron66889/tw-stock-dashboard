/* Read-only strong-add B monitor; loaded independently from official frontend app. */
(function(){
 'use strict';
 const ETF=['0050','0056','00878','00919'];
 const panel=document.getElementById('trendShadowB');
 if(!panel)return;
 const esc=x=>String(x==null?'':x).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const pct=(x,units='%')=>x==null||!Number.isFinite(Number(x))?'—':(Number(x)>=0?'+':'')+Number(x).toFixed(2)+units;
 const show=x=>x==null?'—':Number(x);
 let loading=false,last=0;
 const head='<div class="row"><div><div class="sectiontitle">強勢加碼 B 版｜Shadow實驗與A／B回放</div><div class="note">A版正式模型不變；B版是獨立候選訊號。歷史結果是日K價格核心代理測試，並非盤中實盤完整重播。</div></div><button class="btn" id="refreshTrendB">重新計算</button></div>';
 function table(statsA,statsB){
   if(!statsA||!statsB)return'<div class="note">歷史資料不足，不顯示比較。</div>';
   const rows=[5,20,60].map(n=>{
     const a=statsA.period?.[n]||{},b=statsB.period?.[n]||{};
     return'<tr><td>'+n+'日</td><td>'+show(a.samples)+' / '+show(b.samples)+'</td>'+
     '<td>'+pct(a.avgNetPct)+' / '+pct(b.avgNetPct)+'</td>'+
     '<td>'+pct(a.winPct)+' / '+pct(b.winPct)+'</td>'+
     '<td>'+pct(a.avgMAEPct)+' / '+pct(b.avgMAEPct)+'</td></tr>';
   }).join('');
   return'<div style="overflow:auto"><table class="table" style="min-width:560px"><thead><tr><th>持有期</th><th>A/B樣本</th><th>A/B平均淨報酬</th><th>A/B勝率</th><th>A/B平均MAE</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
 }
 function render(data){
   const models=data.models||{};
   let body='<div class="reading"><b>模型條件：</b>A版20日突破及均線；B版另要求正式強勢訊號、強度至少78分、突破幅度0.12～0.30 ATR，且現價不低於當日開盤。B版不會讓正式模型下單，也不會更改交易記錄。<br><span class="note">歷史A/B：兩版皆在訊號日收盤判定、次交易日開盤模擬進場，平均淨報酬含估計交易成本0.385%但不含最低手續費或滑價；歷史僅驗證價格核心，不能模擬完整分數與盤中條件。</span></div>';
   for(const code of ETF){
     const m=models[code],b=m?.shadowB,bt=m?.abPriceCore;
     const ready=!!bt?.ready,phase=b?.status==='B_CANDIDATE'?'B版候選成立':'B版觀察／等待';
     const color=b?.status==='B_CANDIDATE'?'upc':'amber';
     const live=b?'<b class="'+color+'">'+esc(phase)+'</b>｜'+esc(b.reason)+'<br><span class="note">正式A版：'+esc(m.statusText||m.status||'—')+'｜分數 '+esc(m.score??'—')+'/100｜突破距離 '+esc(b.breakoutAtr??'—')+' ATR</span>':'<b class="amber">B版資料尚未取得</b>';
     const a=bt?.all?.A,bb=bt?.all?.B,tw=bt?.check2026;
     const summary=ready?'<div class="note">長期歷史：A '+show(a?.signals)+'次，B '+show(bb?.signals)+'次｜5日假突破率 A '+pct(a?.fakeBreak5?.rate)+'（'+show(a?.fakeBreak5?.samples)+'筆）／B '+pct(bb?.fakeBreak5?.rate)+'（'+show(bb?.fakeBreak5?.samples)+'筆）｜OHLC覆蓋 '+esc(bt.ohlcCoveragePct)+'%</div>'+
       table(a,bb)+
       '<div class="note">2026近期區段：20日 A '+pct(tw?.A?.period?.[20]?.avgNetPct)+'（'+show(tw?.A?.period?.[20]?.samples)+'筆），B '+pct(tw?.B?.period?.[20]?.avgNetPct)+'（'+show(tw?.B?.period?.[20]?.samples)+'筆）。'+esc(bt.disclosure||'')+'</div>':
       '<div class="note">日K回測不可用：'+esc(bt?.error||m?.error||'資料準備中')+'｜有效K數 '+esc(bt?.historyDays??'—')+'｜OHLC覆蓋 '+esc(bt?.ohlcCoveragePct??'—')+'%</div>';
     body+='<section class="box" style="margin-top:12px"><div class="row"><b>'+esc(code)+'｜'+esc(m?.name||'')+'</b><span class="note">Shadow '+esc(b?.version||'—')+'</span></div>'+
       '<div class="reading" style="margin:8px 0">'+live+'</div>'+summary+'</section>';
   }
   panel.innerHTML=head+body+'<div class="reading" style="margin-top:12px"><b>判讀限制：</b>本次A/B使用固定的日線規則，但規則是看過近期市場事件後設計；即使B版回測較佳，也不能直接宣稱B版已獲得獨立樣本外證明。仍需記錄未來的真實 Shadow 訊號與價格路徑。<br><span class="note">資料時間 '+esc(data.fetchedAt||'—')+'｜強勢加碼正式訊號未變更。</span></div>';
   panel.querySelector('#refreshTrendB')?.addEventListener('click',()=>load(true));
 }
 async function load(force=false){
   if(document.hidden||!document.getElementById('trendBuyPage')?.classList.contains('on')||loading)return;
   if(!force&&Date.now()-last<25000)return;
   loading=true;
   if(!last)panel.innerHTML=head+'<div class="reading">正在取得完整強勢A/B價格核心回放與即時B版候選訊號…</div>';
   try{
     const res=await fetch('/api/trend-entry',{cache:'no-store'});
     if(!res.ok)throw Error('HTTP '+res.status);
     const d=await res.json();if(!d.ok)throw Error(d.error||'資料不可用');
     last=Date.now();render(d);
   }catch(err){panel.innerHTML=head+'<div class="note">強勢B版測試暫不可用：'+esc(err.message)+'。正式A版仍獨立運作。</div>';
     panel.querySelector('#refreshTrendB')?.addEventListener('click',()=>load(true));
   }finally{loading=false}
 }
 document.querySelectorAll('[data-page="trendBuyPage"]').forEach(el=>el.addEventListener('click',()=>setTimeout(()=>load(false),0)));
 setInterval(()=>load(false),30000);
 if(document.getElementById('trendBuyPage')?.classList.contains('on'))load(false);
})();