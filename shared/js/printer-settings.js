window.FOS = window.FOS || {};

FOS.printerSettings = {
  defaults() {
    return {
      enabled: false,
      type: 'cloud',
      ip: '',
      bluetoothAddress: '',
      bluetoothName: '',
      port: 9100,
      copies: 1,
      userKey: '',
      userSecret: '',
      equipmentSn: '',
    };
  },

  storageKey() {
    return `printer_settings_${FOS.merchants.scopeId()}`;
  },

  bluetoothKey() { return this.storageKey() + '_bluetooth_local'; },

  async load() {
    const bluetooth = FOS.storage.get(this.bluetoothKey());
    if (bluetooth?.type === 'bluetooth') {
      this._cache = this.normalize({ ...(FOS.storage.get(this.storageKey()) || {}), ...bluetooth });
      return this._cache;
    }
    const mid = FOS.merchants.scopeId();
    const key = `printer_settings_${mid}`;
    try {
      const { data } = await FOS.db.sb
        .from('settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();
      if (data?.value) {
        this._cache = { ...this.defaults(), ...JSON.parse(data.value) };
        FOS.storage.set(this.storageKey(), this._cache);
        return this._cache;
      }
    } catch {
      /* fallback */
    }
    const local = FOS.storage.get(this.storageKey());
    this._cache = { ...this.defaults(), ...(local || {}) };
    return this._cache;
  },

  normalize(raw) {
    const base = this.defaults();
    const cfg = { ...base, ...(raw || {}) };
    cfg.enabled = !!cfg.enabled;
    cfg.type = ['lan', 'cloud', 'usb', 'bluetooth'].includes(cfg.type) ? cfg.type : 'cloud';
    cfg.ip = String(cfg.ip || '').trim();
    cfg.bluetoothAddress = String(cfg.bluetoothAddress || '').trim().toUpperCase();
    cfg.bluetoothName = String(cfg.bluetoothName || '').trim();
    let port = parseInt(cfg.port, 10);
    if (!Number.isFinite(port) || port <= 0) port = 9100;
    cfg.port = port;
    let copies = parseInt(cfg.copies, 10);
    if (![1, 2, 3].includes(copies)) copies = 1;
    cfg.copies = copies;
    cfg.userKey = String(cfg.userKey || '').trim();
    cfg.userSecret = String(cfg.userSecret || '').trim();
    cfg.equipmentSn = String(cfg.equipmentSn || cfg.equipment_sn || '').trim();
    return cfg;
  },

  async save(raw) {
    const cfg = this.normalize(raw);
    if (cfg.type === 'bluetooth') {
      if (!this.validBluetoothAddress(cfg.bluetoothAddress)) throw new Error(FOS.i18n.t('プリンターを選択してください', '请选择蓝牙打印机'));
      const local = { enabled: cfg.enabled, type: 'bluetooth', copies: cfg.copies, bluetoothAddress: cfg.bluetoothAddress, bluetoothName: cfg.bluetoothName };
      FOS.storage.set(this.bluetoothKey(), local);
      this._cache = this.normalize({ ...(this._cache || {}), ...local });
      return this._cache;
    }
    const mid = FOS.merchants.scopeId();
    const key = `printer_settings_${mid}`;
    const value = JSON.stringify(cfg);
    try {
      const { error } = await FOS.db.sb.from('settings').upsert({
        key,
        value,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message || '保存失败');
    } catch (e) {
      throw e;
    }
    FOS.storage.set(this.bluetoothKey(), null);
    FOS.storage.set(this.storageKey(), cfg);
    this._cache = cfg;
    return cfg;
  },

  isLanReady(cfg) {
    const c = cfg || this._cache || this.defaults();
    return !!c.enabled && c.type === 'lan' && !!c.ip;
  },

  isCloudReady(cfg) {
    const c = cfg || this._cache || this.defaults();
    return !!c.enabled && c.type === 'cloud' && !!c.userKey && !!c.userSecret && !!c.equipmentSn;
  },

  validBluetoothAddress(address) { return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(address || ''); },

  async configureBluetooth() {
    const t = (ja, zh) => FOS.i18n.t(ja, zh);
    if (!FOS.native?.bluetoothListPaired) {
      FOS.ui.toast(t('新版Androidアプリでご利用ください', '请在支持蓝牙打印的新版安卓 APP 中使用'), 'error');
      return;
    }
    const cfg = await this.load();
    const esc = FOS.fmt.escapeHtml;
    FOS.ui.openModal({
      title: t('この端末のBluetooth印刷', '本机蓝牙打印'),
      bodyHtml: `
        <p>${t('先にAndroidのBluetooth設定でプリンターをペアリングしてください。80mm ESC対応機用です。', '请先在安卓系统蓝牙设置中配对打印机。适用于支持 ESC 指令的 80mm 打印机。')}</p>
        <p>${t('この端末だけに保存され、他の端末のクラウド設定には影響しません。', '设置只保存在本机，不影响其他设备的汉印云配置。')}</p>
        <label class="field"><span class="field__label">${t('プリンター', '打印机')}</span>
          <select class="field__input" id="btPrinterSelect"><option value="">${t('選択してください', '请选择')}</option>
          ${cfg.bluetoothAddress ? `<option selected value="${esc(cfg.bluetoothAddress)}">${esc(cfg.bluetoothName || cfg.bluetoothAddress)}</option>` : ''}</select>
        </label>
        <button class="btn btn--secondary" id="btRefresh">${t('ペアリング済み機器を取得', '读取已配对设备')}</button>
        <label class="field"><span>${t('印刷部数', '打印份数')}</span><select class="field__input" id="btCopies">${[1,2,3].map(n => `<option value="${n}" ${cfg.copies === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label><input type="checkbox" id="btEnabled" ${cfg.enabled ? 'checked' : ''}> ${t('出庫印刷を有効化', '启用出库打印')}</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
          <button class="btn btn--secondary" id="btTest">${t('印刷テスト', '测试打印')}</button>
          <button class="btn btn--primary" id="btSave">${t('保存', '保存')}</button>
          <button class="btn btn--ghost" id="btShared">${t('商家の印刷設定に戻す', '恢复使用商家打印配置')}</button>
        </div>`,
    });
    const select = document.getElementById('btPrinterSelect');
    const draft = () => this.normalize({ type: 'bluetooth',
      enabled: document.getElementById('btEnabled').checked,
      copies: document.getElementById('btCopies').value,
      bluetoothAddress: select.value,
      bluetoothName: select.selectedOptions[0]?.textContent || '',
    });
    const run = (id, action) => document.getElementById(id).addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try { await action(); } catch (e) { FOS.ui.toast(e.message || String(e), 'error'); }
      finally { button.disabled = false; }
    });
    run('btRefresh', async () => {
      const { devices = [] } = await FOS.native.bluetoothListPaired();
      const current = select.value;
      select.innerHTML = `<option value="">${t('選択してください', '请选择')}</option>`;
      for (const d of devices) {
        const option = document.createElement('option');
        option.value = d.address; option.textContent = `${d.name} (${d.address})`;
        option.selected = d.address === current; select.appendChild(option);
      }
      if (!devices.length) FOS.ui.toast(t('先にシステム設定でペアリングしてください', '未找到已配对设备，请先在系统设置中配对'), 'info');
    });
    run('btTest', async () => {
      await FOS.outboundPrint.testPrint(draft());
      FOS.ui.toast(t('送信済み。印字を確認してください', '已发送，请检查实际出纸效果'), 'success');
    });
    run('btSave', async () => {
      await this.save(draft());
      FOS.ui.toast(t('この端末に保存しました', '已保存到本机'), 'success');
      FOS.ui.closeModal();
    });
    run('btShared', async () => {
      FOS.storage.set(this.bluetoothKey(), null);
      await this.load();
      FOS.ui.toast(t('商家の印刷設定を使用します', '已恢复使用商家打印配置'), 'success');
      FOS.ui.closeModal();
    });
  },

  isReady(cfg) {
    const c = cfg || this._cache || this.defaults();
    if (!c.enabled) return false;
    if (c.type === 'cloud') return FOS.printerSettings.isCloudReady(c);
    if (c.type === 'lan') return FOS.printerSettings.isLanReady(c);
    if (c.type === 'bluetooth') return this.validBluetoothAddress(c.bluetoothAddress) && !!FOS.native?.isAndroid?.();
    return false;
  },

  deviceLabel(cfg) {
    const c = cfg || this._cache || this.defaults();
    if (c.type === 'cloud') return `Cloud ${c.equipmentSn || '—'}`;
    if (c.type === 'lan') return `LAN ${c.ip}:${c.port || 9100}`;
    if (c.type === 'usb') return 'USB';
    if (c.type === 'bluetooth') return `Bluetooth ${c.bluetoothName || c.bluetoothAddress || '—'}`;
    return '—';
  },
};
