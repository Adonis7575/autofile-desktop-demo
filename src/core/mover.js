const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { resolveTarget } = require('./naming');

const COLUMNS = ['Step', 'Action', 'Path', 'Target', 'Backup', 'PrevAttributes', 'Time'];
const csvLine = (vals) => vals.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
const logFile = (ctx) => path.join(ctx.undoDir, 'log.csv');

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function nextStep(ctx) {
  try {
    const lines = fs.readFileSync(logFile(ctx), 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.length; // header occupies line 0, so the count is the next step number
  } catch { return 1; }
}

function appendLog(ctx, rows) {
  if (!rows.length) return;
  fs.mkdirSync(ctx.undoDir, { recursive: true });
  const file = logFile(ctx);
  const fresh = !fs.existsSync(file);
  // The BOM lets Windows PowerShell 5.1's Import-Csv read accented paths correctly.
  const text = (fresh ? '﻿' + csvLine(COLUMNS) + '\r\n' : '') + rows.map((r) => csvLine(COLUMNS.map((c) => r[c]))).join('\r\n') + '\r\n';
  fs.appendFileSync(file, text, 'utf8');
  writeUndoScript(ctx);
}

function writeUndoScript(ctx) {
  const script = `# Undo moves made by Autofile on this day. Dry run unless you add -Apply.
param([switch]$Apply)
$log = Import-Csv -LiteralPath (Join-Path $PSScriptRoot 'log.csv')
$undone = @{}
foreach ($r in $log) { if ($r.Action -eq 'Undo' -and $r.Backup -like 'step:*') { $undone[$r.Backup.Substring(5)] = $true } }
$rows = $log | Where-Object { $_.Action -in 'Move','MkDir' -and -not $undone[$_.Step] } | Sort-Object { [int]$_.Step } -Descending
foreach ($r in $rows) {
  if ($r.Action -eq 'Move') {
    if (-not (Test-Path -LiteralPath $r.Target)) { Write-Host "SKIP (not found) $($r.Target)"; continue }
    if (Test-Path -LiteralPath $r.Path) { Write-Host "SKIP (something is already at) $($r.Path)"; continue }
    if ($Apply) {
      New-Item -ItemType Directory -Force -Path (Split-Path -LiteralPath $r.Path) | Out-Null
      Move-Item -LiteralPath $r.Target -Destination $r.Path
      Write-Host "MOVED $($r.Target) -> $($r.Path)"
    } else { Write-Host "WOULD MOVE $($r.Target) -> $($r.Path)" }
  } elseif ($r.Action -eq 'MkDir') {
    if ((Test-Path -LiteralPath $r.Path) -and -not (Get-ChildItem -LiteralPath $r.Path -Force | Select-Object -First 1)) {
      if ($Apply) { [System.IO.Directory]::Delete($r.Path); Write-Host "REMOVED empty folder $($r.Path)" }
      else { Write-Host "WOULD REMOVE empty folder $($r.Path)" }
    }
  }
}
if (-not $Apply) { Write-Host 'Dry run. Run again with -Apply to undo for real.' }
`;
  fs.writeFileSync(path.join(ctx.undoDir, 'Undo-Autofile.ps1'), '﻿' + script, 'utf8');
}

async function totalSize(p) {
  const st = await fsp.stat(p);
  if (!st.isDirectory()) return st.size;
  let sum = 0;
  for (const name of await fsp.readdir(p)) sum += await totalSize(path.join(p, name));
  return sum;
}

function friendly(e) {
  if (e.code === 'ENOENT') return new Error('file no longer there');
  if (e.code === 'EBUSY') return new Error('in use, retry');
  if (e.code === 'EPERM' || e.code === 'EACCES') return new Error('Windows blocked this move: the file may be open, or the folder is protected');
  return e;
}

const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// Moves src to target. Across drives: copy, verify, call onCopied (so the move is
// logged), then remove the source. Never replaces something already at target.
async function moveRaw(src, target, onCopied = () => {}) {
  if (samePath(src, target)) {
    if (src === target) return;
    const tmp = `${src}.autofile-${process.pid}`; // case-only rename goes through a temp name
    await fsp.rename(src, tmp).catch((e) => { throw friendly(e); });
    await fsp.rename(tmp, target);
    return;
  }
  if (fs.existsSync(target)) throw new Error(`something is already at ${target}`);
  try {
    await fsp.rename(src, target);
  } catch (e) {
    if (e.code !== 'EXDEV') throw friendly(e);
    await fsp.cp(src, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    if ((await totalSize(src)) !== (await totalSize(target))) {
      await fsp.rm(target, { recursive: true, force: true });
      throw new Error('copy did not verify; original left in place');
    }
    onCopied();
    try { await fsp.rm(src, { recursive: true }); } catch (err) {
      throw new Error(`copied safely, but part of the original couldn't be removed (${err.code || err.message})`);
    }
  }
}

// One move at a time across the whole app, so two approvals can't race for a name.
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

// Creates destDir and any missing parents; returns the folders it made, top-down.
async function ensureDir(dir) {
  const made = [];
  let cur = path.resolve(dir);
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) throw new Error(`drive ${cur} isn't available (unplugged?)`);
    made.unshift(cur);
    cur = parent;
  }
  for (const d of made) await fsp.mkdir(d);
  return made;
}

// Moves one approved item. If it fails partway, the thrown error carries
// `rows` (what already happened) so it can still be undone.
function applyMove(ctx, proposal) {
  return serial(() => applyMoveNow(ctx, proposal));
}

async function applyMoveNow(ctx, proposal) {
  const src = proposal.src;
  try { await fsp.lstat(src); } catch (e) { throw friendly(e); }
  const rows = [];
  let step = nextStep(ctx);
  const row = (Action, P, Target = '') => rows.push({ Step: step++, Action, Path: P, Target, Backup: '', PrevAttributes: '', Time: nowStamp() });
  const move = async (from, to) => {
    let logged = false;
    try {
      await moveRaw(from, to, () => { row('Move', from, to); logged = true; });
    } finally {
      const happened = samePath(from, to) ? true : !fs.existsSync(from) && fs.existsSync(to);
      if (!logged && happened) row('Move', from, to);
    }
  };

  try {
    if (proposal.replaceExisting && fs.existsSync(proposal.replaceExisting)) {
      const name = path.basename(proposal.replaceExisting);
      const archiveDir = path.join(ctx.creations, '_Archive', `${name} old copies`);
      for (const d of await ensureDir(archiveDir)) row('MkDir', d);
      const { target } = await resolveTarget(archiveDir, `${name} - ${ctx.today}`, proposal.replaceExisting, ctx.today);
      await move(proposal.replaceExisting, target);
    }

    let destDir = proposal.destDir;
    let res = await resolveTarget(destDir, proposal.newName, src, ctx.today);
    if (res.identicalExisting) {
      destDir = path.join(ctx.creations, '_Archive', 'Duplicates');
      res = await resolveTarget(destDir, path.basename(src), src, ctx.today);
      if (res.identicalExisting) res = { target: path.join(destDir, `${path.parse(src).name} - ${ctx.today} - ${Date.now()}${path.extname(src)}`) };
    }
    for (const d of await ensureDir(destDir)) row('MkDir', d);
    if (src !== res.target) await move(src, res.target);
  } catch (e) {
    e.rows = rows;
    throw e;
  } finally {
    appendLog(ctx, rows); // whatever already happened is always undoable
  }
  return rows;
}

// Reverses rows. Safe to retry: moves that are already back are skipped.
function undoStep(ctx, rows) {
  return serial(() => undoNow(ctx, rows));
}

async function undoNow(ctx, rows) {
  const undoRows = [];
  let step = nextStep(ctx);
  try {
    for (const r of [...rows].reverse()) {
      if (r.Action === 'Move') {
        const alreadyBack = fs.existsSync(r.Path) && !fs.existsSync(r.Target);
        if (!alreadyBack) {
          if (fs.existsSync(r.Path) && !samePath(r.Path, r.Target)) throw new Error(`Can't undo: something is already at ${r.Path}`);
          await ensureDir(path.dirname(r.Path));
          await moveRaw(r.Target, r.Path);
        }
      } else if (r.Action === 'MkDir') {
        try { fs.rmdirSync(r.Path); } catch { continue; } // only removes it if empty
      } else continue;
      undoRows.push({ Step: step++, Action: 'Undo', Path: r.Target || r.Path, Target: r.Action === 'Move' ? r.Path : '',
        Backup: `step:${r.Step}`, PrevAttributes: '', Time: nowStamp() });
    }
  } finally {
    appendLog(ctx, undoRows);
  }
}

module.exports = { applyMove, undoStep };
