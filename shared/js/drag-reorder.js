/**
 * factory-system-v2 · 长按拖动排序（触摸 / 鼠标）
 * mode: 'swap'  — 越过中线逐步换位（管理端分类/商品）
 * mode: 'float' — 卡片跟手浮动、占位虚线框（配送端）
 */
window.FOS = window.FOS || {};

FOS.dragReorder = {
  bind(container, options) {
    if (!container) return () => {};

    const {
      itemSelector,
      onReorder,
      canDrop = () => true,
      canStart,
      getMoveGroup = (el) => [el],
      getAnchorGroup,
      longPressMs = 500,
      getLongPressMs,
      moveThreshold = 12,
      swapThreshold = 0.42,
      mode = 'swap',
    } = options;

    let session = null;

    const getItems = () => [...container.querySelectorAll(itemSelector)];

    const clearFloatStyles = (item) => {
      if (!item) return;
      item.classList.remove('drag-reorder__item--dragging', 'drag-reorder__item--floating');
      item.style.position = '';
      item.style.left = '';
      item.style.top = '';
      item.style.width = '';
      item.style.margin = '';
      item.style.zIndex = '';
      item.style.pointerEvents = '';
      item.style.transition = '';
      item.style.transform = '';
    };

    const anchorGroupFor = (el) => {
      const fn = getAnchorGroup || getMoveGroup;
      const group = fn(el).filter((node) => node && container.contains(node));
      return group.length ? group : [el];
    };

    const finishSession = () => {
      if (!session) return;
      clearTimeout(session.timer);
      if (session.placeholder?.parentNode) session.placeholder.remove();
      if (session.group?.length) {
        session.group.forEach(clearFloatStyles);
      } else {
        clearFloatStyles(session.item);
      }
      session.item?.classList.remove('drag-reorder__item--dragging');
      container.querySelectorAll('.drag-reorder__item--over').forEach((el) => {
        el.classList.remove('drag-reorder__item--over');
      });
      container.classList.remove('drag-reorder__container--active');
      document.documentElement.classList.remove('fos-drag-active');
      session = null;
    };

    const groupFor = (el) => {
      const group = getMoveGroup(el).filter((node) => node && container.contains(node));
      return group.length ? group : [el];
    };

    const groupBounds = (items, group) => {
      const indices = group.map((node) => items.indexOf(node)).filter((i) => i >= 0);
      if (!indices.length) return { start: 0, end: 0 };
      return { start: Math.min(...indices), end: Math.max(...indices) };
    };

    const reorderDom = (items) => {
      items.forEach((el) => container.appendChild(el));
    };

    const clearOverState = () => {
      container.querySelectorAll('.drag-reorder__item--over').forEach((el) => {
        el.classList.remove('drag-reorder__item--over');
      });
    };

    const markNeighbor = (items, start, end, direction) => {
      clearOverState();
      const targetIdx = direction < 0 ? start - 1 : end + 1;
      const target = items[targetIdx];
      if (target && canDrop(groupFor(session.item)[0], target)) {
        target.classList.add('drag-reorder__item--over');
      }
    };

    const moveGroup = (items, group, direction) => {
      const { start, end } = groupBounds(items, group);
      const targetIdx = direction < 0 ? start - 1 : end + 1;
      if (targetIdx < 0 || targetIdx >= items.length) return false;

      const anchor = items[targetIdx];
      if (!canDrop(group[0], anchor)) return false;

      const without = items.filter((node) => !group.includes(node));
      const anchorGroup = anchorGroupFor(anchor);
      let insertAt;
      if (direction < 0) {
        insertAt = without.indexOf(anchorGroup[0]);
      } else {
        const lastAnchor = anchorGroup[anchorGroup.length - 1];
        insertAt = without.indexOf(lastAnchor) + 1;
      }
      if (insertAt < 0) return false;

      const rebuilt = [...without.slice(0, insertAt), ...group, ...without.slice(insertAt)];
      reorderDom(rebuilt);
      session.lastSwapAt = Date.now();
      return true;
    };

    const tryStepSwap = (clientY) => {
      if (!session?.dragging) return;
      autoScrollDrag(clientY);
      const now = Date.now();
      if (now - (session.lastSwapAt || 0) < 120) return;

      const items = getItems();
      const group = groupFor(session.item);
      const { start, end } = groupBounds(items, group);
      const topRect = group[0].getBoundingClientRect();
      const bottomRect = group[group.length - 1].getBoundingClientRect();
      const blockHeight = Math.max(bottomRect.bottom - topRect.top, 1);
      const midY = (topRect.top + bottomRect.bottom) / 2;
      const edge = blockHeight * swapThreshold;

      if (clientY < midY - edge) {
        if (moveGroup(items, group, -1)) markNeighbor(getItems(), start, end, -1);
      } else if (clientY > midY + edge) {
        if (moveGroup(items, group, 1)) markNeighbor(getItems(), start, end, 1);
      } else {
        clearOverState();
      }
    };

    const floatProbeY = () => {
      const item = session?.item;
      if (!item) return 0;
      const rect = item.getBoundingClientRect();
      return rect.top + rect.height / 2;
    };

    const floatAnchors = () => [...container.querySelectorAll(itemSelector)]
      .filter((node) => !node.classList.contains('drag-reorder__item--floating'))
      .sort((a, b) => {
        if (a === b) return 0;
        const pos = a.compareDocumentPosition(b);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });

    const floatTargetIndex = (probeY) => {
      const anchors = floatAnchors();
      for (let i = 0; i < anchors.length; i++) {
        const rect = anchors[i].getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (probeY < mid) return i;
      }
      return anchors.length;
    };

    const insertNodeSafely = (parent, node, before) => {
      try {
        if (before && before.parentNode === parent) {
          parent.insertBefore(node, before);
        } else {
          parent.appendChild(node);
        }
        return true;
      } catch (err) {
        console.warn('[drag-reorder] insert failed', err);
        try {
          parent.appendChild(node);
          return true;
        } catch {
          return false;
        }
      }
    };

    const repositionPlaceholder = () => {
      if (!session?.placeholder) return;
      const ph = session.placeholder;
      if (!ph.isConnected || ph.parentNode !== container) return;

      const targetIndex = floatTargetIndex(floatProbeY());
      if (session.floatTargetIndex === targetIndex) return;
      session.floatTargetIndex = targetIndex;

      const anchors = floatAnchors();
      const before = anchors[targetIndex] || null;
      if (before) {
        if (ph.nextSibling !== before) insertNodeSafely(container, ph, before);
        return;
      }

      const floatTail = container.querySelector(`${itemSelector}.drag-reorder__item--floating`);
      if (floatTail?.parentNode === container) {
        if (ph.nextSibling !== floatTail) insertNodeSafely(container, ph, floatTail);
      } else if (ph !== container.lastElementChild) {
        insertNodeSafely(container, ph, null);
      }
    };

    const autoScrollDrag = (clientY) => {
      const margin = 72;
      const maxStep = 16;
      const scrollers = [];

      let node = container;
      while (node && node !== document.documentElement) {
        const style = getComputedStyle(node);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
          scrollers.push(node);
        }
        node = node.parentElement;
      }
      if (document.scrollingElement) scrollers.push(document.scrollingElement);

      scrollers.forEach((el) => {
        const rect = el === document.scrollingElement
          ? { top: 0, bottom: window.innerHeight }
          : el.getBoundingClientRect();
        if (clientY > rect.bottom - margin) el.scrollTop += maxStep;
        else if (clientY < rect.top + margin) el.scrollTop -= maxStep;
      });
    };

    const beginFloatDrag = (item, e) => {
      if (!container.contains(item)) {
        finishSession();
        return;
      }

      const rect = item.getBoundingClientRect();
      const placeholder = document.createElement('div');
      placeholder.className = 'drag-reorder__placeholder';
      placeholder.style.height = `${rect.height}px`;

      if (item.parentNode === container) {
        insertNodeSafely(container, placeholder, item);
      } else {
        insertNodeSafely(container, placeholder, null);
      }

      session.placeholder = placeholder;
      session.floatTargetIndex = null;
      session.pointerOffsetY = e.clientY - rect.top;
      session.originTop = rect.top;
      session.originLeft = rect.left;
      session.itemWidth = rect.width;

      item.classList.add('drag-reorder__item--dragging', 'drag-reorder__item--floating');
      if (item.parentNode === container) {
        container.appendChild(item);
      }
      Object.assign(item.style, {
        position: 'fixed',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        margin: '0',
        zIndex: '1200',
        pointerEvents: 'none',
      });
    };

    const moveFloatDrag = (clientY) => {
      if (!session?.item) return;
      session.item.style.top = `${clientY - session.pointerOffsetY}px`;
      autoScrollDrag(clientY);
      repositionPlaceholder();
    };

    const endFloatDrag = (ev) => {
      const { item, placeholder } = session;
      if (!item) {
        finishSession();
        return;
      }

      ev.preventDefault();
      ev.stopPropagation();

      const settleItem = () => {
        try {
          if (placeholder?.parentNode === container) {
            container.replaceChild(item, placeholder);
          } else {
            placeholder?.remove?.();
            if (!container.contains(item)) container.appendChild(item);
          }
        } catch (err) {
          placeholder?.remove?.();
          if (!container.contains(item)) {
            try { container.appendChild(item); } catch { /* ignore */ }
          }
          console.warn('[drag-reorder] settle failed', err);
        }
        clearFloatStyles(item);
        const finalItems = getItems();
        onReorder?.(finalItems, { item });
        finishSession();
        item.dataset.dragJustDone = '1';
        setTimeout(() => delete item.dataset.dragJustDone, 400);
      };

      if (!placeholder?.parentNode) {
        settleItem();
        return;
      }

      const targetTop = placeholder.getBoundingClientRect().top;
      item.style.transition = 'top 0.16s ease, opacity 0.16s ease, transform 0.16s ease';
      item.style.top = `${targetTop}px`;

      let done = false;
      const safeSettle = () => {
        if (done) return;
        done = true;
        item.removeEventListener('transitionend', onEnd);
        settleItem();
      };
      const onEnd = (te) => {
        if (te.propertyName === 'top') safeSettle();
      };
      item.addEventListener('transitionend', onEnd);
      setTimeout(safeSettle, 220);
    };

    const onPointerDown = (e) => {
      if (session) return;
      if (e.button != null && e.button !== 0) return;

      const item = e.target.closest(itemSelector);
      if (!item || !container.contains(item)) return;
      if (canStart && !canStart(item, e)) return;
      if (e.target.closest('button:not([data-cat-reorder]), a, input, label, select, textarea')) return;
      if (e.target.closest('.admin-product-card__del, .admin-product-card__toggle, [data-del], [data-toggle]')) {
        return;
      }

      const startX = e.clientX;
      const startY = e.clientY;
      const pressMs = getLongPressMs ? getLongPressMs(e) : longPressMs;

      session = {
        item,
        pointerId: e.pointerId,
        dragging: false,
        moved: false,
        timer: null,
        lastSwapAt: 0,
        placeholder: null,
      };

      session.timer = setTimeout(() => {
        if (!session || session.moved) return;
        session.dragging = true;
        container.classList.add('drag-reorder__container--active');
        document.documentElement.classList.add('fos-drag-active');
        navigator.vibrate?.(12);
        try {
          session.item.setPointerCapture?.(e.pointerId);
        } catch {
          /* ignore */
        }

        if (mode === 'float') {
          beginFloatDrag(session.item, e);
        } else {
          session.group = groupFor(session.item);
          session.group.forEach((node) => node.classList.add('drag-reorder__item--dragging'));
        }
      }, pressMs);

      const onMove = (ev) => {
        if (!session || ev.pointerId !== session.pointerId) return;
        if (!session.dragging) {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (Math.hypot(dx, dy) > moveThreshold) {
            session.moved = true;
            clearTimeout(session.timer);
          }
          return;
        }
        ev.preventDefault();
        if (mode === 'float') moveFloatDrag(ev.clientY);
        else tryStepSwap(ev.clientY);
      };

      const onUp = (ev) => {
        if (!session || ev.pointerId !== session.pointerId) return;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);

        const { item: dragItem, dragging } = session;
        clearTimeout(session.timer);

        if (dragging) {
          if (mode === 'float') {
            endFloatDrag(ev);
            return;
          }
          ev.preventDefault();
          ev.stopPropagation();
          const finalItems = getItems();
          onReorder?.(finalItems, { item: dragItem });
          finishSession();
          dragItem.dataset.dragJustDone = '1';
          setTimeout(() => delete dragItem.dataset.dragJustDone, 400);
          return;
        }

        finishSession();
      };

      document.addEventListener('pointermove', onMove, { passive: false });
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    };

    const onClickCapture = (e) => {
      const item = e.target.closest(itemSelector);
      if (item?.dataset.dragJustDone === '1') {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('click', onClickCapture, true);

    return () => {
      finishSession();
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('click', onClickCapture, true);
    };
  },

  handleHtml(ariaLabel, extraClass = '') {
    const label = ariaLabel || FOS.i18n?.t?.('順序変更', '调整顺序') || 'Reorder';
    const safe = FOS.fmt?.escapeHtml?.(label) || label;
    const cls = extraClass ? `drag-reorder__handle ${extraClass}` : 'drag-reorder__handle';
    return `<span class="${cls}" aria-label="${safe}"><span class="drag-reorder__handle-icon" aria-hidden="true"><span class="drag-reorder__handle-arrow drag-reorder__handle-arrow--up"></span><span class="drag-reorder__handle-grip"><i></i><i></i><i></i></span><span class="drag-reorder__handle-arrow drag-reorder__handle-arrow--down"></span></span></span>`;
  },
};
