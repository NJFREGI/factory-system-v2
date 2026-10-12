const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const crypto=require('node:crypto');
function setup(responses){
 const values=new Map(),calls=[];
 const ctx={crypto,window:null,FOS:{auth:{user:{id:'shop',password_hash:'test'}},storage:{get:k=>values.get(k),set:(k,v)=>v==null?values.delete(k):values.set(k,v)},db:{sb:{rpc:async(name,args)=>{calls.push(args.p_payload);const r=responses.shift();if(r instanceof Error)throw r;return r;}}}}};
 ctx.window=ctx; vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/../shared/js/orders.js','utf8'),ctx);
 return {orders:ctx.FOS.orders,values,calls};
}
test('failed writes reject instead of reporting success',async()=>{
 for(const operation of ['status','receipt','edit','confirm','recalc']){
  const {orders}=setup([{error:{code:'P0001',message:'write failed'}}]);
  await assert.rejects(orders.mutate(operation,{order_id:'o'}),/write failed/);
 }
});
test('unknown network outcome retains the request ID; a retry deduplicates',async()=>{
 const {orders,calls,values}=setup([new Error('network'),{data:{id:'o',total:324}}]);
 await assert.rejects(orders.submit([{product_id:'p',qty:3}], '2026-09-09',''));
 assert.equal(values.size,1);
 await orders.submit([{product_id:'p',qty:3}], '2026-09-09','');
 assert.equal(calls[0].request_id,calls[1].request_id);assert.equal(values.size,0);
});
test('explicit rollback permits a corrected basket with a new request ID',async()=>{
 const {orders,calls}=setup([{error:{code:'P0001',message:'stock'}},{data:{id:'o'}}]);
 await assert.rejects(orders.submit([{product_id:'p',qty:30}], '2026-09-09',''));
 await orders.submit([{product_id:'p',qty:3}], '2026-09-09','');
 assert.notEqual(calls[0].request_id,calls[1].request_id);
});
test('missing RPC fails closed without falling back to unsafe writes',async()=>{
 const {orders}=setup([{error:{code:'PGRST202',message:'not found'}}]);
 await assert.rejects(orders.submit([{product_id:'p',qty:3}], '2026-09-09',''),/升级尚未完成/);
});
test('recalculation uses transaction result and never writes zero locally',async()=>{
 const {orders,calls}=setup([{error:{code:'P0001',message:'read failed'}}]);
 await assert.rejects(orders.recalc('o'),/read failed/);assert.equal(calls[0].operation,'recalc');
});
test('incomplete response preserves retry identity',async()=>{
 const {orders,values}=setup([{data:null}]);
 await assert.rejects(orders.confirmReceipt('o'),/结果不完整/);assert.equal(values.size,1);
});
test('pending request storage never contains credentials',async()=>{
 const {orders,values}=setup([new Error('offline')]);
 await assert.rejects(orders.updateStatus('o','preparing'));
 assert.ok(!JSON.stringify([...values]).includes('password'));
});

function orderPage(submit) {
 const source=fs.readFileSync(__dirname+'/../apps/order/app.js','utf8');
 const part=source.slice(source.indexOf('  let orderSubmitting = false;'),source.indexOf('  async function renderHistory()'));
 const state={cart:[{product_id:'p',qty:3}],errors:[],success:[],calls:0};
 const ctx={getCart:()=>state.cart,setCart:v=>{state.cart=v},closeCartSheet:()=>{},renderShop:async()=>{},document:{getElementById:()=>null},FOS:{i18n:{t:(ja,zh)=>zh},cutoff:{getOrderDate:()=> '2026-09-09'},merchants:{assertCanOrder:async()=>{}},orders:{submit:async(...args)=>{state.calls++;return submit(...args)},confirmShopSubmission:async()=>{}},ui:{showLoading:()=>{},hideLoading:()=>{},toast:msg=>state.errors.push(msg),showOrderSuccess:info=>state.success.push(info)}}};
 vm.createContext(ctx);vm.runInContext(part+'\nthis.submitOrder = submitOrder;',ctx);return{...ctx,state};
}
test('order screen keeps cart on database failure and does not show success',async()=>{
 const page=orderPage(async()=>{throw Error('stock shortage')});await page.submitOrder();
 assert.equal(page.state.cart.length,1);assert.equal(page.state.success.length,0);assert.deepEqual(page.state.errors,['stock shortage']);
});
test('double click only submits once and clears cart after committed result',async()=>{
 let release;const pending=new Promise(r=>release=r);const page=orderPage(()=>pending);
 const one=page.submitOrder(),two=page.submitOrder();await new Promise(setImmediate);
 assert.equal(page.state.calls,1);release({id:'o',order_no:1,total:324});await Promise.all([one,two]);
 assert.equal(page.state.cart.length,0);assert.equal(page.state.success.length,1);assert.equal(page.state.success[0].total,324);
});
