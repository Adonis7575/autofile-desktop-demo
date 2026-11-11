const path = require('node:path');

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Tidies a filename: no GUIDs, no " (1)" copy suffixes, no illegal characters.
function cleanName(name) {
  const ext = path.extname(name);
  let stem = ext ? name.slice(0, -ext.length) : name;
  stem = stem.replace(GUID, ' ').replace(/\s*\(\d+\)\s*$/, '').replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/_/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[-. ]+|[-. ]+$/g, '');
  return `${stem || 'Untitled'}${ext.toLowerCase()}`;
}

// Where a file should actually land so nothing is overwritten.
// identicalExisting = the same bytes are already there under that name.
async function resolveTarget(destDir, newName, srcPath, today) {
  const fs = require('node:fs');
  const { hashFile } = require('./scan');
  const first = path.join(destDir, newName);
  if (!fs.existsSync(first)) return { target: first, identicalExisting: false };
  // Same file (Windows paths ignore case): a rename in place, not a clash.
  if (path.resolve(first).toLowerCase() === path.resolve(srcPath).toLowerCase()) return { target: first, identicalExisting: false };
  const a = fs.statSync(srcPath), b = fs.statSync(first);
  if (a.isFile() && b.isFile() && a.size === b.size && (await hashFile(srcPath)) === (await hashFile(first))) {
    return { target: first, identicalExisting: true };
  }
  const ext = path.extname(newName);
  const stem = ext ? newName.slice(0, -ext.length) : newName;
  for (let n = 1; ; n++) {
    const candidate = path.join(destDir, `${stem} - ${today}${n > 1 ? ` - ${n}` : ''}${ext}`);
    if (!fs.existsSync(candidate)) return { target: candidate, identicalExisting: false };
  }
}

module.exports = { cleanName, resolveTarget };
