window.FOS = window.FOS || {};

/** UTF-8 文档导出 — html2pdf 直接保存 + HTML 兜底 */
FOS.printDoc = {
  esc(s) {
    return FOS.fmt.escapeHtml(String(s ?? ''));
  },

  _css() {
    return `
      * { box-sizing: border-box; }
      .fos-pdf-root {
        font-family: 'Meiryo', 'Yu Gothic UI', 'Hiragino Sans', 'Microsoft YaHei', sans-serif;
        font-size: 13px; color: #1a1a1a; line-height: 1.5;
        background: #fff; padding: 24px; width: 794px;
      }
      h1 { font-size: 22px; text-align: center; margin: 0 0 8px; }
      .blue-line { height: 3px; background: #2563eb; border-radius: 2px; margin-bottom: 18px; }
      .meta { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-bottom: 16px; font-size: 13px; }
      .meta span { color: #666; }
      .meta strong { color: #111; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
      th { background: #f1f3f5; padding: 8px 10px; text-align: left; font-size: 12px; border-bottom: 2px solid #dee2e6; }
      td { padding: 8px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
      tfoot td { font-weight: 700; background: #fafafa; }
      .qty { text-align: center; font-size: 18px; font-weight: 900; color: #2563eb; }
      .money { text-align: right; white-space: nowrap; }
      .grand { font-size: 16px; font-weight: 900; color: #2563eb; }
      .fos-pdf-root--invoice {
        font-family: 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', 'Meiryo', sans-serif;
        font-size: 11px; color: #000; line-height: 1.5; padding: 36px 40px 32px; width: 794px;
      }
      .fos-pdf-root--invoice .inv-page { margin-bottom: 0; }
      .fos-pdf-root--invoice .inv-title {
        text-align: center; font-size: 26px; font-weight: 700;
        letter-spacing: 0.55em; margin: 0 0 8px; padding-left: 0.55em;
        color: #000;
      }
      .fos-pdf-root--invoice .inv-close {
        text-align: center; margin-bottom: 28px; font-size: 11px; font-weight: 400;
      }
      .fos-pdf-root--invoice .inv-header {
        display: flex; justify-content: space-between; align-items: flex-start;
        gap: 32px; margin-bottom: 22px; min-height: 72px;
      }
      .fos-pdf-root--invoice .inv-to { flex: 1; }
      .fos-pdf-root--invoice .inv-to-name {
        font-size: 16px; font-weight: 700; line-height: 1.4; margin-bottom: 0;
      }
      .fos-pdf-root--invoice .inv-to-line {
        margin-top: 6px; font-size: 11px; font-weight: 400;
      }
      .fos-pdf-root--invoice .inv-from {
        flex: 1; text-align: right; font-size: 11px; line-height: 1.55;
      }
      .fos-pdf-root--invoice .inv-from-name {
        font-weight: 700; font-size: 11px; margin-bottom: 2px;
      }
      .fos-pdf-root--invoice .inv-period,
      .fos-pdf-root--invoice .inv-bank {
        margin: 0 0 8px; font-size: 11px; font-weight: 400;
      }
      .fos-pdf-root--invoice .inv-bank { margin-bottom: 14px; }
      .fos-pdf-root--invoice .inv-summary {
        width: 58%; margin: 0 0 20px; border-collapse: collapse;
      }
      .fos-pdf-root--invoice .inv-summary th,
      .fos-pdf-root--invoice .inv-summary td {
        border: 1px solid #000; padding: 7px 8px; text-align: center;
        font-size: 11px; font-weight: 400;
      }
      .fos-pdf-root--invoice .inv-summary th { font-weight: 700; background: #fff; }
      .fos-pdf-root--invoice .inv-detail {
        width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 11px;
      }
      .fos-pdf-root--invoice .inv-detail th {
        border-bottom: 1px solid #000; padding: 5px 4px 6px; text-align: left;
        font-weight: 700; background: #fff; font-size: 11px;
      }
      .fos-pdf-root--invoice .inv-detail td {
        padding: 4px 4px; vertical-align: top; border: none; font-size: 11px;
      }
      .fos-pdf-root--invoice .inv-detail .inv-date { white-space: nowrap; width: 96px; }
      .fos-pdf-root--invoice .inv-detail .inv-num,
      .fos-pdf-root--invoice .inv-detail .inv-qty { white-space: nowrap; }
      .fos-pdf-root--invoice .inv-slip-row td { padding-top: 8px; padding-bottom: 2px; }
      .fos-pdf-root--invoice .inv-slip-label { text-align: right; font-weight: 700; }
      .fos-pdf-root--invoice .inv-page-break { page-break-after: always; height: 0; }
    `;
  },

  _buildFullHtml(title, bodyHtml, htmlLang) {
    const lang = htmlLang || 'ja';
    return `<!DOCTYPE html>
<html lang="${FOS.printDoc.esc(lang)}"><head><meta charset="UTF-8"><title>${FOS.printDoc.esc(title)}</title>
<style>${FOS.printDoc._css()}</style></head>
<body class="fos-pdf-root">${bodyHtml}</body></html>`;
  },

  _mountNode(bodyHtml, docClass) {
    const wrap = document.createElement('div');
    wrap.className = 'fos-pdf-render-host';
    wrap.style.cssText =
      'position:fixed;left:0;top:0;width:794px;max-width:794px;z-index:-1;opacity:0.01;pointer-events:none;overflow:visible';
    const rootClass = docClass || 'fos-pdf-root';
    wrap.innerHTML = `<style>${FOS.printDoc._css()}</style><div class="${rootClass}">${bodyHtml}</div>`;
    document.body.appendChild(wrap);
    return wrap;
  },

  formatFileSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  },

  async renderPdfBlob({ bodyHtml, docClass, htmlLang }) {
    if (!bodyHtml) throw new Error('empty pdf body');
    if (typeof html2pdf !== 'function') throw new Error('html2pdf missing');

    const rootClass = docClass || 'fos-pdf-root';
    const node = FOS.printDoc._mountNode(bodyHtml, rootClass);
    const target = node.querySelector(`.${rootClass.split(/\s+/)[0]}`);

    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const blob = await html2pdf()
        .set({
          margin: [8, 8, 8, 8],
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            letterRendering: true,
            logging: false,
            width: 794,
            windowWidth: 794,
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'] },
        })
        .from(target)
        .outputPdf('blob');
      if (!blob || blob.size < 64) throw new Error('empty pdf blob');
      return blob;
    } finally {
      node.remove();
    }
  },

  downloadHtml({ title, bodyHtml, filename, htmlLang }) {
    const html = FOS.printDoc._buildFullHtml(title, bodyHtml, htmlLang);
    const blob = new Blob(['\uFEFF', html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (filename || 'document.pdf').replace(/\.pdf$/i, '.html');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    FOS.ui.toast(FOS.i18n.t('HTMLを保存しました。ブラウザで開いてPDF化できます', '已保存 HTML，可用浏览器打开后另存为 PDF'), 'info');
  },

  async savePdfBlob(blob, filename) {
    const fname = filename || 'document.pdf';
    if (FOS.native?.isApp?.() && FOS.native?.downloadPdfBlob) {
      return FOS.native.downloadPdfBlob(blob, fname);
    }

    const file = new File([blob], fname, { type: 'application/pdf' });
    if (navigator.share) {
      try {
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: fname });
          return true;
        }
      } catch (e) {
        if (e?.name === 'AbortError') return false;
      }
    }

    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  },

  async promptDownload({ title, bodyHtml, filename, docClass, htmlLang }) {
    if (!bodyHtml) {
      FOS.ui.toast(FOS.i18n.t('データなし', '暂无数据'), 'error');
      return false;
    }

    const safeDefault = (filename || 'document.pdf').replace(/[^\w.\-\u4e00-\u9fff]/g, '_');
    let cachedBlob = null;

    FOS.ui.openModal({
      title: FOS.i18n.t('ダウンロード', '下载'),
      size: 'sheet',
      bodyHtml: `
        <div class="fos-download-sheet">
          <div class="fos-download-sheet__row">
            <span class="fos-download-sheet__label">${FOS.i18n.t('ファイル名', '文件名')}</span>
            <label class="fos-download-sheet__filename">
              <input type="text" class="fos-download-sheet__input" id="pdfDownloadFilename" value="${FOS.printDoc.esc(safeDefault)}">
              <span class="fos-download-sheet__edit" aria-hidden="true">✎</span>
            </label>
          </div>
          <div class="fos-download-sheet__row">
            <span class="fos-download-sheet__label">${FOS.i18n.t('サイズ', '大小')}</span>
            <span class="fos-download-sheet__value" id="pdfDownloadSize">${FOS.i18n.t('計算中…', '计算中…')}</span>
          </div>
          <div class="fos-download-sheet__actions">
            <button type="button" class="fos-download-sheet__btn" data-modal-close>${FOS.i18n.t('キャンセル', '取消')}</button>
            <button type="button" class="fos-download-sheet__btn fos-download-sheet__btn--primary" id="pdfDownloadConfirm">${FOS.i18n.t('ダウンロード', '下载')}</button>
          </div>
        </div>`,
    });

    const refreshSize = async () => {
      const sizeEl = document.getElementById('pdfDownloadSize');
      const confirmBtn = document.getElementById('pdfDownloadConfirm');
      try {
        cachedBlob = await FOS.printDoc.renderPdfBlob({ bodyHtml, docClass, htmlLang });
        if (sizeEl) sizeEl.textContent = FOS.printDoc.formatFileSize(cachedBlob.size);
        if (confirmBtn) confirmBtn.disabled = false;
      } catch (e) {
        console.warn('pdf preview failed:', e);
        cachedBlob = null;
        if (sizeEl) sizeEl.textContent = '—';
        if (confirmBtn) confirmBtn.disabled = true;
      }
    };

    const confirmBtn = document.getElementById('pdfDownloadConfirm');
    if (confirmBtn) confirmBtn.disabled = true;
    refreshSize();

    return new Promise((resolve) => {
      confirmBtn?.addEventListener('click', async () => {
        const fname = document.getElementById('pdfDownloadFilename')?.value?.trim() || safeDefault;
        FOS.ui.showLoading(FOS.i18n.t('PDF生成中...', '正在生成 PDF...'));
        try {
          let blob = cachedBlob;
          if (!blob) blob = await FOS.printDoc.renderPdfBlob({ bodyHtml, docClass, htmlLang });
          const saved = await FOS.printDoc.savePdfBlob(blob, fname);
          if (saved) {
            FOS.ui.closeModal();
            FOS.ui.toast(
              FOS.native?.isApp?.()
                ? FOS.i18n.t('ダウンロードフォルダに保存しました', '已保存到下载文件夹')
                : FOS.i18n.t('PDFを保存しました', 'PDF 已保存'),
              'success'
            );
            resolve(true);
          } else {
            FOS.ui.toast(FOS.i18n.t('PDFの保存に失敗しました', 'PDF 保存失败'), 'error');
            resolve(false);
          }
        } catch (e) {
          console.warn('pdf download failed:', e);
          FOS.ui.toast(FOS.i18n.t('PDFの保存に失敗しました', 'PDF 保存失败'), 'error');
          resolve(false);
        } finally {
          FOS.ui.hideLoading();
        }
      }, { once: true });

      const modal = document.getElementById('fosModal');
      modal?.querySelector('[data-modal-close]')?.addEventListener('click', () => resolve(false), { once: true });
    });
  },

  async downloadPdf({ title, bodyHtml, filename, docClass, htmlLang }) {
    return FOS.printDoc.promptDownload({ title, bodyHtml, filename, docClass, htmlLang });
  },

  open({ title, bodyHtml, filename }) {
    FOS.ui.openModal({
      title: title || FOS.i18n.t('プレビュー', '预览'),
      size: 'lg',
      bodyHtml: `
        <div id="printInlinePreview" class="fos-pdf-root" style="max-height:70vh;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:16px;background:#fff">
          ${bodyHtml}
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap">
          <button type="button" class="btn btn--secondary" data-modal-close>${FOS.i18n.t('閉じる', '关闭')}</button>
          <button type="button" class="btn btn--primary" id="savePdfBtn">📥 ${FOS.i18n.t('PDF保存', '保存 PDF')}</button>
        </div>`,
    });
    document.getElementById('savePdfBtn')?.addEventListener('click', () => {
      FOS.ui.closeModal();
      FOS.printDoc.promptDownload({ title, bodyHtml, filename });
    });
    return true;
  },
};
