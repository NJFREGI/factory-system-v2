window.FOS = window.FOS || {};

FOS.calendar = {
  _overlay: null,
  _state: null,

  open({ title, activeDates = [], selected, onSelect, onlyActiveDates = true, allowClear = false } = {}) {
    const active = new Set((activeDates || []).filter(Boolean));
    const list = [...active].sort();
    let sel = selected;
    if (sel === undefined || sel === null || sel === '') {
      sel = allowClear ? null : (list[list.length - 1] || FOS.fmt.today());
    } else if (onlyActiveDates && active.size && !active.has(sel)) {
      sel = list[list.length - 1] || FOS.fmt.today();
    }
    const base = sel || FOS.fmt.today();
    const [y, m] = base.split('-').map(Number);

    FOS.calendar.close();
    const overlay = document.createElement('div');
    overlay.className = 'cal-overlay';
    overlay.id = 'fosCalOverlay';
    document.body.appendChild(overlay);
    FOS.calendar._overlay = overlay;
    FOS.calendar._state = {
      year: y,
      month: m,
      active,
      pendingSelected: sel,
      onlyActiveDates,
      allowClear,
      onSelect,
      title: title || '',
    };

    FOS.calendar._paint();
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) FOS.calendar.close();
    });
    document.addEventListener('keydown', FOS.calendar._onKey);
  },

  close() {
    document.removeEventListener('keydown', FOS.calendar._onKey);
    FOS.calendar._overlay?.remove();
    FOS.calendar._overlay = null;
    FOS.calendar._state = null;
  },

  isOpen() {
    return !!FOS.calendar._overlay;
  },

  refresh({ activeDates, selected } = {}) {
    if (!FOS.calendar._state) return;
    if (activeDates) FOS.calendar._state.active = new Set((activeDates || []).filter(Boolean));
    if (selected !== undefined) {
      FOS.calendar._state.pendingSelected = selected;
      const [y, m] = selected.split('-').map(Number);
      if (y && m) {
        FOS.calendar._state.year = y;
        FOS.calendar._state.month = m;
      }
    }
    FOS.calendar._paint();
  },

  _onKey(e) {
    if (e.key === 'Escape') FOS.calendar.close();
  },

  _pad(n) {
    return String(n).padStart(2, '0');
  },

  _dateStr(y, m, d) {
    return `${y}-${FOS.calendar._pad(m)}-${FOS.calendar._pad(d)}`;
  },

  _yearOptions(active, currentYear) {
    const orderYears = [];
    const list = active instanceof Set ? [...active] : (active || []);
    list.forEach((d) => {
      const y = Number(String(d).slice(0, 4));
      if (y) orderYears.push(y);
    });
    const now = new Date().getFullYear();
    const view = currentYear || now;
    const baseMin = orderYears.length ? Math.min(...orderYears) : now;
    const baseMax = orderYears.length ? Math.max(...orderYears) : now;
    const min = Math.min(baseMin, now, view) - 3;
    const max = Math.max(baseMax, now, view) + 1;
    const years = [];
    for (let y = min; y <= max; y++) years.push(y);
    return years;
  },

  _weekdays() {
    return FOS.i18n.lang === 'zh'
      ? ['日', '一', '二', '三', '四', '五', '六']
      : ['日', '月', '火', '水', '木', '金', '土'];
  },

  _weekdayLabel(dow) {
    const zh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const ja = ['日曜', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜'];
    return (FOS.i18n.lang === 'zh' ? zh : ja)[dow] || '';
  },

  _pickedLabel(dateStr) {
    if (!dateStr) return FOS.i18n.t('全日付', '全部日期');
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const wk = FOS.calendar._weekdayLabel(dt.getDay());
    return FOS.i18n.lang === 'zh' ? `${m}月${d}日 ${wk}` : `${m}月${d}日 ${wk}`;
  },

  _monthBarLabel(y, m) {
    return FOS.i18n.lang === 'zh' ? `${y}年${m}月` : `${y}年 ${m}月`;
  },

  _dayEnabled(s, dateStr) {
    return !s.onlyActiveDates || s.active.has(dateStr);
  },

  _paint() {
    const s = FOS.calendar._state;
    const overlay = FOS.calendar._overlay;
    if (!s || !overlay) return;

    const firstDow = new Date(s.year, s.month - 1, 1).getDay();
    const daysInMonth = new Date(s.year, s.month, 0).getDate();
    const cells = [];

    for (let i = 0; i < firstDow; i++) {
      cells.push('<span class="cal-day cal-day--blank"></span>');
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = FOS.calendar._dateStr(s.year, s.month, d);
      const enabled = FOS.calendar._dayEnabled(s, dateStr);
      const isSel = s.pendingSelected === dateStr;
      const cls = [
        'cal-day',
        enabled ? 'cal-day--active' : 'cal-day--disabled',
        isSel ? 'cal-day--selected' : '',
      ].filter(Boolean).join(' ');
      if (enabled) {
        cells.push(`<button type="button" class="${cls}" data-cal-date="${dateStr}">${d}</button>`);
      } else {
        cells.push(`<span class="${cls}" aria-disabled="true">${d}</span>`);
      }
    }

    const picked = s.pendingSelected || '';
    const years = FOS.calendar._yearOptions(s.active, s.year);
    const yearOpts = years.map((y) => (
      `<option value="${y}" ${y === s.year ? 'selected' : ''}>${y}${FOS.i18n.t('年', '年')}</option>`
    )).join('');

    overlay.innerHTML = `
      <div class="cal-sheet" role="dialog" aria-modal="true">
        <div class="cal-sheet__hero">
          <label class="cal-sheet__year-wrap">
            <select class="cal-sheet__year-select" data-cal-year aria-label="${FOS.i18n.t('年を選択', '选择年份')}">${yearOpts}</select>
          </label>
          <div class="cal-sheet__picked">${FOS.calendar._pickedLabel(picked)}</div>
        </div>
        <div class="cal-sheet__body">
          <div class="cal-month-bar">
            <button type="button" class="cal-month-bar__nav" data-cal-prev aria-label="${FOS.i18n.t('前月', '上月')}">‹</button>
            <div class="cal-month-bar__label">${FOS.calendar._monthBarLabel(s.year, s.month)}</div>
            <button type="button" class="cal-month-bar__nav" data-cal-next aria-label="${FOS.i18n.t('翌月', '下月')}">›</button>
          </div>
          <div class="cal-weekdays">
            ${FOS.calendar._weekdays().map((w) => `<span class="cal-weekdays__cell">${w}</span>`).join('')}
          </div>
          <div class="cal-grid">${cells.join('')}</div>
        </div>
        <div class="cal-sheet__footer">
          <button type="button" class="cal-sheet__link" data-cal-clear>${FOS.i18n.t('クリア', '清除')}</button>
          <div class="cal-sheet__actions">
            <button type="button" class="cal-sheet__link" data-cal-cancel>${FOS.i18n.t('キャンセル', '取消')}</button>
            <button type="button" class="cal-sheet__link cal-sheet__link--primary" data-cal-confirm>${FOS.i18n.t('設定', '设置')}</button>
          </div>
        </div>
      </div>`;

    overlay.querySelector('[data-cal-year]')?.addEventListener('change', (e) => {
      s.year = parseInt(e.target.value, 10) || s.year;
      FOS.calendar._paint();
    });
    overlay.querySelector('[data-cal-cancel]')?.addEventListener('click', () => FOS.calendar.close());
    overlay.querySelector('[data-cal-clear]')?.addEventListener('click', () => {
      s.pendingSelected = null;
      FOS.calendar._paint();
    });
    overlay.querySelector('[data-cal-confirm]')?.addEventListener('click', () => {
      const date = s.pendingSelected;
      if (!date && !s.allowClear) { FOS.calendar.close(); return; }
      if (date && s.onlyActiveDates && !s.active.has(date)) return;
      if (typeof s.onSelect === 'function') s.onSelect(date || '');
      FOS.calendar.close();
    });
    overlay.querySelector('[data-cal-prev]')?.addEventListener('click', () => {
      if (s.month === 1) { s.year -= 1; s.month = 12; } else s.month -= 1;
      FOS.calendar._paint();
    });
    overlay.querySelector('[data-cal-next]')?.addEventListener('click', () => {
      if (s.month === 12) { s.year += 1; s.month = 1; } else s.month += 1;
      FOS.calendar._paint();
    });
    overlay.querySelectorAll('[data-cal-date]').forEach((btn) => {
      btn.addEventListener('click', () => {
        s.pendingSelected = btn.dataset.calDate;
        FOS.calendar._paint();
      });
    });
  },
};
