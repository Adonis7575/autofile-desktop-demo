const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Everything the core modules need to know about the machine, in one object,
// so tests can point it at a throwaway home folder.
function createContext({ home, eRoot, dataDir, runClaude, today } = {}) {
  home = home || os.homedir();
  eRoot = eRoot || path.join(home, 'Installer storage');
  dataDir = dataDir || path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Autofile-Desktop');
  today = today || localDate();
  const creations = path.join(home, 'Creations');
  return {
    home,
    creations,
    eRoot,
    eMounted: fs.existsSync(eRoot),
    installersDir: path.join(eRoot, '08 Apps & Installers', 'Installers'),
    dataDir,
    undoDir: path.join(creations, '_Undo', `${today} Autofile`),
    today,
    runClaude,
  };
}

module.exports = { createContext, localDate };
