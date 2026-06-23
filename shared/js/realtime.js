window.FOS = window.FOS || {};

FOS.realtime = {
  _channel: null,
  _productChannel: null,
  _lastNotifyKey: null,
  _lastPollAt: null,
  _lastSubmittedPollAt: null,
  _pollTimer: null,
  _notifyTimers: {},
  _onNewOrder: null,
  _onProductChange: null,
  _audioCtx: null,
  _audioUnlocked: false,
  _alertAudioUrl: null,
  _alertPlayer: null,
  _rearmBound: false,
  _visBound: false,

  isAlertsEnabled() {
    return FOS.storage.get('order_alerts_enabled') === true;
  },

  async requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'default') {
      return (await Notification.requestPermission()) === 'granted';
    }
    return Notification.permission === 'granted';
  },

  async _unlockAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      if (!FOS.realtime._audioCtx) {
        FOS.realtime._audioCtx = new Ctx();
      }
      if (FOS.realtime._audioCtx.state === 'suspended') {
        await FOS.realtime._audioCtx.resume();
      }
      FOS.realtime._audioUnlocked = FOS.realtime._audioCtx.state === 'running';
      return FOS.realtime._audioUnlocked;
    } catch {
      return false;
    }
  },

  async _buildAlertClip() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const OfflineCtx = window.OfflineAudioContext || (Ctx && Ctx.prototype && window.webkitOfflineAudioContext);
      if (!OfflineCtx) return;
      const sr = 22050;
      const duration = 0.75;
      const offline = new OfflineCtx(1, Math.floor(sr * duration), sr);
      [[0, 660], [0.28, 880], [0.5, 1100]].forEach(([offset, freq]) => {
        const osc = offline.createOscillator();
        const gain = offline.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, offset);
        gain.gain.exponentialRampToValueAtTime(0.5, offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, offset + 0.22);
        osc.connect(gain);
        gain.connect(offline.destination);
        osc.start(offset);
        osc.stop(offset + 0.24);
      });
      const rendered = await offline.startRendering();
      const wav = FOS.realtime._encodeWav(rendered);
      if (FOS.realtime._alertAudioUrl) URL.revokeObjectURL(FOS.realtime._alertAudioUrl);
      FOS.realtime._alertAudioUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      if (!FOS.realtime._alertPlayer) FOS.realtime._alertPlayer = new Audio();
      FOS.realtime._alertPlayer.src = FOS.realtime._alertAudioUrl;
      FOS.realtime._alertPlayer.preload = 'auto';
      FOS.realtime._alertPlayer.volume = 0.01;
      await FOS.realtime._alertPlayer.play();
      FOS.realtime._alertPlayer.pause();
      FOS.realtime._alertPlayer.currentTime = 0;
      FOS.realtime._audioUnlocked = true;
    } catch { /* */ }
  },

  _bindAudioRearm() {
    if (FOS.realtime._rearmBound || !FOS.realtime.isAlertsEnabled()) return;
    FOS.realtime._rearmBound = true;
    const rearm = async () => {
      if (FOS.realtime._audioUnlocked && FOS.realtime._alertAudioUrl) return;
      await FOS.realtime._unlockAudio();
      await FOS.realtime._buildAlertClip();
      if (FOS.realtime._audioUnlocked) {
        document.removeEventListener('click', rearm, true);
        document.removeEventListener('touchstart', rearm, true);
      }
    };
    document.addEventListener('click', rearm, true);
    document.addEventListener('touchstart', rearm, true);
  },

  _encodeWav(buffer) {
    const numCh = buffer.numberOfChannels;
    const sr = buffer.sampleRate;
    const samples = buffer.length;
    const bytes = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(bytes);
    const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * numCh * 2, true);
    view.setUint16(32, numCh * 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, samples * 2, true);
    const ch = buffer.getChannelData(0);
    let offset = 44;
    for (let i = 0; i < samples; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
    return bytes;
  },

  async enableAlerts({ test = false } = {}) {
    const notifOk = await FOS.realtime.requestPermission();
    const audioOk = await FOS.realtime._unlockAudio();
    await FOS.realtime._buildAlertClip();
    FOS.storage.set('order_alerts_enabled', true);
    FOS.realtime._bindAudioRearm();
    if (test) {
      await FOS.realtime._playSound();
      FOS.realtime._speakAlert(null, { test: true });
    }
    return notifOk || audioOk || FOS.realtime._audioUnlocked;
  },

  async _playOscillator() {
    try {
      const ok = await FOS.realtime._unlockAudio();
      if (!ok || !FOS.realtime._audioCtx) return;
      const audio = FOS.realtime._audioCtx;
      const t0 = audio.currentTime;
      [660, 880, 1100].forEach((freq, i) => {
        const start = t0 + i * 0.22;
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'sine';
        osc.connect(gain);
        gain.connect(audio.destination);
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.45, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
        osc.start(start);
        osc.stop(start + 0.22);
      });
    } catch { /* */ }
  },

  async _playSound() {
    let played = false;
    const player = FOS.realtime._alertPlayer;
    if (player && FOS.realtime._alertAudioUrl) {
      try {
        player.currentTime = 0;
        player.volume = 1;
        await player.play();
        played = true;
      } catch { /* */ }
    }
    if (!played && FOS.realtime._alertAudioUrl) {
      try {
        if (!FOS.realtime._alertPlayer) FOS.realtime._alertPlayer = new Audio(FOS.realtime._alertAudioUrl);
        FOS.realtime._alertPlayer.volume = 1;
        await FOS.realtime._alertPlayer.play();
        played = true;
      } catch { /* */ }
    }
    if (!played) await FOS.realtime._playOscillator();
    return played;
  },

  _speakAlert(order, opts = {}) {
    if (!window.speechSynthesis) return;
    const label = order ? FOS.realtime._orderNotifyLabel(order) : '';
    let text;
    if (opts.test) {
      text = FOS.i18n.t(
        '新しい注文があります。ご確認ください。',
        '您有新的订单，请注意查收。'
      );
    } else {
      text = FOS.i18n.t(
        label ? `新しい注文があります。${label}。ご確認ください。` : '新しい注文があります。ご確認ください。',
        label ? `您有新的订单，${label}，请注意查收。` : '您有新的订单，请注意查收。'
      );
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = FOS.i18n.lang === 'zh' ? 'zh-CN' : 'ja-JP';
    utter.rate = 0.95;
    utter.volume = 1;
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    } catch { /* */ }
  },

  _notifyKey(order) {
    return `${order?.id || ''}:${order?.shop_submitted_at || ''}`;
  },

  _productionRoles() {
    return [FOS.CONFIG?.ROLES?.FACTORY || 'factory', FOS.CONFIG?.ROLES?.DELIVERY || 'delivery'];
  },

  _canWatchOrders() {
    return FOS.realtime._productionRoles().includes(FOS.auth.user?.role);
  },

  _orderNotifyLabel(order) {
    if (FOS.publicOrder?.isPublicOrder?.(order)) {
      const name = String(order.customer_name || order.shop_name || '').trim();
      const src = FOS.publicOrder.orderSourceLabel(order);
      return name ? `${name} · ${src}` : src;
    }
    return FOS.fmt.displayName(order.shop_name || order.shop_id || '');
  },

  _isNewShopSubmission(order, oldRow) {
    if (!order?.id || !FOS.orders?.isShopSubmitted?.(order)) return false;
    const mid = FOS.merchants?.scopeId?.();
    if (mid && order.merchant_id && order.merchant_id !== mid) return false;
    const newTs = order.shop_submitted_at;
    if (!newTs) return false;
    if (!oldRow) return false;
    const oldTs = oldRow.shop_submitted_at || null;
    if (!oldTs) return false;
    return String(newTs) > String(oldTs);
  },

  async _fetchOrder(orderId) {
    const { data } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('orders').select('*').eq('id', orderId).maybeSingle()
    );
    return data;
  },

  _scheduleNotify(orderOrId) {
    const id = typeof orderOrId === 'object' ? orderOrId?.id : orderOrId;
    if (!id) return;
    clearTimeout(FOS.realtime._notifyTimers[id]);
    FOS.realtime._notifyTimers[id] = setTimeout(async () => {
      delete FOS.realtime._notifyTimers[id];
      const order = typeof orderOrId === 'object' && orderOrId?.order_no != null
        ? await FOS.realtime._fetchOrder(orderOrId.id).then((fresh) => fresh || orderOrId)
        : await FOS.realtime._fetchOrder(id);
      if (order) await FOS.realtime.notify(order);
    }, 400);
  },

  _handleOrderChange(order, event, oldRow) {
    if (!order?.id) return;
    if (event === 'INSERT') {
      if (FOS.orders?.isShopSubmitted?.(order)) FOS.realtime._scheduleNotify(order);
      return;
    }
    if (!FOS.realtime._isNewShopSubmission(order, oldRow)) return;
    FOS.realtime._scheduleNotify(order);
  },

  _showToast(order) {
    const old = document.getElementById('newOrderToast');
    old?.remove();
    const label = FOS.realtime._orderNotifyLabel(order);
    const badge = FOS.publicOrder?.isPublicOrder?.(order)
      ? `<span class="badge badge--blue" style="margin-left:6px">${FOS.fmt.escapeHtml(FOS.publicOrder.orderSourceLabel(order))}</span>`
      : '';
    const el = document.createElement('div');
    el.id = 'newOrderToast';
    el.className = 'new-order-toast';
    el.innerHTML = `
      <div class="new-order-toast__body">
        <strong>${FOS.i18n.t('新しい注文', '新订单')}</strong>${badge}
        <div>${FOS.fmt.escapeHtml(label)} · #${order.order_no || '---'}</div>
      </div>
      <button type="button" class="btn btn--primary btn--sm" id="newOrderViewBtn">${FOS.i18n.t('確認', '查看')}</button>
      <button type="button" class="btn btn--ghost btn--sm" id="newOrderCloseBtn">✕</button>`;
    document.body.appendChild(el);
    document.getElementById('newOrderViewBtn')?.addEventListener('click', () => {
      el.remove();
      if (typeof FOS.realtime._onNewOrder === 'function') FOS.realtime._onNewOrder(order);
    });
    document.getElementById('newOrderCloseBtn')?.addEventListener('click', () => el.remove());
    setTimeout(() => el.remove(), 12000);
  },

  _trackPollCursor(order) {
    FOS.realtime._lastPollAt = order.updated_at || order.created_at || FOS.realtime._lastPollAt;
    if (order.shop_submitted_at) {
      const cur = FOS.realtime._lastSubmittedPollAt;
      if (!cur || String(order.shop_submitted_at) > String(cur)) {
        FOS.realtime._lastSubmittedPollAt = order.shop_submitted_at;
      }
    }
  },

  _suppressedUntil: {},

  suppressOrderAlert(orderId, ms = 5000) {
    if (!orderId) return;
    FOS.realtime._suppressedUntil[orderId] = Date.now() + ms;
  },

  _isOrderAlertSuppressed(orderId) {
    const until = FOS.realtime._suppressedUntil[orderId];
    if (!until) return false;
    if (Date.now() >= until) {
      delete FOS.realtime._suppressedUntil[orderId];
      return false;
    }
    return true;
  },

  async notify(order, { refreshOnly = false } = {}) {
    if (!order || !FOS.orders?.isShopSubmitted?.(order)) return;

    if (typeof FOS.realtime._onNewOrder === 'function') {
      try {
        await FOS.realtime._onNewOrder(order);
      } catch { /* */ }
    }

    if (refreshOnly || FOS.realtime._isOrderAlertSuppressed(order.id)) return;

    const key = FOS.realtime._notifyKey(order);
    if (!order.shop_submitted_at || FOS.realtime._lastNotifyKey === key) return;
    FOS.realtime._lastNotifyKey = key;
    FOS.realtime._trackPollCursor(order);

    if (FOS.realtime.isAlertsEnabled()) {
      const played = await FOS.realtime._playSound();
      if (played) FOS.realtime._speakAlert(order);
      else FOS.realtime._bindAudioRearm();
    }
    if (Notification.permission === 'granted') {
      try {
        new Notification(FOS.i18n.t('新しい注文', '新订单'), {
          body: `${FOS.realtime._orderNotifyLabel(order)} #${order.order_no || ''}`,
          tag: 'order-' + order.id,
        });
      } catch { /* */ }
    }
    FOS.realtime._showToast(order);
    FOS.ui.toast(FOS.i18n.t(`新注文 #${order.order_no}`, `新订单 #${order.order_no}`), 'success');
  },

  async _pollOrders() {
    if (!FOS.db.sb || !FOS.realtime._canWatchOrders()) return;
    try {
      let q = FOS.orders.forFactoryQuery(
        FOS.db.sb.from('orders').select('*').order('shop_submitted_at', { ascending: false }).limit(12)
      );
      if (FOS.realtime._lastSubmittedPollAt) {
        q = q.gt('shop_submitted_at', FOS.realtime._lastSubmittedPollAt);
      }
      const { data, error } = await q;
      if (error) return;
      const rows = (data || []).slice().reverse();
      for (const order of rows) {
        if (!FOS.orders.isShopSubmitted(order)) continue;
        await FOS.realtime.notify(order);
      }
    } catch { /* */ }
  },

  startPolling(intervalMs) {
    const ms = intervalMs ?? 3000;
    FOS.realtime.stopPolling();
    FOS.realtime._pollOrders();
    FOS.realtime._pollTimer = setInterval(() => FOS.realtime._pollOrders(), ms);
  },

  stopPolling() {
    if (FOS.realtime._pollTimer) {
      clearInterval(FOS.realtime._pollTimer);
      FOS.realtime._pollTimer = null;
    }
  },

  start({ onNewOrder, poll = true } = {}) {
    if (!FOS.db.sb || !FOS.realtime._canWatchOrders()) return;
    FOS.realtime.stop();
    FOS.realtime._onNewOrder = onNewOrder;
    const startedAt = new Date().toISOString();
    FOS.realtime._lastPollAt = startedAt;
    FOS.realtime._lastSubmittedPollAt = startedAt;
    if (FOS.realtime.isAlertsEnabled()) {
      FOS.realtime._bindAudioRearm();
      FOS.realtime._buildAlertClip();
    }

    if (!FOS.realtime._visBound) {
      FOS.realtime._visBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') FOS.realtime._pollOrders();
      });
    }

    FOS.realtime._channel = FOS.db.sb
      .channel('fos-v2-orders-' + Date.now())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
        FOS.realtime._handleOrderChange(payload.new, 'INSERT', payload.old);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
        FOS.realtime._handleOrderChange(payload.new, 'UPDATE', payload.old);
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          FOS.realtime.startPolling();
        }
      });

    if (poll) FOS.realtime.startPolling();
  },

  startProducts({ onChange } = {}) {
    if (!FOS.db.sb) return;
    FOS.realtime.stopProducts();
    FOS.realtime._onProductChange = onChange;
    FOS.realtime._productChannel = FOS.db.sb
      .channel('fos-v2-products-' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
        const mid = FOS.merchants?.scopeId?.();
        const row = payload.new || payload.old;
        if (mid && row?.merchant_id && row.merchant_id !== mid) return;
        if (typeof FOS.realtime._onProductChange === 'function') {
          FOS.realtime._onProductChange(payload);
        }
      })
      .subscribe();
  },

  stopProducts() {
    if (FOS.realtime._productChannel) {
      try { FOS.db.sb.removeChannel(FOS.realtime._productChannel); } catch { /* */ }
      FOS.realtime._productChannel = null;
    }
    FOS.realtime._onProductChange = null;
  },

  watchShopOrders(shopId, onChange) {
    FOS.realtime.stopShopOrders();
    if (!FOS.db.sb || !shopId || typeof onChange !== 'function') return;
    FOS.realtime._onShopOrderChange = onChange;
    FOS.realtime._shopOrdersChannel = FOS.db.sb
      .channel('fos-shop-orders-' + shopId + '-' + Date.now())
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `shop_id=eq.${shopId}`,
      }, () => {
        if (typeof FOS.realtime._onShopOrderChange === 'function') {
          FOS.realtime._onShopOrderChange();
        }
      })
      .subscribe();
  },

  stopShopOrders() {
    if (FOS.realtime._shopOrdersTimer) {
      clearTimeout(FOS.realtime._shopOrdersTimer);
      FOS.realtime._shopOrdersTimer = null;
    }
    if (FOS.realtime._shopOrdersChannel) {
      try { FOS.db.sb.removeChannel(FOS.realtime._shopOrdersChannel); } catch { /* */ }
      FOS.realtime._shopOrdersChannel = null;
    }
    FOS.realtime._onShopOrderChange = null;
  },

  scheduleShopOrdersRefresh(onChange, ms = 800) {
    if (typeof onChange !== 'function') return;
    if (FOS.realtime._shopOrdersTimer) clearTimeout(FOS.realtime._shopOrdersTimer);
    FOS.realtime._shopOrdersTimer = setTimeout(() => {
      FOS.realtime._shopOrdersTimer = null;
      onChange();
    }, ms);
  },

  stop() {
    FOS.realtime.stopPolling();
    FOS.realtime.stopProducts();
    FOS.realtime.stopShopOrders();
    Object.values(FOS.realtime._notifyTimers).forEach((t) => clearTimeout(t));
    FOS.realtime._notifyTimers = {};
    if (FOS.realtime._channel) {
      try { FOS.db.sb.removeChannel(FOS.realtime._channel); } catch { /* */ }
      FOS.realtime._channel = null;
    }
    FOS.realtime._onNewOrder = null;
  },
};
