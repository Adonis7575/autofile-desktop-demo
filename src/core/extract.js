const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MAX = 1500;
const MAX_BYTES = 200 * 1024 * 1024;
const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.json', '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.c', '.cpp', '.h',
  '.css', '.xml', '.yml', '.yaml', '.ipynb', '.sql', '.ps1', '.bat', '.sh', '.log', '.ini', '.toml', '.r', '.m', '.tex']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

const squash = (s) => s.replace(/\s+/g, ' ').trim();
const cap = (s, n = MAX) => squash(s).slice(0, n);

function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function htmlText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const body = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<title[\s\S]*?<\/title>/i, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(`${title ? `Title: ${title}. ` : ''}${body}`);
}

function xmlTags(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return decodeEntities(out.join(' '));
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

async function pdfText(file) {
  const pdf = require('pdf-parse/lib/pdf-parse.js');
  const data = await withTimeout(pdf(await fsp.readFile(file), { max: 5 }), 10000);
  return { text: data.text, pages: data.numpages };
}

function officeZipText(file, ext) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(file);
  if (ext === '.pptx') {
    const slides = zip.getEntries().filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
      .sort((a, b) => Number(a.entryName.match(/\d+/)[0]) - Number(b.entryName.match(/\d+/)[0]));
    return slides.map((e) => xmlTags(e.getData().toString('utf8'), 'a:t')).join(' | ');
  }
  const ss = zip.getEntry('xl/sharedStrings.xml');
  return ss ? xmlTags(ss.getData().toString('utf8'), 't') : '';
}

function zipListing(file) {
  const AdmZip = require('adm-zip');
  const names = new AdmZip(file).getEntries().map((e) => e.entryName).slice(0, 40);
  return `ZIP: ${names.join(', ')}`;
}

async function readHead(file, bytes = 8000) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally { await fh.close(); }
}

async function projectSummary(dir) {
  const parts = [];
  const pkg = path.join(dir, 'package.json');
  if (fs.existsSync(pkg)) {
    try {
      const j = JSON.parse(await fsp.readFile(pkg, 'utf8'));
      parts.push(`package: ${j.name || ''} ${j.description || ''}`);
    } catch { /* unreadable package.json is fine */ }
  }
  const readme = fs.readdirSync(dir).find((n) => /^readme/i.test(n));
  if (readme) parts.push((await readHead(path.join(dir, readme), 4000)).slice(0, 800));
  const top = fs.readdirSync(dir).filter((n) => !n.startsWith('.') && n !== 'node_modules').slice(0, 25);
  parts.push(`contains: ${top.join(', ')}`);
  return parts.join(' | ');
}

// A short text description of what is inside the item. Never throws.
async function extractSummary(item) {
  const ext = item.ext;
  const isImage = IMAGE_EXT.has(ext);
  try {
    if (item.kind === 'project') return { excerpt: cap(await projectSummary(item.src)), isImage: false };
    if (isImage || item.size > MAX_BYTES) return { excerpt: '', isImage };
    if (ext === '.pdf') {
      const { text, pages } = await pdfText(item.src);
      return { excerpt: cap(text), isImage, pages };
    }
    if (ext === '.docx') {
      const mammoth = require('mammoth');
      return { excerpt: cap((await mammoth.extractRawText({ path: item.src })).value), isImage };
    }
    if (ext === '.pptx' || ext === '.xlsx') return { excerpt: cap(officeZipText(item.src, ext)), isImage };
    if (ext === '.html' || ext === '.htm') return { excerpt: cap(htmlText(await readHead(item.src, 200000))), isImage };
    if (ext === '.zip') return { excerpt: cap(zipListing(item.src)), isImage };
    if (TEXT_EXT.has(ext)) return { excerpt: cap(await readHead(item.src)), isImage };
    return { excerpt: '', isImage };
  } catch {
    return { excerpt: '', isImage };
  }
}

module.exports = { extractSummary, IMAGE_EXT };
