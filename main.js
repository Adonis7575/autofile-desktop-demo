const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { createContext } = require('./src/core/context');
const { expandDrops } = require('./src/core/scan');
const { classifyAll } = require('./src/core/classify');
const { applyMove, undoStep } = require('./src/core/mover');
const { listDestinations } = require('./src/core/folders');
const { saveRuleFromCorrection } = require('./src/core/rules');
const { cleanName } = require('./src/core/naming');
const { checkDestination, safeProjectName } = require('./src/core/approval');

const env = process.env;
const data = app.getPath('userData');
const ctx = createContext({
  home: env.AUTOFILE_HOME || path.join(data, 'sample-workspace'),
  eRoot: env.AUTOFILE_EROOT || path.join(data, 'sample-installers'),
  dataDir: env.AUTOFILE_DATA || path.join(data, 'filing-state'),
});

const proposals = new Map(); // id -> Proposal (with .item, .original)
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1120, height: 780, minWidth: 720, minHeight: 480, title: 'Autofile',
    autoHideMenuBar: true, backgroundColor: '#eef1f5',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('will-navigate', (e) => e.preventDefault()); // a stray drop must never open the file
}

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
const view = (p) => {
  const { item, original, rows, ...rest } = p;
  return { ...rest, name: item.name, home: ctx.home };
};

ipcMain.handle('addPaths', async (_e, paths) => {
  const items = (await expandDrops(paths)).filter((i) => !proposals.has(i.id) || proposals.get(i.id).status !== 'pending');
  if (!items.length) return 0;
  const placeholders = items.map((item) => {
    const p = { id: item.id, src: item.src, kind: item.kind, newName: item.name, destDir: null, reason: '', confidence: 0,
      source: 'reading', status: 'reading', item };
    proposals.set(item.id, p);
    return view(p);
  });
  send('proposals', placeholders);
  classifyAll(ctx, items, (batch) => {
    const out = [];
    for (const p of batch) {
      const item = proposals.get(p.id)?.item;
      if (!item) continue;
      const full = { ...p, item, original: { destDir: p.destDir, newName: p.newName } };
      if (p.source === 'already' && p.newName === item.name) full.status = 'skipped';
      proposals.set(p.id, full);
      out.push(view(full));
    }
    send('proposals', out);
  }).catch((e) => send('error', e.message));
  return items.length;
});

ipcMain.handle('approve', async (_e, id, edits = {}) => {
  const p = proposals.get(id);
  if (!p || p.status !== 'pending') return p && view(p);
  const destDir = edits.destDir ?? p.destDir;
  let newName = (edits.newName ?? p.newName).trim();
  if (p.kind === 'file' && !path.extname(newName) && p.item.ext) newName += p.item.ext;
  if (p.kind === 'file') newName = cleanName(newName);
  else newName = safeProjectName(newName, p.item.name);
  const userChose = p.userChose || destDir !== p.original.destDir;
  const problem = checkDestination(ctx, destDir, { userChose });
  if (problem) { Object.assign(p, { status: 'pending', error: problem }); return view(p); }
  p.status = 'moving'; // a second click on the same row is ignored from here on
  try {
    const rows = await applyMove(ctx, { ...p, destDir, newName });
    const moved = rows.filter((r) => r.Action === 'Move').pop();
    if (userChose && p.source !== 'rule' && p.source !== 'duplicate') saveRuleFromCorrection(ctx, p.item, destDir);
    Object.assign(p, { destDir, newName, status: 'moved', rows, finalPath: moved ? moved.Target : p.src, error: undefined });
  } catch (e) {
    const done = (e.rows || []).filter((r) => r.Action === 'Move');
    if (done.length) {
      // Part of it happened: keep it undoable rather than pretending nothing moved.
      Object.assign(p, { status: 'moved', rows: e.rows, finalPath: done[done.length - 1].Target, error: `Only partly done: ${e.message}. Use Undo to put it back.` });
    } else {
      Object.assign(p, { status: 'pending', error: e.message });
    }
  }
  return view(p);
});

ipcMain.handle('answer', (_e, id, destDir) => {
  const p = proposals.get(id);
  if (!p) return null;
  if (!destDir) { p.status = 'skipped'; return view(p); }
  if (p.replaceExisting) {
    // Project copy: only "Yes, replace it" keeps the replacement; anything else just files this copy.
    if (path.resolve(destDir).toLowerCase() !== path.dirname(p.replaceExisting).toLowerCase()) {
      delete p.replaceExisting;
      p.newName = p.item.name;
    }
  } else {
    saveRuleFromCorrection(ctx, p.item, destDir);
  }
  Object.assign(p, { destDir, confidence: 1, question: undefined, reason: 'You chose this folder', userChose: true, original: { ...p.original, destDir } });
  return view(p);
});

ipcMain.handle('skip', (_e, id) => {
  const p = proposals.get(id);
  if (p) p.status = 'skipped';
  return p && view(p);
});

ipcMain.handle('undo', async (_e, id) => {
  const p = proposals.get(id);
  if (!p || p.status !== 'moved') return p && view(p);
  try {
    await undoStep(ctx, p.rows);
    Object.assign(p, { status: 'pending', rows: undefined, finalPath: undefined, error: undefined });
  } catch (e) {
    p.error = e.message;
  }
  return view(p);
});

ipcMain.handle('pickFolder', async (_e, defaultPath) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: defaultPath || ctx.creations });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('destinations', () => listDestinations(ctx));
ipcMain.handle('info', () => ({ home: ctx.home, eMounted: ctx.eMounted, undoDir: ctx.undoDir }));
ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('clearDone', () => {
  for (const [id, p] of proposals) if (p.status === 'moved' || p.status === 'skipped') proposals.delete(id);
});

app.whenReady().then(() => {
  if (!env.AUTOFILE_HOME) {
    const inbox = path.join(ctx.home, 'Inbox');
    for (const folder of ['01 Projects/Studio Sample', '02 Business', '03 School', '04 Career', '05 Personal', '06 Reference']) {
      fs.mkdirSync(path.join(ctx.creations, folder), { recursive: true });
    }
    fs.mkdirSync(inbox, { recursive: true });
    ipcMain.handle('addSample', () => {
      const sample = path.join(inbox, 'Studio Sample notes.txt');
      try {
        fs.writeFileSync(sample, 'Synthetic notes for the Studio Sample project.\n', { flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      return sample;
    });
  } else {
    ipcMain.handle('addSample', () => null);
  }
  createWindow();
});
app.on('window-all-closed', () => app.quit());
