const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup() {
  const store = new Map(); const sends = []; let mid = 'a'; let writes = 0;
  const cloud = { enabled:true,type:'cloud',userKey:'key',userSecret:'secret',equipmentSn:'sn' };
  const FOS = { storage:{get:k=>store.get(k),set:(k,v)=>store.set(k,v)},merchants:{scopeId:()=>mid},
    i18n:{t:(ja,zh)=>zh},auth:{user:{}},
    native:{isAndroid:()=>true,bluetoothPrintRaw:async(address,base64)=>{sends.push({address,base64});return {ok:true};}},
    db:{sb:{from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{value:JSON.stringify(cloud)}})})}),upsert:async()=>{writes++;return {error:null};},insert:async()=>({error:null})})}},
    escpos:{buildOutboundPayload:async()=>({base64:'AQID'})},
  };
  for(const f of ['printer-settings.js','outbound-print.js']) vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../shared/js',f),'utf8'),{FOS,window:{FOS}});
  return {FOS,store,sends,cloud,merchant:id=>{mid=id;},writes:()=>writes};
}
const local = { enabled:true,type:'bluetooth',bluetoothAddress:'aa:bb:cc:dd:ee:ff',bluetoothName:'HPRT',copies:2 };
test('Bluetooth settings stay local, preserve cloud credentials and separate merchants',async()=>{
  const x=setup(); await x.FOS.printerSettings.load(); await x.FOS.printerSettings.save(local);
  assert.equal(x.writes(),0);
  const raw=x.store.get('printer_settings_a_bluetooth_local'); assert.equal(raw.userSecret,undefined);
  const cfg=await x.FOS.printerSettings.load(); assert.equal(cfg.bluetoothAddress,'AA:BB:CC:DD:EE:FF'); assert.equal(cfg.userSecret,'secret');
  x.merchant('b'); assert.equal((await x.FOS.printerSettings.load()).type,'cloud');
  x.merchant('a'); x.store.set('printer_settings_a_bluetooth_local',null); assert.equal((await x.FOS.printerSettings.load()).type,'cloud');
});
test('order sends requested copies through Bluetooth with same receipt bytes',async()=>{
  const x=setup();await x.FOS.printerSettings.save(local);
  const result=await x.FOS.outboundPrint.printOrder({id:'order1'});
  assert.equal(result.ok,true);assert.equal(x.sends.length,2);assert.equal(x.sends[0].base64,'AQID');
});
test('Bluetooth failure is reported and remaining copies are not sent',async()=>{
  const x=setup();await x.FOS.printerSettings.save(local);let calls=0;
  x.FOS.native.bluetoothPrintRaw=async()=>{calls++;throw new Error('printer off');};
  const result=await x.FOS.outboundPrint.printOrder({id:'order1'});
  assert.equal(result.ok,false);assert.equal(result.error,'printer off');assert.equal(calls,1);
});
test('invalid address cannot be saved; old APK does not report success',async()=>{
  const x=setup();await assert.rejects(x.FOS.printerSettings.save({...local,bluetoothAddress:''}));
  await x.FOS.printerSettings.save(local);delete x.FOS.native.bluetoothPrintRaw;
  assert.equal((await x.FOS.outboundPrint.printOrder({id:'order1'})).ok,false);
});
test('cloud printing remains available when no local Bluetooth override exists',async()=>{
  const x=setup();let calls=0;
  x.FOS.hprtCloudPrint={buildOutboundPayload:async()=>({content:'receipt'})};
  x.FOS.hprtCloud={sendPrintTask:async(cfg,payload)=>{calls++;assert.equal(cfg.equipmentSn,'sn');assert.equal(payload.content,'receipt');}};
  const result=await x.FOS.outboundPrint.printOrder({id:'order1'});
  assert.equal(result.ok,true);assert.equal(calls,1);assert.equal(x.sends.length,0);
});
test('failed shared config save keeps local Bluetooth override',async()=>{
  const x=setup();await x.FOS.printerSettings.save(local);
  x.FOS.db.sb.from=()=>({upsert:async()=>({error:{message:'offline'}})});
  await assert.rejects(x.FOS.printerSettings.save(x.cloud),/offline/);
  assert.equal((await x.FOS.printerSettings.load()).type,'bluetooth');
});
