const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { makeHome } = require('./helpers');
const { expandDrops } = require('../src/core/scan');
const { createContext } = require('../src/core/context');

test('a loose file becomes one file item', async (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const p = h.write('Downloads\\lecture.pdf', 'pdf bytes');
  const items = await expandDrops([p]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'file');
  assert.equal(items[0].ext, '.pdf');
  assert.equal(items[0].name, 'lecture.pdf');
  assert.equal(items[0].size, 9);
});

test('a folder with package.json is one project item', async (t) => {
  const h = makeHome(); t.after(h.cleanup);
  h.write('Downloads\\my-app\\package.json', '{"name":"my-app"}');
  h.write('Downloads\\my-app\\index.js', '');
  const items = await expandDrops([path.join(h.home, 'Downloads', 'my-app')]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'project');
  assert.equal(items[0].ext, '');
});

test('a plain folder expands to its files, skipping desktop.ini', async (t) => {
  const h = makeHome(); t.after(h.cleanup);
  h.write('Downloads\\stuff\\a.txt', 'a');
  h.write('Downloads\\stuff\\sub\\b.md', 'b');
  h.write('Downloads\\stuff\\desktop.ini', 'x');
  const items = await expandDrops([path.join(h.home, 'Downloads', 'stuff')]);
  assert.deepEqual(items.map((i) => i.name).sort(), ['a.txt', 'b.md']);
});

test('an unreadable folder inside a drop does not sink the rest', async (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const good = h.write('Downloads\\stuff\\good.txt', 'g');
  require('node:fs').symlinkSync(path.join(h.root, 'does-not-exist'), path.join(h.home, 'Downloads', 'stuff', 'broken'), 'junction');
  const items = await expandDrops([path.dirname(good)]);
  assert.ok(items.some((i) => i.name === 'good.txt'));
});

test('dropping the same path twice yields one item', async (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const p = h.write('Downloads\\x.txt', 'x');
  const items = await expandDrops([p, p]);
  assert.equal(items.length, 1);
});

test('createContext derives Creations, undo dir and E: mount state', (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const ctx = createContext({ home: h.home, eRoot: h.eRoot, dataDir: h.dataDir, today: '2026-10-19' });
  assert.equal(ctx.creations, path.join(h.home, 'Creations'));
  assert.equal(ctx.undoDir, path.join(h.home, 'Creations', '_Undo', '2026-10-19 Autofile'));
  assert.equal(ctx.eMounted, true);
  const ctx2 = createContext({ home: h.home, eRoot: path.join(h.root, 'nope'), dataDir: h.dataDir });
  assert.equal(ctx2.eMounted, false);
  assert.match(ctx2.today, /^\d{4}-\d{2}-\d{2}$/);
});
