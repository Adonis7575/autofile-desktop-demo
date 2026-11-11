const fs = require('node:fs');
const path = require('node:path');

// Creations folders that are never a home for dropped files.
const BLOCKED = new Set(['00 main dashboard', 'icons', '_tools', '_undo']);
const SKIP_LISTING = (name) => name.startsWith('.') || name === 'node_modules' || name === '__pycache__';

const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
const isInside = (child, parent) => {
  const c = norm(child), p = norm(parent);
  return c === p || c.startsWith(p + path.sep);
};

function isAllowedDest(ctx, absDir) {
  if (!absDir || !path.isAbsolute(absDir)) return false;
  if (isInside(absDir, ctx.installersDir)) return ctx.eMounted;
  if (isInside(absDir, path.join(ctx.home, 'Videos')) || isInside(absDir, path.join(ctx.home, 'Music'))) return true;
  if (!isInside(absDir, ctx.creations) || norm(absDir) === norm(ctx.creations)) return false;
  const first = path.relative(ctx.creations, path.resolve(absDir)).split(path.sep)[0].toLowerCase();
  return !BLOCKED.has(first);
}

function subdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !SKIP_LISTING(e.name)).map((e) => e.name).sort();
  } catch { return []; }
}

// Absolute paths of every folder a file may be filed into (two levels of Creations).
function listDestinations(ctx) {
  const out = [];
  for (const top of subdirs(ctx.creations)) {
    if (BLOCKED.has(top.toLowerCase())) continue;
    const topPath = path.join(ctx.creations, top);
    out.push(topPath);
    for (const sub of subdirs(topPath)) out.push(path.join(topPath, sub));
  }
  out.push(path.join(ctx.home, 'Videos'), path.join(ctx.home, 'Music'));
  if (ctx.eMounted) out.push(ctx.installersDir);
  return out;
}

// Indented text tree for the Claude prompt.
function folderMap(ctx) {
  const lines = [ctx.creations];
  for (const top of subdirs(ctx.creations)) {
    if (BLOCKED.has(top.toLowerCase())) continue;
    lines.push(`  ${top}`);
    for (const sub of subdirs(path.join(ctx.creations, top))) lines.push(`    ${sub}`);
  }
  lines.push(path.join(ctx.home, 'Videos'), path.join(ctx.home, 'Music'));
  if (ctx.eMounted) lines.push(`${ctx.installersDir}   (installers only)`);
  return lines.join('\n');
}

module.exports = { isAllowedDest, listDestinations, folderMap, isInside, subdirs };
