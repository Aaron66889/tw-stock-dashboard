'use strict';
// Independent 0050 split/cash adjustment RESEARCH only; never feeds a live trading Gate.
// Current 0050 provider normalizes the 2025 1:4 SPLIT, but its adjclose ignores cash dividends.
const SPLIT_DATE='2025-06-18',SPLIT_RATIO=4;
const ANCHORS=[
 {date:'2024-01-17',preSplitAmount:3.00,postScaleAmount:.75},
 {date:'2024-07-16',preSplitAmount:1.00,postScaleAmount:.25},
 {date:'2025-01-17',preSplitAmount:2.70,postScaleAmount:.675},
 {date:'2025-07-21',postScaleAmount:.36},
 {date:'2026-01-22',postScaleAmount:1.00},
 {date:'2026-07-21',postScaleAmount:.60}
];
const closeTo=(a,b,tol=.0006)=>Number.isFinite(a)&&Math.abs(a-b)<=tol;
function amountForScale(e,basis){
 const amount=Number(e.amount),date=e.exDate||e.date;
 if(!(amount>0))return null;
 return date<SPLIT_DATE&&basis==='HISTORICAL_PER_SHARE'?amount/SPLIT_RATIO:amount;
}
function create0050CashResearch(inputRows,dividendEvents,{asOfDate='2026-10-19'}={}){
 const src=Array.isArray(inputRows)?inputRows.slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))):[];
 const events=(Array.isArray(dividendEvents)?dividendEvents:[]).filter(e=>(e.exDate||e.date)&&Number(e.amount)>0)
  .map(e=>({date:String(e.exDate||e.date),amount:Number(e.amount),estimated:e.estimated===true}))
  .sort((a,b)=>a.date.localeCompare(b.date));
 const issues=[],warnings=[];
 const sourcePriceBasis=src[0]?.priceBasis||null;
 if(src.length<340)issues.push('PRICE_HISTORY_INCOMPLETE');
 if(!src.length||src.some(r=>r.priceBasis!=='normalized-split-scale-v2'))issues.push('NOT_0050_SPLIT_ONLY_BASIS');
 if(src.some((r,i)=>!Number.isFinite(Number(r.close))||Number(r.close)<=0||(i&&src[i-1].date>=r.date)))issues.push('UNSORTED_OR_INVALID_PRICE_BARS');
 const coverageByYear={};
 for(const e of events)coverageByYear[e.date.slice(0,4)]=(coverageByYear[e.date.slice(0,4)]||0)+1;
 if(events.some(e=>e.estimated))issues.push('ESTIMATED_DIVIDEND_NOT_ALLOWED');
 if(new Set(events.map(e=>e.date)).size!==events.length)issues.push('DUPLICATE_EX_DIVIDEND_DATE');
 const anchorChecks=ANCHORS.filter(a=>a.date<=asOfDate).map(a=>{
  const entry=events.find(e=>e.date===a.date);
  const amount=entry?.amount??null;
  const plausible=entry?closeTo(amount,a.preSplitAmount??a.postScaleAmount)||closeTo(amount,a.postScaleAmount):false;
  return{date:a.date,sourceAmount:amount,expectedPostSplitAmount:a.postScaleAmount,plausible,
    note:plausible?'配息日期和金額符合已核對公開公告':'缺少或與已核對公開公告不符'};
 });
 if(anchorChecks.some(a=>!a.plausible))issues.push('DIVIDEND_ANCHOR_MISMATCH');
 const preAnchors=ANCHORS.filter(a=>a.preSplitAmount&&a.date<=asOfDate).map(a=>{
  const amount=events.find(e=>e.date===a.date)?.amount;
  if(!Number.isFinite(amount))return null;
  if(closeTo(amount,a.preSplitAmount))return'HISTORICAL_PER_SHARE';
  if(closeTo(amount,a.postScaleAmount))return'ALREADY_POST_SPLIT';
  return'UNKNOWN';
 }).filter(Boolean);
 const uniqueBasis=[...new Set(preAnchors)],basis=uniqueBasis.length===1?uniqueBasis[0]:'AMBIGUOUS';
 if(basis==='AMBIGUOUS'||basis==='UNKNOWN')issues.push('DIVIDEND_UNIT_SCALE_AMBIGUOUS');
 const first=src[0]?.date,last=src.at(-1)?.date;
 const firstYear=Number(first?.slice(0,4)),lastYear=Number(last?.slice(0,4));
 // This check is intentionally stronger than a generic minimum "20 dividends".
 // It cannot prove source completeness, but prevents silent use of an incomplete event set.
 if(first&&last)for(let y=firstYear;y<=lastYear;y++){
  const fullYear=y<lastYear||(asOfDate>=y+'-08-01');
  if(!fullYear)continue;
  const expected=y>=2017?2:1,have=coverageByYear[String(y)]||0;
  if(have<expected)issues.push('DIVIDEND_COVERAGE_'+y+'_HAS_'+have+'_EXPECTED_'+expected);
 }
 const dayIndex=new Map(src.map((r,i)=>[r.date,i])),normalizedEvents=[],eventWindows=[];
 if(!issues.includes('DIVIDEND_UNIT_SCALE_AMBIGUOUS')){
  for(const e of events){
   if(e.date<first||e.date>last)continue;
   const idx=dayIndex.get(e.date),a=amountForScale(e,basis);
   if(!Number.isInteger(idx)||idx<1){issues.push('MISSING_EX_DIVIDEND_TRADING_BAR_'+e.date);continue}
   if(!(a>0&&Number(src[idx-1].close)>a)){issues.push('INVALID_DIVIDEND_FACTOR_'+e.date);continue}
   normalizedEvents.push({...e,normalizedAmount:a,index:idx,factor:(Number(src[idx-1].close)-a)/Number(src[idx-1].close)});
   const prev=Number(src[idx-1].close),ex=Number(src[idx].close),neutralGap=(ex/(prev-a)-1)*100;
   eventWindows.push({date:e.date,rawSourceAmount:e.amount,normalizedAmount:a,
    priorDate:src[idx-1].date,priorSplitOnlyClose:prev,exSplitOnlyClose:ex,
    cashNeutralGapPct:Number(neutralGap.toFixed(3))});
   if(Math.abs(neutralGap)>15)warnings.push('EX_DIV_PRICE_MOVE_REVIEW_'+e.date);
  }
 }
 const before=src.findLast(r=>r.date<SPLIT_DATE),after=src.find(r=>r.date>=SPLIT_DATE);
 const splitBoundary=before&&after?{lastPreSplitTradingDay:before.date,
  firstPostSplitTradingDay:after.date,priorNormalizedClose:Number(before.close),
  afterNormalizedClose:Number(after.close),
  normalizedChangePct:Number(((after.close/before.close-1)*100).toFixed(3)),
  alreadyNormalized:src.every(r=>r.priceBasis==='normalized-split-scale-v2')}:null;
 if(!splitBoundary)issues.push('MISSING_SPLIT_BOUNDARY');
 else if(Math.abs(splitBoundary.normalizedChangePct)>30)issues.push('SPLIT_BOUNDARY_GAP_REVIEW');
 const ready=issues.length===0;
 let rows=[];
 if(ready){
  const multipliers=Array(src.length).fill(1);let factor=1,pos=normalizedEvents.length-1;
  // Move backward; an ex-dividend cash factor adjusts ONLY dates prior to the ex-date.
  for(let i=src.length-1;i>=0;i--){
   while(pos>=0&&normalizedEvents[pos].index>i){factor*=normalizedEvents[pos].factor;pos--}
   multipliers[i]=factor;
  }
  rows=src.map((r,i)=>{
   const k=multipliers[i],price=v=>v!=null&&Number(v)>0?Number(v)*k:null;
   return{...r,close:Number(r.close),adjclose:price(r.close),
    adjopen:price(r.open),adjhigh:price(r.high),adjlow:price(r.low),
    priceBasis:'0050-split-cash-total-return-research-v1',researchOnly:true};
  });
  // A historical adjustment must keep the latest cash price unchanged.
  if(Math.abs(rows.at(-1).adjclose-src.at(-1).close)>0.000001){
   issues.push('LATEST_PRICE_ANCHOR_CHANGED');rows=[];
  }
 }
 return{version:'0050-split-cash-research-v1',mode:'SHADOW_ONLY',
  state:issues.length?'BLOCKED':'RESEARCH_READY',canPromoteToLive:false,
  qa:{issues,warnings,sourcePriceBasis,historyRows:src.length,firstDate:first||null,lastDate:last||null,
   dividendCount:events.length,normalizedDividendCount:normalizedEvents.length,
   dividendBasis:basis,coverageByYear,anchorChecks,splitBoundary},
  events:eventWindows,rows};
}
module.exports={create0050CashResearch,amountForScale,SPLIT_DATE,ANCHORS};
