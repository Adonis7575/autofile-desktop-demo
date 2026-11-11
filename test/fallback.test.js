const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { makeHome } = require('./helpers');
const { createContext } = require('../src/core/context');
const { fallbackPropose } = require('../src/core/fallback');

const it = (name, kind = 'file') => ({ id: 'x', src: `C:\\dl\\${name}`, kind, name, ext: path.extname(name).toLowerCase() });

test('installers go to the installer drive when it is plugged in', (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const ctx = createContext({ home: h.home, eRoot: h.eRoot, dataDir: h.dataDir });
  const p = fallbackPropose(ctx, it('setup_tool.exe'), '');
  assert.equal(p.destDir, ctx.installersDir);
  assert.equal(p.source, 'fallback');
});

test('installers ask when the installer drive is missing', (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const ctx = createContext({ home: h.home, eRoot: path.join(h.root, 'gone'), dataDir: h.dataDir });
  const p = fallbackPropose(ctx, it('setup_tool.exe'), '');
  assert.equal(p.destDir, null);
  assert.match(p.question.text, /installer drive/);
});

test('a course number routes to that course folder', (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const ctx = createContext({ home: h.home, eRoot: h.eRoot, dataDir: h.dataDir });
  const p = fallbackPropose(ctx, it('notes for CSCI 4425.txt'), '');
  assert.equal(p.destDir, path.join(ctx.creations, '03 School', 'CSCI 4425 Deep Learning'));
  const q = fallbackPropose(ctx, it('slides.pdf'), 'CSCI 4425/5425 Introduction to Deep Learning');
  assert.equal(q.destDir, p.destDir);
});

test('a resume goes to Career and an existing project name to that project', (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const ctx = createContext({ home: h.home, eRoot: h.eRoot, dataDir: h.dataDir });
  assert.equal(fallbackPropose(ctx, it('Sample Resume.docx'), '').destDir, path.join(ctx.creations, '04 Career'));
  assert.equal(fallbackPropose(ctx, it('autofile notes.md'), '').destDir, path.join(ctx.creations, '01 Projects', 'Autofile'));
});

test('an unknown file becomes a question with five choices', (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const ctx = createContext({ home: h.home, eRoot: h.eRoot, dataDir: h.dataDir });
  const p = fallbackPropose(ctx, it('random.bin'), '');
  assert.equal(p.destDir, null);
  assert.equal(p.confidence, 0);
  assert.equal(p.question.options.length, 5);
});
