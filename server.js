const http=require('http'),fs=require('fs'),path=require('path');
const {URL}=require('url');
const PORT=process.env.PORT||3000, PUBLIC=path.join(__dirname,'public');
const ETF=['0050','0056','00878','00919'];
const cache=new Map();

function send(res,status,body,type='application/json; charset=utf-8'){
 res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'});
 res.end(body);
}
function n(v){if(v==null||v===''||v==='-')return null;const x=Number(String(v).replace(/,/g,''));return Number.isFinite(x)?x:null;}
async function fetchTimeout(url,opts={},ms=6500){
 const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);
 try{return await fetch(url,{...opts,signal:c.signal})}finally{clearTimeout(t)}
}
async function getJSON(url,headers={},tries=2){
 let last;
 for(let i=0;i<tries;i++){
  try{
   const r=await fetchTimeout(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json,text/plain,*/*',...headers}});
   if(!r.ok)throw new Error('HTTP '+r.status);
   return await r.json();
  }catch(e){last=e;if(i+1<tries)await new Promise(r=>setTimeout(r,350*(i+1)))}
 }
 throw last;
}
async function cached(key,ttl,fn){
 const c=cache.get(key),now=Date.now();
 if(c&&now-c.at<ttl)return {...c.value,cached:true};
 const value=await fn();cache.set(key,{at:now,value});return {...value,cached:false};
}
async function mis(exch){
 return await getJSON('https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch='+encodeURIComponent(exch)+'&json=1&delay=0&_='+Date.now(),{'Referer':'https://mis.twse.com.tw/'});
}
function parseMis(x){return{ticker:(x.c||'').trim(),name:x.n||'',channel:x.ch||'',last:n(x.z)??n(x.y),prevClose:n(x.y),open:n(x.o),high:n(x.h),low:n(x.l),volume:n(x.v),time:x.t||null,date:x.d||null};}
async function live(){
 const symbols=[...ETF,'2330'].map(t=>'tse_'+t+'.tw').join('|')+'|tse_t00.tw';
 const rows=(await mis(symbols)).msgArray||[];const quotes={};let market=null,tsmc=null;
 for(const x of rows){const z=parseMis(x);if((x.ch||'').includes('t00.tw')||z.ticker==='t00')market=z;else if(z.ticker==='2330')tsmc=z;else if(ETF.includes(z.ticker))quotes[z.ticker]=z}
 return{ok:true,fetchedAt:new Date().toISOString(),source:'TWSE MIS',market,tsmc,quotes};
}
async function openapi(p){return await getJSON('https://openapi.twse.com.tw/v1/'+p);}
async function context(){
 let breadth=null,turnover=null,institutional=null,errors=[];
 try{breadth=await openapi('opendata/twtazu_od')}catch(e){errors.push('breadth:'+e.message)}
 try{turnover=await openapi('exchangeReport/FMTQIK')}catch(e){errors.push('turnover:'+e.message)}
 try{institutional=await getJSON('https://www.twse.com.tw/rwd/zh/fund/T86?response=json&selectType=ALLBUT0999&_='+Date.now(),{'Referer':'https://www.twse.com.tw/'})}catch(e){errors.push('institutional:'+e.message)}
 return{ok:!!(breadth||turnover||institutional),fetchedAt:new Date().toISOString(),breadth,turnover,institutional,errors};
}
async function history(){
 try{
  const u='https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=6mo';
  const d=await getJSON(u);
  const r=d?.chart?.result?.[0];
  if(!r)throw new Error('No ^TWII history');
  const ts=r.timestamp||[], q=r.indicators?.quote?.[0]||{}, closes=q.close||[];
  const rows=[];
  for(let i=0;i<ts.length;i++){
    if(Number.isFinite(closes[i]))rows.push({date:new Date(ts[i]*1000).toISOString().slice(0,10),close:closes[i]});
  }
  return{ok:rows.length>=20,fetchedAt:new Date().toISOString(),source:'Yahoo Finance ^TWII daily',rows};
 }catch(e){
  return{ok:false,fetchedAt:new Date().toISOString(),source:'Yahoo Finance ^TWII daily',rows:[],errors:[e.message]};
 }
}
async function overseas(){
 const syms={NASDAQ:'^IXIC',SOX:'^SOX',TSM:'TSM'},quotes={},errors=[];
 for(const[k,s]of Object.entries(syms)){try{quotes[k]=await yahooQuote(s)}catch(e){errors.push(k+':'+e.message)}}
 return{ok:Object.keys(quotes).length>0,fetchedAt:new Date().toISOString(),source:'Yahoo Finance chart',quotes,errors};
}
function stripTags(s){return String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();}
function fieldNum(text,label){
 const esc=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const m=text.match(new RegExp(esc+'\\s*([\\-+]?\\d[\\d,]*(?:\\.\\d+)?)'));
 return m?n(m[1]):null;
}
async function nightFuture(){
 const url='https://tw.stock.yahoo.com/future/WTX%26';
 try{
  const r=await fetchTimeout(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html,application/xhtml+xml','Accept-Language':'zh-TW,zh;q=0.9','Referer':'https://tw.stock.yahoo.com/future/'}},6500);
  if(!r.ok)throw new Error('Yahoo HTTP '+r.status);
  const text=stripTags(await r.text());
  const last=fieldNum(text,'成交'), prevClose=fieldNum(text,'昨收'), open=fieldNum(text,'開盤'), high=fieldNum(text,'最高'), low=fieldNum(text,'最低');
  const volume=fieldNum(text,'總量'), oi=fieldNum(text,'未平倉'), bid=fieldNum(text,'買價'), ask=fieldNum(text,'賣價');
  const change=fieldNum(text,'漲跌');
  let changePct=fieldNum(text,'漲幅');
  if(changePct==null&&last!=null&&prevClose>0)changePct=(last-prevClose)/prevClose*100;
  if(!(last>0)&&!(bid>0)&&!(ask>0))throw new Error('Yahoo WTX fields not found');
  return{ok:true,available:true,fetchedAt:new Date().toISOString(),source:'Yahoo股市 WTX&',sourceUrl:url,last,prevClose,open,high,low,volume,openInterest:oi,bid,ask,change,changePct};
 }catch(e){
  return{ok:false,available:false,fetchedAt:new Date().toISOString(),source:'Yahoo股市 WTX&',sourceUrl:url,reason:e.message};
 }
}
function mime(f){if(f.endsWith('.html'))return'text/html; charset=utf-8';if(f.endsWith('.json'))return'application/json; charset=utf-8';if(f.endsWith('.svg'))return'image/svg+xml';if(f.endsWith('.js'))return'application/javascript; charset=utf-8';return'application/octet-stream';}
http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,'http://'+req.headers.host);
  if(u.pathname==='/health')return send(res,200,JSON.stringify({ok:true,version:'10.0.0',now:new Date().toISOString(),cacheKeys:[...cache.keys()]}));
  if(u.pathname==='/api/market'){try{return send(res,200,JSON.stringify(await live()))}catch(e){return send(res,502,JSON.stringify({ok:false,error:e.message,fetchedAt:new Date().toISOString()}))}}
  if(u.pathname==='/api/context'){try{return send(res,200,JSON.stringify(await cached('context',60000,context)))}catch(e){return send(res,502,JSON.stringify({ok:false,error:e.message}))}}
  if(u.pathname==='/api/history'){try{return send(res,200,JSON.stringify(await cached('history',1800000,history)))}catch(e){return send(res,502,JSON.stringify({ok:false,error:e.message}))}}
  if(u.pathname==='/api/overseas'){try{return send(res,200,JSON.stringify(await cached('overseas',45000,overseas)))}catch(e){return send(res,502,JSON.stringify({ok:false,error:e.message}))}}
  if(u.pathname==='/api/night-future')return send(res,200,JSON.stringify(await nightFuture()));
  let rel=u.pathname==='/'?'/index.html':u.pathname.replace(/\.\./g,'');const f=path.join(PUBLIC,rel);
  if(!f.startsWith(PUBLIC)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return send(res,404,'Not found','text/plain; charset=utf-8');
  return send(res,200,fs.readFileSync(f),mime(f));
 }catch(e){return send(res,500,JSON.stringify({ok:false,error:e.message}))}
}).listen(PORT,()=>console.log('TW Stock V10 Final http://localhost:'+PORT));
