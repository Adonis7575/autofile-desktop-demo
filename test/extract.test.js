const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { makeHome } = require('./helpers');
const { expandDrops } = require('../src/core/scan');
const { extractSummary } = require('../src/core/extract');

async function itemFor(h, rel, content) {
  const p = h.write(rel, content);
  return (await expandDrops([p]))[0];
}

test('html keeps title and body text, drops scripts', async (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const it = await itemFor(h, 'Downloads\\a.html', '<html><head><title>Week 3 Notes</title><script>var secretx=1</script></head><body><p>CNN layers</p></body></html>');
  const s = await extractSummary(it);
  assert.match(s.excerpt, /Week 3 Notes/);
  assert.match(s.excerpt, /CNN layers/);
  assert.doesNotMatch(s.excerpt, /secretx/);
});

test('zip lists its entries', async (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const z = new AdmZip(); z.addFile('a.txt', Buffer.from('a')); z.addFile('b.py', Buffer.from('b'));
  const it = await itemFor(h, 'Downloads\\code.zip', z.toBuffer());
  const s = await extractSummary(it);
  assert.match(s.excerpt, /^ZIP:/);
  assert.match(s.excerpt, /b\.py/);
});

test('pptx yields slide text', async (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const z = new AdmZip();
  z.addFile('ppt/slides/slide1.xml', Buffer.from('<p:sld><a:t>Deep Learning</a:t><a:t>Week 1</a:t></p:sld>'));
  const it = await itemFor(h, 'Downloads\\deck.pptx', z.toBuffer());
  const s = await extractSummary(it);
  assert.match(s.excerpt, /Deep Learning/);
});

test('xlsx yields shared strings', async (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const z = new AdmZip();
  z.addFile('xl/sharedStrings.xml', Buffer.from('<sst><si><t>Budget 2026</t></si></sst>'));
  const it = await itemFor(h, 'Downloads\\book.xlsx', z.toBuffer());
  assert.match((await extractSummary(it)).excerpt, /Budget 2026/);
});

test('images are flagged for Claude to look at', async (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const it = await itemFor(h, 'Downloads\\shot.png', 'png');
  const s = await extractSummary(it);
  assert.equal(s.isImage, true);
});

test('a corrupt pdf gives an empty excerpt instead of throwing', async (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const it = await itemFor(h, 'Downloads\\bad.pdf', 'hello');
  const s = await extractSummary(it);
  assert.equal(s.excerpt, '');
});

test('long text is capped at 1500 characters', async (t) => {
  const h = makeHome(); t.after(h.cleanup);
  const it = await itemFor(h, 'Downloads\\long.md', 'word '.repeat(600));
  const s = await extractSummary(it);
  assert.ok(s.excerpt.length <= 1500);
  assert.ok(s.excerpt.length > 1000);
});

test('a project folder is summarized from its README and package.json', async (t) => {
  const h = makeHome(); t.after(h.cleanup);
  h.write('Downloads\\proj\\package.json', '{"name":"qr-track","description":"QR code tracker"}');
  h.write('Downloads\\proj\\README.md', '# QR Track\nTracks scans.');
  const it = (await expandDrops([require('node:path').join(h.home, 'Downloads', 'proj')]))[0];
  const s = await extractSummary(it);
  assert.match(s.excerpt, /qr-track/);
  assert.match(s.excerpt, /Tracks scans/);
});
