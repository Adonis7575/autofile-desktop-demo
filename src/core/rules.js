const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const STOP = new Set(['the', 'and', 'final', 'copy', 'new', 'file', 'document', 'untitled', 'draft', 'v1', 'v2', 'for',
  'with', 'from', 'pdf', 'docx', 'pptx', 'notes', 'review', 'part']);

const rulesFile = (ctx) => path.join(ctx.dataDir, 'rules.json');

function loadRules(ctx) {
  try { return JSON.parse(fs.readFileSync(rulesFile(ctx), 'utf8')); } catch { return []; }
}

function saveRules(ctx, rules) {
  fs.mkdirSync(ctx.dataDir, { recursive: true });
  fs.writeFileSync(rulesFile(ctx), JSON.stringify(rules, null, 2));
}

// Picks up to three words from the filename that are likely to recur on
// similar files: course codes like "4140", names like "studio".
function tokensFrom(name) {
  const stem = name.replace(/\.[^.]+$/, '').toLowerCase();
  const words = stem.split(/[^a-z0-9]+/).filter(Boolean);
  const code = words.find((w) => /^\d{4}$/.test(w) && !/^(19|20)\d\d$/.test(w));
  if (code) return [code]; // a course-style number is the strongest signal on its own
  const keep = words.filter((w) => !STOP.has(w) && !/^\d+$/.test(w) && w.length >= 3);
  return [...new Set(keep)].slice(0, 2);
}

function saveRuleFromCorrection(ctx, item, destDir) {
  const tokens = tokensFrom(item.name);
  const rules = loadRules(ctx);
  const rule = { id: crypto.randomUUID(), ext: tokens.length ? null : item.ext || null, tokens, destDir, hits: 0, created: new Date().toISOString() };
  if (!tokens.length && !rule.ext) return null;
  const same = rules.findIndex((r) => r.tokens.join() === tokens.join() && r.ext === rule.ext);
  if (same >= 0) rules.splice(same, 1);
  rules.push(rule);
  saveRules(ctx, rules);
  return rule;
}

function matchRule(rules, item, excerpt) {
  const hay = `${item.name} ${excerpt || ''}`.toLowerCase();
  const nameWords = new Set(hay.split(/[^a-z0-9]+/));
  let best = null;
  for (const r of rules) {
    if (r.ext && r.ext !== item.ext) continue;
    if (!r.tokens.every((t) => nameWords.has(t))) continue;
    if (!best || r.tokens.length > best.tokens.length || (r.tokens.length === best.tokens.length && r.created > best.created)) best = r;
  }
  return best;
}

module.exports = { loadRules, saveRuleFromCorrection, matchRule, tokensFrom };
