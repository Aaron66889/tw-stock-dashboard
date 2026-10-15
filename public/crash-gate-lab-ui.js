/* Read-only crash hard-Gate audit and no-lookahead historical price proxy */
(function(root){
'use strict';
let pending=null,cache=null;
const el=id=>document.getElementById(id);
const f=n=>typeof n==='number'&&Number.isFinite(n)?n.toFixed(2):'—';
const p=n=>typeof n==='number'&&Number.isFinite(n)?n.toFixed(2)+'%':'—';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function auditSnippet(a){
 if(!a)return'';
 const flags=a.flags||[],hit=flags.filter(x=>x.hit).map(x=>x.label).join('、')||'無';
 return'<div class="reading" style="margin-top:7px;border-left:3px solid #d1a85b"><b>#13 急跌風控實驗（唯讀）</b>｜原判斷 '+a.existing.flagCount+'票'+(a.existing.blocked?'（阻擋）':'（未阻擋）')+
  '｜排除綜合環境重複計票 '+a.independent.flagCount+'項'+(a.independent.blocked?'（仍阻擋）':'（候選觀察）')+
  '<br><small>觸發項目：'+esc(hit)+'。'+(a.doubleCountRisk?'<b>可能重複計算風險；不代表安全可買。</b>':'獨立風險仍需評估。')+
  ' 此區不改正式硬Gate。</small></div>';
}
function statsLine(x){
 if(!x||!x.matured)return'<span class="note">無成熟樣本</span>';
 return x.matured+'筆｜均淨報酬 '+p(x.meanNetPct)+'｜勝率 '+p(x.winRatePct)+'｜MAE '+p(x.meanMAEPct)+'｜MFE '+p(x.meanMFEPct);
}
function render(d){
 const target=el('crashGateResearchResult');if(!target)return;
 if(!d?.ok){target.textContent='研究資料暫不可用：'+(d?.error||'未知錯誤');return}
 let out='<div class="note">讀取完成 '+esc(d.asOfDate)+'｜市場代理：0050 ETF日K，<b>不是台灣加權指數</b>。原版完整#13歷史快照無法回溯，故以下不能聲稱新策略打敗正式模型。實際正式Gate不變。</div>';
 for(const code of ['0050','0056','00878','00919']){
  const r=d.results?.[code]||{};
  if(!r.ok){out+='<div class="reading"><b>'+code+'</b>｜歷史資料不足：'+esc(r.status||'未取得')+'</div>';continue}
  const all=r.summary?.events??0,qualified=r.summary?.eligible??0,official=r.historyOfficial&&r.proxyOfficial;
  out+='<div class="reading" style="margin-top:10px"><b>'+code+'｜急跌事件 '+all+'次｜達收盤反彈過濾 '+qualified+'次</b>'+
   '<br><small>歷史來源：'+esc(r.source)+'｜'+(official?'TWSE官方價格樣本已就緒':'含備援歷史資料，結論暫時降級')+'｜'+esc(r.data?.firstEtfDay)+'～'+esc(r.data?.lastEtfDay)+'</small>';
  for(const n of [5,20,60]){
   const x=r.summary?.results?.[n]||{};
   out+='<div style="margin-top:7px"><b>'+n+'交易日</b><br><small>全急跌次日開盤：'+statsLine(x.unfiltered)+'<br>符合反彈過濾：'+statsLine(x.reboundQualified)+'</small></div>';
  }
  out+='</div>';
 }
 out+='<div class="note" style="margin-top:10px"><b>解讀限制：</b>兩組事件數可能不同，不能只看報酬差就說有因果優勢。回測採當日收盤才能知道的條件，次一交易日開盤假設成交；使用調整價代理，約扣0.385%來回成本，無法模擬最低零股手續費、滑價、盤中L1/L2/L3確認和歷史廣度。未滿5／20／60日的事件不列入成績。<b>正式交易訊號未調整。</b></div>';
 target.innerHTML=out;
}
async function load(force=false){
 const target=el('crashGateResearchResult');
 if(!target)return;
 if(cache&&!force){render(cache);return}
 if(pending)return pending;
 target.textContent='研究樣本讀取中（不影響現價、持股與正式買點）…';
 pending=(async()=>{
  try{
   const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),19000);
   try{
    const res=await fetch('/api/crash-gate-lab',{credentials:'same-origin',cache:'no-store',signal:ctl.signal});
    if(!res.ok)throw Error('HTTP '+res.status);
    const d=await res.json();cache=d.ok?d:null;render(d);
   }finally{clearTimeout(timeout)}
  }catch(e){if(target)target.textContent='暫時無法取得研究資料：'+(e?.message||'請稍後再試')}
  finally{pending=null}
 })();
 return pending;
}
root.CrashGateLabUI={auditSnippet,load,render};
})(window);
