window.FOS = window.FOS || {};

/** 月次請求書 · 商家开票信息 */
FOS.invoiceSettings = {
  empty() {
    return {
      companyName: '',
      zip: '',
      address: '',
      tel: '',
      fax: '',
      registrationNo: '',
      bankInfo: '',
    };
  },

  fromMerchant(merchant) {
    const m = merchant || {};
    return {
      companyName: (m.invoice_company_name || m.name || '').trim(),
      zip: (m.invoice_zip || '').trim(),
      address: (m.invoice_address || m.address || '').trim(),
      tel: (m.invoice_tel || m.phone || '').trim(),
      fax: (m.invoice_fax || '').trim(),
      registrationNo: (m.invoice_registration_no || '').trim(),
      bankInfo: (m.invoice_bank_info || '').trim(),
    };
  },

  toMerchantPatch(profile) {
    const p = profile || {};
    return {
      invoice_company_name: (p.companyName || '').trim() || null,
      invoice_zip: (p.zip || '').trim() || null,
      invoice_address: (p.address || '').trim() || null,
      invoice_tel: (p.tel || '').trim() || null,
      invoice_fax: (p.fax || '').trim() || null,
      invoice_registration_no: (p.registrationNo || '').trim() || null,
      invoice_bank_info: (p.bankInfo || '').trim() || null,
    };
  },

  isComplete(profile) {
    const p = profile || FOS.invoiceSettings.empty();
    return !!(p.companyName && p.address && p.bankInfo);
  },

  async load() {
    const mid = FOS.merchants.scopeId();
    try {
      const merchant = await FOS.merchants.getById(mid);
      return FOS.invoiceSettings.fromMerchant(merchant);
    } catch {
      return FOS.invoiceSettings.empty();
    }
  },

  async save(profile) {
    const mid = FOS.merchants.scopeId();
    const current = await FOS.merchants.getById(mid);
    const patch = FOS.invoiceSettings.toMerchantPatch(profile);
    try {
      await FOS.merchants.update(mid, { ...current, ...patch });
    } catch (e) {
      if (!/invoice_|column|schema cache|42703|PGRST204/i.test(e.message || '')) throw e;
      await FOS.db.sb.from('settings').upsert({
        key: `invoice_profile_${mid}`,
        value: JSON.stringify(profile),
        updated_at: new Date().toISOString(),
      });
    }
    delete FOS.merchants._cache[mid];
    return FOS.invoiceSettings.fromMerchant({ ...current, ...patch });
  },

  async loadFallbackFromSettings() {
    const mid = FOS.merchants.scopeId();
    try {
      const { data } = await FOS.db.sb
        .from('settings')
        .select('value')
        .eq('key', `invoice_profile_${mid}`)
        .maybeSingle();
      if (data?.value) {
        const parsed = JSON.parse(data.value);
        return { ...FOS.invoiceSettings.empty(), ...parsed };
      }
    } catch { /* ignore */ }
    return null;
  },
};
