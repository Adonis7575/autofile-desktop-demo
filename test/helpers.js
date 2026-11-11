const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CREATIONS_DIRS = [
  '00 Main Dashboard',
  '01 Projects\\Autofile',
  '02 Business\\Studio',
  '03 School\\CSCI 4425 Deep Learning',
  '04 Career',
  '05 Personal',
  '06 Reference',
  'Icons',
  '_Archive',
  '_Tools',
  '_Undo',
];

// Builds a throwaway home folder that mirrors the real Creations layout.
function makeHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autofile-test-'));
  const home = path.join(root, 'home');
  const eRoot = path.join(root, 'E');
  const dataDir = path.join(root, 'data');
  for (const d of CREATIONS_DIRS) fs.mkdirSync(path.join(home, 'Creations', d), { recursive: true });
  for (const d of ['Videos', 'Music', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(home, d), { recursive: true });
  fs.mkdirSync(path.join(eRoot, '08 Apps & Installers', 'Installers'), { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  function write(relPath, content = '') {
    const full = path.join(home, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
  }
  function cleanup() {
    fs.rmSync(root, { recursive: true, force: true });
  }
  return { root, home, eRoot, dataDir, write, cleanup };
}

module.exports = { makeHome };
