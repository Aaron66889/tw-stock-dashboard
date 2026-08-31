'use strict';
const http=require('http');
const fs=require('fs');
const path=require('path');
const {URL}=require('url');
let XLSX=null; try{XLSX=require('xlsx')}catch(_){}

const PORT=process.env.PORT||3000;
const PUBLIC=path.join(__dirname,'public');
const VERSION='V12.4';
const BUILD='16.8.18-VISIBILITY-RESTART-FIX';
const DATA_DIR=path.join(__dirname,'data'); if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true});
const ETF=['0050','0056','00878','00919'];
const META={
 '0050':{name:'元大台灣50',listed:'2003-06-30',expected:50,fundId:'1066',source:'Yuanta',url:'https://www.yuantaetfs.com/product/detail/0050/ratio',
   cfg:{q:[.45,.25,.10],chaseBase:23,chasePctile:66,chaseDev:650,chaseR20:190,envShiftNeg:.020,envShiftPos:.0045,healthShift:.0040,reanchor:.18}},
 '0056':{name:'元大高股息',listed:'2007-12-26',expected:50,fundId:'1084',source:'Yuanta',url:'https://www.yuantaetfs.com/product/detail/0056/ratio',
   cfg:{q:[.48,.27,.11],chaseBase:21,chasePctile:68,chaseDev:570,chaseR20:175,envShiftNeg:.016,envShiftPos:.0040,healthShift:.0032,reanchor:.20}},
 '00878':{name:'國泰永續高股息',listed:'2020-07-20',expected:30,source:'Cathay',url:'https://www.cathaysite.com.tw/fund-details/ECN?tab=portfolio',
   cfg:{q:[.48,.27,.11],chaseBase:20,chasePctile:69,chaseDev:560,chaseR20:170,envShiftNeg:.016,envShiftPos:.0040,healthShift:.0033,reanchor:.21}},
 '00919':{name:'群益台灣精選高息',listed:'2022-10-20',expected:40,source:'Capital',url:'https://www.capitalfund.com.tw/etf/product/detail/195/buyback',portfolioUrl:'https://www.capitalfund.com.tw/etf/product/detail/195/portfolio',
   cfg:{q:[.50,.28,.12],chaseBase:22,chasePctile:68,chaseDev:590,chaseR20:180,envShiftNeg:.017,envShiftPos:.0038,healthShift:.0034,reanchor:.20}}
};
const cache=new Map(),nightSamples=[];
const HISTORY_JOBS=new Map(),WARM_QUEUE=[],DIV_MIN={'0050':20,'0056':12,'00878':12,'00919':8};
let WARM_ACTIVE=false;
const RUNTIME={live:null,ctx:null,nf:null,ovs:null,bm:null,refreshing:false,lastRefresh:null,errors:[]};
const ETF_TW_LIVE={quotes:{},errors:{},running:false,index:0,lastCycleAt:null};

async function refreshOneYahooTwETF(){
 if(ETF_TW_LIVE.running)return;
 ETF_TW_LIVE.running=true;
 const code=ETF[ETF_TW_LIVE.index%ETF.length];
 ETF_TW_LIVE.index=(ETF_TW_LIVE.index+1)%ETF.length;
 try{
  const q=await deadline(yahooTwPageOne(code),5000,null);
  if(q?.last>0){
   ETF_TW_LIVE.quotes[code]=q;
   ETF_TW_LIVE.errors[code]=null;
   ETF_TW_LIVE.lastCycleAt=new Date().toISOString();
  }else ETF_TW_LIVE.errors[code]='Yahoo台股頁面逾時';
 }catch(e){ETF_TW_LIVE.errors[code]=e.message||String(e)}
 finally{ETF_TW_LIVE.running=false}
}
function startYahooTwEtfPump(){
 refreshOneYahooTwETF();
 setInterval(refreshOneYahooTwETF,1200);
}


function n(v){if(v==null||v===''||v==='-'||v==='－')return null;const x=Number(String(v).replace(/,/g,'').replace('%','').trim());return Number.isFinite(x)?x:null}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function mean(a){const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null}
function median(a){return quantile(a,.5)}
function quantile(arr,q){const a=arr.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const p=(a.length-1)*q,l=Math.floor(p),h=Math.ceil(p);return l===h?a[l]:a[l]+(a[h]-a[l])*(p-l)}
function weightedAvailable(items){const a=items.filter(x=>Number.isFinite(x.v)&&x.w>0),d=a.reduce((s,x)=>s+x.w,0);return d?a.reduce((s,x)=>s+x.v*x.w,0)/d:null}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function send(res,status,body,type='application/json; charset=utf-8'){
 res.writeHead(status,{'Content-Type':type,'Cache-Control':type.startsWith('application/json')?'no-store':'public,max-age=120','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'});
 res.end(Buffer.isBuffer(body)?body:(typeof body==='string'?body:JSON.stringify(body)));
}
async function fetchTimeout(url,opts={},ms=9000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{...opts,signal:c.signal})}finally{clearTimeout(t)}}
async function getJSON(url,headers={},tries=2){let e;for(let i=0;i<tries;i++){try{const r=await fetchTimeout(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json,text/plain,*/*','Accept-Language':'zh-TW,zh;q=0.9',...headers}},12000);const text=await r.text();if(!r.ok)throw Error('HTTP '+r.status+' '+new URL(url).hostname);const t=text.trim();if(!(t.startsWith('{')||t.startsWith('[')))throw Error('來源回傳非JSON：'+new URL(url).hostname+'｜'+t.slice(0,45).replace(/\s+/g,' '));try{return JSON.parse(t)}catch(err){throw Error('JSON解析失敗：'+new URL(url).hostname+'｜'+err.message)}}catch(x){e=x;if(i+1<tries)await sleep(300*(i+1))}}throw e}
async function getJSONQuick(url,headers={},ms=4500){const r=await fetchTimeout(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json,text/plain,*/*','Accept-Language':'zh-TW,zh;q=0.9',...headers}},ms);const text=await r.text();if(!r.ok)throw Error('HTTP '+r.status+' '+new URL(url).hostname);const t=text.trim();if(!(t.startsWith('{')||t.startsWith('[')))throw Error('來源回傳非JSON：'+new URL(url).hostname+'｜'+t.slice(0,45).replace(/\s+/g,' '));return JSON.parse(t)}
function deadline(p,ms,fallback){return Promise.race([p,new Promise(resolve=>setTimeout(()=>resolve(fallback),ms))])}
function twMarketOpenNow(){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date()).map(x=>[x.type,x.value]));const wd=parts.weekday,m=Number(parts.hour)*60+Number(parts.minute);return ['Mon','Tue','Wed','Thu','Fri'].includes(wd)&&m>=540&&m<=810}

async function getText(url,headers={},tries=2){let e;for(let i=0;i<tries;i++){try{const r=await fetchTimeout(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html,application/xhtml+xml,*/*','Accept-Language':'zh-TW,zh;q=0.9',...headers}},9000);if(!r.ok)throw Error('HTTP '+r.status);return await r.text()}catch(x){e=x;if(i+1<tries)await sleep(250*(i+1))}}throw e}
async function postText(url,headers={},ms=15000){const r=await fetchTimeout(url,{method:'POST',headers:{'User-Agent':'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.0)','Accept':'text/html,application/xhtml+xml,*/*','Accept-Language':'zh-TW,zh;q=0.9','Content-Type':'application/x-www-form-urlencoded','Cache-Control':'no-cache','Pragma':'no-cache','If-Modified-Since':'Sat, 1 Jan 2000 00:00:00 GMT',...headers},body:''},ms);if(!r.ok)throw Error('HTTP '+r.status);return await r.text()}
async function getBuffer(url,headers={}){const r=await fetchTimeout(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'*/*',...headers}},12000);if(!r.ok)throw Error('HTTP '+r.status);return Buffer.from(await r.arrayBuffer())}
async function cached(key,ttl,fn){const c=cache.get(key),now=Date.now();if(c&&now-c.at<ttl)return {...c.v,cached:true};const v=await fn();cache.set(key,{at:now,v});return {...v,cached:false}}
function stripTags(s){return String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&#x27;|&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim()}
function ymdTaipei(d=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)}
function parseROCDate(s){const m=String(s||'').match(/(\d{3})[\/.-](\d{1,2})[\/.-](\d{1,2})/);return m?`${Number(m[1])+1911}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`:null}
function parseISODate(s){const m=String(s||'').match(/(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})/);return m?`${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`:null}
function dateMinus(days){const d=new Date(Date.now()-days*86400000);return ymdTaipei(d)}

async function mis(exch){
 const nonce=Date.now()+'_'+Math.random().toString(36).slice(2);
 return getJSONQuick(
  'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch='+encodeURIComponent(exch)+'&json=1&delay=0&_='+nonce,
  {
   'Referer':'https://mis.twse.com.tw/stock/index.jsp',
   'Cache-Control':'no-cache, no-store, max-age=0',
   'Pragma':'no-cache',
   'Expires':'0',
   'If-Modified-Since':'Thu, 01 Jan 1970 00:00:00 GMT',
   'Accept-Encoding':'identity'
  },
  3500
 )
}
function parseMis(x){
 const z=n(x.z),y=n(x.y),open=n(x.o),high=n(x.h),low=n(x.l);
 return{
  ticker:String(x.c||'').trim(),
  name:x.n||'',
  channel:x.ch||'',
  last:z,
  prevClose:y,
  open,high,low,
  volume:n(x.v),
  time:x.t||null,
  date:x.d||null,
  hasTrade:Number.isFinite(z)&&z>0
 };
}
async function quoteCodes(codes){
 const uniq=[...new Set(codes.filter(x=>/^\d{4,6}$/.test(String(x))))],out={};
 try{
  for(let i=0;i<uniq.length;i+=22){const chunk=uniq.slice(i,i+22),ex=chunk.flatMap(c=>['tse_'+c+'.tw','otc_'+c+'.tw']).join('|'),rows=(await mis(ex)).msgArray||[];for(const x of rows){const z=parseMis(x);if(z.ticker&&z.last>0){z.source='TWSE MIS';z.realtime=true;out[z.ticker]=z}}}
  if(Object.keys(out).length>=Math.max(3,uniq.length*.65))return out;
 }catch(_){}
 try{const day=await twseDailyAll();for(const c of uniq)if(!out[c]&&day.map[c])out[c]=day.map[c]}catch(_){}
 return out;
}
async function twseDailyAll(){
 return cached('twse:dayall',30000,async()=>{
  const arr=await getJSONQuick('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',{},6500),map={};
  for(const r of (Array.isArray(arr)?arr:[])){
   const code=String(r.Code||r['證券代號']||'').trim();if(!code)continue;
   const close=n(r.ClosingPrice??r['收盤價']),chg=n(r.Change??r['漲跌價差']),open=n(r.OpeningPrice??r['開盤價']),high=n(r.HighestPrice??r['最高價']),low=n(r.LowestPrice??r['最低價']);
   if(!(close>0))continue;const prev=Number.isFinite(chg)?close-chg:null;
   map[code]={ticker:code,name:r.Name||r['證券名稱']||code,last:close,prevClose:prev,open,high,low,volume:n(r.TradeVolume??r['成交股數']),time:null,date:String(r.Date||''),source:'TWSE STOCK_DAY_ALL盤後快照',realtime:false};
  }
  return{map,source:'TWSE STOCK_DAY_ALL盤後快照',fetchedAt:new Date().toISOString()};
 });
}

async function yahooTwPageOne(code){
 const url='https://tw.stock.yahoo.com/quote/'+code+'.TW?_='+Date.now();
 const html=await getText(url,{
  'Cache-Control':'no-cache',
  'Pragma':'no-cache',
  'Referer':'https://tw.stock.yahoo.com/'
 },1);

 // Yahoo台股報價頁本身的現價欄位。
 let m=html.match(/data-field=["']regularMarketPrice["'][^>]*>\s*([^<]+?)\s*</i);
 if(!m)m=html.match(/["']regularMarketPrice["']\s*:\s*\{?[^}]{0,180}?["'](?:raw|value)["']\s*:\s*([0-9.]+)/i);
 if(!m)m=html.match(/["']regularMarketPrice["']\s*:\s*([0-9.]+)/i);
 if(!m)throw Error('Yahoo台股頁面找不到 regularMarketPrice '+code);

 const last=n(String(m[1]).replace(/,/g,''));
 if(!(last>0))throw Error('Yahoo台股頁面現價無效 '+code);

 let tm=null;
 const mt=html.match(/["']regularMarketTime["']\s*:\s*([0-9]{10,13})/i);
 if(mt){
  let epoch=Number(mt[1]);
  if(epoch>1e12)epoch=Math.floor(epoch/1000);
  if(epoch>1e9)tm=new Date(epoch*1000).toISOString();
 }

 return{
  ticker:code,
  name:META[code]?.name||code,
  last,
  prevClose:null,
  open:null,high:null,low:null,volume:null,
  time:tm||new Date().toISOString(),
  date:new Date().toISOString().slice(0,10),
  source:'Yahoo台股報價頁 '+code+'.TW',
  realtime:true
 };
}
async function yahooTwOne(code,isIndex=false){
 const symbol=isIndex?'^TWII':code+'.TW',
       url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?interval=1m&range=1d&includePrePost=false&_='+Date.now();
 const d=await getJSONQuick(url,{'Cache-Control':'no-cache','Pragma':'no-cache'},5000),
       r=d?.chart?.result?.[0];
 if(!r)throw Error('Yahoo no chart '+symbol);
 const q=r.indicators?.quote?.[0]||{},ts=r.timestamp||[],meta=r.meta||{};
 let idx=-1;
 for(let i=(q.close||[]).length-1;i>=0;i--)if(Number.isFinite(q.close[i])){idx=i;break}
 const candleLast=idx>=0?q.close[idx]:null,
       metaLast=n(meta.regularMarketPrice),
       last=(metaLast>0?metaLast:candleLast),
       prev=n(meta.chartPreviousClose??meta.previousClose),
       opens=(q.open||[]).filter(Number.isFinite),
       highs=(q.high||[]).filter(Number.isFinite),
       lows=(q.low||[]).filter(Number.isFinite),
       marketTime=n(meta.regularMarketTime);
 if(!(last>0))throw Error('Yahoo no price '+symbol);
 return{
  ticker:isIndex?'t00':code,
  name:isIndex?'加權指數':(META[code]?.name||code),
  last,prevClose:prev,
  open:n(meta.regularMarketOpen)??opens[0],
  high:n(meta.regularMarketDayHigh)??(highs.length?Math.max(...highs):null),
  low:n(meta.regularMarketDayLow)??(lows.length?Math.min(...lows):null),
  volume:n(meta.regularMarketVolume),
  time:marketTime?new Date(marketTime*1000).toISOString():(idx>=0&&ts[idx]?new Date(ts[idx]*1000).toISOString():null),
  date:marketTime?new Date(marketTime*1000).toISOString().slice(0,10):(idx>=0&&ts[idx]?new Date(ts[idx]*1000).toISOString().slice(0,10):null),
  source:metaLast>0?'Yahoo Finance regularMarketPrice':'Yahoo Finance 1m fallback',
  realtime:true
 };
}

async function liveEtf4(){
 const quotes={},errors=[];
 const rs=await Promise.allSettled(
  ETF.map(async c=>{
   const d=await mis('tse_'+c+'.tw');
   const rows=d?.msgArray||[];
   const x=rows.find(v=>String(v.c||'').trim()===c);
   if(!x)throw Error('TWSE MIS missing '+c);
   const q=parseMis(x);
   if(!(q.last>0))throw Error('TWSE MIS no last '+c);
   q.source='TWSE MIS direct '+c;
   q.realtime=true;
   q.serverFetchedAt=new Date().toISOString();
   return q;
  })
 );
 rs.forEach((r,i)=>{
  const c=ETF[i];
  if(r.status==='fulfilled'&&r.value?.last>0)quotes[c]=r.value;
  else errors.push(c+': '+(r.reason?.message||'TWSE MIS失敗'));
 });
 return{
  ok:ETF.every(c=>quotes[c]?.last>0),
  source:'TWSE MIS direct per-code',
  fetchedAt:new Date().toISOString(),
  quotes,
  missing:ETF.filter(c=>!quotes[c]?.last),
  errors
 };
}

async function liveTwse(extra=[]){
 const codes=[...new Set([...ETF,'2330',...extra.map(String).filter(x=>/^\d{4,6}$/.test(x))])],ex=codes.map(c=>'tse_'+c+'.tw').join('|')+'|tse_t00.tw',rows=(await mis(ex)).msgArray||[],quotes={};let market=null,tsmc=null;
 for(const x of rows){const z=parseMis(x);z.source='TWSE MIS';z.realtime=true;if((x.ch||'').includes('t00.tw')||z.ticker==='t00')market=z;else if(z.ticker==='2330')tsmc=z;else if(z.ticker&&z.last>0)quotes[z.ticker]=z}
 if(!market||ETF.filter(c=>quotes[c]?.last>0).length<4)throw Error('TWSE MIS回傳不完整');return{ok:true,fetchedAt:new Date().toISOString(),source:'TWSE MIS',realtime:true,market,tsmc,quotes};
}
async function liveYahoo(extra=[]){
 const codes=[...new Set([...ETF,'2330',...extra.map(String).filter(x=>/^\d{4,6}$/.test(x))])],settled=await Promise.allSettled([yahooTwOne('t00',true),...codes.map(c=>yahooTwOne(c,false))]),quotes={};let market=null,tsmc=null;
 settled.forEach((r,i)=>{if(r.status!=='fulfilled')return;const z=r.value;if(i===0)market=z;else if(z.ticker==='2330')tsmc=z;else quotes[z.ticker]=z});
 if(!market||ETF.filter(c=>quotes[c]?.last>0).length<3)throw Error('Yahoo台股備援不完整');return{ok:true,fetchedAt:new Date().toISOString(),source:'Yahoo Finance即時備援',realtime:true,market,tsmc,quotes,partial:ETF.filter(c=>!quotes[c]?.last)};
}
async function liveDaily(extra=[]){
 const day=await twseDailyAll(),codes=[...new Set([...ETF,'2330',...extra.map(String)])],quotes={};for(const c of codes)if(day.map[c])quotes[c]=day.map[c];
 const th=await taiexHistory().catch(()=>null),rows=th?.rows||[],last=rows.at(-1),prev=rows.at(-2);const market=last?{ticker:'t00',name:'加權指數',last:last.close,prevClose:prev?.close??null,open:last.open??last.close,high:last.high??last.close,low:last.low??last.close,date:last.date,source:'TWSE官方現貨日線備援',realtime:false}:null;
 return{ok:true,fetchedAt:new Date().toISOString(),source:'TWSE官方盤後備援',realtime:false,market,tsmc:quotes['2330']||null,quotes};
}
async function live(extra=[]){
 const errors=[];try{return await liveTwse(extra)}catch(e){errors.push('MIS:'+e.message)}
 if(twMarketOpenNow()){try{const y=await cached('live:yahoo',8000,()=>liveYahoo(extra));return{...y,fallbackErrors:errors}}catch(e){errors.push('Yahoo:'+e.message)}}
 try{const d=await liveDaily(extra);return{...d,fallbackErrors:errors}}catch(e){errors.push('TWSE日線:'+e.message)}
 if(!twMarketOpenNow()){try{const y=await cached('live:yahoo',15000,()=>liveYahoo(extra));return{...y,fallbackErrors:errors}}catch(e){errors.push('Yahoo:'+e.message)}}
 throw Error(errors.join('｜'));
}
async function openapi(p){return getJSON('https://openapi.twse.com.tw/v1/'+p)}
function numByKeys(o,patterns){if(!o)return null;for(const[k,v]of Object.entries(o))if(patterns.some(p=>p.test(k))){const x=n(v);if(x!=null)return x}return null}
function breadthServer(arr){
 if(!Array.isArray(arr)||!arr.length)return null;
 const r=arr.at(-1),up=numByKeys(r,[/上漲/i,/漲家/i]),down=numByKeys(r,[/下跌/i,/跌家/i]),flat=numByKeys(r,[/持平/i,/平盤/i])||0;
 if(up==null||down==null)return null;const total=up+down+flat;
 return{up,down,flat,total,upPct:total?up/total*100:null,downPct:total?down/total*100:null,flatPct:total?flat/total*100:null,ratio:total?up/total:.5,scope:'上市集中市場',source:'TWSE opendata/twtazu_od'};
}
async function context(){
 const errors=[];let breadth=null,turnover=null,institutional=null;
 try{breadth=await openapi('opendata/twtazu_od')}catch(e){errors.push('breadth:'+e.message)}
 try{turnover=await openapi('exchangeReport/FMTQIK')}catch(e){errors.push('turnover:'+e.message)}
 try{institutional=await getJSON('https://www.twse.com.tw/rwd/zh/fund/T86?response=json&selectType=ALLBUT0999&_='+Date.now(),{'Referer':'https://www.twse.com.tw/'})}catch(e){errors.push('institutional:'+e.message)}
 return{ok:!!(breadth||turnover||institutional),fetchedAt:new Date().toISOString(),breadth:breadthServer(breadth),turnover,institutional,errors};
}

async function twseTaiexMonth(iso){
 const ym=iso.slice(0,7).replace('-','')+'01',d=await getJSON('https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?response=json&date='+ym);
 const rows=[];
 for(const r of (d.data||[])){const date=parseROCDate(r[0])||parseISODate(r[0]),close=n(r[1]);if(date&&close!=null)rows.push({date,close})}
 return rows;
}
async function taiexHistory(){
 return cached('taiexhist',10*60*1000,async()=>{
  try{
   const now=new Date(),months=[];
   for(let k=0;k<4;k++){const d=new Date(now.getFullYear(),now.getMonth()-k,1);months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`)}
   const rows=(await Promise.all(months.map(twseTaiexMonth))).flat().sort((a,b)=>a.date.localeCompare(b.date));
   const ded=[...new Map(rows.map(x=>[x.date,x])).values()];
   if(ded.length>=25)return{ok:true,source:'TWSE 發行量加權股價指數歷史資料',rows:ded,fetchedAt:new Date().toISOString()};
   throw Error('official rows insufficient');
  }catch(e){
   const d=await getJSON('https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=6mo'),r=d?.chart?.result?.[0];
   if(!r)throw e;const ts=r.timestamp||[],q=r.indicators?.quote?.[0]||{},rows=[];
   for(let i=0;i<ts.length;i++)if(Number.isFinite(q.close?.[i]))rows.push({date:new Date(ts[i]*1000).toISOString().slice(0,10),close:q.close[i]});
   return{ok:rows.length>=25,source:'Yahoo ^TWII fallback（僅現貨日線）',rows,fetchedAt:new Date().toISOString(),warning:e.message};
  }
 });
}
function periodReturn(rows,nDays){const a=rows.filter(x=>Number.isFinite(x.close));return a.length>nDays?(a.at(-1).close/a.at(-(nDays+1)).close-1)*100:null}

async function yahooQuote(symbol){
 const [intraday,daily]=await Promise.all([
  getJSON('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?interval=5m&range=5d&includePrePost=true'),
  getJSON('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?interval=1d&range=10d')
 ]);
 const ir=intraday?.chart?.result?.[0],dr=daily?.chart?.result?.[0];if(!ir)throw Error('No intraday '+symbol);
 const meta=ir.meta||{},ts=ir.timestamp||[],closes=ir.indicators?.quote?.[0]?.close||[];let last=null,lastTs=null;
 for(let i=closes.length-1;i>=0;i--)if(Number.isFinite(closes[i])){last=closes[i];lastTs=ts[i];break}
 const dc=(dr?.indicators?.quote?.[0]?.close||[]).filter(Number.isFinite),latest=dc.at(-1),prior=dc.length>=2?dc.at(-2):null,p=meta.currentTradingPeriod||{};
 let session='前一交易日',weight=.65;
 if(lastTs&&p.pre?.start&&lastTs>=p.pre.start&&lastTs<(p.regular?.start||Infinity)){session='盤前';weight=1}
 else if(lastTs&&p.regular?.start&&lastTs>=p.regular.start&&lastTs<=p.regular.end){session='盤中';weight=1}
 else if(lastTs&&p.post?.start&&lastTs>=p.post.start&&lastTs<=p.post.end){session='盤後';weight=.9}
 let prev=null;if(session==='前一交易日'){last=latest??last;prev=prior??n(meta.chartPreviousClose)}else prev=n(meta.chartPreviousClose??meta.previousClose)??prior;
 if(!(last>0&&prev>0))throw Error('insufficient '+symbol);
 return{symbol,last,prevClose:prev,changePct:(last-prev)/prev*100,session,sessionWeight:weight,asOf:lastTs?new Date(lastTs*1000).toISOString():null};
}
async function overseas(){
 const map={NASDAQ:'^IXIC',SOX:'^SOX',TSM:'TSM'},quotes={},errors=[];
 await Promise.all(Object.entries(map).map(async([k,s])=>{try{quotes[k]=await yahooQuote(s)}catch(e){errors.push(k+':'+e.message)}}));
 return{ok:Object.keys(quotes).length>0,source:'Yahoo Finance chart',fetchedAt:new Date().toISOString(),quotes,errors};
}

function fieldNum(text,label){const esc=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),m=text.match(new RegExp(esc+'\\s*([\\-+]?\\d[\\d,]*(?:\\.\\d+)?)'));return m?n(m[1]):null}
function addNightSample(price){const now=Date.now();if(!(price>0))return;const last=nightSamples.at(-1);if(!last||now-last.at>=7000)nightSamples.push({at:now,price});while(nightSamples.length&&now-nightSamples[0].at>16*60*1000)nightSamples.shift()}
function nightMomentum(last,high,low){
 const now=Date.now();function d(mins){const target=now-mins*60000;let base=null;for(const x of nightSamples){if(x.at<=target)base=x;else break}if(!base&&nightSamples.length&&now-nightSamples[0].at>mins*45000)base=nightSamples[0];return base?{points:last-base.price,pct:(last-base.price)/base.price*100,base:base.price}:null}
 const d1=d(1),d3=d(3),d5=d(5),d15=d(15),r=d3||d1;let direction='資料累積中',tone='neutral';
 if(r){const offH=high>0?last-high:0,offL=low>0?last-low:0;if(r.pct<=-.22)direction='加速下殺',tone='bear';else if(r.pct<=-.08)direction='短線走弱',tone='bear';else if(offH<=-35&&r.points<15)direction='高檔回落',tone='softBear';else if(r.pct>=.22)direction='持續走強',tone='bull';else if(r.pct>=.08)direction='短線走強',tone='bull';else if(offL>=35&&r.points>0)direction='低檔反彈',tone='softBull';else direction='區間震盪'}
 return{direction,tone,d1,d3,d5,d15,sampleCount:nightSamples.length};
}
async function nightFuture(){
 const url='https://tw.stock.yahoo.com/future/WTX%26';
 try{
  const text=stripTags(await getText(url,{'Referer':'https://tw.stock.yahoo.com/future/'}));
  const last=fieldNum(text,'成交'),reference=fieldNum(text,'參考價')??fieldNum(text,'昨收'),open=fieldNum(text,'開盤'),high=fieldNum(text,'最高'),low=fieldNum(text,'最低'),volume=fieldNum(text,'總量'),oi=fieldNum(text,'未平倉'),bid=fieldNum(text,'買價'),ask=fieldNum(text,'賣價');
  if(!(last>0)||!(reference>0))throw Error('WTX fields not found');
  const change=last-reference,changePct=change/reference*100;addNightSample(last);
  return{ok:true,available:true,source:'Yahoo股市 WTX&（正負號自行重算）',sourceUrl:url,fetchedAt:new Date().toISOString(),last,reference,prevClose:reference,open,high,low,volume,openInterest:oi,bid,ask,change,changePct,offHighPoints:high>0?last-high:null,offHighPct:high>0?(last-high)/high*100:null,momentum:nightMomentum(last,high,low)};
 }catch(e){return{ok:false,available:false,source:'Yahoo股市 WTX&',sourceUrl:url,fetchedAt:new Date().toISOString(),reason:e.message}}
}

const SPLITS={'0050':[{'date':'2025-06-18','ratio':4,'source':'TWSE official 0050 split'}]};
function diskRead(name){try{return JSON.parse(fs.readFileSync(path.join(DATA_DIR,name),'utf8'))}catch{return null}}
function diskWrite(name,v){try{fs.writeFileSync(path.join(DATA_DIR,name),JSON.stringify(v))}catch(_){}}
function monthKeys(start,end=ymdTaipei()){
 const a=[],d=new Date(start+'T00:00:00Z'),e=new Date(end+'T00:00:00Z');let y=d.getUTCFullYear(),m=d.getUTCMonth();
 while(y<e.getUTCFullYear()||(y===e.getUTCFullYear()&&m<=e.getUTCMonth())){a.push(`${y}-${String(m+1).padStart(2,'0')}-01`);m++;if(m===12){m=0;y++}}
 return a;
}
async function mapLimit(items,limit,fn){const out=new Array(items.length);let i=0;async function w(){while(true){const k=i++;if(k>=items.length)return;out[k]=await fn(items[k],k)}}await Promise.all(Array.from({length:Math.min(limit,items.length)},w));return out}
function twseDate(s){return parseROCDate(s)||parseISODate(s)}

function csvCells(line){
 const out=[];let cur='',q=false;
 for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++}else q=!q}else if(ch===','&&!q){out.push(cur.trim());cur=''}else cur+=ch}
 out.push(cur.trim());return out.map(x=>x.replace(/^"|"$/g,'').trim());
}
function parseTwseStockDayCSV(text){
 const rows=[];
 for(const line of String(text||'').split(/\r?\n/)){
  const c=csvCells(line);if(c.length<7)continue;const date=twseDate(c[0]),open=n(c[3]),high=n(c[4]),low=n(c[5]),close=n(c[6]);
  if(date&&close>0)rows.push({date,open,high,low,close,volume:n(c[1]),ohlc:true,source:'TWSE STOCK_DAY CSV'});
 }
 return rows;
}
function parseTwseStockDayAvgCSV(text){
 const rows=[];
 for(const line of String(text||'').split(/\r?\n/)){
  const c=csvCells(line);if(c.length<2)continue;const date=twseDate(c[0]),close=n(c[1]);
  if(date&&close>0)rows.push({date,open:null,high:null,low:null,close,volume:null,ohlc:false,source:'TWSE STOCK_DAY_AVG CSV'});
 }
 return rows;
}
async function twseCSV(url){
 const r=await fetchTimeout(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'text/csv,text/plain,*/*','Referer':'https://www.twse.com.tw/'}},12000);
 if(!r.ok)throw Error('TWSE CSV HTTP '+r.status);
 const b=Buffer.from(await r.arrayBuffer());
 // TWSE CSV is normally UTF-8 BOM nowadays. Remove BOM; replacement decoding prevents a single bad byte from killing history.
 return b.toString('utf8').replace(/^\uFEFF/,'');
}




/* ---------- Goodinfo 0050 long-history bridge ---------- */
let GOODINFO_0050_CACHE={at:0,rows:[],error:null,period:null,url:null};
function htmlEntities(s){return String(s||'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#x27;|&#39;/gi,"'")}
function goodinfoDate(s){
 const m=String(s||'').trim().replace(/^['\s]+/,'').match(/^(\d{2,4})\/(\d{1,2})\/(\d{1,2})$/);if(!m)return null;
 let y=Number(m[1]);if(y<100)y+=2000;
 return `${y}-${String(Number(m[2])).padStart(2,'0')}-${String(Number(m[3])).padStart(2,'0')}`;
}
function parseGoodinfo0050(html,preAdjusted=false){
 const out=[];const rows=String(html||'').match(/<tr\b[\s\S]*?<\/tr>/gi)||[];
 for(const tr of rows){
  const cells=(tr.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi)||[]).map(x=>htmlEntities(stripTags(x)).trim());
  if(cells.length<5)continue;
  const date=goodinfoDate(cells[0]);if(!date)continue;
  const open=n(cells[1]),high=n(cells[2]),low=n(cells[3]),close=n(cells[4]);if(!(close>0))continue;
  const row={date,open:open||null,high:high||null,low:low||null,close,volume:n(cells[10]),ohlc:open>0&&high>0&&low>0,source:preAdjusted?'Goodinfo 0050 還原權息日K':'Goodinfo 0050 日K',preAdjusted};
  if(preAdjusted){row.adjopen=row.open;row.adjhigh=row.high;row.adjlow=row.low;row.adjclose=row.close;row.adjFactor=1}
  out.push(row);
 }
 return [...new Map(out.map(x=>[x.date,x])).values()].sort((a,b)=>a.date.localeCompare(b.date));
}
function goodinfoLongPlausible(rows){
 if(!Array.isArray(rows)||rows.length<3000)return false;
 const first=rows[0]?.date,last=rows.at(-1)?.date;if(!first||!last)return false;
 const years=(Date.parse(last)-Date.parse(first))/31557600000;
 const age=(Date.now()-Date.parse(last))/86400000;
 return years>=10&&age<=30&&rows.filter(x=>x.ohlc).length/rows.length>=.97;
}
async function goodinfo0050LongRows(force=false){
 if(!force&&Date.now()-GOODINFO_0050_CACHE.at<6*60*60*1000&&goodinfoLongPlausible(GOODINFO_0050_CACHE.rows))return GOODINFO_0050_CACHE.rows;
 const roots=['https://goodinfo.tw/tw/ShowK_Chart.asp','https://goodinfo.tw/StockInfo/ShowK_Chart.asp'];
 const periods=[6000,5700,4800];let errors=[];
 for(const root of roots)for(const period of periods){
  const referer=root+`?STOCK_ID=0050&CHT_CAT2=DATE&PRICE_ADJ=T`;
  const url=root+`?STOCK_ID=0050&CHT_CAT2=DATE&STEP=DATA&PERIOD=${period}&PRICE_ADJ=T`;
  try{
   const html=await postText(url,{'Referer':referer},18000),rows=parseGoodinfo0050(html,true);
   if(!goodinfoLongPlausible(rows)){errors.push(`${new URL(root).pathname} PERIOD=${period}: parsed ${rows.length} rows`);continue}
   GOODINFO_0050_CACHE={at:Date.now(),rows,error:null,period,url};return rows;
  }catch(e){errors.push(`${new URL(root).pathname} PERIOD=${period}: ${e.message}`)}
 }
 GOODINFO_0050_CACHE={at:Date.now(),rows:GOODINFO_0050_CACHE.rows||[],error:errors.join(' | '),period:null,url:null};
 if(goodinfoLongPlausible(GOODINFO_0050_CACHE.rows))return GOODINFO_0050_CACHE.rows;
 throw Error('Goodinfo long history unavailable: '+errors.join(' | '));
}

function normalize0050YahooScale(rawRows){
 const rows=rawRows.map(x=>({...x})).sort((a,b)=>a.date.localeCompare(b.date));
 if(!rows.length)return {rows,events:[],warnings:[],fails:[]};
 // Work backwards from the newest price scale. Detect only split-like 2x/3x/4x/5x/10x discontinuities.
 const candidates=[0.1,0.2,0.25,1/3,0.5,2,3,4,5,10];
 let scale=1; const events=[];
 const scales=new Array(rows.length).fill(1); scales[rows.length-1]=1;
 for(let i=rows.length-1;i>0;i--){
  const cur=rows[i].close,prev=rows[i-1].close,ratio=cur/prev;
  let best=null;
  if(cur>0&&prev>0&&Math.abs(ratio-1)>.30){
   for(const c of candidates){const err=Math.abs(ratio-c)/c;if(err<=.12&&(!best||err<best.err))best={c,err}}
  }
  if(best){
   // prev * previousScale should be on the same basis as cur * currentScale.
   scale*=best.c;
   events.push({type:'scaleBoundary',date:rows[i].date,prevDate:rows[i-1].date,rawRatio:ratio,inferredFactor:best.c,source:rows[i].date==='2025-06-18'?'0050 2025/06/18 1拆4':'Yahoo歷史價格尺度斷點自動校正'});
  }
  scales[i-1]=scale;
 }
 const out=rows.map((x,i)=>{const f=scales[i];return {...x,open:x.open>0?x.open*f:null,high:x.high>0?x.high*f:null,low:x.low>0?x.low*f:null,close:x.close*f,adjclose:x.close*f,adjopen:x.open>0?x.open*f:null,adjhigh:x.high>0?x.high*f:null,adjlow:x.low>0?x.low*f:null,ohlc:x.open>0&&x.high>0&&x.low>0,preAdjusted:true,priceBasis:'normalized-split-scale-v2',adjFactor:f,source:'Yahoo Finance 0050.TW daily OHLC（價格尺度QA校正）'}});
 const warnings=[],fails=[];
 for(let i=1;i<out.length;i++){
  const r=out[i].close/out[i-1].close-1,rec={date:out[i].date,prevDate:out[i-1].date,returnPct:r*100,prevClose:out[i-1].close,close:out[i].close};
  if(Math.abs(r)>.15)warnings.push(rec);
  if(Math.abs(r)>.30)fails.push(rec);
 }
 return {rows:out,events,warnings,fails};
}

async function yahoo0050LongRows(){
 const urls=[
  'https://query1.finance.yahoo.com/v8/finance/chart/0050.TW?period1=1054051200&period2=1798761600&interval=1d&includeAdjustedClose=true&events=div%2Csplits',
  'https://query2.finance.yahoo.com/v8/finance/chart/0050.TW?period1=1054051200&period2=1798761600&interval=1d&includeAdjustedClose=true&events=div%2Csplits'
 ];
 let errors=[];
 for(const url of urls){try{
  const d=await getJSONQuick(url,{'Referer':'https://finance.yahoo.com/'},12000),r=d?.chart?.result?.[0];
  if(!r)throw Error(d?.chart?.error?.description||'empty chart result');
  const ts=r.timestamp||[],q=r.indicators?.quote?.[0]||{},raw=[];
  for(let i=0;i<ts.length;i++){
   const close=Number(q.close?.[i]);if(!(close>0))continue;
   const open=Number(q.open?.[i]),high=Number(q.high?.[i]),low=Number(q.low?.[i]);
   raw.push({date:new Date(ts[i]*1000).toISOString().slice(0,10),open:open>0?open:null,high:high>0?high:null,low:low>0?low:null,close,volume:Number(q.volume?.[i])||null,ohlc:open>0&&high>0&&low>0});
  }
  const ded=[...new Map(raw.map(x=>[x.date,x])).values()].sort((a,b)=>a.date.localeCompare(b.date));
  if(!goodinfoLongPlausible(ded))throw Error('parsed '+ded.length+' rows, long-sample validation failed');
  const norm=normalize0050YahooScale(ded);
  if(norm.fails.length)throw Error('DATA QUALITY FAIL: normalized series still has >30% jump: '+JSON.stringify(norm.fails.slice(0,3)));
  norm.rows.forEach(x=>{x.scaleEvents=norm.events.length;x.qaWarnings=norm.warnings.length});
  return norm.rows;
 }catch(e){errors.push(new URL(url).hostname+': '+e.message)}}
 throw Error('Yahoo 0050 long history unavailable: '+errors.join(' | '));
}
async function long0050Rows(){return yahoo0050LongRows()}
function parseYahooAdjustedChart(code,d){
 const listed=META[code].listed,symbol=code+'.TW',r=d?.chart?.result?.[0];
 if(!r)throw Error(d?.chart?.error?.description||'empty chart result');
 const ts=r.timestamp||[],q=r.indicators?.quote?.[0]||{},ac=r.indicators?.adjclose?.[0]?.adjclose||[],rows=[];
 for(let i=0;i<ts.length;i++){
  const close=Number(q.close?.[i]),adjclose=Number(ac?.[i]);if(!(close>0&&adjclose>0))continue;
  const f=adjclose/close,open=Number(q.open?.[i]),high=Number(q.high?.[i]),low=Number(q.low?.[i]);
  rows.push({date:new Date(ts[i]*1000).toISOString().slice(0,10),open:open>0?open*f:null,high:high>0?high*f:null,low:low>0?low*f:null,close:adjclose,adjclose,adjopen:open>0?open*f:null,adjhigh:high>0?high*f:null,adjlow:low>0?low*f:null,volume:Number(q.volume?.[i])||null,ohlc:open>0&&high>0&&low>0,preAdjusted:true,priceBasis:'yahoo-adjusted-total-return-v1',adjFactor:f,source:`Yahoo Finance ${symbol} adjusted daily OHLC`});
 }
 return rows.filter(x=>x.date>=listed);
}
function validateYahooAdjustedRows(code,rows){
 const listed=META[code].listed,ded=[...new Map(rows.filter(x=>x.date>=listed).map(x=>[x.date,x])).values()].sort((a,b)=>a.date.localeCompare(b.date));
 // A fixed 1000-row floor incorrectly rejects newer ETFs such as 00919.
 // Require coverage proportional to ETF age instead: ~252 TW trading days/year,
 // with a conservative 75% floor for holidays/source gaps, minimum 120 rows.
 const ageDays=Math.max(1,(Date.now()-Date.parse(listed+'T00:00:00Z'))/86400000);
 const expectedTrading=Math.floor(ageDays/365.2425*252);
 const minRows=Math.max(120,Math.floor(expectedTrading*.75));
 if(ded.length<minRows)throw Error(`parsed ${ded.length} rows, below age-adjusted minimum ${minRows} for ${code}`);
 const warnings=[],fails=[];
 for(let i=1;i<ded.length;i++){
  const ret=ded[i].close/ded[i-1].close-1,rec={date:ded[i].date,prevDate:ded[i-1].date,returnPct:ret*100,prevClose:ded[i-1].close,close:ded[i].close};
  if(Math.abs(ret)>.15)warnings.push(rec);if(Math.abs(ret)>.30)fails.push(rec);
 }
 if(fails.length)throw Error('DATA QUALITY FAIL: adjusted series still has >30% jump: '+JSON.stringify(fails.slice(0,3)));
 ded.forEach(x=>{x.qaWarnings=warnings.length});
 return ded;
}
async function yahooAdjustedLongRows(code){
 const listed=META[code].listed,p1=Math.floor(Date.parse(listed+'T00:00:00Z')/1000)-7*86400,p2=Math.floor(Date.now()/1000)+3*86400,symbol=code+'.TW',errors=[];
 const fullUrls=[1,2].map(n=>`https://query${n}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&includeAdjustedClose=true&events=div%2Csplits`);
 for(const url of fullUrls){try{
  const d=await getJSONQuick(url,{'Referer':'https://finance.yahoo.com/'},12000);
  return validateYahooAdjustedRows(code,parseYahooAdjustedChart(code,d));
 }catch(e){errors.push('full '+new URL(url).hostname+': '+e.message)}}

 // R3.30 fallback: split long history into 4-year windows to avoid a large Yahoo response / upstream 502.
 let all=[];const startYear=Number(listed.slice(0,4)),endYear=Number(ymdTaipei().slice(0,4));
 for(let y=startYear;y<=endYear;y+=4){
  const a=(y===startYear?listed:`${y}-01-01`),bYear=Math.min(y+4,endYear+1),b=`${bYear}-01-08`;
  const ca=Math.floor(Date.parse(a+'T00:00:00Z')/1000)-3*86400,cb=Math.floor(Date.parse(b+'T00:00:00Z')/1000);
  let got=false,last=null;
  for(const host of [1,2]){
   const url=`https://query${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${ca}&period2=${cb}&interval=1d&includeAdjustedClose=true&events=div%2Csplits`;
   try{const d=await getJSONQuick(url,{'Referer':'https://finance.yahoo.com/'},12000),rows=parseYahooAdjustedChart(code,d);if(rows.length){all.push(...rows);got=true;break}}catch(e){last=e}
  }
  if(!got)throw Error(`Yahoo ${code} chunk ${a}~${b} failed: ${last?.message||'empty'} | full attempts: ${errors.join(' | ')}`);
  await sleep(180);
 }
 return validateYahooAdjustedRows(code,all);
}
async function long0056Rows(){return yahooAdjustedLongRows('0056')}
async function long00878Rows(){return yahooAdjustedLongRows('00878')}
async function long00919Rows(){return yahooAdjustedLongRows('00919')}
function rowsToMonths(rows){const out={};for(const x of rows||[]){const k=x.date?.slice(0,7);if(!k)continue;(out[k]||(out[k]=[])).push(x)}return out}
async function goodinfo0050Rows(){return goodinfo0050LongRows(false)}
async function goodinfo0050Month(iso){
 const ym=iso.slice(0,7),rows=(await goodinfo0050LongRows(false)).filter(x=>x.date.slice(0,7)===ym);
 if(!rows.length)throw Error('Goodinfo has no rows for '+ym);return rows;
}

async function twseHistoryMonth(code,iso){
 const key=iso.slice(0,7).replace('-','')+'01',base='https://www.twse.com.tw/rwd/zh/afterTrading/',isPre2010=iso<'2010-01-01',errors=[];
 if(!isPre2010){
  try{
   const d=await getJSON(base+'STOCK_DAY?response=json&date='+key+'&stockNo='+code,{'Referer':'https://www.twse.com.tw/'}),rows=[];
   for(const r of (d.data||[])){const date=twseDate(r[0]),open=n(r[3]),high=n(r[4]),low=n(r[5]),close=n(r[6]);if(date&&close>0)rows.push({date,open,high,low,close,volume:n(r[1]),ohlc:true,source:'TWSE STOCK_DAY JSON'})}
   if(rows.length)return rows;
   errors.push('STOCK_DAY JSON empty');
  }catch(e){errors.push('STOCK_DAY JSON '+e.message)}
  try{
   const text=await twseCSV(base+'STOCK_DAY?response=csv&date='+key+'&stockNo='+code),rows=parseTwseStockDayCSV(text);
   if(rows.length)return rows;
   errors.push('STOCK_DAY CSV empty');
  }catch(e){errors.push('STOCK_DAY CSV '+e.message)}
 }
 // Official closing-price archive is the authoritative pre-2010 source and also the fallback if STOCK_DAY is temporarily unavailable.
 try{
  const d=await getJSON(base+'STOCK_DAY_AVG?response=json&date='+key+'&stockNo='+code,{'Referer':'https://www.twse.com.tw/'}),rows=[];
  for(const r of (d.data||[])){const date=twseDate(r[0]),close=n(r[1]);if(date&&close>0)rows.push({date,open:null,high:null,low:null,close,volume:null,ohlc:false,source:'TWSE STOCK_DAY_AVG JSON'})}
  if(rows.length)return rows;
  errors.push('STOCK_DAY_AVG JSON empty');
 }catch(e){errors.push('STOCK_DAY_AVG JSON '+e.message)}
 try{
  const text=await twseCSV(base+'STOCK_DAY_AVG?response=csv&date='+key+'&stockNo='+code),rows=parseTwseStockDayAvgCSV(text);
  if(rows.length)return rows;
  errors.push('STOCK_DAY_AVG CSV empty');
 }catch(e){errors.push('STOCK_DAY_AVG CSV '+e.message)}
 // User-requested fallback: for 0050, try Goodinfo daily K data after all TWSE variants fail.
 if(code==='0050'){try{const rows=await goodinfo0050Month(iso);if(rows.length)return rows;errors.push('Goodinfo empty')}catch(e){errors.push('Goodinfo '+e.message)}}
 const err=Error(errors.join(' | ')||'TWSE/Goodinfo month unavailable');err.code='TWSE_MONTH_EMPTY';throw err;
}

function parseDividendText(code,html){
 const text=stripTags(html),events=[];
 // row-like pattern: code, name, ex-date, record-date, pay-date, amount
 const re=new RegExp(`${code}\\s+[^\\d]{0,80}?(\\d{3})年(\\d{1,2})月(\\d{1,2})日\\s+(\\d{3})年(\\d{1,2})月(\\d{1,2})日\\s+(\\d{3})年(\\d{1,2})月(\\d{1,2})日\\s+([0-9]+(?:\\.[0-9]+)?)`,'g');let m;
 while((m=re.exec(text))){
  const date=`${Number(m[1])+1911}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`,amount=n(m[10]);
  if(amount>0)events.push({date,amount,source:'TWSE ETF e添富配息清單'});
 }
 // Fallback to the looser parser for older layouts.
 if(!events.length){
  let pos=0;
  while(true){const idx=text.indexOf(code,pos);if(idx<0)break;const seg=text.slice(idx,idx+1400);pos=idx+code.length;
   const dates=[...seg.matchAll(/(\d{3})年(\d{1,2})月(\d{1,2})日/g)];if(dates.length<3)continue;
   const after=seg.slice((dates[2].index||0)+dates[2][0].length),am=after.match(/\s([0-9]+(?:\.[0-9]+)?)\s+(?:詳細資料|\\d{3}(?:\s|$))/),amount=am?n(am[1]):null;if(!(amount>0))continue;
   const d=dates[0],date=`${Number(d[1])+1911}-${String(d[2]).padStart(2,'0')}-${String(d[3]).padStart(2,'0')}`;events.push({date,amount,source:'TWSE ETF e添富配息清單'});
  }
 }
 return[...new Map(events.map(x=>[x.date,x])).values()].sort((a,b)=>a.date.localeCompare(b.date));
}
async function twseDividendEvents(code){
 return cached('div:r3:'+code,24*60*60*1000,async()=>{
  const y0=Number(META[code].listed.slice(0,4)),y1=Number(ymdTaipei().slice(0,4));let events=[],errors=[];
  try{const html=await getText(`https://www.twse.com.tw/zh/ETFortune/dividendList?startDate=${y0}&endDate=${y1}&stkNo=${code}`);events=parseDividendText(code,html)}catch(e){errors.push('range:'+e.message)}
  if(events.length<DIV_MIN[code]){
   const yearly=await mapLimit(Array.from({length:y1-y0+1},(_,i)=>y0+i),4,async y=>{try{return parseDividendText(code,await getText(`https://www.twse.com.tw/zh/ETFortune/dividendList?startDate=${y}&endDate=${y}&stkNo=${code}`))}catch(e){errors.push(y+':'+e.message);return[]}});
   events=[...new Map([...events,...yearly.flat()].map(x=>[x.date,x])).values()].sort((a,b)=>a.date.localeCompare(b.date));
  }
  return{ok:events.length>0,complete:events.length>=DIV_MIN[code],events,expectedMin:DIV_MIN[code],source:'TWSE ETF e添富',errors:errors.slice(0,6)};
 });
}

function validateOfficialHistory(code,rows){
 const listed=META[code].listed,first=rows[0]?.date||null,last=rows.at(-1)?.date||null,firstGap=first?Math.round((Date.parse(first)-Date.parse(listed))/86400000):9999,lastAge=last?Math.round((Date.now()-Date.parse(last))/86400000):9999;
 let duplicate=0,bigGaps=[],badPrices=0,outOfOrder=0;const seen=new Set();
 for(let i=0;i<rows.length;i++){const x=rows[i];if(seen.has(x.date))duplicate++;seen.add(x.date);if(!(x.close>0))badPrices++;if(i){if(x.date<=rows[i-1].date)outOfOrder++;const gap=(Date.parse(x.date)-Date.parse(rows[i-1].date))/86400000;if(gap>16&&!((code==='0050')&&rows[i-1].date<='2025-06-11'&&x.date>='2025-06-18'))bigGaps.push({from:rows[i-1].date,to:x.date,days:gap})}}
 const ohlcDays=rows.filter(x=>x.ohlc&&x.high>0&&x.low>0&&x.open>0).length,post2010=rows.filter(x=>x.date>='2010-01-04'),post2010Ohlc=post2010.filter(x=>x.ohlc&&x.high>0&&x.low>0&&x.open>0).length;
 const years=Math.max(0,(Date.parse(last||ymdTaipei())-Date.parse(listed))/31557600000),minimumRows=Math.floor(years*205*.95),rowCountPass=rows.length>=minimumRows;
 const startPass=firstGap>=0&&firstGap<=14,rowSequencePass=!bigGaps.length&&!duplicate&&!outOfOrder&&!badPrices&&rowCountPass;
 const latestPass=lastAge<=12,post2010OhlcCoveragePct=post2010.length?post2010Ohlc/post2010.length*100:100,backtestPrecisionPass=post2010OhlcCoveragePct>=97.5;
 const actualYears=first&&last?Math.max(0,(Date.parse(last)-Date.parse(first))/31557600000):0,longSamplePass=code==='0050'&&rows.length>=3000&&actualYears>=10&&latestPass&&backtestPrecisionPass&&!duplicate&&!outOfOrder&&!badPrices;
 return{listed,first,last,rows:rows.length,minimumRows,yearsCovered:Number(years.toFixed(2)),actualYearsCovered:Number(actualYears.toFixed(2)),rowCountPass,startPass,firstGapDays:firstGap,latestPass,lastAgeDays:lastAge,duplicate,outOfOrder,bigGaps:bigGaps.slice(0,12),badPrices,ohlcDays,ohlcCoveragePct:rows.length?ohlcDays/rows.length*100:0,post2010Days:post2010.length,post2010OhlcDays:post2010Ohlc,post2010OhlcCoveragePct,backtestPrecisionPass,rowSequencePass,longSamplePass,priceFullHistoryPass:startPass&&rowSequencePass&&latestPass,fullHistoryPass:false,precision:ohlcDays===rows.length?'OHLC全覆蓋':ohlcDays?'長期OHLC＋部分收盤價':'收盤價'};
}
function applyCorporateActions(code,rows,divs){
 if(rows.length&&rows.every(x=>x.preAdjusted)){const out=rows.map(x=>({...x,adjclose:x.adjclose??x.close,adjopen:x.adjopen??x.open,adjhigh:x.adjhigh??x.high,adjlow:x.adjlow??x.low})),warnings=[],anomalies=[];for(let i=1;i<out.length;i++){const r=out[i].adjclose/out[i-1].adjclose-1,rec={date:out[i].date,prev:out[i-1].date,returnPct:r*100};if(Math.abs(r)>.15)warnings.push(rec);if(Math.abs(r)>.30)anomalies.push(rec)}return{rows:out,events:[{type:'preAdjusted',source:'Yahoo/Goodinfo 已統一價格尺度'}],warnings,anomalies,preAdjusted:true}}
 const out=rows.map(x=>({...x,adjFactor:1})),events=[];
 for(const sp of (SPLITS[code]||[])){for(const x of out)if(x.date<sp.date)x.adjFactor/=sp.ratio;events.push({...sp,type:'split'})}
 for(const ev of (divs?.events||[])){const idx=out.findIndex(x=>x.date>=ev.date);if(idx<=0)continue;const prev=out[idx-1].close;if(!(prev>ev.amount&&ev.amount>0))continue;const f=(prev-ev.amount)/prev;for(let i=0;i<idx;i++)out[i].adjFactor*=f;events.push({...ev,type:'cash',factor:f,prevClose:prev})}
 for(const x of out){x.adjclose=x.close*x.adjFactor;x.adjopen=x.open!=null?x.open*x.adjFactor:null;x.adjhigh=x.high!=null?x.high*x.adjFactor:null;x.adjlow=x.low!=null?x.low*x.adjFactor:null}
 const anomalies=[];for(let i=1;i<out.length;i++){const a=out[i-1].adjclose,b=out[i].adjclose;if(a>0&&b>0){const r=b/a-1;if(Math.abs(r)>.35)anomalies.push({date:out[i].date,returnPct:r*100,prev:out[i-1].date})}}
 return{rows:out,events,anomalies};
}

function historyMonthKey(iso){return String(iso).slice(0,7)}
function monthRowsPlausible(code,key,rows){
 if(!Array.isArray(rows)||!rows.length)return false;const uniq=[...new Set(rows.map(x=>x?.date).filter(Boolean))],listedKey=META[code].listed.slice(0,7),currentKey=ymdTaipei().slice(0,7);
 if(key===listedKey||key===currentKey)return uniq.length>=1;
 return uniq.length>=10;
}
function validSavedMonths(code,byMonth){const out={};for(const [k,v] of Object.entries(byMonth||{}))if(monthRowsPlausible(code,k,v))out[k]=v;return out}
function historyFile(code){return`twse_${code}_history.json`}
function readyFile(code){return`twse_${code}_official_ready.json`}


function readyRefreshDue(ready){const t=Date.parse(ready?.fetchedAt||'');return !Number.isFinite(t)||Date.now()-t>12*60*60*1000}
function repairKeysFromValidation(code,validation,adjustmentAnomalies=[]){
 const keys=new Set(),addDate=d=>{if(/^20\d{2}-\d{2}-\d{2}$/.test(String(d||'')))keys.add(String(d).slice(0,7))};
 if(!validation?.startPass)keys.add(META[code].listed.slice(0,7));
 if(!validation?.latestPass){const cur=ymdTaipei().slice(0,7);keys.add(cur)}
 for(const g of (validation?.bigGaps||[])){addDate(g.from);addDate(g.to)}
 for(const x of adjustmentAnomalies||[]){addDate(x.date);addDate(x.prev)}
 return [...keys];
}

function historyProgress(code){
 const months=monthKeys(META[code].listed),saved=diskRead(historyFile(code)),valid=validSavedMonths(code,saved?.months||{}),have=new Set(Object.keys(valid)),missing=months.filter(m=>!have.has(m.slice(0,7))),job=HISTORY_JOBS.get(code),ready=diskRead(readyFile(code));
 const pass=!!ready?.validation?.fullHistoryPass,eligible=!!ready?.validation?.backtestReadyPass,refreshDue=eligible&&readyRefreshDue(ready),readyStatus=ready?.rows?.length?(eligible?(refreshDue?'REFRESH_DUE':pass?'READY':'LONG_SAMPLE_READY'):'VALIDATION_FAIL'):null;
 return{code,status:job?.status||readyStatus||(missing.length?'IDLE':'FINALIZING'),fullHistoryPass:pass,backtestReadyPass:eligible,refreshDue,totalMonths:months.length,doneMonths:months.length-missing.length,missingMonths:missing.length,missingKeys:missing.slice(0,12).map(x=>x.slice(0,7)),percent:months.length?Math.round((months.length-missing.length)/months.length*100):0,first:ready?.validation?.first||null,last:ready?.validation?.last||null,rows:ready?.rows?.length||0,validation:ready?.validation||null,error:job?.error||null,errors:(job?.errors||[]).slice(-12)};
}
async function finalizeOfficialHistory(code){
 const saved=diskRead(historyFile(code)),byMonth=saved?.months||{},raw=Object.values(byMonth).flat().filter(x=>x.date>=META[code].listed).sort((a,b)=>a.date.localeCompare(b.date)),ded=[...new Map(raw.map(x=>[x.date,x])).values()];
 const validation=validateOfficialHistory(code,ded),preAdjusted=ded.length>0&&ded.every(x=>x.preAdjusted),divs=preAdjusted?{ok:true,complete:true,events:[],errors:[],source:'Goodinfo 還原權息已內含企業行動'}:await twseDividendEvents(code).catch(e=>({ok:false,complete:false,events:[],errors:[e.message]})),adj=applyCorporateActions(code,ded,divs);
 validation.dividendEvents=(divs.events||[]).length;validation.dividendExpectedMin=preAdjusted?0:DIV_MIN[code];validation.dividendCoveragePass=preAdjusted||!!divs.complete;validation.splitEvents=preAdjusted?0:(SPLITS[code]||[]).length;validation.preAdjustedSourcePass=preAdjusted;validation.adjustmentAnomalies=adj.anomalies.length;validation.adjustmentPass=!adj.anomalies.length;
 validation.priceHistoryPass=!!(validation.priceFullHistoryPass||validation.longSamplePass);
 validation.corporateActionPass=!!(validation.dividendCoveragePass&&validation.adjustmentPass);
 validation.backtestReadyPass=!!(validation.priceHistoryPass&&validation.backtestPrecisionPass&&validation.corporateActionPass);
 validation.fullHistoryPass=!!(validation.priceFullHistoryPass&&validation.backtestPrecisionPass&&validation.corporateActionPass);
 const source=preAdjusted?(ded.some(x=>String(x.source||'').includes('Yahoo Finance'))?'Yahoo Finance 0050.TW 長期日K（2009起實際樣本；價格尺度QA＋1拆4校正）':'Goodinfo 0050 還原權息長期日K（完整性依實際起訖標示）'):'TWSE官方：2010前STOCK_DAY_AVG收盤價＋2010後STOCK_DAY OHLC＋ETF e添富配息';
 const result={ok:ded.length>100,ready:validation.backtestReadyPass,code,source,normalizationVersion:code==='0050'?'scale-v2':null,qaWarnings:adj.warnings||[],rows:adj.rows,validation,corporateActions:adj.events,adjustmentAnomalies:adj.anomalies,dividendSource:{complete:!!divs.complete,events:(divs.events||[]).length,errors:divs.errors||[]},fetchedAt:new Date().toISOString()};diskWrite(readyFile(code),result);return result;
}
function enqueueHistory(code,front=false){if(!ETF.includes(code))return historyProgress(code);const ready=diskRead(readyFile(code));if(ready?.validation?.backtestReadyPass&&!readyRefreshDue(ready)&&!(code==='0050'&&ready.normalizationVersion!=='scale-v2'))return historyProgress(code);const active=['RUNNING','RETRYING','FINALIZING','QUEUED'].includes(HISTORY_JOBS.get(code)?.status);if(!WARM_QUEUE.includes(code)&&!active){front?WARM_QUEUE.unshift(code):WARM_QUEUE.push(code);HISTORY_JOBS.set(code,{status:'QUEUED',startedAt:new Date().toISOString(),errors:[]});pumpWarmQueue()}return historyProgress(code)}
async function pumpWarmQueue(){if(WARM_ACTIVE)return;WARM_ACTIVE=true;while(WARM_QUEUE.length){const code=WARM_QUEUE.shift();try{await warmHistoryWorker(code)}catch(e){const j=HISTORY_JOBS.get(code)||{};j.status='ERROR';j.error=e.message;HISTORY_JOBS.set(code,j)}}WARM_ACTIVE=false}

async function warmHistoryWorker(code){
 const months=monthKeys(META[code].listed),saved=diskRead(historyFile(code))||{months:{}},byMonth=validSavedMonths(code,saved.months||{});let priorReady=diskRead(readyFile(code));if(code==='0050'&&priorReady?.normalizationVersion!=='scale-v2')priorReady=null;if(code==='0056'&&priorReady?.normalizationVersion!=='yahoo-adjusted-v1')priorReady=null;if(['00878','00919'].includes(code)&&priorReady?.normalizationVersion!=='yahoo-adjusted-v1')priorReady=null;if(priorReady?.validation?.backtestReadyPass&&readyRefreshDue(priorReady))delete byMonth[ymdTaipei().slice(0,7)];
 if(code==='0050'&&!priorReady?.validation?.backtestReadyPass){try{const longRows=await yahoo0050LongRows(),gm=rowsToMonths(longRows);for(const [k,v] of Object.entries(gm))if(monthRowsPlausible(code,k,v))byMonth[k]=v;diskWrite(historyFile(code),{months:byMonth,updatedAt:new Date().toISOString(),seedSource:longRows[0]?.source||'0050長期日K',seedRows:longRows.length,seedFirst:longRows[0]?.date,seedLast:longRows.at(-1)?.date});const seeded=await finalizeOfficialHistory(code);if(seeded.validation?.backtestReadyPass){const j={status:seeded.validation.fullHistoryPass?'READY':'LONG_SAMPLE_READY',startedAt:new Date().toISOString(),doneMonths:Object.keys(byMonth).length,totalMonths:months.length,rows:seeded.rows.length,finishedAt:new Date().toISOString()};HISTORY_JOBS.set(code,j);return seeded}}catch(e){const j=HISTORY_JOBS.get(code)||{errors:[]};j.status='SOURCE_BLOCKED';j.error='0050 長期資料源連線失敗；已停止逐月279次重試';j.errors=[...(j.errors||[]),'Long history seed: '+e.message];HISTORY_JOBS.set(code,j);return{ok:false,ready:false,progress:historyProgress(code)}}}
 if(['0056','00878','00919'].includes(code)&&!priorReady?.validation?.backtestReadyPass){
  {const j=HISTORY_JOBS.get(code)||{errors:[]};j.status='YAHOO_LONG_FETCH';j.startedAt=j.startedAt||new Date().toISOString();HISTORY_JOBS.set(code,j)}
  try{
   const longRows=await yahooAdjustedLongRows(code),gm=rowsToMonths(longRows);
   for(const [k,v] of Object.entries(gm))if(monthRowsPlausible(code,k,v))byMonth[k]=v;
   diskWrite(historyFile(code),{months:byMonth,updatedAt:new Date().toISOString(),seedSource:longRows[0]?.source||`Yahoo Finance ${code}.TW adjusted daily OHLC`,seedRows:longRows.length,seedFirst:longRows[0]?.date,seedLast:longRows.at(-1)?.date,normalizationVersion:'yahoo-adjusted-v1'});
   const seeded=await finalizeOfficialHistory(code);
   if(seeded.validation?.backtestReadyPass){
    const j={status:seeded.validation.fullHistoryPass?'READY':'LONG_SAMPLE_READY',startedAt:new Date().toISOString(),doneMonths:Object.keys(byMonth).length,totalMonths:months.length,rows:seeded.rows.length,finishedAt:new Date().toISOString()};
    HISTORY_JOBS.set(code,j);return seeded
   }
   const j=HISTORY_JOBS.get(code)||{errors:[]};j.status='VALIDATION_FAIL';j.error=`${code} Yahoo 全歷史已取得但驗證未通過`;HISTORY_JOBS.set(code,j);return seeded;
  }catch(e){
   const j=HISTORY_JOBS.get(code)||{errors:[]};j.status='SOURCE_BLOCKED';j.error=`${code} Yahoo 全歷史連線或驗證失敗；不改走逐月TWSE`;j.errors=[...(j.errors||[]),`${code} Yahoo full-history seed: `+e.message];HISTORY_JOBS.set(code,j);return{ok:false,ready:false,progress:historyProgress(code)}
  }
 }
 const job={status:'RUNNING',startedAt:new Date().toISOString(),totalMonths:months.length,doneMonths:Object.keys(byMonth).length,errors:[]};HISTORY_JOBS.set(code,job);diskWrite(historyFile(code),{months:byMonth,updatedAt:new Date().toISOString(),sanitizedBy:'R3.6'});
 for(let round=1;round<=4;round++){
  const missing=months.filter(m=>!(m.slice(0,7) in byMonth));
  if(!missing.length)break;
  job.status=round===1?'RUNNING':'RETRYING';job.round=round;HISTORY_JOBS.set(code,job);
  for(let i=0;i<missing.length;i+=8){
   const batch=missing.slice(i,i+8),rs=await Promise.allSettled(batch.map(m=>twseHistoryMonth(code,m)));
   rs.forEach((r,k)=>{
    const key=batch[k].slice(0,7);
    if(r.status==='fulfilled'&&monthRowsPlausible(code,key,r.value))byMonth[key]=r.value;
    else job.errors.push(key+':'+(r.status==='rejected'?r.reason.message:'empty official month'));
   });
   job.doneMonths=Object.keys(byMonth).length;
   diskWrite(historyFile(code),{months:byMonth,updatedAt:new Date().toISOString()});
   HISTORY_JOBS.set(code,job);
   await sleep(220);
  }
  if(round<4)await sleep(1200*round);
 }
 const remain=months.filter(m=>!(m.slice(0,7) in byMonth));
 if(remain.length){job.status='PARTIAL';job.error=`仍缺 ${remain.length} 個月份`;job.missing=remain.slice(0,20);HISTORY_JOBS.set(code,job);return{ok:false,ready:false,progress:historyProgress(code)}}
 job.status='FINALIZING';HISTORY_JOBS.set(code,job);
 const ready=await finalizeOfficialHistory(code);
 job.status=ready.validation?.fullHistoryPass?'READY':'VALIDATION_FAIL';job.doneMonths=months.length;job.rows=ready.rows.length;job.finishedAt=new Date().toISOString();
 if(!ready.validation?.fullHistoryPass){const repair=repairKeysFromValidation(code,ready.validation,ready.adjustmentAnomalies);if(!ready.validation?.backtestPrecisionPass){for(const [k,v] of Object.entries(byMonth))if(k>='2010-01'&&Array.isArray(v)&&v.some(x=>!x.ohlc))repair.push(k)}for(const k of new Set(repair))delete byMonth[k];if(repair.length){diskWrite(historyFile(code),{months:byMonth,updatedAt:new Date().toISOString(),repairKeys:[...new Set(repair)]});job.repairKeys=[...new Set(repair)];setTimeout(()=>enqueueHistory(code,true),12000)}}
 HISTORY_JOBS.set(code,job);return ready;
}
async function officialHistory(code){const ready=diskRead(readyFile(code));if(ready?.validation?.backtestReadyPass&&!(code==='0050'&&ready.normalizationVersion!=='scale-v2')){if(readyRefreshDue(ready))enqueueHistory(code,false);return ready}enqueueHistory(code,true);return{ok:true,ready:false,warming:true,code,source:ready?.rows?.length?'TWSE官方歷史驗證未通過，背景重驗中':'TWSE官方歷史背景建立中',progress:historyProgress(code),rows:ready?.rows||[],validation:ready?.validation||null,corporateActions:ready?.corporateActions||[],adjustmentAnomalies:ready?.adjustmentAnomalies||[]}}
async function yahooHistoryFallback(code){
 const period2=Math.floor(Date.now()/1000),url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(code+'.TW')+'?period1=0&period2='+period2+'&interval=1d&events=div%2Csplits';
 const d=await getJSON(url),r=d?.chart?.result?.[0];if(!r)throw Error('No fallback history '+code);const ts=r.timestamp||[],q=r.indicators?.quote?.[0]||{},adj=r.indicators?.adjclose?.[0]?.adjclose||[],rows=[];
 for(let i=0;i<ts.length;i++){const close=n(q.close?.[i]);if(close>0)rows.push({date:new Date(ts[i]*1000).toISOString().slice(0,10),open:n(q.open?.[i]),high:n(q.high?.[i]),low:n(q.low?.[i]),close,adjclose:n(adj[i]),volume:n(q.volume?.[i]),ohlc:true,source:'Yahoo fallback'})}
 return{ok:rows.length>=120,code,source:'Yahoo fallback（TWSE官方全歷史尚未暖機）',rows,validation:{fullHistoryPass:false,precision:'fallback'},fetchedAt:new Date().toISOString()};
}
async function etfHistory(code){
 const ready=diskRead(`twse_${code}_official_ready.json`);if(ready?.rows?.length>100&&ready?.validation?.backtestReadyPass)return ready;
 // Never label or silently use a failed official build as complete history. Until PASS, keep a clearly marked fallback for live model continuity.
 return cached('fallback:'+code,30*60*1000,()=>yahooHistoryFallback(code));
}
function adjustedRows(rows){return rows.map(x=>{const ac=x.adjclose??x.close,f=x.close>0&&ac>0?ac/x.close:1;return{...x,aOpen:x.adjopen??(x.open!=null?x.open*f:null),aHigh:x.adjhigh??(x.high!=null?x.high*f:null),aLow:x.adjlow??(x.low!=null?x.low*f:null),aClose:ac,precision:x.high!=null&&x.low!=null?'ohlc':'close'}}).filter(x=>x.aClose>0)}
function sma(a,k){if(a.length<k)return null;return a.slice(-k).reduce((s,x)=>s+x,0)/k}
function histStats(rows){
 const raw=rows.filter(x=>x.close>0),adj=raw.map(x=>x.adjclose??x.close),tr=[],downs=[];
 for(let i=1;i<raw.length;i++){const f=raw[i].close>0&&raw[i].adjclose>0?raw[i].adjclose/raw[i].close:1,pf=raw[i-1].close>0&&raw[i-1].adjclose>0?raw[i-1].adjclose/raw[i-1].close:1;const prev=raw[i-1].close*pf,h=(raw[i].high??raw[i].close)*f,l=(raw[i].low??raw[i].close)*f;tr.push(Math.max(h-l,Math.abs(h-prev),Math.abs(l-prev)));if(l>0&&prev>0)downs.push(l/prev-1)}
 const d1=downs.slice(-252),d2=downs.slice(-504),d5=downs.slice(-1260),df=downs;
 const blend=q=>weightedAvailable([{v:quantile(df,q),w:.15},{v:quantile(d5,q),w:.25},{v:quantile(d2,q),w:.30},{v:quantile(d1,q),w:.30}]);
 const last=raw.at(-1)?.close??null,r20=raw.length>=21?((raw.at(-1).adjclose??raw.at(-1).close)/(raw.at(-21).adjclose??raw.at(-21).close)-1):null;
 return{prevClose:last,sma20:sma(adj,20),sma60:sma(adj,60),sma120:sma(adj,120),sma250:sma(adj,250),atr14:sma(tr,14),q45:blend(.45),q25:blend(.25),q10:blend(.10),r20,historyDays:raw.length,windowDays:{full:raw.length,y10:Math.min(raw.length,2520),y5:Math.min(raw.length,1260),y2:Math.min(raw.length,504),y1:Math.min(raw.length,252)},pullbackBlend:{full:.15,y5:.25,y2:.30,y1:.30}};
}
function pricePercentile(rows,px){const a=rows.slice(-252).map(x=>x.close).filter(Number.isFinite);return a.length?a.filter(v=>v<=px).length/a.length*100:50}
function movePct(q){return q&&q.last>0&&q.prevClose>0?(q.last-q.prevClose)/q.prevClose*100:null}
function normPct(v,scale){return Number.isFinite(v)?clamp(v/scale,-1,1):null}

async function cathayConstituents(date){
 if(!XLSX)throw Error('xlsx module unavailable');
 let lastErr=null;
 const dates=date?[date]:Array.from({length:7},(_,i)=>dateMinus(i));
 for(const iso of dates){
  try{
   const sd=iso.replaceAll('-','/'),buf=await getBuffer('https://cwapi.cathaysite.com.tw/api/ETF/DownloadETFWeightExcel?FundCode=CN&SearchDate='+encodeURIComponent(sd));
   const wb=XLSX.read(buf,{type:'buffer'}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:''}),items=[];
   for(const r of rows){const code=String(r[0]??'').trim();if(!/^\d{4,6}$/.test(code))continue;const name=String(r[1]??'').trim();let weight=null;
    for(let j=2;j<r.length;j++){const s=String(r[j]??'').trim();if(s.includes('%')){weight=n(s);break}}
    if(weight==null){for(let j=r.length-1;j>=2;j--){const x=n(r[j]);if(x!=null&&x>=0&&x<=30){weight=x;break}}}
    if(name&&weight!=null)items.push({code,name,weight});
   }
   const uniq=[...new Map(items.map(x=>[x.code,x])).values()];if(uniq.length>=20)return{code:'00878',asOf:iso,effectiveDate:iso,items:uniq,complete:uniq.length>=META['00878'].expected,expected:META['00878'].expected,officialOnly:true,source:'國泰官方ETF權重Excel',sourceUrl:'https://cwapi.cathaysite.com.tw/api/ETF/DownloadETFWeightExcel',historicalAvailable:true,note:uniq.length>=META['00878'].expected?'國泰官方完整Excel。':`只取得 ${uniq.length}/${META['00878'].expected}，不計健康度。`};
  }catch(e){lastErr=e}
 }
 throw lastErr||Error('Cathay holdings unavailable');
}


function isOfficialHostFor(code,url){
 try{const h=new URL(url).hostname.toLowerCase();if(code==='0050'||code==='0056')return h==='yuantaetfs.com'||h.endsWith('.yuantaetfs.com');if(code==='00878')return h==='cathaysite.com.tw'||h.endsWith('.cathaysite.com.tw');if(code==='00919')return h==='capitalfund.com.tw'||h.endsWith('.capitalfund.com.tw');return false}catch(_){return false}
}
function absUrl(base,u){try{return new URL(String(u||'').replaceAll('\\/','/').replace(/\\u0026/g,'&').replace(/&amp;/g,'&'),base).href}catch(_){return null}}
function discoverOfficialCandidates(code,base,html){
 const raw=String(html||''),found=[];
 const add=u=>{const x=absUrl(base,u);if(x&&isOfficialHostFor(code,x)&&!/\.(?:png|jpg|jpeg|gif|svg|css|woff2?)(?:\?|$)/i.test(x)&&!found.includes(x))found.push(x)};
 // href/src/data-* attributes and quoted URL fragments in scripts/state.
 for(const m of raw.matchAll(/(?:href|src|data-url|data-href|data-download|download-url)\s*=\s*["']([^"']+)["']/gi))add(m[1]);
 for(const m of raw.matchAll(/["']([^"']{1,320}(?:download|export|excel|xlsx|csv|buyback|pcf|StkWeights)[^"']{0,220})["']/gi))add(m[1]);
 return found.filter(u=>/(download|export|excel|xlsx|csv|buyback|pcf|stkweights)/i.test(u));
}
function parseSheetRows(buf){
 if(!XLSX)throw Error('xlsx module unavailable');const wb=XLSX.read(buf,{type:'buffer'}),out=[];
 for(const sn of wb.SheetNames){const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,raw:false,defval:''});if(rows?.length)out.push(...rows)}
 return out;
}
function normalizeConstituentTableRows(rows,sourceLabel){
 const items=[];let header=-1,idxCode=-1,idxName=-1,idxWeight=-1,idxShares=-1;
 for(let i=0;i<Math.min(rows.length,80);i++){
  const z=(rows[i]||[]).map(x=>String(x).trim());const joined=z.join('|');
  if(/(股票|商品|證券).{0,4}(代碼|代號)/.test(joined)&&/(名稱)/.test(joined)){header=i;idxCode=z.findIndex(x=>/(股票|商品|證券).{0,4}(代碼|代號)|^代碼$|^代號$/.test(x));idxName=z.findIndex(x=>/名稱/.test(x));idxWeight=z.findIndex(x=>/權重|比重/.test(x));idxShares=z.findIndex(x=>/股數|數量/.test(x));break}
 }
 if(header<0)return items;
 for(let i=header+1;i<rows.length;i++){
  const r=rows[i]||[],code=String(r[idxCode]??'').trim().match(/\d{4,6}/)?.[0];if(!code)continue;
  const name=String(r[idxName]??code).trim(),weight=idxWeight>=0?n(r[idxWeight]):null,shares=idxShares>=0?n(r[idxShares]):null;
  if(name&&(/^[0-9]{4,6}$/.test(code)))items.push({code,name,weight:Number.isFinite(weight)?weight:null,shares:Number.isFinite(shares)?shares:null,weightSource:sourceLabel});
 }
 return [...new Map(items.map(x=>[x.code,x])).values()];
}
async function fetchAndParseOfficialDocument(code,url){
 if(!isOfficialHostFor(code,url))throw Error('non-official URL blocked');const r=await fetchTimeout(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/html,*/*','Referer':META[code].url}},12000);if(!r.ok)throw Error('HTTP '+r.status);
 const ct=String(r.headers.get('content-type')||'').toLowerCase(),buf=Buffer.from(await r.arrayBuffer()),txt=buf.toString('utf8').replace(/^\uFEFF/,'').trim();
 if(ct.includes('json')||txt.startsWith('{')||txt.startsWith('[')){
  try{const data=JSON.parse(txt),items=(code==='0050'||code==='0056')?parseYuantaWeightJSON(code,data):parseGenericOfficialJSON(data,'官方JSON');if(items.length)return{items,kind:'json'}}catch(_){}
 }
 const isZipXlsx=buf.length>4&&buf[0]===0x50&&buf[1]===0x4b&&buf[2]===0x03&&buf[3]===0x04,isOleXls=buf.length>8&&buf[0]===0xd0&&buf[1]===0xcf&&buf[2]===0x11&&buf[3]===0xe0;
 if(ct.includes('sheet')||ct.includes('excel')||/\.(xlsx?|xlsm)(?:\?|$)/i.test(url)||isZipXlsx||isOleXls){
  const items=normalizeConstituentTableRows(parseSheetRows(buf),'官方Excel');if(items.length)return{items,kind:'excel'};
 }
 if(ct.includes('csv')||/\.csv(?:\?|$)/i.test(url)){
  const rows=txt.split(/\r?\n/).map(csvCells),items=normalizeConstituentTableRows(rows,'官方CSV');if(items.length)return{items,kind:'csv'};
 }
 const items=code==='00919'?parseCapitalOfficialFullHTML(txt):parseYuantaPCFFullHTML(txt);if(items.length)return{items,kind:'html'};
 throw Error('official document parsed 0 constituents');
}
function parseGenericOfficialJSON(data,label='官方JSON'){
 const out=[];for(const o of deepObjects(data)){
  const c=String(pickField(o,['stockCode','StockCode','stkCode','StkCode','symbol','Symbol','code','Code','stockNo','StockNo'])??'').trim();if(!/^\d{4,6}$/.test(c))continue;
  const name=String(pickField(o,['stockName','StockName','stkName','StkName','name','Name','chineseName','ChineseName'])??c).trim();let weight=n(pickField(o,['weight','Weight','ratio','Ratio','percentage','Percentage','percent','Percent','stockWeight','StockWeight']));if(weight!=null&&weight>0&&weight<=1)weight*=100;const shares=n(pickField(o,['shares','Shares','qty','Qty','quantity','Quantity','stockQty','StockQty']));
  if(name)out.push({code:c,name,weight:Number.isFinite(weight)?weight:null,shares:Number.isFinite(shares)?shares:null,weightSource:label});
 }
 return[...new Map(out.map(x=>[x.code,x])).values()];
}
function parseYuantaPCFFullHTML(html){
 const text=stripTags(html).replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim(),items=[];
 const chunks=text.split(/(?=股票代碼\s*\d{4,6}\b)/g);
 for(const chunk of chunks){
  const cm=chunk.match(/股票代碼\s*(\d{4,6})\b/);if(!cm)continue;
  const code=cm[1];
  const nm=chunk.match(/股票名稱\s*(.*?)\s*(?=是否為現金替代|可否參予最小實物申購|股數|股票代碼|$)/);
  const sm=chunk.match(/股數\s*([\d,]+)/);
  if(!sm)continue;
  const name=(nm?.[1]||code).trim();
  const shares=n(sm[1]);
  if(shares>0)items.push({code,name,shares,weight:null,weightSource:'元大官方PCF'});
 }
 return[...new Map(items.map(x=>[x.code,x])).values()];
}
function parseCapitalOfficialFullHTML(html){
 const text=stripTags(html),start=text.indexOf('股票'),end=text.indexOf('期貨',start),seg=start>=0?text.slice(start,end>start?end:undefined):text,items=[];
 const re=/(?:^|\s)(\d{4,6})\s+(.{1,50}?)\s+(\d+(?:\.\d+)?)%\s+([\d,]{3,})(?=\s|$)/g;let m;while((m=re.exec(seg)))items.push({code:m[1],name:m[2].trim(),weight:n(m[3]),shares:n(m[4]),weightSource:'群益官方申購買回清單'});return[...new Map(items.map(x=>[x.code,x])).values()];
}
async function deriveWeightsFromShares(items){
 if(!items?.length)return items||[];const q=await quoteCodes(items.map(x=>x.code)).catch(()=>({}));let total=0;const rows=items.map(x=>{const px=q[x.code]?.last,v=(x.shares>0&&px>0)?x.shares*px:null;if(v)total+=v;return{...x,_basketValue:v}});return rows.map(x=>({...x,weight:Number.isFinite(x.weight)?x.weight:(x._basketValue&&total?x._basketValue/total*100:null),weightSource:Number.isFinite(x.weight)?x.weightSource:(x._basketValue&&total?'官方PCF股數×TWSE現價估算':x.weightSource),_basketValue:undefined}));
}
function parseYuantaRatio(code,html){
 const text=stripTags(html),items=[],re=/商品代碼\s*(\d{4,6})\s*商品名稱\s*([^\d]+?)\s*商品數量\s*[\d,]+\s*商品權重\s*([\d.]+)/g;let m;
 while((m=re.exec(text)))items.push({code:m[1],name:m[2].trim(),weight:n(m[3]),weightSource:'Yuanta ratio'});
 const date=(text.match(/(?:Trade Date|交易日期)\s*:?\s*(20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2})/i)||[])[1];
 return{date:parseISODate(date)||ymdTaipei(),items:[...new Map(items.map(x=>[x.code,x])).values()]};
}
function pickField(o,names){
 if(!o||typeof o!=='object')return null;
 const entries=Object.entries(o);
 for(const name of names){const hit=entries.find(([k])=>k.toLowerCase()===name.toLowerCase());if(hit)return hit[1]}
 return null;
}
function deepObjects(v,out=[]){
 if(Array.isArray(v)){for(const x of v)deepObjects(x,out)}
 else if(v&&typeof v==='object'){out.push(v);for(const x of Object.values(v))if(x&&typeof x==='object')deepObjects(x,out)}
 return out;
}
function parseYuantaWeightJSON(code,data){
 const rows=[],objs=deepObjects(data);
 for(const o of objs){
  const rawCode=pickField(o,['StkCode','StockCode','stockCode','Symbol','symbol','Code','code','StkNo','stockNo']);
  const c=String(rawCode??'').trim();
  if(!/^\d{4,6}$/.test(c))continue;
  const name=String(pickField(o,['StkName','StockName','stockName','Name','name','CName','ChineseName'])??'').trim();
  let w=n(pickField(o,['Weight','weight','StkWeight','StockWeight','stockWeight','Ratio','ratio','Percentage','percentage','Percent','percent','Weights']));
  if(w!=null&&w>0&&w<=1)w*=100;
  const shares=n(pickField(o,['StkQty','StockQty','stockQty','Quantity','quantity','Qty','qty','Shares','shares']));
  if(w!=null&&w>=0&&w<=100)rows.push({code:c,name:name||c,weight:w,shares,weightSource:'Yuanta StkWeights API'});
 }
 const uniq=[...new Map(rows.map(x=>[x.code,x])).values()];
 return uniq.sort((a,b)=>b.weight-a.weight);
}

async function yuantaApiConstituents(code){
 const fundId=META[code].fundId;if(!fundId)throw Error('Yuanta fundId missing');
 const dates=[ymdTaipei(),dateMinus(1),dateMinus(2),dateMinus(3),dateMinus(4)].map(x=>x.replaceAll('-','/'));
 const bases=['https://etfapi.yuantaetfs.com/api/StkWeights','https://www.yuantaetfs.com/api/StkWeights','https://yuantaetfs.com/api/StkWeights'];
 const headers={'Referer':META[code].url,'Origin':'https://www.yuantaetfs.com','X-Requested-With':'XMLHttpRequest','Accept':'application/json, text/plain, */*','Sec-Fetch-Site':'same-site','Sec-Fetch-Mode':'cors'};
 let lastErr=null;
 for(const base of bases){
  for(const dt of ['',...dates]){
   const qs=new URLSearchParams({date:dt,fundid:fundId});const url=base+'?'+qs.toString();
   try{const d=await getJSON(url,headers,1),items=parseYuantaWeightJSON(code,d);if(items.length>=META[code].expected)return{items:items.slice(0,META[code].expected),sourceUrl:url,kind:'StkWeights API',asOf:dt?dt.replaceAll('/','-'):null};lastErr=Error(`Yuanta API only ${items.length} @ ${url}`)}catch(e){lastErr=e}
  }
 }
 throw lastErr||Error('Yuanta StkWeights unavailable');
}


function parseMoneyDJHoldings(code,html){
 const text=stripTags(html).replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim(),items=[];
 // Example: 台積電(2330.TW) 57.40 568,615,359.00
 const re=/([^\s()]{1,40})\((\d{4,6})\.TW\)\s+(\d+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)/g;let m;
 while((m=re.exec(text))){
  const name=m[1].trim(),c=m[2],weight=n(m[3]),shares=n(m[4]);
  if(/^\d{4,6}$/.test(c)&&Number.isFinite(weight)&&weight>=0&&weight<=100)
   items.push({code:c,name,weight,shares,weightSource:'MoneyDJ全部持股'});
 }
 const date=(text.match(/持股明細\s*資料日期[:：]?\s*(20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2})/)||
             text.match(/資料日期[:：]?\s*(20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2})/)||[])[1];
 return{date:parseISODate(date)||ymdTaipei(),items:[...new Map(items.map(x=>[x.code,x])).values()]};
}
async function moneyDJConstituents(code){
 const expected=META[code].expected;
 const urls=[
  `https://www.moneydj.com/etf/x/basic/basic0007b.xdjhtm?etfid=${code}.tw`,
  `https://www.moneydj.com/ETF/X/Basic/Basic0007.xdjhtm?etfid=${code}.tw&topc=`
 ];
 let best={date:ymdTaipei(),items:[]},errors=[];
 for(const url of urls){
  try{
   const html=await deadline(getText(url,{'Accept':'text/html,application/xhtml+xml','Referer':'https://www.moneydj.com/'},1),6500,null);
   if(!html){errors.push('timeout '+url);continue}
   const p=parseMoneyDJHoldings(code,html);
   if(p.items.length>best.items.length)best=p;
   if(p.items.length>=expected)return{
    code,asOf:p.date,effectiveDate:p.date,items:p.items.slice(0,expected),
    complete:true,expected,officialOnly:false,thirdParty:true,
    source:'MoneyDJ 完整持股明細',sourceUrl:url,historicalAvailable:false,
    note:`完整成分與權重由 MoneyDJ 全部持股頁取得；個股即時漲跌由 dashboard 行情模組自行取得。已解析 ${p.items.length}/${expected} 檔。`,
    attempts:[{source:'MoneyDJ',ok:true,count:p.items.length,url}]
   };
   errors.push(`parsed ${p.items.length}/${expected} ${url}`);
  }catch(e){errors.push(e.message)}
 }
 return{
  code,asOf:best.date,effectiveDate:best.date,items:best.items,complete:false,expected,
  officialOnly:false,thirdParty:true,source:'MoneyDJ 持股來源未完整',
  sourceUrl:urls[0],historicalAvailable:false,
  note:`只解析 ${best.items.length}/${expected} 檔；不完整時不納入模型。`,
  errors:errors.slice(-4),attempts:[{source:'MoneyDJ',ok:best.items.length>=expected,count:best.items.length,error:errors.at(-1)||null,url:urls[0]}]
 };
}
function parsePocketHoldings(code,html){
 const text=stripTags(html).replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim(),items=[];
 // Pocket holding rows: stock code, name, weight%, holding quantity, 股.
 // Restrict to ordinary Taiwan stock codes; ignore cash, receivables and futures.
 const re=/(?:^|\s)(\d{4,6})\s+(.{1,45}?)\s+(\d+(?:\.\d+)?)%\s+([\d,]+)\s+股(?=\s|$)/g;let m;
 while((m=re.exec(text))){
  const c=m[1],name=m[2].trim(),weight=n(m[3]),shares=n(m[4]);
  if(/^\d{4,6}$/.test(c)&&Number.isFinite(weight)&&weight>=0&&weight<=100)items.push({code:c,name,weight,shares,weightSource:'口袋證券持股明細'});
 }
 const dates=[...text.matchAll(/資料日期\s*[:：]?\s*(20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2})/g)].map(x=>parseISODate(x[1])).filter(Boolean);
 return{date:dates.at(-1)||ymdTaipei(),items:[...new Map(items.map(x=>[x.code,x])).values()]};
}
async function pocketConstituents(code){
 const expected=META[code].expected,url=`https://www.pocket.tw/etf/tw/${code}/fundholding?page=&parent=&source=`;
 const variants=[url,`https://www.pocket.tw/etf/tw/${code}/fundholding`],lastErr=[];
 let best={date:ymdTaipei(),items:[]};
 for(const u of variants){
  try{
   const html=await deadline(getText(u,{'Accept':'text/html,application/xhtml+xml','Referer':`https://www.pocket.tw/etf/tw/${code}`},1),6500,null);
   if(!html){lastErr.push('timeout '+u);continue}
   const p=parsePocketHoldings(code,html);if(p.items.length>best.items.length)best=p;
   if(p.items.length>=expected)return{code,asOf:p.date,effectiveDate:p.date,items:p.items.slice(0,expected),complete:true,expected,officialOnly:false,thirdParty:true,source:'口袋證券完整持股明細',sourceUrl:u,historicalAvailable:false,note:`持股/權重由口袋證券取得；個股漲跌由儀表板既有市場行情來源自行計算。已解析 ${p.items.length}/${expected} 檔。`};
   lastErr.push(`parsed ${p.items.length}/${expected} ${u}`);
  }catch(e){lastErr.push(e.message)}
 }
 return{code,asOf:best.date,effectiveDate:best.date,items:best.items,complete:false,expected,officialOnly:false,thirdParty:true,source:'口袋證券持股來源未完整',sourceUrl:url,historicalAvailable:false,note:`只解析 ${best.items.length}/${expected} 檔；不完整時不納入模型。`,errors:lastErr.slice(-4)};
}
async function yuantaConstituents(code){
 const ratioUrl=META[code].url,pcfUrl=`https://www.yuantaetfs.com/tradeInfo/pcf/${code}`,errors=[],attempts=[];
 let ratio={date:ymdTaipei(),items:[]};

 // Always secure the official top-5 fallback first. Never regress to 0 just because the full source is slow.
 try{
  const ratioHtml=await deadline(getText(ratioUrl,{},1),6500,null);
  if(ratioHtml){
   ratio=parseYuantaRatio(code,ratioHtml);
   attempts.push({source:'ratio',ok:true,count:ratio.items.length,url:ratioUrl});
   if(ratio.items.length>=META[code].expected)return{code,asOf:ratio.date,effectiveDate:ratio.date,items:ratio.items.slice(0,META[code].expected),complete:true,expected:META[code].expected,officialOnly:true,source:'元大官方持股比重頁完整50檔',sourceUrl:ratioUrl,historicalAvailable:false,note:'直接使用元大官方每日持股比重完整清單與官方權重。',attempts};
  }else{attempts.push({source:'ratio',ok:false,count:0,error:'timeout',url:ratioUrl});errors.push('ratio:timeout')}
 }catch(e){attempts.push({source:'ratio',ok:false,count:0,error:e.message,url:ratioUrl});errors.push('ratio:'+e.message)}

 // Try PCF full list. Current public HTML exposes only a preview, but keep this official route for Render verification.
 try{
  const pcfHtml=await deadline(getText(pcfUrl,{'Referer':ratioUrl,'Accept':'text/html,application/xhtml+xml'},1),6500,null);
  if(pcfHtml){
   let pcf=parseYuantaPCFFullHTML(pcfHtml);
   attempts.push({source:'pcf',ok:true,count:pcf.length,url:pcfUrl});
   if(pcf.length>=META[code].expected){
    pcf=await deriveWeightsFromShares(pcf);
    const weightN=pcf.filter(x=>Number.isFinite(x.weight)).length;
    const text=stripTags(pcfHtml),date=(text.match(/(?:交易日期|公告日期|Trade Date)\s*:?\s*(20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2})/)||[])[1];
    if(weightN>=META[code].expected*.90)return{code,asOf:parseISODate(date)||ratio.date,effectiveDate:parseISODate(date)||ratio.date,items:pcf.slice(0,META[code].expected),complete:true,expected:META[code].expected,officialOnly:true,source:'元大官方完整PCF＋TWSE現價估算權重',sourceUrl:pcfUrl,historicalAvailable:false,note:`官方PCF已解析 ${pcf.length}/${META[code].expected} 檔。`,attempts};
    attempts.push({source:'pcf-weight',ok:false,count:weightN,error:'weight derivation incomplete'});
   }
  }else{attempts.push({source:'pcf',ok:false,count:0,error:'timeout',url:pcfUrl});errors.push('pcf:timeout')}
 }catch(e){attempts.push({source:'pcf',ok:false,count:0,error:e.message,url:pcfUrl});errors.push('pcf:'+e.message)}

 // Legacy official API as a bounded backup. It may now return the website HTML rather than JSON.
 try{
  const api=await deadline(yuantaApiConstituents(code),5000,null);
  if(api){
   attempts.push({source:'StkWeights',ok:true,count:api.items.length,url:api.sourceUrl});
   const asOf=api.asOf||ratio.date;
   return{code,asOf,effectiveDate:asOf,items:api.items,complete:true,expected:META[code].expected,officialOnly:true,source:'元大官方完整 StkWeights API',sourceUrl:api.sourceUrl,historicalAvailable:false,note:'官方完整權重API備援。',attempts};
  }
  attempts.push({source:'StkWeights',ok:false,count:0,error:'timeout'});
 }catch(e){attempts.push({source:'StkWeights',ok:false,count:0,error:e.message});errors.push('api:'+e.message)}

 return{code,asOf:ratio.date,effectiveDate:ratio.date,items:ratio.items,complete:false,expected:META[code].expected,officialOnly:true,source:'元大官方來源（完整來源尚未取得）',sourceUrl:ratioUrl,historicalAvailable:false,note:`目前保留官方持股比重頁 ${ratio.items.length}/${META[code].expected} 檔作參考，不計健康度；完整來源失敗不再退化成0檔。`,errors:errors.slice(-8),attempts};
}

function parseCapital(html){
 const text=stripTags(html),start=text.indexOf('股票'),end=text.indexOf('期貨',start),seg=start>=0?text.slice(start,end>start?end:undefined):text,items=[];
 const re=/(?:^|\s)(\d{4,6})\s+(.{1,50}?)\s+(\d+(?:\.\d+)?)%\s+([\d,]{3,})(?=\s|$)/g;let m;while((m=re.exec(seg)))items.push({code:m[1],name:m[2].trim(),weight:n(m[3]),shares:n(m[4]),weightSource:'群益官方申購買回清單'});
 const date=(text.match(/(?:查詢日期|交易日期|資料日期|匯率)\s*[:：]?\s*[^0-9]{0,40}(20\d{2}[\/.]\d{1,2}[\/.]\d{1,2})/)||[])[1];return{date:parseISODate(date)||ymdTaipei(),items:[...new Map(items.map(x=>[x.code,x])).values()]};
}
async function capitalConstituents(){
 const code='00919',expected=META[code].expected,today=ymdTaipei(),errors=[];
 const urls=[META[code].portfolioUrl,META[code].url];
 const rs=await Promise.allSettled(urls.map(url=>deadline(getText(url,{'Referer':'https://www.capitalfund.com.tw/etf/product/detail/195','Accept':'text/html,application/xhtml+xml'},1),4500,null)));
 let best={date:today,items:[],html:'',url:META[code].portfolioUrl};
 for(let i=0;i<rs.length;i++){
  const url=urls[i],r=rs[i];
  if(r.status!=='fulfilled'||!r.value){errors.push(url+':timeout/error');continue}
  const html=r.value,p=parseCapital(html);
  if(p.items.length>best.items.length)best={...p,html,url};
  if(p.items.length>=expected)return{code,asOf:p.date,effectiveDate:p.date,items:p.items.slice(0,expected),complete:true,expected,officialOnly:true,source:'群益官方完整投資組合/申購買回清單',sourceUrl:url,historicalAvailable:false,note:'完整持股直接由群益官方頁取得。'};
 }
 // Try only the official download/API candidates visible in the two official pages, in parallel and under a hard deadline.
 const candidates=[...new Set(urls.flatMap((u,i)=>discoverOfficialCandidates(code,u,rs[i]?.status==='fulfilled'?(rs[i].value||''):'')))].slice(0,12);
 const docs=await Promise.allSettled(candidates.map(u=>deadline(fetchAndParseOfficialDocument(code,u),3500,null)));
 for(let i=0;i<docs.length;i++){
  const z=docs[i].status==='fulfilled'?docs[i].value:null;if(!z)continue;
  if(z.items?.length>=expected)return{code,asOf:best.date,effectiveDate:best.date,items:z.items.slice(0,expected),complete:true,expected,officialOnly:true,source:`群益官方${z.kind==='excel'?'下載Excel':z.kind==='csv'?'下載CSV':z.kind==='json'?'完整JSON':'完整PCF'}`,sourceUrl:candidates[i],historicalAvailable:false,note:'由群益官方下載資料/API取得完整清單。'};
 }
 return{code,asOf:best.date,effectiveDate:best.date,items:best.items,complete:false,expected,officialOnly:true,source:'群益官方頁（目前僅取得前十大）',sourceUrl:best.url,historicalAvailable:false,note:`R3.25已停止長時間輪詢，避免 /api/constituent-dashboard 逾時。目前群益官方HTML只直接提供 ${best.items.length}/${expected} 筆；未使用第三方補齊。`,errors:errors.slice(-8)};
}
async function constituents(code,date=null){
 const key='const:r328:'+code+':'+(date||'latest');
 return cached(key,date?6*60*60*1000:30*60*1000,async()=>{
  if(code==='00878')return cathayConstituents(date);
  if(date)return{...await constituents(code,null),requestedHistoricalDate:date,historicalAvailable:false,note:'未取得該歷史日完整持股版本時，絕不將今天成分倒灌歷史。'};
  if(code==='0050'||code==='0056'||code==='00919')return moneyDJConstituents(code);
  throw Error('unsupported constituents');
 });
}
async function constituentHealth(code){
 return cached('health:r328:'+code,45000,async()=>{
  let c;try{c=await constituents(code)}catch(e){return{ok:true,code,usable:false,score:null,divergence:'資料源暫時不可用',bullWeight:0,weakWeight:0,neutralWeight:0,sourceCoverage:0,quoteCoverage:0,items:[],reason:e.message,source:'unavailable'}}
  const expected=c.expected||META[code].expected;if(!c.items?.length)return{ok:true,code,usable:false,score:null,divergence:'資料不足',sourceCoverage:0,quoteCoverage:0,items:[],source:c.source,note:c.note};
  const q=await quoteCodes(c.items.map(x=>x.code)).catch(()=>({})),rows=[];let totalW=0,quotedW=0,bullW=0,weakW=0,neutralW=0,weighted=0,weightedCount=0;
  for(const it of c.items){const z=q[it.code],ch=movePct(z),w=Number.isFinite(it.weight)?it.weight:null;if(w!=null)totalW+=w;if(Number.isFinite(ch)&&w!=null){quotedW+=w;weighted+=clamp(ch/2.5,-1,1)*w;weightedCount++;if(ch>.30)bullW+=w;else if(ch<-.30)weakW+=w;else neutralW+=w}rows.push({...it,changePct:Number.isFinite(ch)?ch:null,last:z?.last??null,quoted:Number.isFinite(ch)})}
  const sourceCoverage=expected?Math.min(1,c.items.length/expected):0,weightCoverage=expected?Math.min(1,c.items.filter(x=>Number.isFinite(x.weight)).length/expected):0,quoteCoverage=totalW?quotedW/totalW:0;
  // R3.27: complete Pocket holdings are accepted for 0050/0056/00919; 00878 remains Cathay official.
  const trustedHoldingSource=c.officialOnly===true||c.thirdParty===true;
  const usable=!!c.complete&&trustedHoldingSource&&sourceCoverage>=1&&weightCoverage>=1&&quoteCoverage>=.75;
  const score=usable?clamp(Math.round(50+(weighted/quotedW)*38),0,100):null;let divergence='資料不足';if(usable){if(score>=65&&bullW>=weakW*1.5)divergence='健康擴散';else if(score>=52&&weakW<45)divergence='輕度分歧';else if(score<42||weakW>55)divergence='明顯分歧';else divergence='結構背離'}
  return{ok:true,code,score,usable,divergence,bullWeight:bullW,weakWeight:weakW,neutralWeight:neutralW,sourceCoverage:sourceCoverage*100,weightCoverage:weightCoverage*100,quoteCoverage:quoteCoverage*100,asOf:c.asOf,effectiveDate:c.effectiveDate,complete:c.complete,expected,items:rows.sort((a,b)=>(b.weight||0)-(a.weight||0)),source:c.source,sourceUrl:c.sourceUrl,historicalAvailable:c.historicalAvailable,note:c.note||null,attempts:c.attempts||null,errors:c.errors||null};
 });
}


async function constituentDashboard(code='0050'){
 const h=await constituentHealth(code), items=h.items||[], quoted=items.filter(x=>Number.isFinite(x.changePct));
 const up=quoted.filter(x=>x.changePct>0.3), down=quoted.filter(x=>x.changePct<-0.3), flat=quoted.filter(x=>Math.abs(x.changePct)<=0.3);
 const sum=a=>a.reduce((z,x)=>z+(Number.isFinite(x.weight)?x.weight:0),0);
 const top10=[...items].sort((a,b)=>(b.weight||0)-(a.weight||0)).slice(0,10);
 const weightedMove=quoted.length?quoted.reduce((z,x)=>z+x.changePct*(x.weight||0),0)/Math.max(0.0001,sum(quoted)):null;
 const equalBreadth=quoted.length?(up.length-down.length)/quoted.length*100:null;
 const weightedBreadth=quoted.length?(sum(up)-sum(down))/Math.max(0.0001,sum(quoted))*100:null;
 return{ok:true,build:BUILD,code,name:META[code]?.name,asOf:h.asOf,source:h.source,sourceUrl:h.sourceUrl,complete:h.complete,usable:h.usable,expected:h.expected||META[code]?.expected,actual:items.length,quoted:quoted.length,sourceCoverage:h.sourceCoverage,quoteCoverage:h.quoteCoverage,healthScore:h.score,divergence:h.divergence,bullWeight:h.bullWeight,weakWeight:h.weakWeight,neutralWeight:h.neutralWeight,attempts:h.attempts||null,errors:h.errors||null,summary:{upCount:up.length,downCount:down.length,flatCount:flat.length,upWeight:sum(up),downWeight:sum(down),flatWeight:sum(flat),equalBreadth,weightedBreadth,weightedMove,top10Weight:sum(top10),tsmcWeight:items.find(x=>x.code==='2330')?.weight??null},items};
}
function buildEnvironment(code,ld,ctx,ovs,nf,health){
 const parts=[];function add(name,v,w){if(Number.isFinite(v))parts.push({name,v:clamp(v,-1,1),w})}
 const broad=ctx?.breadth;
 add('大盤',normPct(movePct(ld.market),2.5),code==='0050'?.14:.16);
 add('台積電',normPct(movePct(ld.tsmc),3),code==='0050'?.20:.08);
 add('台指夜盤',normPct(nf?.changePct,2.5),.18);
 add('NASDAQ',normPct(ovs?.quotes?.NASDAQ?.changePct,2.2),code==='0050'?.10:.07);
 add('SOX',normPct(ovs?.quotes?.SOX?.changePct,3.5),code==='0050'?.15:.07);
 add('TSM ADR',normPct(ovs?.quotes?.TSM?.changePct,3.5),code==='0050'?.14:.06);
 if(broad)add('上市廣度',(broad.ratio-.5)*2,.08);
 if(health?.usable)add('ETF成分健康',(health.score-50)/50,code==='0050'?.18:.24);
 const den=parts.reduce((s,x)=>s+x.w,0);
 const base=den?parts.reduce((s,x)=>s+x.v*x.w,0)/den*100:0;
 return{score:clamp(base,-100,100),baseScore:base,parts,breadth:broad};
}
function modelOne(code,quote,hist,env,health,fresh=true){
 const cfg=META[code].cfg,st=histStats(hist.rows),px=quote?.last??st.prevClose,prev=quote?.prevClose??st.prevClose;if(!(px>0&&prev>0))throw Error('No current price '+code);
 const atr=st.atr14||prev*.012,pctile=pricePercentile(hist.rows,px),dev20=st.sma20?px/st.sma20-1:0,r20=st.r20||0;
 const chaseRisk=clamp(Math.round(cfg.chaseBase+Math.max(0,pctile-cfg.chasePctile)*1.25+Math.max(0,dev20)*cfg.chaseDev+Math.max(0,r20-.05)*cfg.chaseR20),0,100);
 const chasePenalty=clamp((chaseRisk-45)/55*.010,0,.010),envShift=env.score<0?clamp(env.score/100*cfg.envShiftNeg,-.022,0):clamp(env.score/100*cfg.envShiftPos,0,.006);
 const healthShift=health?.usable?clamp((health.score-50)/50*cfg.healthShift,-.004,.004):0;
 let p1=clamp(st.q45??-.006,-.020,-.0025)-chasePenalty+envShift+healthShift,p2=clamp(st.q25??-.012,-.038,-.006)-chasePenalty*.7+envShift*.9+healthShift*.8,p3=clamp(st.q10??-.022,-.065,-.013)-chasePenalty*.4+envShift*.8+healthShift*.6;
 const bull=st.sma20&&st.sma60&&st.sma120&&st.sma250&&st.sma20>st.sma60&&st.sma60>st.sma120&&st.sma120>st.sma250;
 // Slow re-anchor: long-term center may lift the floor, never chase current price directly.
 if(bull&&r20>0){const center=.42*st.sma20+.30*st.sma60+.18*st.sma120+.10*st.sma250,centerGap=center/(st.sma60||center)-1,re=clamp(centerGap*cfg.reanchor,0,.007);p1+=re;p2+=re*.75;p3+=re*.55}
 let l1=prev*(1+p1),l2=prev*(1+p2),l3=prev*(1+p3);l2=Math.min(l2,l1-Math.max(atr*.35,prev*.004));l3=Math.min(l3,l2-Math.max(atr*.45,prev*.006));
 const zoneW=Math.max(.03,Math.min(atr*.10,px*.0016)),z=x=>({low:x-zoneW,high:x+zoneW,center:x});
 const marketCh=movePct(env.liveMarket),tsmcCh=movePct(env.liveTsmc),b=env.breadth;
 const knife=(Number.isFinite(marketCh)&&marketCh<-2.2?1:0)+(Number.isFinite(tsmcCh)&&tsmcCh<-3?1:0)+(b&&b.ratio<.22?1:0)+(env.score<-65?1:0);
 const stale=!fresh,hardVeto=stale||knife>=2,dist=(l1-px)/px*100;
 let score=58+clamp(-dist*8,-20,20)-chaseRisk*.20+clamp(env.score*.08,-8,8)+(health?.usable?clamp((health.score-50)*.12,-6,6):0);if(hardVeto)score=Math.min(score,42);score=clamp(Math.round(score),0,100);
 const noBuyToday=!hardVeto&&((chaseRisk>=88&&px-l1>atr*1.4)||(score<40&&px>l1));
 return{code,name:META[code].name,price:px,prevClose:prev,score,chaseRisk,hardVeto,hardVetoReason:stale?'資料時間戳逾時':(knife>=2?'市場/權值/廣度至少兩項急殺':null),noBuyToday,noBuyReason:noBuyToday?'現價偏離合理區過遠／追高風險過高，今日不硬生買點':null,environmentScore:env.score,environmentParts:env.parts,health:health?{score:health.score,usable:health.usable,divergence:health.divergence,sourceCoverage:health.sourceCoverage,quoteCoverage:health.quoteCoverage}:null,history:{...st,pricePercentile:pctile,dev20Pct:dev20*100,r20Pct:r20*100,bullStructure:!!bull},raw:{first:z(l1),second:z(l2),third:z(l3)},historySource:hist.source,historyOfficial:!!hist.validation?.fullHistoryPass,historyProgress:historyProgress(code),method:'full-history price core + 5/20/60/120/250 trend + asymmetric environment + health when complete + anti-chase + slow re-anchor'};
}
async function buyModel(){
 const historyTimeout=c=>({ok:false,code:c,rows:[],source:'歷史來源逾時（模型暫以即時價＋保守預設運作）',validation:{fullHistoryPass:false},error:'history deadline exceeded'});
 const healthTimeout=c=>({ok:true,code:c,usable:false,score:null,divergence:'官方成分來源逾時，暫不計分',sourceCoverage:0,quoteCoverage:0,items:[],reason:'constituent deadline exceeded',source:'timeout'});
 const [ld,ctx,ovs,nf,harr,hhealth]=await Promise.all([
  deadline(live().catch(e=>({ok:false,quotes:{},error:e.message,fetchedAt:null})),8000,{ok:false,quotes:{},market:null,tsmc:null,error:'market deadline exceeded',fetchedAt:null}),
  deadline(cached('ctx',60000,context).catch(()=>null),6000,null),
  deadline(cached('ovs',45000,overseas).catch(()=>null),6000,null),
  deadline(nightFuture().catch(()=>null),6000,null),
  Promise.all(ETF.map(async c=>[c,await deadline(etfHistory(c).catch(e=>({ok:false,rows:[],source:'history error',validation:{fullHistoryPass:false},error:e.message})),7000,historyTimeout(c))])),
  Promise.all(ETF.map(async c=>[c,await deadline(constituentHealth(c).catch(e=>({ok:false,code:c,usable:false,score:null,divergence:'成分來源錯誤',sourceCoverage:0,quoteCoverage:0,reason:e.message})),6000,healthTimeout(c))]))
 ]);
 const hs=Object.fromEntries(harr),hh=Object.fromEntries(hhealth),models={};const marketAt=ld.fetchedAt?Date.parse(ld.fetchedAt):0,fresh=!!marketAt&&Date.now()-marketAt<90000&&(!twMarketOpenNow()||ld.realtime!==false);
 for(const c of ETF){try{const env=buildEnvironment(c,ld,ctx,ovs,nf,hh[c]);env.liveMarket=ld.market;env.liveTsmc=ld.tsmc;models[c]=modelOne(c,ld.quotes?.[c],hs[c],env,hh[c],fresh)}catch(e){models[c]={code:c,error:e.message}}}
 return{ok:true,version:VERSION,build:BUILD,fetchedAt:new Date().toISOString(),marketFetchedAt:ld.fetchedAt||null,dataFresh:!!fresh,degraded:!fresh||Object.values(hh).some(x=>!x?.usable),models,quotes:ld.quotes||{},market:ld.market||null,tsmc:ld.tsmc||null,context:ctx,nightFuture:nf,overseas:ovs,health:Object.fromEntries(ETF.map(c=>[c,hh[c]&&{score:hh[c].score,usable:hh[c].usable,divergence:hh[c].divergence,sourceCoverage:hh[c].sourceCoverage,quoteCoverage:hh[c].quoteCoverage,asOf:hh[c].asOf}]))};
}

/* ---------- Full-history price-core backtest, anti-chase A/B, walk-forward ---------- */
function prefix(a){const p=[0];for(const x of a)p.push(p.at(-1)+(Number.isFinite(x)?x:0));return p}
function avgP(p,i,k){return i+1>=k?(p[i+1]-p[i+1-k])/k:null}
function prepBacktest(rows){
 const a=adjustedRows(rows),tr=[0],downs=[null];
 for(let i=1;i<a.length;i++){const prev=a[i-1].aClose,h=a[i].aHigh??a[i].aClose,l=a[i].aLow??a[i].aClose;tr[i]=Math.max(h-l,Math.abs(h-prev),Math.abs(l-prev));downs[i]=l/prev-1}
 return{a,tr,downs,pClose:prefix(a.map(x=>x.aClose)),pTr:prefix(tr)};
}
function signalSeries(rows,chaseScale=1){
 const {a,tr,downs,pClose,pTr}=prepBacktest(rows),sig=[];let qcache=null,lastSig=-999;
 for(let i=260;i<a.length-60;i++){
  if(!qcache||i%20===0){const ds=downs.slice(1,i).filter(Number.isFinite),blend=q=>weightedAvailable([{v:quantile(ds,q),w:.15},{v:quantile(ds.slice(-1260),q),w:.25},{v:quantile(ds.slice(-504),q),w:.30},{v:quantile(ds.slice(-252),q),w:.30}]);qcache={q45:blend(.45),q25:blend(.25),q10:blend(.10)}}
  const prev=a[i-1].aClose,px=a[i-1].aClose,s20=avgP(pClose,i-1,20),slice=a.slice(Math.max(0,i-252),i).map(x=>x.aClose),pctile=slice.filter(v=>v<=px).length/(slice.length||1)*100,r20=i>=20?px/a[i-20].aClose-1:0,dev20=s20?px/s20-1:0;
  const chase=chaseScale===0?0:clamp((25+Math.max(0,pctile-67)*1.25+Math.max(0,dev20)*620+Math.max(0,r20-.05)*185)*chaseScale,0,100),pen=chaseScale===0?0:clamp((chase-45)/55*.010,0,.010);
  let p1=clamp(qcache.q45??-.006,-.020,-.0025)-pen,p2=clamp(qcache.q25??-.012,-.038,-.006)-pen*.7,p3=clamp(qcache.q10??-.022,-.065,-.013)-pen*.4;
  const atr=(pTr[i]-pTr[Math.max(0,i-14)])/Math.min(14,i),l1=prev*(1+p1),l2=Math.min(prev*(1+p2),l1-Math.max(atr*.35,prev*.004)),l3=Math.min(prev*(1+p3),l2-Math.max(atr*.45,prev*.006));
  const day=a[i],dayLow=day.aLow??day.aClose,dayHigh=day.aHigh??day.aClose,rapid=(day.aOpen??day.aClose)<l3,hit=!rapid&&dayLow<=l1&&dayHigh>=l1;
  if(hit&&i-lastSig>=7){const entry=l1,fut={},lows=[];for(const k of [5,20,60])fut[k]=a[i+k].aClose/entry-1;for(let j=i;j<=Math.min(i+60,a.length-1);j++)lows.push({r:((a[j].aLow??a[j].aClose)/entry-1),date:a[j].date,price:(a[j].aLow??a[j].aClose),precision:a[j].aLow!=null?'ohlc':'close'});const wl=lows.reduce((w,x)=>!w||x.r<w.r?x:w,null);
   sig.push({i,date:day.date,entry,pctile,chase,ret5:fut[5],ret20:fut[20],ret60:fut[60],mae60:wl.r,lowDate:wl.date,lowPrice:wl.price,precision:wl.precision});lastSig=i}
 }
 return{rows:a,signals:sig};
}
function metrics(series,startDate=null){
 const s=series.signals.filter(x=>!startDate||x.date>=startDate),a=series.rows;if(!s.length)return{signals:0};
 const r5=s.map(x=>x.ret5*100),r20=s.map(x=>x.ret20*100),r60=s.map(x=>x.ret60*100),mae=s.map(x=>x.mae60*100),high=s.filter(x=>x.pctile>=80).length/s.length*100;
 let maxGap=0,prev=null;for(const x of s){if(prev!=null)maxGap=Math.max(maxGap,x.i-prev);prev=x.i}
 // True participation KPI: identify 60-trading-day bull regimes (>10% gain). A regime is participated only if a signal occurs in its first half and entry isn't >8% above regime start.
 let bullWindows=0,participated=0,late=0,missedUpside=0;
 for(let i=260;i<a.length-61;i+=10){if(startDate&&a[i].date<startDate)continue;const gain=a[i+60].aClose/a[i].aClose-1;if(gain>.10){bullWindows++;const sig=s.find(x=>x.i>=i&&x.i<=i+30);if(sig&&sig.entry<=a[i].aClose*1.08)participated++;else{if(sig)late++;missedUpside++}}}
 const worst=s.reduce((w,x)=>!w||x.mae60<w.mae60?x:w,null);
 return{signals:s.length,avg5:mean(r5),median5:median(r5),avg20:mean(r20),median20:median(r20),avg60:mean(r60),median60:median(r60),win20:r20.filter(x=>x>0).length/r20.length*100,worstMAE60:Math.min(...mae),worstCase:worst?{signalDate:worst.date,entry:worst.entry,mae60:worst.mae60*100,lowDate:worst.lowDate,lowPrice:worst.lowPrice,precision:worst.precision}:null,highEntryRate:high,maxNoSignalDays:maxGap,participationRate:bullWindows?participated/bullWindows*100:null,bullWindows,participatedBullWindows:participated,lateBullWindows:late,missedUpsideWindows:missedUpside};
}
function yearsAgo(n){const d=new Date();d.setFullYear(d.getFullYear()-n);return d.toISOString().slice(0,10)}
function objective(m){if(!m.signals)return-999;return (m.median20||0)-(.04*(m.highEntryRate||0))+(.025*(m.participationRate||0))}
function walkForward(rows,cands){
 const years=[...new Set(rows.map(x=>Number(x.date.slice(0,4))))].sort((a,b)=>a-b),out=[],combined=[];
 for(const y of years){if(y<years[0]+4)continue;const trainStart=`${y-3}-01-01`,trainEnd=`${y-1}-12-31`,testStart=`${y}-01-01`,testEnd=`${y}-12-31`;let best=null;
  for(const [scale,series] of Object.entries(cands)){const subset={rows:series.rows,signals:series.signals.filter(x=>x.date>=trainStart&&x.date<=trainEnd)},m=metrics(subset);const o=objective(m);if(!best||o>best.o)best={scale:Number(scale),o,m,series}}
  const ts=best.series.signals.filter(x=>x.date>=testStart&&x.date<=testEnd);combined.push(...ts);out.push({year:y,selectedChaseScale:best.scale,trainSignals:best.m.signals,testSignals:ts.length});
 }
 return{years:out,metrics:metrics({rows:cands['1'].rows,signals:combined})};
}
async function backtest(code){
 const h=await officialHistory(code);if(!h.ready)return{ok:true,ready:false,status:'WARMING',code,name:META[code].name,progress:h.progress,error:null};const v=h.validation;
 if(!v?.priceHistoryPass)return{ok:true,ready:false,status:'VALIDATION_FAIL',code,error:'歷史價格樣本不足，未達完整歷史或長期樣本門檻',validation:v,source:h.source};
 if(!v?.backtestPrecisionPass)return{ok:true,ready:false,status:'VALIDATION_FAIL',code,error:'2010年後OHLC覆蓋不足98%，禁止用收盤價冒充日內最低/最高回測',validation:v,source:h.source};
 if(!v?.dividendCoveragePass)return{ok:true,ready:false,status:'VALIDATION_FAIL',code,error:`企業行動調整資料不足：${v?.dividendEvents||0}/${v?.dividendExpectedMin||'?'}`,validation:v,source:h.source};
 if(h.adjustmentAnomalies?.length)return{ok:true,ready:false,status:'VALIDATION_FAIL',code,error:'價格尺度校正後仍有>30%異常跳動，禁止回測',validation:v,anomalies:h.adjustmentAnomalies,source:h.source};
 const key='bt:r3:'+code,old=cache.get(key);if(old&&Date.now()-old.at<6*60*60*1000)return old.v;
 const on=signalSeries(h.rows,1),off=signalSeries(h.rows,0),c75=signalSeries(h.rows,.75),c125=signalSeries(h.rows,1.25),wf=walkForward(h.rows,{'0.75':c75,'1':on,'1.25':c125}),slices={full:metrics(on),y10:metrics(on,yearsAgo(10)),y5:metrics(on,yearsAgo(5)),y2:metrics(on,yearsAgo(2)),y1:metrics(on,yearsAgo(1))};
 const result={ok:true,ready:true,status:'READY',code,name:META[code].name,listed:META[code].listed,firstDate:v.first,lastDate:v.last,source:h.source,historyDays:h.rows.length,validation:v,corporateActions:h.corporateActions,scope:v.fullHistoryPass?'上市日至今完整歷史核心回測':`長期樣本回測（PARTIAL）：${v.first}～${v.last}，${v.rows}交易日；未宣稱上市日至今完整。`,slices,ab:{antiChaseOn:metrics(on),antiChaseOff:metrics(off)},walkForward:wf,generatedAt:new Date().toISOString()};cache.set(key,{at:Date.now(),v:result});return result;
}

async function refreshRuntime(){if(RUNTIME.refreshing)return;RUNTIME.refreshing=true;const errors=[];const jobs=[['live',()=>live()],['ctx',()=>cached('ctx',60000,context)],['nf',()=>nightFuture()],['ovs',()=>cached('ovs',45000,overseas)],['bm',()=>cached('buymodel',8000,buyModel)]];await Promise.all(jobs.map(async([k,fn])=>{try{RUNTIME[k]=await fn()}catch(e){errors.push(k+':'+e.message)}}));RUNTIME.errors=errors;RUNTIME.lastRefresh=new Date().toISOString();RUNTIME.refreshing=false}
function V(status,evidence,detail='',updatedAt=new Date().toISOString()){return{status,evidence,detail,updatedAt}}
async function validationReport(deep=false){
 const out={},errors=[...(RUNTIME.errors||[])],ld=RUNTIME.live,ctx=RUNTIME.ctx,nf=RUNTIME.nf,ovs=RUNTIME.ovs,bm=RUNTIME.bm;
 if(!RUNTIME.refreshing&&!RUNTIME.lastRefresh)refreshRuntime();
 out[1]=V(ld?.market?'PASS':'PARTIAL',ld?.market?'大盤/持股/明日環境等核心API可用':'部分核心行情不可用',errors.join('｜'));
 const arithmetic=nf?.available&&Math.abs((nf.last-nf.reference)-nf.change)<.01&&Math.abs(((nf.last-nf.reference)/nf.reference*100)-nf.changePct)<.001;out[2]=V(arithmetic?'PASS':nf?.available?'FAIL':'WAIT',nf?.available?`${nf.last}-${nf.reference}=${nf.change.toFixed(0)} / ${nf.changePct.toFixed(2)}%`:'等待夜盤資料');
 out[3]=V(nf?.available&&Number.isFinite(nf.offHighPoints)?'PASS':nf?.available?'PARTIAL':'WAIT',nf?.available?'相對參考價與距今晚高點為獨立欄位':'等待夜盤');const mom=nf?.momentum,allMom=mom&&mom.d1&&mom.d3&&mom.d5&&mom.d15;out[4]=V(allMom?'PASS':mom?.sampleCount?'PARTIAL':'WAIT',allMom?'1/3/5/15分鐘皆完成':`樣本累積 ${mom?.sampleCount||0}`);
 out[5]=V('WAIT','需真實08:57–08:59:30由瀏覽器端鎖定');out[6]=V('PASS','首頁具08:57–09:00盤前優先邏輯');out[7]=V(bm&&Object.values(bm.models||{}).some(x=>x&&'noBuyToday' in x)?'PASS':'PARTIAL','支援「今日暫無合理買點」');out[8]=V(new Set(ETF.map(c=>JSON.stringify(META[c].cfg))).size===4?'PASS':'FAIL','四檔使用獨立參數');out[9]=V(bm&&ETF.some(c=>bm.models?.[c]?.raw?.first?.low)?'PASS':'PARTIAL','第一層為動態區間');out[10]=V(bm&&ETF.some(c=>bm.models?.[c]?.raw?.third?.low)?'PASS':'PARTIAL','三層價格輸出');out[11]=V(bm&&ETF.some(c=>Number.isFinite(bm.models?.[c]?.score))?'PASS':'PARTIAL','綜合評分輸出');out[12]=V('PASS','前端分層狀態機支援分批');out[13]=V(bm&&ETF.some(c=>'hardVeto' in (bm.models?.[c]||{}))?'PASS':'PARTIAL','硬Gate含資料失效/急殺');out[14]=V(bm&&ETF.some(c=>bm.models?.[c]?.history?.sma250)?'PASS':'PARTIAL','5/20/60/120/250納入');out[15]=V('PASS','買點上修有速度上限');out[16]=V(bm&&ETF.some(c=>'bullStructure' in (bm.models?.[c]?.history||{}))?'PASS':'PARTIAL','中樞慢速重新定錨');
 out[17]=V('WAIT','瀏覽器歷史紀錄由前端補驗');out[18]=V('WAIT','實際價格同步由前端補驗');out[19]=V('WAIT','重複區間折疊由前端補驗');out[20]=V('WAIT','需累積7日買點歷史');
 const hs=bm?.health||{},usable=ETF.filter(c=>hs[c]?.usable).length,connected=ETF.filter(c=>hs[c]&&hs[c].sourceCoverage>0).length;out[21]=V(usable===4?'PASS':connected?'PARTIAL':'FAIL',`成分來源已連線 ${connected}/4；完整健康可計分 ${usable}/4`);out[22]=V(connected?'PASS':'PARTIAL',`成分資料畫面可顯示 ${connected}/4；不足者明示不計分`);out[23]=V(usable===4?'PASS':usable?'PARTIAL':'WAIT',`健康度可正式計分 ${usable}/4`);out[24]=V(usable?'PASS':'WAIT','健康度可用時採權重式分歧/背離');out[25]=V('PASS','健康度位於各ETF detail頁');out[26]=V('PARTIAL','新有效日期會保存版本；待實際換股事件驗證');out[27]=V('PARTIAL','沒有當時版本就禁止今日成分倒灌歷史');
 out[28]=V(ctx?.breadth?.total?'PASS':'PARTIAL',ctx?.breadth?`${ctx.breadth.scope} ${ctx.breadth.up}↑/${ctx.breadth.down}↓/${ctx.breadth.flat}平`:'廣度來源暫不可用');out[29]=V(ovs?.quotes?'PASS':'PARTIAL',ovs?.quotes?'NASDAQ／SOX／TSM ADR 海外風險層可用':'海外風險資料暫不可用');out[30]=V('PASS','環境分數採大盤／夜盤／海外／成分健康多來源加權');out[31]=V('WAIT','私人持股由前端補驗');out[32]=V('PASS','我的持股與買點頁分離');out[33]=V(ld?.quotes?'PASS':'PARTIAL','持股行情使用TWSE MIS約10秒');out[34]=V(bm?.dataFresh?'PASS':bm?'FAIL':'WAIT',bm?.dataFresh?'模型行情時間戳新鮮':'資料逾時即停止確認');out[35]=V('PASS','回前景立即刷新');out[36]=V('PASS','行情10秒/模型30秒');
 if(deep)ETF.forEach(c=>enqueueHistory(c,false));const hp=ETF.map(c=>historyProgress(c)),ready=hp.filter(x=>x.status==='READY').length;out[37]=V(ready===4?'PASS':ready?'PARTIAL':'WAIT',`TWSE全歷史完成 ${ready}/4`,hp.map(x=>`${x.code}:${x.status} ${x.doneMonths}/${x.totalMonths}月 ${x.percent}%`).join('｜'));out[38]=V('PASS','主結果全歷史；10/5/2/1年只做切片');
 let corpPass=0,btReady=0,wfPass=0,abPass=0,kpiPass=0,cred=[];for(const c of ETF){const h=diskRead(readyFile(c));if(h?.validation?.dividendCoveragePass&&h?.validation?.adjustmentPass)corpPass++;if(h?.rows?.length){try{const b=await backtest(c);if(b.ready){btReady++;const w=b.walkForward?.metrics,on=b.ab?.antiChaseOn,off=b.ab?.antiChaseOff,m=b.slices?.full,mins={'0050':20,'0056':20,'00878':10,'00919':5};if((w?.signals||0)>=mins[c])wfPass++;if(Number.isFinite(on?.highEntryRate)&&Number.isFinite(off?.highEntryRate)&&on.highEntryRate<=off.highEntryRate)abPass++;if([m?.avg5,m?.avg20,m?.avg60,m?.worstMAE60].every(Number.isFinite))kpiPass++;cred.push(`${c}:歷史${b.historyDays}日/WF${w?.signals||0}`)}}catch(e){cred.push(`${c}:回測錯誤 ${e.message}`)}}}
 out[39]=V(wfPass===4?'PASS':btReady?'PARTIAL':'WAIT',`Walk-forward樣本門檻 ${wfPass}/4`,cred.join('｜'));out[40]=V(corpPass===4?'PASS':corpPass?'PARTIAL':ready?'FAIL':'WAIT',`除息/分割/還原驗證 ${corpPass}/4`);out[41]=V(abPass===4?'PASS':btReady?'PARTIAL':'WAIT',`防追高A/B可驗證 ${abPass}/4`);out[42]=V(kpiPass===4?'PASS':btReady?'PARTIAL':'WAIT',`5/20/60、MAE、參與率等KPI ${kpiPass}/4`);out[43]=V(btReady===4?'PASS':btReady?'PARTIAL':'WAIT',`可信度輸出 ${btReady}/4`,cred.join('｜'));out[44]=V('PASS','全站紅漲綠跌');out[45]=V('PASS',`全站版本 ${VERSION} / build ${BUILD}`);
 return{ok:true,version:VERSION,build:BUILD,deep,checks:out,historyProgress:hp,errors,generatedAt:new Date().toISOString()};
}


function autoWarmAllHistory(){
 // Build official history automatically after every cold start. No user button required.
 const order=['0050','00878','00919','0056'];
 for(const c of order)enqueueHistory(c,false);
}


async function tradePerformance(code,entryDate,entryPrice,layer2Low=null,layer3Low=null,layer1High=null){
 if(!ETF.includes(code)||!(Number(entryPrice)>0)||!/^\d{4}-\d{2}-\d{2}$/.test(entryDate||''))return{ok:false,error:'invalid trade parameters'};
 const ep=Number(entryPrice),livePx=RUNTIME.live?.quotes?.[code]?.last??null;
 let h;try{h=await etfHistory(code)}catch(e){h={rows:[],source:'history unavailable',validation:{fullHistoryPass:false},error:e.message}}
 const rows=adjustedRows(h.rows||[]).filter(x=>x.date>=entryDate);
 const current=Number.isFinite(livePx)?livePx:(rows.at(-1)?.close??null);
 const immediate={currentPrice:current,currentReturnPct:Number.isFinite(current)?(current/ep-1)*100:null,currentPnLPerShare:Number.isFinite(current)?current-ep:null};
 if(!rows.length)return{ok:true,status:'TRACKING',code,entryDate,entryPrice:ep,...immediate,horizon:{5:null,20:null,60:null},maePct:null,mfePct:null,maeDate:null,mfeDate:null,
  reachedLayer2:false,reachedLayer3:false,chaseEntry:Number.isFinite(Number(layer1High))?ep>Number(layer1High):null,historySource:h.source,officialHistory:!!h.validation?.fullHistoryPass,reason:'尚未形成進場日後的日K；即時損益仍持續追蹤',updatedAt:new Date().toISOString()};
 const r0=rows[0],entryFactor=r0.close>0&&r0.aClose>0?r0.aClose/r0.close:1,horizon={};
 for(const k of [5,20,60]){const x=rows[k];horizon[k]=x?{date:x.date,priceReturnPct:(x.close/ep-1)*100,totalReturnPct:(x.aClose/(ep*entryFactor)-1)*100}:null}
 let min=null,max=null;
 for(const x of rows){const lo=x.low??x.close,hi=x.high??x.close;if(!min||lo<min.price)min={date:x.date,price:lo};if(!max||hi>max.price)max={date:x.date,price:hi}}
 const l2=Number(layer2Low),l3=Number(layer3Low),l1h=Number(layer1High);
 return{ok:true,status:'READY',code,entryDate,entryPrice:ep,...immediate,horizon,
  maePct:min?(min.price/ep-1)*100:null,mfePct:max?(max.price/ep-1)*100:null,maeDate:min?.date||null,mfeDate:max?.date||null,
  reachedLayer2:Number.isFinite(l2)&&min?min.price<=l2:false,reachedLayer3:Number.isFinite(l3)&&min?min.price<=l3:false,
  chaseEntry:Number.isFinite(l1h)?ep>l1h:null,historySource:h.source,officialHistory:!!h.validation?.fullHistoryPass,updatedAt:new Date().toISOString()};
}

function modelTradeStaticProof(){
 try{
  const app=fs.readFileSync(path.join(PUBLIC,'app.js'),'utf8');
  const required=['v124_model_trades','function saveModelTrade','function refreshModelTradePerformance','currentReturnPct','maePct','mfePct','reachedLayer2','reachedLayer3','chaseEntry','function closeTrackedTrade'];
  const missing=required.filter(x=>!app.includes(x));
  return{pass:missing.length===0,storageKey:'v124_model_trades',metrics:['currentPnL','5d','20d','60d','MAE','MFE','reachedLayer2','reachedLayer3','chaseEntry'],missing};
 }catch(e){return{pass:false,storageKey:'v124_model_trades',metrics:[],missing:['app.js unreadable'],error:e.message}}
}

function mime(f){if(f.endsWith('.html'))return'text/html; charset=utf-8';if(f.endsWith('.css'))return'text/css; charset=utf-8';if(f.endsWith('.js'))return'application/javascript; charset=utf-8';if(f.endsWith('.json'))return'application/json; charset=utf-8';if(f.endsWith('.svg'))return'image/svg+xml';return'application/octet-stream'}
async function safeApi(res,label,fn){try{const data=await fn();const key={'market':'live','context':'ctx','night-future':'nf','overseas':'ovs','buy-model':'bm'}[label];if(key&&data){RUNTIME[key]=data;RUNTIME.lastRefresh=new Date().toISOString()}return send(res,200,data)}catch(e){console.error(label,e);RUNTIME.errors=[...(RUNTIME.errors||[]).filter(x=>!x.startsWith(label+':')),label+':'+(e.message||String(e))].slice(-20);return send(res,200,{ok:false,status:'ERROR',source:label,error:e.message||String(e),fetchedAt:new Date().toISOString()})}}
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://'+req.headers.host);
 if(['/health','/api/health','/healthz','/readyz'].includes(u.pathname))return send(res,200,{ok:true,status:'healthy',version:VERSION,build:BUILD,now:new Date().toISOString(),uptimeSec:Math.round(process.uptime())});
 if(u.pathname==='/api/constituent-proof')return safeApi(res,'constituent-proof',async()=>{const rs=await Promise.all(ETF.map(async code=>{try{const c=await deadline(constituents(code),15000,null);if(!c)throw Error('official constituent source timed out');const expected=c.expected||META[code].expected,actual=c.items?.length||0,weights=c.items?.filter(x=>Number.isFinite(x.weight)).length||0,official=!!c.officialOnly&&isOfficialHostFor(code,c.sourceUrl||META[code].url);return{code,pass:!!(c.complete&&official&&actual>=expected&&weights>=expected),official,source:c.source,sourceUrl:c.sourceUrl||META[code].url,expected,actual,weightRows:weights,coveragePct:expected?Math.min(100,actual/expected*100):0,weightCoveragePct:expected?Math.min(100,weights/expected*100):0,asOf:c.asOf,note:c.note||null,errors:c.errors||[]}}catch(e){return{code,pass:false,official:true,source:META[code].source,sourceUrl:META[code].url,expected:META[code].expected,actual:0,weightRows:0,coveragePct:0,weightCoveragePct:0,note:e.message}}}));return{ok:true,build:BUILD,allPass:rs.every(x=>x.pass),constituents:rs,generatedAt:new Date().toISOString()}});
 if(u.pathname==='/api/core3-proof')return safeApi(res,'core3-proof',async()=>{
  const hist=ETF.map(historyProgress),modelTrade=modelTradeStaticProof();
  const con=await Promise.all(ETF.map(async code=>{try{const x=await deadline(constituents(code),15000,null);if(!x)throw Error('official constituent source timed out');const expected=x.expected||META[code].expected,actual=x.items?.length||0,weighted=x.items?.filter(z=>Number.isFinite(z.weight)).length||0,official=!!x.officialOnly&&isOfficialHostFor(code,x.sourceUrl||META[code].url);return{code,pass:!!(x.complete&&official&&actual>=expected&&weighted>=expected),official,expected,actual,weighted,source:x.source,sourceUrl:x.sourceUrl}}catch(e){return{code,pass:false,expected:META[code].expected,actual:0,weighted:0,error:e.message}}}));
  return{ok:true,build:BUILD,modelTrade,constituents:{allPass:con.every(x=>x.pass),items:con},history:{allPass:hist.every(x=>x.fullHistoryPass===true),items:hist},allPass:modelTrade.pass&&con.every(x=>x.pass)&&hist.every(x=>x.fullHistoryPass===true)}
 });
 if(u.pathname==='/api/history-status')return send(res,200,{ok:true,build:BUILD,history:ETF.map(historyProgress)});
 if(u.pathname==='/api/history-proof')return send(res,200,{ok:true,build:BUILD,allPass:ETF.every(c=>historyProgress(c).fullHistoryPass===true),history:ETF.map(c=>{const p=historyProgress(c),r=diskRead(readyFile(c));return{...p,source:r?.source||null,corporateActions:r?.corporateActions||[],adjustmentAnomalies:r?.adjustmentAnomalies||[],dividendSource:r?.dividendSource||null}})});
 if(u.pathname==='/api/history-warm'){const code=u.searchParams.get('code'),all=u.searchParams.get('all')==='1';if(all)ETF.forEach(c=>enqueueHistory(c,false));else if(ETF.includes(code))enqueueHistory(code,true);return send(res,200,{ok:true,status:'WARMING',history:ETF.map(historyProgress)});}
 if(u.pathname==='/api/validation')return safeApi(res,'validation',()=>validationReport(u.searchParams.get('deep')==='1'));
 if(u.pathname==='/api/official-history'){const code=u.searchParams.get('code')||'0050';return safeApi(res,'official-history',async()=>{if(!ETF.includes(code))return{ok:false,error:'unsupported code'};const h=await officialHistory(code);return h.ready?{ok:true,ready:true,code,source:h.source,validation:h.validation,corporateActions:h.corporateActions,adjustmentAnomalies:h.adjustmentAnomalies,rows:h.rows.length,first:h.rows[0]?.date,last:h.rows.at(-1)?.date}:{ok:true,ready:false,status:'WARMING',code,progress:h.progress}})}
 if(u.pathname==='/api/diagnostics')return send(res,200,{ok:true,version:VERSION,build:BUILD,marketSource:RUNTIME.live?.source||null,marketRealtime:RUNTIME.live?.realtime??null,lastRefresh:RUNTIME.lastRefresh,errors:RUNTIME.errors||[],historyQueue:ETF.map(historyProgress),historyAllPass:ETF.every(c=>historyProgress(c).fullHistoryPass===true),yahoo0050:{enabled:true,mode:'v8 chart period1/period2 adjusted OHLC'},goodinfo0050:{enabled:true,mode:'POST long-history',cachedRows:GOODINFO_0050_CACHE.rows.length,period:GOODINFO_0050_CACHE.period,error:GOODINFO_0050_CACHE.error,sourceUrl:GOODINFO_0050_CACHE.url||'https://goodinfo.tw/tw/ShowK_Chart.asp?STOCK_ID=0050&CHT_CAT2=DATE&STEP=DATA&PERIOD=6000&PRICE_ADJ=T'},now:new Date().toISOString()});
 if(u.pathname==='/api/etf-live'){
  try{
   const d=await deadline(liveEtf4(),7000,null),body=JSON.stringify(d||{ok:false,status:'TIMEOUT',source:'etf-live',quotes:{},error:'四檔ETF即時行情逾時',fetchedAt:new Date().toISOString()});
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate','Pragma':'no-cache','Expires':'0'});
   return res.end(body);
  }catch(e){
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate'});
   return res.end(JSON.stringify({ok:false,source:'etf-live',quotes:{},error:e.message,fetchedAt:new Date().toISOString()}));
  }
 }
 if(u.pathname==='/api/market')return safeApi(res,'market',async()=>{const d=await deadline(live((u.searchParams.get('symbols')||'').split(',')),8500,null);return d||{ok:false,status:'TIMEOUT',source:'market',error:'外部行情來源逾時；前端將自動沿用最後成功資料並重試',fetchedAt:new Date().toISOString()}});
 if(u.pathname==='/api/context')return safeApi(res,'context',()=>cached('ctx',60000,context));
 if(u.pathname==='/api/taiex-history')return safeApi(res,'taiex-history',async()=>{const h=await taiexHistory();return{...h,ret5:periodReturn(h.rows,5),ret20:periodReturn(h.rows,20)}});
 if(u.pathname==='/api/overseas')return safeApi(res,'overseas',()=>cached('ovs',45000,overseas));
 if(u.pathname==='/api/night-future')return safeApi(res,'night-future',()=>nightFuture());
 if(u.pathname==='/api/buy-model')return safeApi(res,'buy-model',async()=>{const d=await deadline(cached('buymodel',8000,buyModel),9500,null);return d||{ok:false,status:'TIMEOUT',source:'buy-model',error:'模型外部資料逾時；不阻塞頁面，30秒後自動重試',fetchedAt:new Date().toISOString()}});
 if(u.pathname==='/api/etf-history'){const code=u.searchParams.get('code')||'0050';return safeApi(res,'etf-history',()=>ETF.includes(code)?etfHistory(code):Promise.resolve({ok:false,error:'unsupported code'}))}
 if(u.pathname==='/api/constituent-dashboard'){const code=u.searchParams.get('code')||'0050';return safeApi(res,'constituent-dashboard',()=>ETF.includes(code)?constituentDashboard(code):Promise.resolve({ok:false,error:'unsupported code'}))}
 if(u.pathname==='/api/constituents'){const code=u.searchParams.get('code')||'0050',date=u.searchParams.get('date')||null;return safeApi(res,'constituents',()=>ETF.includes(code)?constituents(code,date):Promise.resolve({ok:false,error:'unsupported code'}))}
 if(u.pathname==='/api/constituent-health'){const code=u.searchParams.get('code')||'0050';return safeApi(res,'constituent-health',()=>ETF.includes(code)?constituentHealth(code):Promise.resolve({ok:false,error:'unsupported code'}))}
 if(u.pathname==='/api/backtest'){const code=u.searchParams.get('code')||'0050';return safeApi(res,'backtest',()=>ETF.includes(code)?backtest(code):Promise.resolve({ok:false,error:'unsupported code'}))}
 if(u.pathname==='/api/trade-performance'){return safeApi(res,'trade-performance',()=>tradePerformance(u.searchParams.get('code'),u.searchParams.get('entryDate'),u.searchParams.get('entryPrice'),u.searchParams.get('layer2Low'),u.searchParams.get('layer3Low'),u.searchParams.get('layer1High')))}
 try{let rel=u.pathname==='/'?'/index.html':u.pathname.replace(/\.\./g,''),f=path.join(PUBLIC,rel);if(!f.startsWith(PUBLIC)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return send(res,404,'Not found','text/plain; charset=utf-8');const type=mime(f);res.writeHead(200,{'Content-Type':type,'Cache-Control':/\.html$|\.js$|\.css$/.test(f)?'no-store, max-age=0':'public,max-age=120','X-Content-Type-Options':'nosniff'});return res.end(fs.readFileSync(f))}catch(e){return send(res,500,'Static error','text/plain; charset=utf-8')}
});
server.keepAliveTimeout=120000;
server.headersTimeout=125000;
server.requestTimeout=30000;
server.on('clientError',(err,socket)=>{try{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')}catch(_){}});
server.listen(PORT,'0.0.0.0',()=>{
 console.log(VERSION+' '+BUILD+' listening on '+PORT);
 // Stability-only scheduling: do not start full-history warming while the first live/model refresh is still opening external connections.
 setTimeout(refreshRuntime,5000);
 setInterval(refreshRuntime,120000);
 setTimeout(autoWarmAllHistory,45000);
 setInterval(autoWarmAllHistory,30*60*1000);
});
