const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { makeHome } = require('./helpers');
const { createContext } = require('../src/core/context');
const { isAllowedDest, folderMap, listDestinations } = require('../src/core/folders');
const { cleanName } = require('../src/core/naming');
const { loadRules, saveRuleFromCorrection, matchRule } = require('../src/core/rules');

function ctxFor(h, extra = {}) {
  return createContext({ home: h.home, eRoot: h.eRoot, dataDir: h.dataDir, today: '2026-10-19', ...extra });
}
const item = (name) => ({ name, ext: path.extname(name).toLowerCase() });

test('isAllowedDest accepts Creations buckets and rejects system folders', (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const ctx = ctxFor(h);
  const C = ctx.creations;
  assert.equal(isAllowedDest(ctx, path.join(C, '03 School', 'X')), true);
  assert.equal(isAllowedDest(ctx, path.join(h.home, 'Videos')), true);
  assert.equal(isAllowedDest(ctx, path.join(C, '_Undo')), false);
  assert.equal(isAllowedDest(ctx, path.join(C, 'Icons', 'a')), false);
  assert.equal(isAllowedDest(ctx, path.join(C, '00 Main Dashboard')), false);
  assert.equal(isAllowedDest(ctx, 'C:\\Windows'), false);
  assert.equal(isAllowedDest(ctx, path.join(C, '..', 'Desktop')), false);
  assert.equal(isAllowedDest(ctx, ctx.installersDir), true);
  const noE = ctxFor(h, { eRoot: path.join(h.root, 'missing') });
  assert.equal(isAllowedDest(noE, noE.installersDir), false);
});

test('folderMap lists real folders but not hidden system ones', (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const map = folderMap(ctxFor(h));
  assert.match(map, /03 School/);
  assert.match(map, /CSCI 4425 Deep Learning/);
  assert.doesNotMatch(map, /_Undo/);
  assert.doesNotMatch(map, /00 Main Dashboard/);
  assert.ok(listDestinations(ctxFor(h)).some((d) => d.endsWith('CSCI 4425 Deep Learning')));
});

test('cleanName removes GUIDs, copy suffixes and underscores', () => {
  assert.equal(cleanName('292c2cab-414a-4ba8-b92b-d08a2538a183.pdf'), 'Untitled.pdf');
  assert.equal(cleanName('StudioSample_Micro_Proposals (1).pptx'), 'StudioSample Micro Proposals.pptx');
  assert.equal(cleanName('a:b?c.txt'), 'a b c.txt');
  assert.equal(cleanName('Clear Name.md'), 'Clear Name.md');
});

test('a learned rule catches similar files and not unrelated ones', (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const ctx = ctxFor(h);
  const dest = path.join(ctx.creations, '03 School', 'CSCI 4425 Deep Learning');
  saveRuleFromCorrection(ctx, item('4140_04.17.2026 - Chapter 8.mp4'), dest);
  const rules = loadRules(ctx);
  assert.equal(rules.length, 1);
  assert.equal(matchRule(rules, item('4140_05.05.2026 - Exam Review.mp4'), '').destDir, dest);
  assert.equal(matchRule(rules, item('holiday.mp4'), ''), null);
});

test('rules survive a reload from disk', (t) => {
  const h = makeHome(); t.after(h.cleanup);
  saveRuleFromCorrection(ctxFor(h), item('studio_gig_brief.docx'), 'X:\\dest');
  assert.equal(loadRules(ctxFor(h))[0].destDir, 'X:\\dest');
});
