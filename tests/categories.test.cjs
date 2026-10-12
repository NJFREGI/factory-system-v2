const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../shared/js/categories.js'), 'utf8');

function setup(saved = {}) {
  const data = JSON.parse(JSON.stringify(saved));
  const FOS = { storage: {
    get: key => data[key] === undefined ? null : JSON.parse(JSON.stringify(data[key])),
    set: (key, value) => { data[key] = JSON.parse(JSON.stringify(value)); },
  } };
  vm.runInNewContext(source, { window: { FOS }, FOS });
  return { cats: FOS.categories, data };
}

test('deleting the last category stays empty after reloading storage', () => {
  const { cats, data } = setup({ category_tree_default: [{ id: 'one', name: 'Empty', children: [] }] });
  cats.deleteParent('Empty');
  assert.equal(cats.getTree([]).length, 0);
  assert.equal(setup(data).cats.getTree([]).length, 0);
});

test('empty legacy category list remains empty; first use still gets defaults', () => {
  assert.equal(setup({ categories: [] }).cats.getTree([]).length, 0);
  const { cats } = setup();
  assert.equal(cats.getTree([]).length, cats.DEFAULTS.length);
});

test('empty child and parent deletions persist while other categories remain', () => {
  const { cats, data } = setup({ category_tree_default: [
    { id: 'one', name: 'A', children: [{ id: 'child', name: 'B' }] },
    { id: 'two', name: 'C', children: [] },
  ] });
  cats.deleteChild('A', 'B');
  assert.equal(cats.getTree([])[0].children.length, 0);
  cats.deleteParent('A');
  assert.equal(setup(data).cats.getTree([]).map(n => n.name).join(','), 'C');
});

test('product-derived categories appear immediately with stable stored IDs', () => {
  const { cats } = setup({ category_tree_default: [] });
  const products = [{ category: 'A / B', active: false }];
  const first = cats.getTree(products);
  assert.equal(first.length, 1);
  assert.equal(first[0].children[0].name, 'B');
  const again = cats.getTree(products);
  assert.equal(first[0].id, again[0].id);
  assert.equal(first[0].children[0].id, again[0].children[0].id);
});
