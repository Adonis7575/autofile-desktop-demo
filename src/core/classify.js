const path = require('node:path');
const { extractSummary } = require('./extract');
const { buildPrompt } = require('./claude');
const { fallbackPropose, bucketQuestion, isInstaller } = require('./fallback');
const { isAllowedDest } = require('./folders');
const { loadRules, matchRule } = require('./rules');
const { cleanName } = require('./naming');
const { hashFile } = require('./scan');
const { findExistingProject, compareProjects } = require('./projects');

const BATCH = 10;
const CONCURRENCY = 3;
const CHUNK = 30;
const ASK_BELOW = 0.6;

const sameDir = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// Code is loaded by name, so code files only lose a " (1)" copy suffix.
const CODE_EXT = new Set(['.py', '.js', '.jsx', '.ts', '.tsx', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.rs', '.rb', '.php',
  '.ipynb', '.sql', '.sh', '.ps1', '.bat', '.css', '.json', '.yml', '.yaml', '.toml', '.r', '.m']);
const COPY_SUFFIX = /\s*\(\d+\)(?=\.[^.]+$|$)/;

function defaultName(item) {
  if (item.kind === 'project') return item.name;
  if (CODE_EXT.has(item.ext)) return item.name.replace(COPY_SUFFIX, '');
  return cleanName(item.name);
}

function baseProposal(item) {
  return { id: item.id, src: item.src, kind: item.kind, newName: defaultName(item), status: 'pending' };
}

// For each set of identical files, the copy worth keeping: no " (1)" suffix, then the shortest name.
function pickPrimaries(items) {
  const primary = new Map();
  const score = (i) => [COPY_SUFFIX.test(i.name) ? 1 : 0, i.name.length];
  for (const item of items) {
    if (!item.hash) continue;
    const cur = primary.get(item.hash);
    if (!cur) { primary.set(item.hash, item); continue; }
    const [a1, a2] = score(item), [b1, b2] = score(cur);
    if (a1 < b1 || (a1 === b1 && a2 < b2)) primary.set(item.hash, item);
  }
  return primary;
}

// Everything decided without Claude: duplicates, installers, project copies, learned rules.
function quickDecision(ctx, item, excerpt, rules, primaries) {
  const base = baseProposal(item);
  const keeper = item.hash && primaries.get(item.hash);
  if (keeper && keeper !== item) {
    return { ...base, source: 'duplicate', confidence: 1, destDir: path.join(ctx.creations, '_Archive', 'Duplicates'),
      newName: item.name, reason: `Exact copy of ${keeper.name}` };
  }
  if (item.kind === 'file' && isInstaller(item)) return fallbackPropose(ctx, item, excerpt);
  if (item.kind === 'project') {
    const existing = findExistingProject(ctx, item);
    if (existing) {
      const name = path.basename(existing);
      const cmp = compareProjects(item.src, existing);
      if (cmp.newer === 'b') {
        return { ...base, source: 'project', confidence: 0.95, destDir: path.join(ctx.creations, '_Archive', `${name} old copies`),
          reason: `Older copy of your ${name} project (last changed ${day(cmp.aLatest)} vs ${day(cmp.bLatest)})` };
      }
      const archive = path.join(ctx.creations, '_Archive', `${name} old copies`);
      return { ...base, source: 'project', confidence: 0.9, destDir: path.dirname(existing), newName: name, replaceExisting: existing,
        reason: `Newer than your current ${name} (changed ${day(cmp.aLatest)} vs ${day(cmp.bLatest)})`,
        question: {
          text: `Replace your current ${name} with this newer copy? The current one goes to _Archive.`,
          options: [{ label: 'Yes, replace it', destDir: path.dirname(existing) }, { label: 'No, archive this copy', destDir: archive }],
        } };
    }
  }
  const rule = matchRule(rules, item, excerpt);
  if (rule) {
    return { ...base, source: 'rule', confidence: 0.95, destDir: rule.destDir,
      reason: `You filed similar files here (${rule.tokens.join(', ') || rule.ext})` };
  }
  return null;
}

// Checks Claude's answer against the rules of the filing system.
function finalize(ctx, item, excerpt, r) {
  const base = baseProposal(item);
  const p = { ...base, source: 'claude', destDir: r.destDir || null, reason: r.reason || '', confidence: Number(r.confidence) || 0,
    newName: r.newName ? cleanName(r.newName.endsWith(item.ext) || item.kind === 'project' ? r.newName : r.newName + item.ext) : base.newName };
  if (item.kind === 'project') p.newName = p.newName.replace(new RegExp(`${item.ext}$`), '');
  if (CODE_EXT.has(item.ext)) p.newName = defaultName(item);
  const options = (r.options || []).filter((o) => isAllowedDest(ctx, o.destDir));
  if (r.question) p.question = { text: r.question, options };
  if (p.destDir && !isAllowedDest(ctx, p.destDir)) {
    p.destDir = null;
    p.confidence = 0;
    p.question = { ...bucketQuestion(ctx, p.question?.text || 'Where does this go?'), ...(options.length ? { options } : {}) };
  }
  if (!p.destDir && !p.question) p.question = bucketQuestion(ctx);
  if (p.confidence < ASK_BELOW && !p.question) p.question = fallbackPropose(ctx, item, excerpt).question || bucketQuestion(ctx);
  if (p.question && !p.question.options.length && p.question.text && !/installer drive/.test(p.question.text)) {
    p.question.options = bucketQuestion(ctx).options;
  }
  return p;
}

// Any proposal pointing at the folder the item already sits in is "already filed".
function markAlready(item, p) {
  if (!sameDir(p.destDir, path.dirname(item.src))) return p;
  const q = { ...p, source: 'already', reason: p.newName === item.name ? 'Already filed here' : 'Already in the right folder; only the name changes' };
  delete q.question;
  return q;
}

// Hashes only files whose size matches another dropped file: the only ones that can be duplicates.
async function hashCollisions(items) {
  const bySize = new Map();
  for (const i of items) if (i.kind === 'file' && i.size > 0) bySize.set(i.size, [...(bySize.get(i.size) || []), i]);
  for (const group of bySize.values()) {
    if (group.length < 2) continue;
    for (const i of group) { try { i.hash = await hashFile(i.src); } catch { /* unreadable: treat as unique */ } }
  }
}

// Keeps at most `n` Claude processes alive across all chunks.
function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => { if (active < n && queue.length) { active++; queue.shift()(); } };
  return (fn) => new Promise((resolve, reject) => {
    queue.push(() => Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); }));
    next();
  });
}
const claudeSlots = limiter(CONCURRENCY);

async function runPool(tasks, n) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) await tasks[i++]();
  });
  await Promise.all(workers);
}

// Proposes a destination for every item. onBatch receives proposals as they finish.
// Big drops are worked in chunks so the first rows appear within seconds.
async function classifyAll(ctx, items, onBatch = () => {}) {
  const rules = loadRules(ctx);
  await hashCollisions(items);
  const seen = pickPrimaries(items);
  const results = new Map();
  const chunks = [];
  for (let k = 0; k < items.length; k += CHUNK) chunks.push(items.slice(k, k + CHUNK));
  await runPool(chunks.map((chunk) => () => classifyChunk(ctx, chunk, rules, seen, results, onBatch)), CONCURRENCY);
  return items.map((i) => results.get(i.id));
}

async function classifyChunk(ctx, items, rules, seen, results, onBatch) {
  const summaries = new Map();
  for (const item of items) summaries.set(item.id, await extractSummary(item));

  const quick = [];
  const pending = [];
  for (const item of items) {
    const s = summaries.get(item.id);
    let q = quickDecision(ctx, item, s.excerpt, rules, seen);
    if (q && q.source !== 'duplicate' && q.source !== 'project') q = markAlready(item, q);
    if (!q && !ctx.runClaude) q = markAlready(item, fallbackPropose(ctx, item, s.excerpt));
    if (q) { quick.push(q); results.set(item.id, q); } else pending.push(item);
    await new Promise(setImmediate); // let approvals and window events through during big drops
  }
  if (quick.length) onBatch(quick);

  const textItems = pending.filter((i) => !summaries.get(i.id).isImage);
  const imageItems = pending.filter((i) => summaries.get(i.id).isImage);
  const batches = [];
  for (const group of [textItems, imageItems]) for (let k = 0; k < group.length; k += BATCH) batches.push(group.slice(k, k + BATCH));

  await runPool(batches.map((batch) => async () => {
    const entries = batch.map((item) => ({ item, ...summaries.get(item.id) }));
    let out;
    try {
      const answer = await claudeSlots(() => ctx.runClaude(buildPrompt(ctx, entries, rules)));
      const byId = new Map((answer.results || []).map((r) => [r.id, r]));
      out = entries.map(({ item, excerpt }) => (byId.has(item.id)
        ? finalize(ctx, item, excerpt, byId.get(item.id))
        : fallbackPropose(ctx, item, excerpt)));
    } catch (e) {
      out = entries.map(({ item, excerpt }) => ({ ...fallbackPropose(ctx, item, excerpt), note: `Claude unavailable: ${e.message}` }));
    }
    out = out.map((p, k) => markAlready(entries[k].item, p));
    for (const p of out) results.set(p.id, p);
    onBatch(out);
  }), CONCURRENCY);
}

module.exports = { classifyAll, ASK_BELOW };
