window.FOS = window.FOS || {};

FOS.outboundPrint = {
  async logPrint({ orderId, printType, status, device, error }) {
    const user = FOS.auth?.user || {};
    const row = {
      merchant_id: FOS.merchants.scopeId(),
      order_id: String(orderId),
      print_type: printType || 'outbound',
      device_info: device || '',
      status: status === 'success' ? 'success' : 'failed',
      operator_id: user.id || null,
      operator_name: user.name || user.username || null,
      error_message: error ? String(error).slice(0, 500) : null,
      created_at: new Date().toISOString(),
    };
    try {
      await FOS.db.sb.from('print_logs').insert(row);
    } catch {
      const key = `print_logs_${FOS.merchants.scopeId()}`;
      const list = FOS.storage.get(key) || [];
      list.unshift(row);
      FOS.storage.set(key, list.slice(0, 200));
    }
  },

  async sendLan(payload, cfg) {
    const host = String(cfg.ip || '').trim();
    const port = parseInt(cfg.port, 10) || 9100;
    if (!host) throw new Error(FOS.i18n.t('プリンターIP未設定', '未配置打印机 IP'));

    let result = null;
    if (FOS.native?.lanPrintRaw) {
      result = await FOS.native.lanPrintRaw(host, port, payload.base64);
    } else if (window.NjfAndroid?.lanPrintRaw) {
      const ok = !!window.NjfAndroid.lanPrintRaw(host, port, payload.base64);
      const detail = String(window.NjfAndroid.getLanPrintLastError?.() || '').trim();
      result = { ok, error: detail };
    }

    if (result?.ok) return true;

    const detail = String(result?.error || '').trim();
    if (detail) {
      throw new Error(`${FOS.i18n.t('プリンター接続失敗', '打印机连接失败')} (${detail})`);
    }
    throw new Error(FOS.i18n.t('LAN印刷はアプリからご利用ください', '请在管理端 APP 中使用 LAN 打印'));
  },

  async testPrint(cfg) {
    const settings = cfg || await FOS.printerSettings.load();
    const host = String(settings.ip || '').trim();
    if (!host) throw new Error(FOS.i18n.t('プリンターIP未設定', '未配置打印机 IP'));

    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const bytes = FOS.escpos.concat(
      FOS.escpos.init(),
      FOS.escpos.separator(),
      FOS.escpos.styledLine(FOS.i18n.t('印刷テスト', '打印测试'), { align: 1, bold: true, size: 0x11 }),
      FOS.escpos.lineText(host),
      FOS.escpos.lineText(stamp),
      FOS.escpos.separator(),
      FOS.escpos.feed(2),
      FOS.escpos.cut()
    );
    await FOS.outboundPrint.sendLan({ base64: FOS.escpos.bytesToBase64(bytes) }, settings);
    return true;
  },

  async printOrder(order, { printType = 'outbound', copies } = {}) {
    const cfg = await FOS.printerSettings.load();
    if (!cfg.enabled) {
      return { ok: true, skipped: true };
    }
    if (cfg.type !== 'lan') {
      return {
        ok: false,
        skipped: false,
        error: FOS.i18n.t('現時点ではLAN印刷のみ対応', '当前仅支持网络打印机'),
      };
    }

    const count = copies || cfg.copies || 1;
    const device = FOS.printerSettings.deviceLabel(cfg);

    try {
      const payload = await FOS.escpos.buildOutboundPayload(order);
      for (let i = 0; i < count; i++) {
        await FOS.outboundPrint.sendLan(payload, cfg);
      }
      await FOS.outboundPrint.logPrint({
        orderId: order.id,
        printType,
        status: 'success',
        device,
      });
      return { ok: true, skipped: false, device, copies: count };
    } catch (e) {
      const errMsg = e?.message || String(e);
      await FOS.outboundPrint.logPrint({
        orderId: order.id,
        printType,
        status: 'failed',
        device,
        error: errMsg,
      });
      return { ok: false, skipped: false, error: errMsg, device };
    }
  },

  confirmRetry(errorMsg) {
    return new Promise((resolve) => {
      const id = `printRetry_${Date.now()}`;
      FOS.ui.openModal({
        title: '',
        size: 'sm',
        bodyHtml: `
          <div class="danger-confirm" id="${id}">
            <div class="danger-confirm__title">${FOS.i18n.t('印刷失敗', '打印失败')}</div>
            <div class="danger-confirm__msg">${FOS.fmt.escapeHtml(errorMsg || FOS.i18n.t('印刷に失敗しました', '打印失败'))}<br>${FOS.i18n.t('再試行しますか？', '是否重试？')}</div>
            <div class="danger-confirm__actions">
              <button type="button" class="btn btn--ghost btn--lg" data-cancel>${FOS.i18n.t('キャンセル', '取消')}</button>
              <button type="button" class="btn btn--primary btn--lg" data-ok>${FOS.i18n.t('再試行', '重试')}</button>
            </div>
          </div>`,
      });
      const wrap = document.getElementById(id);
      wrap?.querySelector('[data-cancel]')?.addEventListener('click', () => {
        FOS.ui.closeModal();
        resolve(false);
      });
      wrap?.querySelector('[data-ok]')?.addEventListener('click', () => {
        FOS.ui.closeModal();
        resolve(true);
      });
    });
  },

  async shipAndPrint(orderId, { printType = 'outbound' } = {}) {
    await FOS.orders.updateStatus(orderId, 'shipped');
    const order = await FOS.orders.fetchOne(orderId);
    if (!order) throw new Error(FOS.i18n.t('注文が見つかりません', '未找到订单'));

    const result = await FOS.outboundPrint.printOrder(order, { printType });
    if (result.skipped) {
      return { order, print: result, message: FOS.i18n.t('出庫完了', '出库完成') };
    }
    if (result.ok) {
      return {
        order,
        print: result,
        message: FOS.i18n.t('出庫完了・印刷送信済', '出库完成并已发送打印任务'),
      };
    }

    const retry = await FOS.outboundPrint.confirmRetry(result.error);
    if (retry) {
      const retryResult = await FOS.outboundPrint.printOrder(order, { printType: `${printType}_retry` });
      if (retryResult.ok) {
        return {
          order,
          print: retryResult,
          message: FOS.i18n.t('出庫完了・印刷送信済', '出库完成并已发送打印任务'),
        };
      }
    }

    return {
      order,
      print: result,
      message: FOS.i18n.t('出庫完了（印刷失敗）', '出库完成（打印失败）'),
      printFailed: true,
    };
  },

  async reprint(orderId) {
    const order = await FOS.orders.fetchOne(orderId);
    if (!order) throw new Error(FOS.i18n.t('注文が見つかりません', '未找到订单'));
    const result = await FOS.outboundPrint.printOrder(order, { printType: 'reprint' });
    if (result.skipped) {
      FOS.ui.toast(FOS.i18n.t('出庫印刷が無効です', '未启用出库打印'), 'info');
      return result;
    }
    if (result.ok) {
      FOS.ui.toast(FOS.i18n.t('印刷送信済', '已发送打印任务'), 'success');
      return result;
    }
    const retry = await FOS.outboundPrint.confirmRetry(result.error);
    if (retry) {
      const retryResult = await FOS.outboundPrint.printOrder(order, { printType: 'reprint_retry' });
      if (retryResult.ok) {
        FOS.ui.toast(FOS.i18n.t('印刷送信済', '已发送打印任务'), 'success');
        return retryResult;
      }
      FOS.ui.toast(retryResult.error || FOS.i18n.t('印刷失敗', '打印失败'), 'error');
      return retryResult;
    }
    return result;
  },
};
