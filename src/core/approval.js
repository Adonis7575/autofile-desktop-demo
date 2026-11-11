const path = require('node:path');
const { isAllowedDest, isInside } = require('./folders');

// Why a destination can't be used, or null if it can. A folder the user picked
// themselves may sit outside the filing system; suggestions may not. _Undo never.
function checkDestination(ctx, destDir, { userChose }) {
  if (!destDir || !path.isAbsolute(destDir)) return 'Pick a folder first';
  if (isInside(destDir, path.join(ctx.creations, '_Undo'))) return "Files can't go in _Undo";
  if (!userChose && !isAllowedDest(ctx, destDir)) return 'Pick a folder first';
  return null;
}

// A typed project folder name, reduced to a single safe folder name.
function safeProjectName(typed, fallback) {
  const parts = String(typed || '').split(/[\\/]+/).map((s) => s.replace(/[<>:"|?*]/g, ' ').trim())
    .filter((s) => s && s !== '.' && s !== '..');
  const name = parts.length > 1 && /[\\/]/.test(typed) && !/\.\./.test(typed) ? parts.join(' ') : parts.pop();
  return (name || '').replace(/\s+/g, ' ').replace(/[. ]+$/, '') || fallback;
}

module.exports = { checkDestination, safeProjectName };
