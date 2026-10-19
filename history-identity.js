'use strict';
// Data provenance only: no model rules, scores, gates or trade state.
const CODES=new Set(['0050','0056','00878','00919']);
function rowSymbols(rows){
 const codes=new Set();
 for(const r of rows||[]){
  const s=String(r?.source||'');const m=s.match(/\b(\d{4,5})\.TW\b/i);
  if(m)codes.add(m[1]);
 }
 return [...codes].sort();
}
function inspect(code,hist){
 const rows=Array.isArray(hist?.rows)?hist.rows:[];
 const cacheCode=typeof hist?.code==='string'?hist.code:null;
 const observedSymbols=rowSymbols(rows);
 const mismatch=!!(cacheCode&&cacheCode!==code)||observedSymbols.some(x=>x!==code);
 const sample=r=>r?{date:String(r.date||''),rawClose:Number(r.rawClose)>0?Number(r.rawClose):null,
   seriesClose:Number(r.close)>0?Number(r.close):null,source:String(r.source||'')}:null;
 return{requestedCode:code,cacheCode,rowSymbols:observedSymbols,match:mismatch?'FAIL':cacheCode===code&&observedSymbols.includes(code)?'PASS':'NOT_VERIFIABLE',
  observations:rows.length,first:sample(rows[0]),last:sample(rows.at(-1)),
  note:mismatch?'快取代碼或行情列來源代碼不一致，請停止依賴該資料並重新建置歷史資料':
   cacheCode===code&&observedSymbols.includes(code)?'快取代碼與行情列標示的來源代碼相符；這不是外部價格逐筆核對':
   '無足夠代碼來源資訊可獨立核對；不能視為已通過來源驗證'};
}
function label(code,hist){
 if(!CODES.has(code))return String(hist?.source||'未辨識來源');
 const rows=Array.isArray(hist?.rows)?hist.rows:[];
 const audit=inspect(code,hist);
 if(audit.match==='FAIL')return '歷史行情代碼不一致（需檢查快取）';
 const sources=new Set(rows.map(r=>String(r?.source||'')).filter(Boolean));
 const yahoo=[...sources].some(s=>s.includes('Yahoo Finance'));
 const goodinfo=[...sources].some(s=>s.includes('Goodinfo'));
 const twse=[...sources].some(s=>s.includes('TWSE'));
 if(yahoo)return code==='0050'?'Yahoo Finance 0050.TW 長期日K（價格尺度QA＋1拆4校正）':
   'Yahoo Finance '+code+'.TW 長期調整日K（各檔獨立行情）';
 if(goodinfo)return 'Goodinfo '+code+' 長期還原權息日K';
 if(twse)return 'TWSE '+code+' 官方歷史日K＋ETF配息校正';
 // The legacy header may say "0050.TW" even for a different ETF; never repeat that misleading header.
 const existing=String(hist?.source||'');
 if(code!=='0050'&&/\b0050(?:\.TW)?\b/.test(existing))return '來源待核對（舊版誤標0050；行情列未提供代碼來源）';
 return existing||'歷史行情來源未標記';
}
module.exports={rowSymbols,inspect,label};
