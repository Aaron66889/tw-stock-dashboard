/* Emergency read-only backup: works even when localStorage.setItem throws QuotaExceededError.
 * Never clears trades, tombstones, pending holdings operations or portfolio state.
 */
(function(root){
 'use strict';
 const SAFE_REBUILDABLE_KEYS=[
  'v124_buy_history','v124_shadow_replay','v124_entry_evidence_research_v1'
 ];
 let backupStarted=false,warningKey='';
 const el=id=>root.document?.getElementById(id);
 function sizeOf(value){return (String(value||'').length*2)}
 function inventory(){
  const entries=[];
  const store=root.localStorage;
  for(let i=0;i<store.length;i++){
   const key=store.key(i);
   entries.push({key,bytes:sizeOf(key)+sizeOf(store.getItem(key))});
  }
  return entries.sort((a,b)=>b.bytes-a.bytes);
 }
 function exportRaw(store){
  const result={};
  for(let i=0;i<store.length;i++){
   const key=store.key(i),value=store.getItem(key);
   if(value!==null)result[key]=value;
  }
  return result;
 }
 function setStatus(message){
  const status=el('emergencyBackupStatus');
  if(status)status.textContent=message;
 }
 function download(){
  // Take an immediate snapshot, without any setItem, server request or cache cleanup.
  const local=exportRaw(root.localStorage);
  const session=exportRaw(root.sessionStorage);
  const json=JSON.stringify({format:'twstock-origin-backup-v1',
   createdAt:new Date().toISOString(),origin:root.location?.origin||null,
   description:'RAW browser storage snapshot; values preserved as strings; may contain sensitive portfolio data',
   localStorage:local,sessionStorage:session},null,2);
  const blob=new Blob([json],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=root.document.createElement('a');
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  a.href=url;a.download='twstock-full-local-backup-'+stamp+'.json';
  root.document.body.appendChild(a);
  try{a.click();backupStarted=true;
   setStatus('已啟動完整備份下載（'+(blob.size/1024/1024).toFixed(2)+' MiB）。請先確認檔案已在電腦保存，才清理研究快取。');}
  finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
  return {entries:Object.keys(local).length,bytes:blob.size};
 }
 function cleanup(){
  if(!backupStarted){setStatus('請先按「下載完整備份」，並確認檔案已儲存。');return{ok:false,reason:'BACKUP_REQUIRED'}}
  const entries=inventory(),candidates=entries.filter(e=>SAFE_REBUILDABLE_KEYS.includes(e.key));
  const amount=candidates.reduce((n,e)=>n+e.bytes,0);
  if(!candidates.length){setStatus('目前沒有可清理的研究快取；交易及持股資料均未刪除。');return{ok:true,removed:[],bytes:0}}
  const names=candidates.map(e=>e.key).join('、');
  const msg='確認已下載且檢查完整備份檔？\n\n只清理可重建的研究快取：'+names+
   '\n預計釋放約 '+(amount/1024).toFixed(1)+' KiB。\n\n不會刪除持股、交易、待同步ID或刪除墓碑。此操作不會自動上傳或下載雲端資料。';
  if(!root.confirm(msg))return{ok:false,reason:'CANCELLED'};
  for(const e of candidates)root.localStorage.removeItem(e.key);
  setStatus('已清理 '+candidates.length+' 項研究快取，約 '+(amount/1024).toFixed(1)+' KiB；原始資料保留在剛才的備份檔。請重新整理並檢查交易同步。');
  return{ok:true,removed:candidates.map(e=>e.key),bytes:amount};
 }
 function warnQuota(key){
  warningKey=String(key||'unknown');
  const bar=el('emergencyStorageBar');if(bar)bar.hidden=false;
  setStatus('本機儲存空間不足：'+warningKey+' 無法成功保存。請先備份；不要清除 Chrome 網站資料或覆蓋雲端持股。');
 }
 function startup(){
  // Always show emergency export before the app's own initialization.
  const bar=el('emergencyStorageBar');if(bar)bar.hidden=false;
  const entries=inventory(),bytes=entries.reduce((sum,e)=>sum+e.bytes,0);
  setStatus('本裝置 localStorage 目前約 '+(bytes/1024/1024).toFixed(2)+' MiB；備份不需寫入儲存空間。');
  try{const q=root.localStorage.getItem('v124_model_trades');if(q&&q.length>800000)warnQuota('v124_model_trades（占用較大）')}catch(_){}
 }
 root.StorageSafety={download,cleanup,inventory,warnQuota,get backupStarted(){return backupStarted},get warningKey(){return warningKey}};
 if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',startup);
 else startup();
})(window);
