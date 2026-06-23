/**
 * factory-system-v2 · 商品分类（支持二级）
 * 商品 category 字段：一级 或 「一级 / 二级」
 */
window.FOS = window.FOS || {};

FOS.categories = {
  DEFAULTS: ['肉類', '鶏肉', '魚類', '野菜', '調味料', '乳製品', '加工品', 'その他'],
  SEP: ' / ',

  _storageKey() {
    const mid = FOS.merchants?.scopeId?.() || FOS.CONFIG?.DEFAULT_MERCHANT_ID || 'default';
    return `category_tree_${mid}`;
  },

  _genId() {
    return 'cat_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  },

  _normalizeTree(tree) {
    if (!Array.isArray(tree)) return [];
    const seenParentIds = new Set();
    const seenParentNames = new Set();
    return tree
      .map((node) => ({
        id: node.id || FOS.categories._genId(),
        name: String(node.name || '').trim(),
        children: (node.children || [])
          .map((ch) => ({
            id: ch.id || FOS.categories._genId(),
            name: String(ch.name || '').trim(),
          }))
          .filter((ch) => ch.name),
      }))
      .filter((n) => n.name)
      .filter((n) => {
        if (seenParentIds.has(n.id) || seenParentNames.has(n.name)) return false;
        seenParentIds.add(n.id);
        seenParentNames.add(n.name);
        return true;
      })
      .map((node) => {
        const seenChildIds = new Set();
        const seenChildNames = new Set();
        node.children = node.children.filter((ch) => {
          if (seenChildIds.has(ch.id) || seenChildNames.has(ch.name)) return false;
          seenChildIds.add(ch.id);
          seenChildNames.add(ch.name);
          return true;
        });
        return node;
      });
  },

  _migrateFlat(flat) {
    return (flat || [])
      .map((name) => String(name || '').trim())
      .filter(Boolean)
      .map((name) => ({ id: FOS.categories._genId(), name, children: [] }));
  },

  getTree(fromProducts) {
    let tree = FOS.storage.get(FOS.categories._storageKey());
    if (!tree?.length) {
      const legacy = FOS.storage.get('categories');
      const flat = legacy?.length ? legacy : FOS.categories.DEFAULTS;
      tree = FOS.categories._migrateFlat(flat);
      FOS.categories.setTree(tree);
    }
    const raw = JSON.stringify(tree);
    tree = FOS.categories._normalizeTree(tree);
    if (JSON.stringify(tree) !== raw) FOS.categories.setTree(tree);
    FOS.categories.mergeFromProducts(tree, fromProducts);
    return tree;
  },

  setTree(tree) {
    const normalized = FOS.categories._normalizeTree(tree);
    FOS.storage.set(FOS.categories._storageKey(), normalized);
    return normalized;
  },

  mergeFromProducts(tree, products) {
    const list = FOS.categories._normalizeTree(tree);
    let changed = false;
    (products || []).forEach((p) => {
      const { l1, l2 } = FOS.categories.decode(p?.category);
      if (!l1 || l1 === '未分類') return;
      let parent = list.find((n) => n.name === l1);
      if (!parent) {
        parent = { id: FOS.categories._genId(), name: l1, children: [] };
        list.push(parent);
        changed = true;
      }
      if (l2 && !parent.children.some((c) => c.name === l2)) {
        parent.children.push({ id: FOS.categories._genId(), name: l2 });
        changed = true;
      }
    });
    if (changed) FOS.categories.setTree(list);
    return list;
  },

  /** @deprecated 兼容旧调用 */
  get(fromProducts) {
    return FOS.categories.getTree(fromProducts).map((n) => n.name);
  },

  /** @deprecated */
  set(cats) {
    return FOS.categories.setTree(FOS.categories._migrateFlat(cats));
  },

  /** @deprecated */
  mergeFromProductsLegacy(products) {
    return FOS.categories.mergeFromProducts(FOS.categories.getTree(products), products);
  },

  decode(category) {
    const raw = String(category || '').trim();
    if (!raw) return { l1: '未分類', l2: '' };
    const parts = raw.split(FOS.categories.SEP).map((s) => s.trim()).filter(Boolean);
    return { l1: parts[0] || '未分類', l2: parts[1] || '' };
  },

  encode(l1, l2) {
    const p = String(l1 || '').trim() || '未分類';
    const c = String(l2 || '').trim();
    return c ? `${p}${FOS.categories.SEP}${c}` : p;
  },

  label(category) {
    const { l1, l2 } = FOS.categories.decode(category);
    return l2 ? `${l1}${FOS.categories.SEP}${l2}` : l1;
  },

  matches(productCategory, filterL1, filterL2) {
    if (!filterL1) return true;
    const { l1, l2 } = FOS.categories.decode(productCategory);
    if (l1 !== filterL1) return false;
    if (!filterL2) return true;
    return l2 === filterL2;
  },

  addParent(name) {
    const n = String(name || '').trim();
    if (!n) return FOS.categories.getTree();
    const tree = FOS.categories.getTree();
    if (!tree.some((t) => t.name === n)) {
      tree.push({ id: FOS.categories._genId(), name: n, children: [] });
      FOS.categories.setTree(tree);
    }
    return tree;
  },

  addChild(parentName, childName) {
    const p = String(parentName || '').trim();
    const c = String(childName || '').trim();
    if (!p || !c) return FOS.categories.getTree();
    const tree = FOS.categories.getTree();
    let parent = tree.find((n) => n.name === p);
    if (!parent) {
      parent = { id: FOS.categories._genId(), name: p, children: [] };
      tree.push(parent);
    }
    if (!parent.children.some((ch) => ch.name === c)) {
      parent.children.push({ id: FOS.categories._genId(), name: c });
    }
    return FOS.categories.setTree(tree);
  },

  updateParent(oldName, newName) {
    const next = String(newName || '').trim();
    if (!next) return FOS.categories.getTree();
    const tree = FOS.categories.getTree();
    const node = tree.find((n) => n.name === oldName);
    if (node) node.name = next;
    return FOS.categories.setTree(tree);
  },

  updateChild(parentName, oldChild, newChild) {
    const next = String(newChild || '').trim();
    if (!next) return FOS.categories.getTree();
    const tree = FOS.categories.getTree();
    const parent = tree.find((n) => n.name === parentName);
    const child = parent?.children?.find((c) => c.name === oldChild);
    if (child) child.name = next;
    return FOS.categories.setTree(tree);
  },

  deleteParent(name) {
    const tree = FOS.categories.getTree().filter((n) => n.name !== name);
    return FOS.categories.setTree(tree);
  },

  deleteChild(parentName, childName) {
    const tree = FOS.categories.getTree();
    const parent = tree.find((n) => n.name === parentName);
    if (parent) parent.children = parent.children.filter((c) => c.name !== childName);
    return FOS.categories.setTree(tree);
  },

  _dedupeIds(ids) {
    const seen = new Set();
    return ids.filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  },

  reorderParents(orderedParentIds) {
    const tree = FOS.categories._normalizeTree(FOS.categories.getTree());
    const map = Object.fromEntries(tree.map((n) => [n.id, n]));
    const next = FOS.categories._dedupeIds(orderedParentIds).map((id) => map[id]).filter(Boolean);
    tree.forEach((n) => {
      if (!next.some((x) => x.id === n.id)) next.push(n);
    });
    return FOS.categories.setTree(next);
  },

  reorderChildren(parentId, orderedChildIds) {
    const tree = FOS.categories._normalizeTree(FOS.categories.getTree());
    const parent = tree.find((n) => n.id === parentId);
    if (!parent) return tree;
    const map = Object.fromEntries(parent.children.map((c) => [c.id, c]));
    const next = FOS.categories._dedupeIds(orderedChildIds).map((id) => map[id]).filter(Boolean);
    parent.children.forEach((c) => {
      if (!next.some((x) => x.id === c.id)) next.push(c);
    });
    parent.children = next;
    return FOS.categories.setTree(tree);
  },
};
