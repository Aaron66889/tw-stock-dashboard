'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../public/storage-safety.js'),'utf8');

function fixture({confirm=true}={}){
 const values=new Map([
  ['v124_model_trades',JSON.stringify([{id:'mt_new_1',code:'0050',shares:10,_syncDirty:true}])],
  ['v124_holdings_pending_trade_ops_r3802',JSON.stringify([{id:'mt_new_1',shares:10}])],
  ['v124_model_trade_pending_deletes','["mt_deleted_2"]'],
  ['twStockHoldingsV12','[{"t":"0050","s":3760,"c":81}]'],
  ['v124_buy_history','A'.repeat(4000)],
  ['v124_shadow_replay','B'.repeat(3000)],
  ['v124_entry_evidence_research_v1','C'.repeat(2000)]
 ]);
 const writes=[],removes=[],links=[],objects=[],statuses={},clicked=[];
 const store={get length(){return values.size},key:i=>[...values.keys()][i],
  getItem:key=>values.has(key)?values.get(key):null,
  setItem:(key,value)=>{writes.push(key);throw Object.assign(new Error('quota'),{name:'QuotaExceededError'})},
  removeItem:key=>{removes.push(key);values.delete(key)}};
 const els={emergencyStorageBar:{hidden:true},
  emergencyBackupStatus:{set textContent(x){statuses.text=x},get textContent(){return statuses.text}}};
 const doc={readyState:'complete',getElementById:id=>els[id]||null,
  body:{appendChild:a=>links.push(a)},
  createElement:tag=>({click(){clicked.push(this)},remove(){}})};
 class BlobMock{constructor(data,opts){this.data=data.join('');this.size=this.data.length*2;this.opts=opts}}
 const url={createObjectURL:o=>{objects.push(o);return'blob:test'},revokeObjectURL:()=>{}};
 const win={localStorage:store,sessionStorage:{length:0,key:()=>null,getItem:()=>null},document:doc,
  confirm:()=>confirm,location:{origin:'https://example.test'}};
 const ctx={window:win,Blob:BlobMock,URL:url,Date,setTimeout:()=>{},console};
 vm.runInNewContext(code,ctx,{timeout:1000});
 return{win,values,writes,removes,links,objects,clicked,statuses};
}

test('emergency full backup downloads raw holdings, trades, pending operations and tombstones while writes always fail',()=>{
 const f=fixture();
 assert.equal(f.win.document.getElementById('emergencyStorageBar').hidden,false);
 const x=f.win.StorageSafety.download();
 assert.equal(f.writes.length,0,'backup must not call localStorage.setItem');
 assert.equal(f.removes.length,0,'backup must never erase data');
 assert.ok(x.entries>=7);
 assert.equal(f.clicked.length,1);
 assert.match(f.clicked[0].download,/twstock-full-local-backup-.*\.json/);
 const payload=JSON.parse(f.objects[0].data);
 assert.equal(payload.format,'twstock-origin-backup-v1');
 assert.equal(payload.localStorage.v124_model_trades,f.values.get('v124_model_trades'));
 assert.equal(payload.localStorage.v124_holdings_pending_trade_ops_r3802,f.values.get('v124_holdings_pending_trade_ops_r3802'));
 assert.equal(payload.localStorage.v124_model_trade_pending_deletes,f.values.get('v124_model_trade_pending_deletes'));
 assert.equal(payload.localStorage.twStockHoldingsV12,f.values.get('twStockHoldingsV12'));
});
test('cache cleanup refuses without backup and only deletes explicit disposable research keys after confirmation',()=>{
 const f=fixture();
 const rejected=f.win.StorageSafety.cleanup();
 assert.equal(rejected.reason,'BACKUP_REQUIRED');
 assert.equal(f.removes.length,0);
 f.win.StorageSafety.download();
 const cleaned=f.win.StorageSafety.cleanup();
 assert.equal(cleaned.ok,true);
 assert.deepEqual([...f.removes].sort(),[
  'v124_buy_history','v124_entry_evidence_research_v1','v124_shadow_replay'
 ]);
 assert.equal(f.values.has('v124_model_trades'),true);
 assert.equal(f.values.has('v124_holdings_pending_trade_ops_r3802'),true);
 assert.equal(f.values.has('v124_model_trade_pending_deletes'),true);
 assert.equal(f.values.has('twStockHoldingsV12'),true);
 assert.equal(f.writes.length,0);
});
test('canceling cleanup preserves every key and quota warning does not write storage',()=>{
 const f=fixture({confirm:false});
 const count=f.values.size;
 f.win.StorageSafety.warnQuota('v124_model_trades');
 assert.match(f.statuses.text,/v124_model_trades/);
 f.win.StorageSafety.download();
 assert.equal(f.win.StorageSafety.cleanup().reason,'CANCELLED');
 assert.equal(f.values.size,count);
 assert.equal(f.removes.length,0);
 assert.equal(f.writes.length,0);
});
