const path = require('node:path');
const { subdirs } = require('./folders');
const { cleanName } = require('./naming');

const INSTALLER_EXT = new Set(['.exe', '.msi', '.msix', '.msixbundle', '.appx']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.wmv']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg']);

function isInstaller(item) {
  return INSTALLER_EXT.has(item.ext) || (item.ext === '.zip' && /setup|installer/i.test(item.name));
}

function bucketQuestion(ctx, text = 'Where does this go?') {
  const C = ctx.creations;
  return {
    text,
    options: [
      { label: 'School', destDir: path.join(C, '03 School') },
      { label: 'Business', destDir: path.join(C, '02 Business') },
      { label: 'Personal', destDir: path.join(C, '05 Personal') },
      { label: 'Reference', destDir: path.join(C, '06 Reference') },
      { label: 'Career', destDir: path.join(C, '04 Career') },
    ],
  };
}

const squashKey = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Simple keyword rules used when Claude can't be reached.
function fallbackPropose(ctx, item, excerpt) {
  const base = { id: item.id, src: item.src, kind: item.kind, newName: item.kind === 'project' ? item.name : cleanName(item.name),
    source: 'fallback', status: 'pending' };
  const say = (destDir, confidence, reason) => ({ ...base, destDir, confidence, reason });
  const hay = `${item.name} ${excerpt || ''}`;

  if (item.kind === 'file' && isInstaller(item)) {
    if (ctx.eMounted) return say(ctx.installersDir, 0.9, 'Installer — re-downloadable, so it lives on the installer drive');
    return { ...say(null, 0, 'Installer, but the installer drive is not plugged in'),
      question: { text: 'The installer drive isn\'t plugged in. Leave this installer where it is for now?', options: [] } };
  }

  const school = path.join(ctx.creations, '03 School');
  const nums = [...hay.matchAll(/(?:CSCI\s?|\b)(\d{4})(?=[_/\s.\-]|$)/gi)].map((m) => m[1]);
  for (const course of subdirs(school)) {
    const n = (course.match(/\d{4}/) || [])[0];
    if (n && nums.includes(n)) return say(path.join(school, course), 0.75, `Mentions course ${n}`);
  }

  const projects = path.join(ctx.creations, '01 Projects');
  const hayKey = squashKey(hay);
  for (const proj of subdirs(projects)) {
    if (squashKey(proj).length >= 4 && hayKey.includes(squashKey(proj))) return say(path.join(projects, proj), 0.7, `Mentions your ${proj} project`);
  }

  if (/resume|résumé|cover letter|transcript/i.test(hay)) return say(path.join(ctx.creations, '04 Career'), 0.7, 'Looks like a career document');
  if (VIDEO_EXT.has(item.ext)) return say(path.join(ctx.home, 'Videos'), 0.5, 'Video file');
  if (AUDIO_EXT.has(item.ext)) return say(path.join(ctx.home, 'Music'), 0.5, 'Audio file');

  return { ...say(null, 0, 'Not sure what this is'), question: bucketQuestion(ctx) };
}

module.exports = { fallbackPropose, bucketQuestion, isInstaller };
