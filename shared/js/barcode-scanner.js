/**
 * factory-system-v2 · 扫条码
 * 实时摄像头识别（BarcodeDetector / ZXing），支持 EAN/UPC 等商品条码
 */
window.FOS = window.FOS || {};

FOS.barcodeScanner = {
  _active: null,

  canUseLiveCamera() {
    const hasApi = !!navigator.mediaDevices?.getUserMedia;
    const hasEngine = typeof ZXing !== 'undefined' || typeof BarcodeDetector !== 'undefined';
    return hasApi && hasEngine;
  },

  _normalizeResult(code) {
    return FOS.productCatalog?.normalizeBarcode?.(code) || String(code || '').trim();
  },

  _zxingReader() {
    if (typeof ZXing === 'undefined') return null;
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.EAN_13,
      ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.UPC_A,
      ZXing.BarcodeFormat.UPC_E,
      ZXing.BarcodeFormat.CODE_128,
      ZXing.BarcodeFormat.CODE_39,
      ZXing.BarcodeFormat.ITF,
    ]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    return new ZXing.BrowserMultiFormatReader(hints, 300);
  },

  _barcodeDetector() {
    if (typeof BarcodeDetector === 'undefined') return null;
    try {
      return new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'],
      });
    } catch {
      return null;
    }
  },

  async _stop() {
    const active = FOS.barcodeScanner._active;
    if (!active) return;
    FOS.barcodeScanner._active = null;

    if (active.rafId) cancelAnimationFrame(active.rafId);

    try {
      active.zxingReader?.reset?.();
    } catch {
      /* ignore */
    }

    const stopStream = (stream) => {
      stream?.getTracks?.().forEach((track) => {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      });
    };

    stopStream(active.stream);
    if (active.videoEl?.srcObject) {
      stopStream(active.videoEl.srcObject);
      active.videoEl.srcObject = null;
    }

    active.overlay?.remove();
  },

  async _openCamera(videoEl) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    FOS.barcodeScanner._active.stream = stream;
    videoEl.srcObject = stream;
    await videoEl.play();
    return stream;
  },

  _startNativeDetectLoop(videoEl, finish) {
    const detector = FOS.barcodeScanner._barcodeDetector();
    if (!detector) return false;

    let running = true;
    const loop = async () => {
      if (!running || !FOS.barcodeScanner._active) return;
      try {
        if (videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const codes = await detector.detect(videoEl);
          const raw = codes?.[0]?.rawValue;
          if (raw) {
            running = false;
            finish(raw, false);
            return;
          }
        }
      } catch {
        /* keep scanning */
      }
      if (FOS.barcodeScanner._active) {
        FOS.barcodeScanner._active.rafId = requestAnimationFrame(loop);
      }
    };
    loop();
    return true;
  },

  async _startZXingOnVideo(videoEl, finish) {
    const reader = FOS.barcodeScanner._zxingReader();
    if (!reader || !videoEl) throw new Error('live unavailable');

    FOS.barcodeScanner._active.zxingReader = reader;

    if (typeof reader.decodeFromVideoElementContinuously === 'function') {
      reader.decodeFromVideoElementContinuously(videoEl, (result) => {
        if (result?.getText) finish(result.getText(), false);
      });
      return;
    }

    reader.decodeFromVideoElement(videoEl, (result) => {
      if (result?.getText) finish(result.getText(), false);
    });
  },

  async _startLiveZXingDevice(videoEl, finish) {
    const reader = FOS.barcodeScanner._zxingReader();
    if (!reader || !videoEl) throw new Error('live unavailable');

    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');
    const rear =
      cams.find((d) => /back|rear|後|environment/i.test(d.label || '')) ||
      cams[cams.length - 1] ||
      cams[0];

    FOS.barcodeScanner._active.zxingReader = reader;

    reader.decodeFromVideoDevice(rear?.deviceId || undefined, videoEl, (result) => {
      if (result?.getText) finish(result.getText(), false);
    });
  },

  async _startLiveScan(videoEl, finish) {
    if (!videoEl) throw new Error('live unavailable');

    try {
      await FOS.barcodeScanner._openCamera(videoEl);
    } catch {
      throw new Error(
        FOS.i18n.t(
          'カメラを起動できません。ブラウザでカメラを許可してください',
          '无法启动摄像头，请在浏览器中允许相机权限'
        )
      );
    }

    if (FOS.barcodeScanner._startNativeDetectLoop(videoEl, finish)) return;

    try {
      await FOS.barcodeScanner._startZXingOnVideo(videoEl, finish);
    } catch {
      const stream = FOS.barcodeScanner._active?.stream;
      stream?.getTracks?.().forEach((t) => t.stop());
      videoEl.srcObject = null;
      await FOS.barcodeScanner._startLiveZXingDevice(videoEl, finish);
    }
  },

  async scan() {
    if (!FOS.barcodeScanner.canUseLiveCamera()) {
      throw new Error(
        FOS.i18n.t(
          'この端末ではカメラスキャンに対応していません',
          '当前设备不支持摄像头扫码'
        )
      );
    }

    await FOS.barcodeScanner._stop();

    return new Promise((resolve, reject) => {
      const overlay = document.createElement('div');
      overlay.className = 'barcode-scanner-overlay barcode-scanner-overlay--live';
      overlay.innerHTML = `
        <div class="barcode-scanner-panel barcode-scanner-panel--live">
          <div class="barcode-scanner-panel__head">${FOS.i18n.t('バーコードをスキャン', '扫描商品条码')}</div>
          <div class="barcode-scanner-panel__viewport">
            <video id="fosBarcodeVideo" playsinline muted autoplay></video>
            <div class="barcode-scanner-panel__frame" aria-hidden="true"></div>
          </div>
          <p class="barcode-scanner-panel__hint">${FOS.i18n.t('バーコードを枠内に合わせてください', '将条码对准框内，自动识别')}</p>
          <p class="barcode-scanner-panel__hint barcode-scanner-panel__subhint">
            ${FOS.i18n.t('認識できない場合は手入力も可能です', '识别失败可手动输入条码')}
          </p>
          <button type="button" class="btn btn--ghost btn--block" id="fosBarcodeCancel">
            ${FOS.i18n.t('キャンセル', '取消')}
          </button>
        </div>`;
      document.body.appendChild(overlay);

      let settled = false;

      const finish = async (code, isCancel) => {
        if (settled) return;
        settled = true;
        await FOS.barcodeScanner._stop();
        if (isCancel) reject(new Error('cancelled'));
        else resolve(FOS.barcodeScanner._normalizeResult(code));
      };

      const video = overlay.querySelector('#fosBarcodeVideo');
      FOS.barcodeScanner._active = { overlay, zxingReader: null, stream: null, videoEl: video, rafId: null };

      overlay.querySelector('#fosBarcodeCancel')?.addEventListener('click', () => finish(null, true));

      FOS.barcodeScanner._startLiveScan(video, finish).catch(async (e) => {
        if (settled) return;
        settled = true;
        await FOS.barcodeScanner._stop();
        reject(e);
      });
    });
  },
};
