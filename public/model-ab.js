/*
 * Read-only A/B validation and performance attribution.
 * Does not modify model, quotes, portfolio, storage, Gate or cloud sync.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    root.ModelABEvidence = api;
    api.attach(root.document, function () {
      return typeof MODEL_TRADES !== 'undefined' && Array.isArray(MODEL_TRADES) ? MODEL_TRADES : [];
    });
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const ETF = ['0050','0056','00878','00919'];
  const isNum = n => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n));
  const avg = xs => xs.length ? xs.reduce((sum,n) => sum + n,0) / xs.length : null;
  const fmt = n => isNum(n) ? (Number(n)>=0?'+':'')+Number(n).toFixed(2)+'%' : '—';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function family(t) {
    return t && t.tradeType === 'manual' ? 'manual' : (t && (t.modelFamily || (t.snapshot && t.snapshot.modelFamily))) || 'reasonable';
  }
  function classify(t) {
    const f = family(t), snap = t.snapshot || {};
    if (f === 'manual') return 'manual';
    const status = String(snap.modelStatusText || snap.modelStatus || '');
    if (/Gate\s*暫停|暫停交易|禁止交易|Hard Gate|BLOCKED/i.test(status)) return 'blocked';
    // Compare against the rule SAVED at entry; never apply today's rule to legacy trades.
    const minScore = snap.confirmationRule && snap.confirmationRule.minScore;
    if (f === 'reasonable' && isNum(snap.score) && isNum(minScore) &&
        Number(snap.score) < Number(minScore)) return 'blocked';
    if (f === 'trend') return snap.modelStatus === 'TREND_BUY' || /可小額|可加碼/.test(status) ? 'signaled' : 'review';
    return /已確認.{0,8}可分批/.test(status) ? 'signaled' : 'review';
  }
  function comparePolicies(trades) {
    const found = new Map();
    (trades || []).slice().sort((a,b) => String(b.entryAt || b.entryDate || '').localeCompare(String(a.entryAt || a.entryDate || ''))).forEach(t => {
      if (family(t) !== 'reasonable' || !ETF.includes(t.code) || found.has(t.code)) return;
      const policy = t.snapshot && t.snapshot.shadow && t.snapshot.shadow.policy;
      if (!policy || !policy.ready || !policy.oosMetrics || !policy.baselineOosMetrics ||
          !isNum(policy.oosMetrics.signals) || !isNum(policy.baselineOosMetrics.signals)) return;
      found.set(t.code, {
        code:t.code, date:t.entryDate || '', selectedId:policy.selectedId || 'unknown',
        confidence:policy.confidence || 'UNKNOWN', wfCount:Number(policy.wfCount)||0,
        signals:Number(policy.oosMetrics.signals), baseline:policy.baselineOosMetrics,
        shadow:policy.oosMetrics
      });
    });
    return ETF.map(code => found.get(code)).filter(Boolean);
  }
  function trendEvents(trades) {
    return new Set((trades || []).filter(t => family(t)==='trend')
      .map(t => t.code + '|' + (t.entryDate || String(t.entryAt || '').slice(0,10)))).size;
  }
  function summary(trades) {
    const all=(trades||[]).filter(t => t && typeof t==='object');
    const groups={signaled:[],blocked:[],review:[],manual:[]};
    for(const t of all) groups[classify(t)].push(t);
    const maturity={};
    for(const day of [5,20,60]){
      const items=groups.signaled.filter(t => isNum(t.perf && t.perf.horizon && t.perf.horizon[day] && t.perf.horizon[day].totalReturnPct));
      maturity[day]={count:items.length, grossReturnPct:avg(items.map(t => Number(t.perf.horizon[day].totalReturnPct)))};
    }
    const trend=all.filter(t => family(t)==='trend');
    return {total:all.length,model:all.length-groups.manual.length,groups,maturity,
      trendTrades:trend.length,trendEvents:trendEvents(trend),policies:comparePolicies(all)};
  }
  function metric(row,key) {
    const a=row.baseline[key], b=row.shadow[key];
    const delta=isNum(a)&&isNum(b)?Number(b)-Number(a):null;
    return esc(fmt(a))+' / '+esc(fmt(b))+
      '<small style="display:block">差 '+(delta===null?'—':esc((delta>=0?'+':'')+delta.toFixed(3)+' 個百分點'))+'</small>';
  }
  function renderPanel(el,trades) {
    const r=summary(trades);
    const tiles=[
      ['模型交易紀錄',r.model,'含舊版未核對交易'],
      ['快照顯示可買',r.groups.signaled.length,'快照文字，不代表逐筆回放已驗證'],
      ['Gate暫停／當時分數不足',r.groups.blocked.length,'不列入確認訊號'],
      ['待核對／觀察',r.groups.review.length,'不推定已正式確認'],
      ['人工買入',r.groups.manual.length,'不列入模型績效']
    ].map(x=>'<div class="box"><span class="k">'+esc(x[0])+'</span><b>'+x[1]+'</b><small>'+esc(x[2])+'</small></div>').join('');
    const periods=[5,20,60].map(n=>'<div class="box"><span class="k">'+n+'交易日｜成熟已確認快照</span><b>'+r.maturity[n].count+'筆</b><small>平均含息價格變動 '+fmt(r.maturity[n].grossReturnPct)+'（未扣成本）</small></div>').join('');
    const cols=[['avg5','5日平均'],['avg20','20日平均'],['avg60','60日平均'],['win20','20日勝率'],['avgMAE60','60日平均MAE']];
    const head=cols.map(x=>'<th>'+esc(x[1])+' A/B</th>').join('');
    const rows=r.policies.length?r.policies.map(p=>'<tr><td><b>'+p.code+'</b><small style="display:block">'+esc(p.date)+' 快照</small></td>'+
      '<td>'+esc(p.selectedId)+'</td><td>'+p.signals+'筆<small style="display:block">'+esc(p.confidence)+(p.signals<30?'｜樣本偏少':'')+'</small></td>'+
      cols.map(x=>'<td>'+metric(p,x[0])+'</td>').join('')+'</tr>').join(''):
      '<tr><td colspan="8">缺少可比較的 Baseline／Shadow 樣本外回測快照，暫無比較結果。</td></tr>';
    el.innerHTML='<div class="sectiontitle">A／B 驗證｜績效歸因（唯讀）</div>'+
      '<div class="note">本區只分析已儲存交易快照，不會變更正式買點、Gate、持股、交易紀錄或雲端同步。</div>'+
      '<div class="grid5">'+tiles+'</div>'+
      '<div class="reading" style="margin-top:10px"><b>強勢加碼去重提醒：</b>'+r.trendTrades+
      '筆交易按同 ETF＋同日暫合併為 '+r.trendEvents+' 個候選事件；未保存真實突破事件 ID，不能視為精確獨立樣本數。</div>'+
      '<div class="sectiontitle" style="margin-top:14px">成熟期間績效（僅快照顯示可買）</div><div class="grid3">'+periods+'</div>'+
      '<div class="note" style="margin-top:8px">這些是持有期含息價格報酬，尚未扣交易成本；未到期、Gate暫停及待核對交易不列入。</div>'+
      '<div class="sectiontitle" style="margin-top:14px">合理買點：歷史 Baseline（A）／Shadow（B）</div>'+
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;text-align:left;font-size:12px"><thead>'+
      '<tr><th>ETF</th><th>候選方案</th><th>OOS訊號數</th>'+head+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+
      '<div class="note" style="margin-top:8px">A/B來源為歷史交易快照裡的樣本外政策統計，非完整盤中回放。不同 ETF 的訓練期間與樣本量不同，不能直接比較；高分不是獲利機率。</div>'+
      '<div class="reading" style="margin-top:8px"><b>強勢加碼B版：</b>尚未取得具可比性的獨立歷史訊號與進出場紀錄，無法宣稱新版勝過正式版。</div>';
    return r;
  }
  function attach(doc,getTrades) {
    const panel=doc.getElementById('abValidation'),live=doc.getElementById('liveTradeSummary');
    if(!panel || !live || typeof getTrades!=='function')return false;
    let scheduled=false;
    function refresh() {
      if(scheduled)return;
      scheduled=true;
      Promise.resolve().then(()=>{
        scheduled=false;
        try{renderPanel(panel,getTrades());}
        catch(e){panel.textContent='A/B唯讀驗證暫不可用：'+String(e && e.message || e);}
      });
    }
    refresh();
    if(typeof MutationObserver!=='undefined')new MutationObserver(refresh).observe(live,{childList:true,subtree:true});
    doc.querySelectorAll('[data-page="model"]').forEach(n=>n.addEventListener('click',refresh));
    return true;
  }
  return {family,classify,comparePolicies,trendEvents,summary,renderPanel,attach};
});