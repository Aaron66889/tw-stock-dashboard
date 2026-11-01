'use strict';
/*
 * Official crash Gate v2: independent inputs only.
 * Environment is a composite of market/TSMC/breadth and MUST NOT be a fourth
 * vote. It remains a continuous model score penalty, not an independent veto.
 * Never treat missing evidence as a passing observation; stale quotes and
 * missing corporate-action reference are unconditional hard stops.
 */
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function evaluate({marketPct=null,tsmcPct=null,breadthRatio=null,breadthUsable=false,environmentScore=null,fresh=true,corpActionBlocked=false}={}){
 const flags=[
  {id:'market',group:'market',label:'大盤<-2.2%',available:finite(marketPct),hit:finite(marketPct)&&marketPct<-2.2},
  {id:'tsmc',group:'concentration',label:'台積電<-3%',available:finite(tsmcPct),hit:finite(tsmcPct)&&tsmcPct<-3},
  {id:'breadth',group:'breadth',label:'上市廣度<22%',available:breadthUsable&&finite(breadthRatio),hit:breadthUsable&&finite(breadthRatio)&&breadthRatio<.22},
  {id:'environment',group:'derived',label:'綜合環境分數<-65（衍生訊號，不獨立計票）',available:finite(environmentScore),hit:finite(environmentScore)&&environmentScore<-65}
 ];
 const legacyCount=flags.filter(x=>x.hit).length;
 const independentCount=flags.filter(x=>x.hit&&x.group!=='derived').length;
 const riskBlocked=independentCount>=2;
 const hardBlocked=!fresh||!!corpActionBlocked||riskBlocked;
 const reason=corpActionBlocked?'偵測到疑似除權息，但TWSE官方除權息參考價暫不可用；本檔買點暫停採用':
  !fresh?'資料時間戳逾時':riskBlocked?'大盤／台積電／市場廣度至少兩項獨立急殺':null;
 return{version:'independent-crash-gate-v2',flags,
  legacy:{count:legacyCount,blocked:legacyCount>=2},
  independent:{count:independentCount,blocked:riskBlocked},
  hardBlocked,reason,
  overlapRisk:legacyCount>=2&&independentCount<2&&flags[3].hit,
  evidenceComplete:flags.slice(0,3).every(x=>x.available)};
}
module.exports={evaluate};
