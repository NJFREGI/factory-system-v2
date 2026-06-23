window.FOS = window.FOS || {};

FOS.media = {
  formatStorageError(error) {
    const msg = error?.message || error?.error || String(error || '');
    if (/bucket.*not found|Bucket not found|404/i.test(msg)) {
      return FOS.i18n.t(
        'Storage の products バケットがありません。Supabase で schema.sql の Storage 設定を実行してください',
        '未找到 Storage 的 products 存储桶，请在 Supabase 执行 schema.sql 中的 Storage 配置'
      );
    }
    if (/policy|row-level security|permission|JWT|403/i.test(msg)) {
      return FOS.i18n.t(
        '画像アップロード権限がありません。Supabase Storage ポリシーを設定してください',
        '没有图片上传权限，请配置 Supabase Storage 策略'
      );
    }
    return msg || FOS.i18n.t('アップロード失敗', '上传失败');
  },

  fileExt(file) {
    const fromName = (file.name.split('.').pop() || '').toLowerCase().replace('jpeg', 'jpg');
    if (fromName && fromName !== file.name.toLowerCase()) return fromName;
    const mime = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    return mime[file.type] || 'jpg';
  },

  async uploadProductImage(file) {
    if (!file) return null;
    if (!file.type.startsWith('image/')) {
      throw new Error(FOS.i18n.t('画像ファイルを選択してください', '请选择图片文件'));
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new Error(FOS.i18n.t('5MB以内', '请小于 5MB'));
    }
    const ext = FOS.media.fileExt(file);
    const name = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const contentType = file.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    const { error } = await FOS.db.sb.storage.from('products').upload(name, file, {
      cacheControl: '3600',
      upsert: true,
      contentType,
    });
    if (error) throw new Error(FOS.media.formatStorageError(error));
    const { data } = FOS.db.sb.storage.from('products').getPublicUrl(name);
    return data.publicUrl;
  },

  previewFile(file, imgEl) {
    if (!file || !imgEl) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      imgEl.src = e.target.result;
      imgEl.style.display = 'block';
    };
    reader.readAsDataURL(file);
  },
};
