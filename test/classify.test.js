const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeHome } = require('./helpers');
const { createContext } = require('../src/core/context');
const { expandDrops } = require('../src/core/scan');
const { classifyAll } = require('../src/core/classify');
const { buildPrompt } = require('../src/core/claude');
const { saveRuleFromCorrection } = require('../src/core/rules');

// A stand-in for Claude that files everything to `dest` and records what it was asked.
function fakeClaude(dest, { confidence = 0.9, failOnCall = 0 } = {}) {
  const calls = [];
  const run = async ({ prompt }) => {
    const entries = JSON.parse(prompt.slice(prompt.lastIndexOf('ITEMS:\n') + 7));
    calls.push(entries.map((e) => e.name));
    if (calls.length === failOnCall) throw new Error('claude down');
    return { results: entries.map((e) => ({ id: e.id, destDir: dest, newName: `Clean ${e.name}`, reason: 'fake', confidence })) };
  };
  return { run, calls };
}

function setup(t, runClaude) {
  const h = makeHome(); t.after(h.cleanup);
  const ctx = createContext({ home: h.home, eRoot: h.eRoot, dataDir: h.dataDir, today: '2026-10-19', runClaude });
  return { h, ctx };
}

test('a failed Claude batch falls back to rules and every item still gets a row', async (t) => {
  const { h, ctx } = setup(t, null);
  const run = fakeClaude(path.join(ctx.creations, '06 Reference'), { failOnCall: 2 });
  ctx.runClaude = run.run;
  const paths = Array.from({ length: 25 }, (_, i) => h.write(`Downloads\\doc${i}.txt`, `content ${i}`));
  let batches = 0;
  const out = await classifyAll(ctx, await expandDrops(paths), () => { batches++; });
  assert.equal(out.length, 25);
  assert.equal(out.filter((p) => p.source === 'fallback').length, 10);
  assert.equal(out.filter((p) => p.source === 'claude').length, 15);
  assert.equal(batches, 3);
});

test('a destination outside the allowed folders becomes a question', async (t) => {
  const { h, ctx } = setup(t, fakeClaude('D:\\Stuff').run);
  const out = await classifyAll(ctx, await expandDrops([h.write('Downloads\\a.txt', 'a')]), () => {});
  assert.equal(out[0].destDir, null);
  assert.ok(out[0].question);
});

test('low confidence without a question gets one attached', async (t) => {
  const { h, ctx } = setup(t, null);
  ctx.runClaude = fakeClaude(path.join(ctx.creations, '06 Reference'), { confidence: 0.3 }).run;
  const out = await classifyAll(ctx, await expandDrops([h.write('Downloads\\a.txt', 'a')]), () => {});
  assert.ok(out[0].question);
  assert.equal(out[0].destDir, path.join(ctx.creations, '06 Reference'));
});

test('identical files: the second is a duplicate and never sent to Claude', async (t) => {
  const { h, ctx } = setup(t, null);
  const fc = fakeClaude(path.join(ctx.creations, '06 Reference'));
  ctx.runClaude = fc.run;
  const a = h.write('Downloads\\deck.pptx', 'same');
  const b = h.write('Downloads\\deck (1).pptx', 'same');
  const out = await classifyAll(ctx, await expandDrops([a, b]), () => {});
  const dup = out.find((p) => p.src === b);
  assert.equal(dup.source, 'duplicate');
  assert.ok(dup.destDir.endsWith(path.join('_Archive', 'Duplicates')));
  assert.deepEqual(fc.calls.flat(), ['deck.pptx']);
});

test('a learned rule wins and skips Claude', async (t) => {
  const { h, ctx } = setup(t, null);
  const fc = fakeClaude(path.join(ctx.creations, '06 Reference'));
  ctx.runClaude = fc.run;
  const dest = path.join(ctx.creations, '02 Business', 'Studio');
  saveRuleFromCorrection(ctx, { name: 'studio gig.docx', ext: '.docx' }, dest);
  const out = await classifyAll(ctx, await expandDrops([h.write('Downloads\\Studio Gig ideas.txt', 'x')]), () => {});
  assert.equal(out[0].source, 'rule');
  assert.equal(out[0].destDir, dest);
  assert.equal(fc.calls.length, 0);
});

test('a file already in its proposed folder is marked already filed', async (t) => {
  const { h, ctx } = setup(t, null);
  const dest = path.join(ctx.creations, '03 School', 'CSCI 4425 Deep Learning');
  ctx.runClaude = fakeClaude(dest).run;
  const p = h.write('Creations\\03 School\\CSCI 4425 Deep Learning\\x.pdf', 'x');
  const out = await classifyAll(ctx, await expandDrops([p]), () => {});
  assert.equal(out[0].source, 'already');
});

test('an older copy of an existing project is proposed for the archive', async (t) => {
  const { h, ctx } = setup(t, fakeClaude(null).run);
  h.write('Creations\\01 Projects\\Autofile\\package.json', '{"name":"autofile"}');
  const old = h.write('Downloads\\Autofile-main\\package.json', '{"name":"autofile"}');
  const past = new Date('2025-01-01');
  fs.utimesSync(old, past, past);
  const out = await classifyAll(ctx, await expandDrops([path.dirname(old)]), () => {});
  assert.equal(out[0].source, 'project');
  assert.equal(out[0].destDir, path.join(ctx.creations, '_Archive', 'Autofile old copies'));
});

test('a newer copy of an existing project replaces it and archives the old one', async (t) => {
  const { h, ctx } = setup(t, fakeClaude(null).run);
  const existing = h.write('Creations\\01 Projects\\Autofile\\package.json', '{"name":"autofile"}');
  const past = new Date('2025-01-01');
  fs.utimesSync(existing, past, past);
  const fresh = h.write('Downloads\\autofile\\package.json', '{"name":"autofile"}');
  const out = await classifyAll(ctx, await expandDrops([path.dirname(fresh)]), () => {});
  assert.equal(out[0].destDir, path.join(ctx.creations, '01 Projects'));
  assert.equal(out[0].newName, 'Autofile');
  assert.equal(out[0].replaceExisting, path.dirname(existing));
  assert.ok(out[0].question, 'replacing a project always asks first');
});

test('Claude is always called on Haiku 5.5 by its exact model id', () => {
  const { claudeArgs, MODEL } = require('../src/core/claude');
  assert.equal(MODEL, 'claude-haiku-5-5');
  const args = claudeArgs({ system: 's', schema: {}, readDirs: [] });
  assert.equal(args[args.indexOf('--model') + 1], 'claude-haiku-5-5');
  const withImages = claudeArgs({ system: 's', schema: {}, readDirs: ['C:\\x'] });
  assert.equal(withImages[withImages.indexOf('--model') + 1], 'claude-haiku-5-5');
});

test('a project copy with the same timestamps never replaces the current one', async (t) => {
  const { h, ctx } = setup(t, fakeClaude(null).run);
  const when = new Date('2026-01-01');
  const existing = h.write('Creations\\01 Projects\\Autofile\\a.txt', 'x');
  const dropped = h.write('Downloads\\Autofile\\a.txt', 'x');
  fs.utimesSync(existing, when, when);
  fs.utimesSync(dropped, when, when);
  h.write('Downloads\\Autofile\\package.json', '{}');
  fs.utimesSync(path.join(h.home, 'Downloads', 'Autofile', 'package.json'), when, when);
  fs.utimesSync(path.join(h.home, 'Creations', '01 Projects', 'Autofile', 'a.txt'), when, when);
  const out = await classifyAll(ctx, await expandDrops([path.dirname(dropped)]), () => {});
  assert.equal(out[0].replaceExisting, undefined);
});

test('a project is matched by folder name only, not by a generic package name', async (t) => {
  const { h, ctx } = setup(t, null);
  h.write('Creations\\01 Projects\\Autofile\\package.json', '{"name":"my-app"}');
  const fresh = h.write('Downloads\\weather-widget\\package.json', '{"name":"my-app"}');
  ctx.runClaude = fakeClaude(path.join(ctx.creations, '01 Projects')).run;
  const out = await classifyAll(ctx, await expandDrops([path.dirname(fresh)]), () => {});
  assert.notEqual(out[0].source, 'project');
  assert.equal(out[0].replaceExisting, undefined);
});

test('a file already in its folder is marked already filed whatever proposed it', async (t) => {
  const { h, ctx } = setup(t, fakeClaude(null, { failOnCall: 1 }).run); // Claude down -> basic rules pick the course
  const p = h.write('Creations\\03 School\\CSCI 4425 Deep Learning\\notes for CSCI 4425.txt', 'x');
  const out = await classifyAll(ctx, await expandDrops([p]), () => {});
  assert.equal(out[0].source, 'already');
});

test('the prompt carries the folder map on stdin and keeps the command line short', (t) => {
  const { ctx } = setup(t, null);
  const rules = Array.from({ length: 400 }, (_, i) => ({ tokens: [`token${i}`], ext: null, destDir: `C:\\long\\destination\\folder\\${i}` }));
  const { system, prompt, schema } = buildPrompt(ctx, [{ item: { id: 'a', name: 'n.pdf', ext: '.pdf', size: 2048, src: 'C:\\x\\n.pdf' }, excerpt: 'CNN', isImage: false }], rules);
  assert.ok(system.length < 2000, `system prompt is ${system.length} chars`);
  assert.match(prompt, /03 School/);
  assert.match(prompt, /CSCI 4425 Deep Learning/);
  assert.match(prompt, /token399/);
  assert.match(prompt, /"excerpt":"CNN"/);
  assert.ok(schema.properties.results);
});

test('installers go to the installer drive without asking Claude', async (t) => {
  const { h, ctx } = setup(t, null);
  const fc = fakeClaude(null, { confidence: 0 });
  ctx.runClaude = fc.run;
  const out = await classifyAll(ctx, await expandDrops([h.write('Downloads/16y5037fjn006th0.exe', 'MZ')]), () => {});
  assert.equal(out[0].destDir, ctx.installersDir);
  assert.equal(fc.calls.length, 0);
});

test('of two identical files, the one without a (1) suffix is kept', async (t) => {
  const { h, ctx } = setup(t, null);
  ctx.runClaude = fakeClaude(path.join(ctx.creations, '06 Reference')).run;
  const copy = h.write('Downloads/02_Supervised (1).pdf', 'same');
  const orig = h.write('Downloads/02_Supervised.pdf', 'same');
  const out = await classifyAll(ctx, await expandDrops([copy, orig]), () => {});
  assert.equal(out.find((p) => p.src === copy).source, 'duplicate');
  assert.notEqual(out.find((p) => p.src === orig).source, 'duplicate');
});

test('code files keep their name apart from the copy suffix', async (t) => {
  const { h, ctx } = setup(t, null);
  ctx.runClaude = fakeClaude(path.join(ctx.creations, '06 Reference')).run;
  const out = await classifyAll(ctx, await expandDrops([h.write('Downloads/data (1).py', 'import x')]), () => {});
  assert.equal(out[0].newName, 'data.py');
});
