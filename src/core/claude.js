const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { folderMap } = require('./folders');

let claudePath = null;
function findClaude() {
  if (claudePath) return claudePath;
  const local = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
  if (fs.existsSync(local)) return (claudePath = local);
  try {
    const hits = execFileSync('where.exe', ['claude'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
    claudePath = hits.find((h) => h.toLowerCase().endsWith('.exe')) || null;
  } catch { claudePath = null; }
  return claudePath;
}

// Kept tiny on purpose: everything long goes through stdin, because Windows
// command lines top out around 32,000 characters.
const SYSTEM = 'You file documents for the workspace owner. Follow the filing instructions in the message exactly and answer only in the requested JSON shape.';

// Pinned by exact id (not the "haiku" alias) so an alias change can't swap the model.
const MODEL = 'claude-haiku-5-5';
let modelsUsed = []; // what the most recent call actually ran on, for checks

function claudeArgs({ system, schema, readDirs = [] }) {
  const args = ['-p', '--model', MODEL, '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '',
    '--system-prompt', system, '--output-format', 'json', '--json-schema', JSON.stringify(schema)];
  if (readDirs.length) {
    args.push('--tools', 'Read', '--allowedTools', 'Read');
    for (const d of readDirs) args.push('--add-dir', d);
  } else {
    args.push('--tools', '');
  }
  return args;
}

// Runs one headless Claude Code call and returns its structured answer.
function runClaude({ system, prompt, schema, readDirs = [], timeoutMs = 90000 }) {
  return new Promise((resolve, reject) => {
    const exe = findClaude();
    if (!exe) return reject(new Error('Claude Code (claude.exe) not found'));
    const args = claudeArgs({ system, schema, readDirs });
    const child = spawn(exe, args, { windowsHide: true, cwd: os.tmpdir() });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Claude timed out')); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        if (code !== 0 || j.is_error || !j.structured_output) return reject(new Error(j.result || err || `claude exited ${code}`));
        modelsUsed = Object.keys(j.modelUsage || {});
        if (modelsUsed.some((m) => !m.startsWith(MODEL))) console.warn(`Autofile: expected ${MODEL}, Claude Code used ${modelsUsed.join(', ')}`);
        resolve(j.structured_output);
      } catch {
        reject(new Error(err.trim() || `claude exited ${code}`));
      }
    });
    child.stdin.end(prompt);
  });
}

const SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          destDir: { type: 'string', description: 'Absolute folder path from the folder map, or a new subfolder inside one. Empty string if unsure.' },
          newName: { type: 'string', description: 'Suggested file name including extension' },
          reason: { type: 'string', description: 'One short sentence, under 120 characters' },
          confidence: { type: 'number' },
          question: { type: 'string', description: 'Only when unsure: a plain question for the workspace owner' },
          options: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, destDir: { type: 'string' } }, required: ['label', 'destDir'] } },
        },
        required: ['id', 'destDir', 'newName', 'reason', 'confidence'],
      },
    },
  },
  required: ['results'],
};

function instructions(ctx, rules) {
  const C = ctx.creations;
  return `You file documents for the owner of this filing workspace.
For each item, choose the folder it belongs in and suggest a clear file name. Read the excerpt, not just the filename.

FOLDERS THAT EXIST (absolute paths; indented names are subfolders):
${folderMap(ctx)}

WHERE THINGS GO
- ${C}\\01 Projects\\<Project>: files that belong to one of his existing software projects. A whole new software project folder goes in ${C}\\01 Projects.
- ${C}\\02 Business\\<Area>: business documents, proposals and plans.
- ${C}\\03 School\\<Course>: coursework — lecture slides, assignments, syllabi, exams, advising forms. Course folders are named "CSCI #### Name" (e.g. "CSCI 4425 Deep Learning"). If the course has no folder yet, propose a new one with that naming. Non-course school paperwork goes in ${C}\\03 School.
- ${C}\\04 Career: resumes, cover letters, transcripts, job applications.
- ${C}\\05 Personal: wedding, travel, games, schedules, health, personal data exports, receipts.
- ${C}\\06 Reference: cheat sheets, guides, prompts, how-tos, documentation, research papers kept for reference.
- ${ctx.home}\\Videos and ${ctx.home}\\Music: videos and audio that don't clearly belong to a Creations folder (a lecture recording belongs to its course).
${ctx.eMounted ? `- ${ctx.installersDir}: installers only (.exe/.msi/setup zips). Nothing else goes on the installer drive.` : '- The installer drive is not connected: never propose that drive.'}
Never propose: ${C}\\00 Main Dashboard, ${C}\\Icons, ${C}\\_Tools, ${C}\\_Undo, or any path outside the folders above.

NAMING
- Title Case with spaces: "Topic - What It Is - Date.ext" when a date is meaningful, otherwise "Topic - What It Is.ext".
- Examples: "292c2cab-....pdf" containing lecture 10 on CNNs for CSCI 4425 -> "CSCI 4425 - Lecture 10 - Convolutional Networks Part 1.pdf"; "sample_fall_schedule.png" -> "Fall Work Schedule 2026.png".
- Keep the original name if it is already clear. Always keep the original extension. No GUIDs, no " (1)".
- Number lectures, chapters, labs and assignments with two digits ("Lecture 02", "Lab 03") so they sort in order.
- Use the same wording for files from the same series, so they sit together in the folder.
- For a software project folder, keep its name unless it is a GUID or "-main" download suffix (drop "-main").
${rules.length ? `\nLEARNED FROM USER CORRECTIONS (follow these):\n${rules.map((r) => `- names containing ${r.tokens.join(' + ') || r.ext} -> ${r.destDir}`).join('\n')}\n` : ''}
CONFIDENCE
- confidence is 0-1. If below 0.6, set destDir to your best guess (or "") and add a short plain question with 2-4 options, each option an absolute folder path.
- Reasons are one short sentence that cites what you saw ("Slides for CSCI 4425, lecture 10 on CNNs").`;
}

function buildPrompt(ctx, entries, rules) {
  const list = entries.map(({ item, excerpt, isImage }) => ({
    id: item.id,
    name: item.name,
    kind: item.kind,
    ext: item.ext,
    sizeKB: Math.round((item.size || 0) / 1024),
    folder: path.basename(path.dirname(item.src)),
    excerpt,
    ...(isImage ? { imagePath: item.src } : {}),
  }));
  const hasImages = list.some((e) => e.imagePath);
  const readDirs = [...new Set(entries.filter((e) => e.isImage).map((e) => path.dirname(e.item.src)))];
  const prompt = `${instructions(ctx, rules)}\n\n${hasImages ? 'Some items have an imagePath: use the Read tool to look at each image before deciding.\n' : ''}Return one result per item.\nITEMS:\n${JSON.stringify(list)}`;
  return { system: SYSTEM, prompt, schema: SCHEMA, readDirs };
}

module.exports = { runClaude, buildPrompt, findClaude, claudeArgs, MODEL, lastModelsUsed: () => modelsUsed };
