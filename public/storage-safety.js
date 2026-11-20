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
 async function download(){
  // Take an immediate snapshot, without any setItem, server request or cache cleanup.
  const local=exportRaw(root.localStorage);
  const session=exportRaw(root.sessionStorage);
  // IndexedDB is now the authoritative home of research history. A full
  // backup must contain it even after duplicate localStorage copies are gone.
  const research=root.ResearchStore?.exportRaw?
   await root.ResearchStore.exportRaw():{status:'UNAVAILABLE',data:{}};
  if(research.status!=='READY'&&root.ResearchStore)
   throw Error('IndexedDB 研究資料尚未完整載入，不能稱為完整備份。請保留原始備份檔。');
  const json=JSON.stringify({format:'twstock-origin-backup-v2',
   createdAt:new Date().toISOString(),origin:root.location?.origin||null,
   description:'RAW browser storage snapshot; values preserved as strings; may contain sensitive portfolio data',
   localStorage:local,sessionStorage:session,
   indexedDBResearch:research,
   runtimeSnapshot:typeof root.twStockEmergencyRuntimeSnapshot==='function'?
    root.twStockEmergencyRuntimeSnapshot():null},null,2);
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
 async function cleanup(){
  if(!backupStarted){setStatus('請先按「下載完整備份」，確認電腦已存好檔案。');return{ok:false,reason:'BACKUP_REQUIRED'}}
  if(!root.ResearchStore?.releaseLegacy){
   setStatus('IndexedDB 研究儲存未載入，不可刪除任何研究資料。');
   return{ok:false,reason:'ARCHIVE_UNAVAILABLE'};
  }
  return root.ResearchStore.releaseLegacy();
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
  // No automatic cleanup. Legacy research remains until verified in IndexedDB.
 }
 root.StorageSafety={download,cleanup,inventory,warnQuota,get backupStarted(){return backupStarted},get warningKey(){return warningKey}};
 if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',startup);
 else startup();
})(window);
