const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { makeHome } = require('./helpers');
const { createContext } = require('../src/core/context');
const { applyMove, undoStep } = require('../src/core/mover');
const { resolveTarget } = require('../src/core/naming');

const HEADER = '"Step","Action","Path","Target","Backup","PrevAttributes","Time"';

function setup(t) {
  const h = makeHome(); t.after(h.cleanup);
  const ctx = createContext({ home: h.home, eRoot: h.eRoot, dataDir: h.dataDir, today: '2026-10-19' });
  return { h, ctx };
}
const prop = (src, destDir, newName, extra = {}) => ({ id: 'x', src, kind: 'file', destDir, newName, ...extra });

test('moving into a new folder logs MkDir and Move rows', async (t) => {
  const { h, ctx } = setup(t);
  const src = h.write('Downloads\\a.txt', 'a');
  const dest = path.join(ctx.creations, '03 School', 'CSCI 9999 New');
  const rows = await applyMove(ctx, prop(src, dest, 'A Notes.txt'));
  assert.equal(fs.existsSync(src), false);
  assert.equal(fs.readFileSync(path.join(dest, 'A Notes.txt'), 'utf8'), 'a');
  assert.deepEqual(rows.map((r) => r.Action), ['MkDir', 'Move']);
  const log = fs.readFileSync(path.join(ctx.undoDir, 'log.csv'), 'utf8').split(/\r?\n/);
  assert.equal(log[0].replace(/^﻿/, ''), HEADER);
  assert.equal(log.filter(Boolean).length, 3);
});

test('a name clash with different content gets a dated name, never an overwrite', async (t) => {
  const { h, ctx } = setup(t);
  const dest = path.join(ctx.creations, '06 Reference');
  await applyMove(ctx, prop(h.write('Downloads\\one\\Notes.md', '1'), dest, 'Notes.md'));
  await applyMove(ctx, prop(h.write('Downloads\\two\\Notes.md', '2'), dest, 'Notes.md'));
  await applyMove(ctx, prop(h.write('Downloads\\three\\Notes.md', '3'), dest, 'Notes.md'));
  assert.equal(fs.readFileSync(path.join(dest, 'Notes.md'), 'utf8'), '1');
  assert.equal(fs.readFileSync(path.join(dest, 'Notes - 2026-10-19.md'), 'utf8'), '2');
  assert.equal(fs.readFileSync(path.join(dest, 'Notes - 2026-10-19 - 2.md'), 'utf8'), '3');
});

test('resolveTarget spots an identical file already at the destination', async (t) => {
  const { h, ctx } = setup(t);
  const dest = path.join(ctx.creations, '06 Reference');
  h.write('Creations\\06 Reference\\Same.md', 'same');
  const src = h.write('Downloads\\Same.md', 'same');
  const r = await resolveTarget(dest, 'Same.md', src, ctx.today);
  assert.equal(r.identicalExisting, true);
});

test('an identical existing file sends the drop to the Duplicates archive', async (t) => {
  const { h, ctx } = setup(t);
  h.write('Creations\\06 Reference\\Same.md', 'same');
  const src = h.write('Downloads\\Same.md', 'same');
  await applyMove(ctx, prop(src, path.join(ctx.creations, '06 Reference'), 'Same.md'));
  assert.ok(fs.existsSync(path.join(ctx.creations, '_Archive', 'Duplicates', 'Same.md')));
});

test('a source that vanished is reported and nothing is logged', async (t) => {
  const { h, ctx } = setup(t);
  const src = h.write('Downloads\\gone.txt', 'x');
  fs.rmSync(src);
  await assert.rejects(applyMove(ctx, prop(src, path.join(ctx.creations, '06 Reference'), 'gone.txt')), /file no longer there/);
  assert.equal(fs.existsSync(path.join(ctx.undoDir, 'log.csv')), false);
});

test('undo puts a moved project folder back and removes folders it created', async (t) => {
  const { h, ctx } = setup(t);
  h.write('Downloads\\proj\\package.json', '{}');
  h.write('Downloads\\proj\\src\\a.js', 'a');
  const src = path.join(h.home, 'Downloads', 'proj');
  const dest = path.join(ctx.creations, '01 Projects', 'Group', 'Sub');
  const rows = await applyMove(ctx, prop(src, dest, 'Proj', { kind: 'project' }));
  assert.ok(fs.existsSync(path.join(dest, 'Proj', 'src', 'a.js')));
  await undoStep(ctx, rows);
  assert.ok(fs.existsSync(path.join(src, 'src', 'a.js')));
  assert.equal(fs.existsSync(path.join(ctx.creations, '01 Projects', 'Group')), false);
});

test('replacing a project archives the old copy first', async (t) => {
  const { h, ctx } = setup(t);
  const existing = path.dirname(h.write('Creations\\01 Projects\\Autofile\\old.txt', 'old'));
  h.write('Downloads\\autofile\\new.txt', 'new');
  const src = path.join(h.home, 'Downloads', 'autofile');
  await applyMove(ctx, prop(src, path.join(ctx.creations, '01 Projects'), 'Autofile', { kind: 'project', replaceExisting: existing }));
  assert.ok(fs.existsSync(path.join(ctx.creations, '01 Projects', 'Autofile', 'new.txt')));
  assert.ok(fs.existsSync(path.join(ctx.creations, '_Archive', 'Autofile old copies', 'Autofile - 2026-10-19', 'old.txt')));
});

test('two approvals at the same moment never overwrite each other', async (t) => {
  const { h, ctx } = setup(t);
  const dest = path.join(ctx.creations, '06 Reference');
  const a = h.write('Downloads\\one\\Notes.md', 'AAAA');
  const b = h.write('Downloads\\two\\Notes.md', 'BBBB');
  await Promise.all([applyMove(ctx, prop(a, dest, 'Notes.md')), applyMove(ctx, prop(b, dest, 'Notes.md'))]);
  const contents = fs.readdirSync(dest).map((n) => fs.readFileSync(path.join(dest, n), 'utf8')).sort();
  assert.deepEqual(contents, ['AAAA', 'BBBB']);
  const steps = fs.readFileSync(path.join(ctx.undoDir, 'log.csv'), 'utf8').split(/\r?\n/).filter(Boolean).slice(1).map((l) => l.split(',')[0]);
  assert.equal(new Set(steps).size, steps.length, 'step numbers are unique');
});

test('approving a file that is already where it belongs does not archive it', async (t) => {
  const { h, ctx } = setup(t);
  const dir = path.join(ctx.creations, '06 Reference');
  const src = h.write('Creations\\06 Reference\\Guide.md', 'only copy');
  await applyMove(ctx, prop(src, dir, 'Guide.md'));
  assert.equal(fs.readFileSync(src, 'utf8'), 'only copy');
  assert.equal(fs.existsSync(path.join(ctx.creations, '_Archive', 'Duplicates')), false);
});

test('a case-only rename keeps the file in place', async (t) => {
  const { h, ctx } = setup(t);
  const dir = path.join(ctx.creations, '06 Reference');
  const src = h.write('Creations\\06 Reference\\Slides.PDF', 'pdf');
  await applyMove(ctx, prop(src, dir, 'Slides.pdf'));
  assert.deepEqual(fs.readdirSync(dir), ['Slides.pdf']);
});

test('a project replacement that fails halfway can still be undone', async (t) => {
  const { h, ctx } = setup(t);
  const existing = path.dirname(h.write('Creations\\01 Projects\\Autofile\\old.txt', 'old'));
  h.write('Downloads\\autofile\\new.txt', 'new');
  const src = path.join(h.home, 'Downloads', 'autofile');
  const blocker = h.write('Creations\\01 Projects\\Blocked', 'i am a file, not a folder');
  const err = await applyMove(ctx, prop(src, path.join(blocker, 'Sub'), 'Autofile', { kind: 'project', replaceExisting: existing })).catch((e) => e);
  assert.ok(err instanceof Error);
  assert.ok(err.rows.some((r) => r.Action === 'Move'), 'the error carries the moves already made');
  await undoStep(ctx, err.rows);
  assert.ok(fs.existsSync(path.join(existing, 'old.txt')));
});

test('undo can be retried after part of it already happened', async (t) => {
  const { h, ctx } = setup(t);
  const a = h.write('Downloads\\a.txt', 'a');
  const b = h.write('Downloads\\b.txt', 'b');
  const dest = path.join(ctx.creations, '06 Reference');
  const rows = [...await applyMove(ctx, prop(a, dest, 'a.txt')), ...await applyMove(ctx, prop(b, dest, 'b.txt'))];
  fs.renameSync(path.join(dest, 'b.txt'), b); // b was put back by hand
  await undoStep(ctx, rows);
  assert.ok(fs.existsSync(a) && fs.existsSync(b));
});

test('the log starts with a byte-order mark so Windows PowerShell reads accented paths', async (t) => {
  const { h, ctx } = setup(t);
  await applyMove(ctx, prop(h.write('Downloads\\Café menu.txt', 'x'), path.join(ctx.creations, '05 Personal'), 'Café menu.txt'));
  const bytes = fs.readFileSync(path.join(ctx.undoDir, 'log.csv'));
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test('a blocked destination says so instead of blaming an open file', async (t) => {
  const { h, ctx } = setup(t);
  const src = h.write('Downloads\\a.txt', 'a');
  const err = await applyMove(ctx, prop(src, 'Z:\\definitely\\not\\here', 'a.txt')).catch((e) => e);
  assert.ok(err instanceof Error);
  assert.doesNotMatch(err.message, /in use/);
  assert.ok(fs.existsSync(src), 'source untouched');
});

test('the undo script is a dry run unless -Apply is given', async (t) => {
  const { h, ctx } = setup(t);
  const src = h.write('Downloads\\a.txt', 'a');
  const dest = path.join(ctx.creations, '06 Reference');
  await applyMove(ctx, prop(src, dest, 'a.txt'));
  const script = path.join(ctx.undoDir, 'Undo-Autofile.ps1');
  assert.match(fs.readFileSync(script, 'utf8'), /\[switch\]\$Apply/);
  const out = execFileSync('pwsh', ['-NoProfile', '-File', script], { encoding: 'utf8' });
  assert.match(out, /WOULD MOVE/);
  assert.ok(fs.existsSync(path.join(dest, 'a.txt')));
  execFileSync('pwsh', ['-NoProfile', '-File', script, '-Apply'], { encoding: 'utf8' });
  assert.ok(fs.existsSync(src));
});
