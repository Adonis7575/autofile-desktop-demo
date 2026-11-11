const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { makeHome } = require('./helpers');
const { createContext } = require('../src/core/context');
const { checkDestination, safeProjectName } = require('../src/core/approval');

function ctxFor(t) {
  const h = makeHome(); t.after(h.cleanup);
  return createContext({ home: h.home, eRoot: h.eRoot, dataDir: h.dataDir });
}

test('a folder the user picked is accepted even outside the usual filing system', (t) => {
  const ctx = ctxFor(t);
  const picked = path.join(ctx.home, 'Documents', 'Taxes');
  assert.equal(checkDestination(ctx, picked, { userChose: true }), null);
});

test('a suggested folder outside the filing system is refused', (t) => {
  const ctx = ctxFor(t);
  assert.match(checkDestination(ctx, 'D:\\Stuff', { userChose: false }), /Pick a folder/);
});

test('the undo log folder is refused even when picked by hand', (t) => {
  const ctx = ctxFor(t);
  assert.match(checkDestination(ctx, path.join(ctx.creations, '_Undo', 'x'), { userChose: true }), /_Undo/);
});

test('a missing or relative folder is refused', (t) => {
  const ctx = ctxFor(t);
  assert.match(checkDestination(ctx, '', { userChose: true }), /Pick a folder/);
  assert.match(checkDestination(ctx, 'Creations\\06 Reference', { userChose: true }), /Pick a folder/);
});

test('a typed project name cannot climb out of its folder', () => {
  assert.equal(safeProjectName('..\\..\\Windows', 'Autofile'), 'Windows');
  assert.equal(safeProjectName('My/App', 'Autofile'), 'My App');
  assert.equal(safeProjectName('   ', 'Autofile'), 'Autofile');
  assert.equal(safeProjectName('..', 'Autofile'), 'Autofile');
  assert.equal(safeProjectName('Nexus v5', 'Autofile'), 'Nexus v5');
});
