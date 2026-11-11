const fs = require('node:fs');
const path = require('node:path');
const { subdirs } = require('./folders');

const IGNORE = new Set(['node_modules', '.git', '.next', 'dist', '.venv', 'venv', '__pycache__', 'build']);
const key = (s) => s.toLowerCase().replace(/-(main|master)$/, '').replace(/[^a-z0-9]/g, '');

// The existing 01 Projects folder this dropped project is a copy of, if any.
// Matched by folder name only: package names like "my-app" are too generic to trust.
function findExistingProject(ctx, item) {
  const root = path.join(ctx.creations, '01 Projects');
  const want = key(item.name);
  if (!want) return null;
  for (const name of subdirs(root)) {
    const dir = path.join(root, name);
    if (path.resolve(dir).toLowerCase() === path.resolve(item.src).toLowerCase()) continue;
    if (key(name) === want) return dir;
  }
  return null;
}

function latestMtime(dir, depth = 0) {
  let latest = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (IGNORE.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 6) latest = Math.max(latest, latestMtime(full, depth + 1)); }
    else { try { latest = Math.max(latest, fs.statSync(full).mtimeMs); } catch { /* vanished */ } }
  }
  return latest;
}

function compareProjects(a, b) {
  const aLatest = latestMtime(a), bLatest = latestMtime(b);
  // A tie is not "newer": the safe outcome is archiving the dropped copy, never replacing.
  return { newer: aLatest > bLatest ? 'a' : 'b', aLatest, bLatest };
}

module.exports = { findExistingProject, compareProjects };
