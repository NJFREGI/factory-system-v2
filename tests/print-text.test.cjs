const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup() {
  const encoded = [];
  const FOS = { orders: { deliveredQty: i => i.quantity, shortageQty: () => 0 } };
  const window = { FOS, NjfAndroid: { textToGbkBase64: s => {
    encoded.push(s); return Buffer.from(s).toString('base64');
  } } };
  const context = vm.createContext({ FOS, window, Uint8Array, TextEncoder, atob, btoa });
  for (const file of ['escpos-print.js', 'hprt-cloud-print.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../shared/js', file), 'utf8'), context);
  }
  return { FOS, encoded };
}
test('kana runs compose voiced marks before wrapping, without normalizing other product text', () => {
  const { FOS: { escpos: e } } = setup();
  assert.equal(e.printableText('ﾔｹﾞﾝ【ﾌﾞﾗｼﾞﾙ産】 ﾊﾟﾝ ① Ａ'), 'ヤゲン【ブラジル産】 パン ① Ａ');
  assert.deepEqual(Array.from(e.wrapDisplayWidth('ABﾌﾞﾗｼﾞﾙ', 4)), ['ABブ', 'ラジ', 'ル']);
  assert.equal(e.displayWidth('ﾌﾞﾗｼﾞﾙ'), 8);
  assert.equal(e.printableText('ﾞﾟ'), '゛゜');
  assert.equal(e.printableText(e.printableText('ﾊﾟﾝ ¥352')), 'パン ￥352');
});
test('yen width matches the actual printable glyph for alignment', () => {
  const { FOS: { escpos: e } } = setup();
  assert.equal(e.money(1000), '￥1,000');
  assert.equal(e.money(0), '￥0');
  assert.equal(e.displayWidth('¥352'), 5);
  assert.equal(e.padTwoCol('単価', '¥352', 12), '単価   ￥352');
});
test('photo receipt is normalized at both native and cloud output, original order unchanged', () => {
  const { FOS, encoded } = setup();
  const order = { order_no: '076', order_date: '2026-09-21', customer_name: 'ﾃｽﾄ店',
    order_items: [
      { product_name: 'ラム串(10串)', quantity: 1, unit_price: 1000, tax_rate: 8 },
      { product_name: '▲鶏 脂 (油)【国産】2kg*6', quantity: 1, unit_price: 352, tax_rate: 8 },
      { product_name: '▲鶏 肉なしﾔｹﾞﾝ軟骨【ﾌﾞﾗｼﾞﾙ産】(三角骨)', quantity: 1, unit_price: 605, tax_rate: 8 },
    ] };
  const original = JSON.stringify(order);
  FOS.escpos.buildOutboundSlip(order);
  const native = encoded.join('');
  const cloud = FOS.hprtCloudPrint.buildOutboundSlip(order);
  for (const output of [native, cloud]) {
    assert.doesNotMatch(output, /[\uFF61-\uFF9F\u00A5?]/);
    for (const expected of ['ヤゲン軟骨', 'ブラジル産', '￥1,000', '￥352', '￥605', '￥1,957', '￥156', '￥2,113', 'テスト店']) {
      assert.ok(output.includes(expected), expected);
    }
  }
  assert.equal(FOS.hprtCloudPrint.escape('ﾊﾟﾝ & <¥352>'), 'パン &amp; &lt;￥352&gt;');
  assert.equal(JSON.stringify(order), original);
});
