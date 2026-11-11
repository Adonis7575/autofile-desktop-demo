const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const SKIP_FILES = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);
const PROJECT_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'requirements.txt', 'src'];

function isProjectDir(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return false; }
  const lower = names.map((n) => n.toLowerCase());
  return PROJECT_MARKERS.some((m) => lower.includes(m)) || lower.some((n) => n.endsWith('.sln'));
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

function idFor(p) {
  return crypto.createHash('sha1').update(p.toLowerCase()).digest('hex').slice(0, 12);
}

// Hashing is left to classifyAll, which only hashes files that could be duplicates.
function fileItem(p, st) {
  return {
    id: idFor(p), src: p, kind: 'file', name: path.basename(p), ext: path.extname(p).toLowerCase(),
    size: st.size, mtimeMs: st.mtimeMs,
  };
}

async function walk(dir, out) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; } // unreadable folder: skip it
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (isProjectDir(full)) out.push(full); else await walk(full, out);
    } else if (!SKIP_FILES.has(e.name.toLowerCase())) {
      out.push(full);
    }
  }
}

// Turns whatever was dropped into a flat list of things to file.
// Project folders stay whole; any other folder is opened up.
async function expandDrops(paths) {
  const seen = new Set();
  const leafs = [];
  for (const raw of paths) {
    const p = path.resolve(raw);
    let st;
    try { st = await fsp.stat(p); } catch { continue; }
    if (st.isDirectory() && !isProjectDir(p)) await walk(p, leafs); else leafs.push(p);
  }
  const items = [];
  for (const p of leafs) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let st;
    try { st = await fsp.stat(p); } catch { continue; } // broken link or vanished: nothing to file
    if (st.isDirectory()) {
      items.push({ id: idFor(p), src: p, kind: 'project', name: path.basename(p), ext: '', size: 0, mtimeMs: st.mtimeMs });
    } else if (!SKIP_FILES.has(path.basename(p).toLowerCase())) {
      items.push(fileItem(p, st));
    }
  }
  return items;
}

module.exports = { expandDrops, isProjectDir, hashFile };
