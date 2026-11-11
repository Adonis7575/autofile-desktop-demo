const api = window.autofile;
const rows = new Map();   // id -> proposal from main
const edits = new Map();  // id -> { destDir?, newName? } typed by the user
let home = '';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const SOURCE_LABEL = { claude: 'read by Claude', rule: 'your rule', fallback: 'basic rules', duplicate: 'duplicate', project: 'project copy', already: 'already filed' };

function crumbs(dir) {
  if (!dir) return null;
  let parts;
  if (home && dir.toLowerCase().startsWith(home.toLowerCase() + '\\')) parts = dir.slice(home.length + 1).split('\\');
  else parts = dir.split('\\');
  return parts.filter(Boolean);
}

function destTab(dir) {
  const tab = el('span', 'dest');
  const parts = crumbs(dir);
  if (!parts) { tab.classList.add('none'); tab.textContent = 'No folder yet'; return tab; }
  parts.forEach((p, i) => {
    if (i) tab.append(el('span', 'sep', '›'));
    tab.append(el('span', i === parts.length - 1 ? 'leaf' : '', p));
  });
  tab.title = dir;
  return tab;
}

function current(p) {
  const e = edits.get(p.id) || {};
  return { destDir: e.destDir ?? p.destDir, newName: e.newName ?? p.newName };
}

function setEdit(id, patch) {
  edits.set(id, { ...(edits.get(id) || {}), ...patch });
}

async function act(promise) {
  const p = await promise;
  if (p) { rows.set(p.id, p); if (p.status !== 'pending') edits.delete(p.id); draw(p); }
  refresh();
  return p;
}

function approve(id) {
  const p = rows.get(id);
  if (!p || p.status !== 'pending' || p.question) return null;
  p.status = 'moving';
  draw(p); // swaps the ✓ for a spinner so it can't be clicked twice
  return act(api.approve(id, edits.get(id) || {}));
}

function renderRow(p) {
  const li = el('li', 'row');
  li.dataset.id = p.id;
  li.dataset.status = p.status;
  li.dataset.name = p.name;
  li.tabIndex = 0;
  const { destDir, newName } = current(p);
  const pending = p.status === 'pending';
  const asking = pending && !!p.question;
  li.classList.toggle('asking', asking);

  const main = el('div', 'body');
  const kind = p.kind === 'project' ? 'Project folder' : '';
  const renamed = newName !== p.name ? `was ${p.name}` : '';
  if (kind || renamed) main.append(el('div', 'was', [kind, renamed].filter(Boolean).join(', ')));

  const name = el('input', 'name');
  name.value = newName;
  name.readOnly = !pending;
  name.setAttribute('aria-label', 'New name');
  name.addEventListener('change', () => setEdit(p.id, { newName: name.value }));
  main.append(name);

  const line = el('div', 'dest-line');
  const tab = destTab(destDir);
  line.append(tab);
  if (pending) {
    const change = el('button', 'ghost change', 'Change folder');
    change.addEventListener('click', async () => {
      const picked = await api.pickFolder(destDir);
      if (picked) { setEdit(p.id, { destDir: picked }); if (p.question) await act(api.answer(p.id, picked)); else draw(p); }
    });
    const type = el('button', 'ghost change', 'Type a path');
    type.addEventListener('click', () => {
      const input = el('input', 'path-input');
      input.value = destDir || '';
      input.setAttribute('list', 'destList');
      input.setAttribute('aria-label', 'Destination folder');
      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
          setEdit(p.id, { destDir: input.value.trim() });
          if (p.question) await act(api.answer(p.id, input.value.trim())); else draw(p);
        }
        if (e.key === 'Escape') draw(p);
      });
      type.replaceWith(input);
      input.focus();
    });
    line.append(change, type);
  }
  main.append(line);

  if (p.status !== 'reading') {
    const why = el('div', 'why', p.reason || '');
    const label = SOURCE_LABEL[p.source];
    if (label) why.append(el('span', 'chip', p.source === 'claude' ? `${label} · ${Math.round(p.confidence * 100)}% sure` : label));
    main.append(why);
  }

  if (asking) {
    const q = el('div', 'question');
    q.append(el('p', '', p.question.text));
    for (const o of p.question.options || []) {
      const b = el('button', 'option', o.label);
      b.title = o.destDir;
      b.addEventListener('click', () => act(api.answer(p.id, o.destDir)));
      q.append(b);
    }
    if (!(p.question.options || []).length) {
      const leave = el('button', 'option', 'Leave it where it is');
      leave.addEventListener('click', () => act(api.answer(p.id, null)));
      q.append(leave);
    }
    main.append(q);
  }
  if (p.error) main.append(el('div', 'error', p.error === 'in use, retry' ? 'That file is open in another program. Close it, then click ✓ again.' : p.error));
  li.append(main);

  const side = el('div', 'side');
  if (p.status === 'reading' || p.status === 'moving') {
    side.append(el('div', 'spinner'));
  } else if (pending && !asking) {
    const ok = el('button', 'approve', '✓');
    ok.setAttribute('aria-label', `Approve: move to ${destDir || 'chosen folder'}`);
    ok.title = 'Move it there';
    ok.addEventListener('click', () => approve(p.id));
    side.append(ok);
  }
  if (pending) {
    const skip = el('button', 'skip', 'Skip');
    skip.addEventListener('click', () => act(api.skip(p.id)));
    side.append(skip);
  }
  if (p.status === 'moved') {
    const done = el('div', 'done');
    done.append(el('span', '', 'Moved'));
    const show = el('button', 'ghost', 'Show');
    show.addEventListener('click', () => api.reveal(p.finalPath));
    const undo = el('button', 'ghost undo', 'Undo');
    undo.addEventListener('click', () => act(api.undo(p.id)));
    done.append(show, undo);
    side.append(done);
  }
  if (p.status === 'skipped') side.append(el('span', 'why', p.source === 'already' ? 'Already filed' : 'Skipped'));
  li.append(side);

  li.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === li) approve(p.id); });
  return li;
}

function draw(p) {
  const fresh = renderRow(p);
  const old = $(`.row[data-id="${p.id}"]`);
  if (old) old.replaceWith(fresh); else $('#list').append(fresh);
}

function refresh() {
  const all = [...rows.values()];
  const count = (f) => all.filter(f).length;
  const reading = count((p) => p.status === 'reading');
  const ready = count((p) => p.status === 'pending' && !p.question && p.destDir);
  const asking = count((p) => p.status === 'pending' && p.question);
  const moved = count((p) => p.status === 'moved');
  document.body.classList.toggle('has-rows', all.length > 0);
  const bits = [];
  if (reading) bits.push(`Reading ${all.length - reading} of ${all.length}…`);
  if (ready) bits.push(`${ready} ready`);
  if (asking) bits.push(`${asking} need${asking === 1 ? 's' : ''} your answer`);
  if (moved) bits.push(`${moved} filed`);
  $('#status').textContent = bits.join(', ');
  $('#approveAll').hidden = ready === 0;
  $('#approveAll').textContent = `Approve all ready (${ready})`;
  $('#clear').hidden = count((p) => p.status === 'moved' || p.status === 'skipped') === 0;
  $('#progress').hidden = reading === 0;
  $('#progressFill').style.width = `${all.length ? ((all.length - reading) / all.length) * 100 : 0}%`;
}

api.onProposals((list) => {
  for (const p of list) { rows.set(p.id, p); draw(p); }
  refresh();
});
api.onError((msg) => { $('#status').textContent = msg; });

// A FileList arrives empty on the other side of the preload bridge; a plain array of Files doesn't.
function pathsOf(fileList) {
  return api.pathsFromDrop(Array.from(fileList || []));
}

async function add(paths) {
  if (!paths.length) {
    $('#status').textContent = "Nothing to add: drop files or folders from File Explorer.";
    return;
  }
  try {
    await api.addPaths(paths);
  } catch (e) {
    $('#status').textContent = `Couldn't read what was dropped: ${e.message}`;
  }
}

// Drag and drop anywhere on the window.
let depth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; $('#dropOverlay').hidden = false; });
window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) $('#dropOverlay').hidden = true; });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  depth = 0;
  $('#dropOverlay').hidden = true;
  add(pathsOf(e.dataTransfer.files));
});

$('#browse').addEventListener('click', () => $('#filePicker').click());
$('#sample').addEventListener('click', async () => {
  try {
    const sample = await api.addSample();
    if (sample) await api.addPaths([sample]);
  } catch (error) {
    $('#status').textContent = `Couldn't load the sample: ${error.message}`;
  }
});
$('#filePicker').addEventListener('change', (e) => {
  add(pathsOf(e.target.files));
  e.target.value = ''; // so picking the same file again still fires
});

$('#approveAll').addEventListener('click', async () => {
  const btn = $('#approveAll');
  btn.disabled = true;
  for (const p of [...rows.values()]) {
    if (p.status === 'pending' && !p.question && current(p).destDir) await approve(p.id);
  }
  btn.disabled = false;
  refresh();
});

$('#clear').addEventListener('click', async () => {
  await api.clearDone();
  for (const [id, p] of rows) {
    if (p.status === 'moved' || p.status === 'skipped') { rows.delete(id); $(`.row[data-id="${id}"]`)?.remove(); }
  }
  refresh();
});

(async () => {
  home = (await api.info()).home;
  const list = $('#destList');
  for (const d of await api.destinations()) { const o = document.createElement('option'); o.value = d; list.append(o); }
  refresh();
})();
