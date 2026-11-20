/* IndexedDB research archive. Portfolio/trades/sync ledgers remain untouched.
 * Migrate each exact legacy value transactionally and verify readback before
 * allowing an explicit, separately confirmed legacy-copy removal.
 */
(function(root){
 'use strict';
 const KEYS=Object.freeze([
  'v124_buy_history','v124_shadow_replay','v124_entry_evidence_research_v1'
 ]);
 const DB_NAME='twstock-research-archive-v1',STORE='snapshots',VERSION=1;
 const cache=new Map(),queues=new Map();
 let db=null,ready=false,state='待初始化',error=null;
 const isKey=key=>KEYS.includes(key);
 const readLegacy=key=>{try{return root.localStorage.getItem(key)}catch(_){return null}};
 const status=message=>{
  state=message;
  const el=root.document?.getElementById('researchMigrationStatus');
  if(el)el.textContent=message;
 };
 function open(){
  return new Promise((resolve,reject)=>{
   if(!root.indexedDB)return reject(Error('這個瀏覽器不支援 IndexedDB'));
   let req;
   try{req=root.indexedDB.open(DB_NAME,VERSION)}catch(e){return reject(e)}
   req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE)};
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(req.error||Error('IndexedDB 開啟失敗'));
   req.onblocked=()=>reject(Error('另一分頁阻擋 IndexedDB 資料庫升級'));
  });
 }
 function read(key){
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).get(key);
   req.onsuccess=()=>resolve(req.result||null);
   req.onerror=()=>reject(req.error||Error('IndexedDB 讀取失敗'));
   tx.onabort=()=>reject(tx.error||Error('IndexedDB 交易中止'));
  });
 }
 function put(key,obj){
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readwrite');
   tx.objectStore(STORE).put(obj,key);
   tx.oncomplete=()=>resolve();
   tx.onerror=()=>reject(tx.error||Error('IndexedDB 寫入失敗'));
   tx.onabort=()=>reject(tx.error||Error('IndexedDB 寫入中止'));
  });
 }
 function enqueue(key,work){
  const previous=queues.get(key)||Promise.resolve();
  const task=previous.catch(()=>{}).then(work);
  queues.set(key,task);
  return task;
 }
 const parseValue=(raw,fallback)=>{
  if(raw===null||raw===undefined)return fallback;
  try{const x=JSON.parse(raw);return x??fallback}catch(_){return fallback}
 };
 async function init(){
  if(ready)return true;
  try{
   db=await open();
   let count=0;
   for(const key of KEYS){
    const legacy=readLegacy(key);
    let record=await read(key);
    if(!record&&legacy!==null){
     // Store the original copy for exact comparison on explicit cleanup.
     await put(key,{raw:legacy,legacyOriginal:legacy});
     record=await read(key);
     if(record?.raw!==legacy||record?.legacyOriginal!==legacy)
      throw Error(key+' 遷移後資料核對失敗');
     count++;
    }
    if(record&&typeof record.raw==='string'){
     // Validate JSON before using; a corrupt archive must never overwrite
     // the known good original localStorage value.
     try{JSON.parse(record.raw)}
     catch(e){throw Error(key+' 已儲存資料格式異常，請保留原始備份')}
     cache.set(key,record.raw);
    }else if(legacy!==null)cache.set(key,legacy);
   }
   ready=true;status('IndexedDB 研究資料已載入；完成 '+count+' 項新遷移。原始本機副本尚未刪除。');
   return true;
  }catch(e){
   error=e;status('研究資料遷移暫停：'+(e.message||e)+'。原始本機資料保留，不會自動刪除。');
   return false;
  }
 }
 function get(key,fallback){
  if(!isKey(key)||!ready)return parseValue(readLegacy(key),fallback);
  return parseValue(cache.has(key)?cache.get(key):null,fallback);
 }
 function save(key,value){
  if(!isKey(key))throw Error('非研究資料不得透過研究儲存層修改');
  const raw=JSON.stringify(value);
  if(!ready||!db){
   // Never erase an existing large research record because an upgrade failed.
   // Caller will receive quota errors through existing localStorage protection.
   root.localStorage.setItem(key,raw);return Promise.resolve();
  }
  cache.set(key,raw);
  return enqueue(key,async()=>{
   try{
    const prev=await read(key);
    const legacyOriginal=prev?.legacyOriginal===undefined?readLegacy(key):prev.legacyOriginal;
    await put(key,{raw,legacyOriginal});
   }catch(e){
    error=e;status('IndexedDB 儲存失敗：'+key+'。請立即下載完整備份，保留目前頁面。'+(e.message||e));
    throw e;
   }
  });
 }
 async function flush(){
  await Promise.all(KEYS.map(key=>queues.get(key)||Promise.resolve()));
 }
 async function exportRaw(){
  await flush();
  if(!db)return {status:'UNAVAILABLE',data:{}};
  const out={};
  for(const key of KEYS){
   const record=await read(key);
   if(record&&typeof record.raw==='string')out[key]=record.raw;
  }
  return{status:ready?'READY':'PARTIAL',data:out,keys:KEYS};
 }
 async function releaseLegacy(){
  if(!ready||!db){status('尚未完成研究資料遷移，不能清理原始資料。');return{ok:false,reason:'NOT_READY'}}
  try{await flush()}catch(_){status('研究資料有尚未完成的寫入，不能清理原始資料。');return{ok:false,reason:'WRITE_FAILED'}}
  const verified=[];
  for(const key of KEYS){
   const legacy=readLegacy(key);
   if(legacy===null)continue;
   const record=await read(key);
   if(!record||typeof record.raw!=='string'||record.legacyOriginal!==legacy){
    status('未通過原始資料一致性驗證：'+key+'。未清理任何資料。');
    return{ok:false,reason:'MISMATCH',key};
   }
   JSON.parse(record.raw);
   verified.push({key,bytes:(key.length+legacy.length)*2});
  }
  if(!verified.length){status('已沒有重複的本機研究副本，IndexedDB 研究紀錄仍保留。');return{ok:true,removed:[],bytes:0}}
  const total=verified.reduce((sum,item)=>sum+item.bytes,0);
  if(!root.confirm('這 '+verified.length+' 項研究資料已經逐項寫入並核對 IndexedDB。\\n\\n確認已保存完整備份檔後，才移除 localStorage 的重複副本（約 '+(total/1024/1024).toFixed(2)+' MiB）。\\n\\nIndexedDB 中的研究資料會保留，交易、持股與待同步紀錄絕不刪除。'))return{ok:false,reason:'CANCELLED'};
  for(const item of verified){
   // Recheck the source for changes from other tabs since verification.
   const current=readLegacy(item.key),record=await read(item.key);
   if(current===null)continue;
   if(record?.legacyOriginal!==current)continue;
   root.localStorage.removeItem(item.key);
   // Drop redundant baseline only after original removal; current raw survives.
   await put(item.key,{raw:record.raw,legacyOriginal:null});
  }
  const removed=verified.filter(x=>readLegacy(x.key)===null).map(x=>x.key);
  const bytes=verified.filter(x=>removed.includes(x.key)).reduce((n,x)=>n+x.bytes,0);
  status('已保留 IndexedDB 研究紀錄，釋放原始重複副本約 '+(bytes/1024/1024).toFixed(2)+' MiB。');
  return{ok:true,removed,bytes};
 }
 root.ResearchStore={init,get,save,flush,exportRaw,releaseLegacy,isKey,
  get ready(){return ready},get status(){return state},get error(){return error}};
 if(root.document?.readyState==='loading')
  root.document.addEventListener('DOMContentLoaded',()=>status(state));
 else status(state);
})(window);
