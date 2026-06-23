/**
 * 扩展插件注册中心
 * 后续可挂载：labelPrint, bluetoothPrint, barcodeScanner, barcode, factoryBoard, selfOrder
 */
window.FOS = window.FOS || {};

FOS.plugins = {
  _registry: {},
  slots: {
    topbar: [],
    sidebar: [],
    orderToolbar: [],
    productionToolbar: [],
  },

  register(name, api) {
    FOS.plugins._registry[name] = api;
    if (typeof api.onRegister === 'function') api.onRegister();
  },

  get(name) {
    return FOS.plugins._registry[name] || null;
  },

  addSlot(slot, html) {
    if (!FOS.plugins.slots[slot]) FOS.plugins.slots[slot] = [];
    FOS.plugins.slots[slot].push(html);
  },

  renderSlot(slot) {
    const items = FOS.plugins.slots[slot] || [];
    return items.join('');
  },

  /** 预留扩展定义（Phase 3+ 实现） */
  stubs: {
    labelPrint: { id: 'labelPrint', label: '标签打印', icon: '🏷️', status: 'planned' },
    bluetoothPrint: { id: 'bluetoothPrint', label: '蓝牙打印', icon: '📶', status: 'planned' },
    barcodeScanner: { id: 'barcodeScanner', label: '扫码枪', icon: '📷', status: 'planned' },
    barcode: { id: 'barcode', label: '条码', icon: '▮▯', status: 'planned' },
    factoryBoard: { id: 'factoryBoard', label: '工厂看板', icon: '📊', status: 'planned' },
    selfOrder: { id: 'selfOrder', label: '自助下单', icon: '🖥️', status: 'planned' },
  },
};
