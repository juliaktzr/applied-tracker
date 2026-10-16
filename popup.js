const STATUS_LABELS = {
  viewed: 'Viewed',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected'
};

const FILTERS = {
  active: s => s === 'applied' || s === 'interviewing' || s === 'offer',
  viewed: s => s === 'viewed',
  rejected: s => s === 'rejected',
  all: () => true
};

const EMPTY = {
  active: ['No applications yet', 'Apply somewhere and it shows up here automatically.'],
  viewed: ['Nothing viewed yet', 'Job postings you open will land here.'],
  rejected: ['No rejections', 'Nothing here. Keep it that way.'],
  all: ['Nothing tracked yet', 'Open a job posting to get started.']
};

let jobs = {};
let filter = 'active';
let query = '';
let pendingDelete = null;

const $ = sel => document.querySelector(sel);
const svgNS = 'http://www.w3.org/2000/svg';

function hostLabel(url) {
  try {
    const h = new URL(url).hostname.replace(/^(www|careers|jobs|apply)\./, '');
    const first = h.split('.')[0];
    return first.charAt(0).toUpperCase() + first.slice(1);
  } catch (_) {
    return 'Unknown';
  }
}

const DAY_MS = 86400000;

// 3/12/26
function shortDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
}

// yyyy-mm-dd in local time, for <input type="date">
function inputDate(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// today, yesterday, 5 days ago, 3 weeks ago, 2 months ago, 1 year ago
function ago(ts) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const then = new Date(ts); then.setHours(0, 0, 0, 0);
  const days = Math.round((today - then) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) {
    const m = Math.floor(days / 30);
    return `${m} month${m === 1 ? '' : 's'} ago`;
  }
  const y = Math.floor(days / 365);
  return `${y} year${y === 1 ? '' : 's'} ago`;
}

// "Applied 3/12/26 · 2 weeks ago". Click the date to correct it.
function dateLine(job) {
  const wrap = document.createElement('div');
  wrap.className = 'when';

  const applied = job.status !== 'viewed' && job.appliedAt;
  const ts = applied ? job.appliedAt : job.firstSeen;

  const btn = document.createElement('button');
  btn.className = 'date-btn';
  btn.textContent = `${applied ? 'Applied' : 'Viewed'} ${shortDate(ts)}`;

  const rel = document.createElement('span');
  rel.className = 'ago';
  rel.textContent = ` · ${ago(ts)}`;

  if (applied) {
    btn.title = 'Change applied date';
    btn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'date';
      input.className = 'date-input';
      input.value = inputDate(ts);
      input.max = inputDate(Date.now());
      btn.replaceWith(input);
      input.focus();
      try { input.showPicker(); } catch (_) { /* picker not available, typing still works */ }

      let saved = false;
      input.addEventListener('change', () => {
        if (!input.value) return;
        const [y, m, d] = input.value.split('-').map(Number);
        const t = new Date(y, m - 1, d, 12).getTime();
        saved = true;
        update(job.id, { appliedAt: t });
      });
      input.addEventListener('blur', () => { if (!saved) render(); });
    });
  } else {
    btn.disabled = true;
  }

  wrap.append(btn, rel);
  return wrap;
}

function hueFor(str) {
  let h = 0;
  for (const ch of str || '') h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function icon(pathD, size = 14) {
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  const p = document.createElementNS(svgNS, 'path');
  p.setAttribute('d', pathD);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2500);
}

async function load() {
  const data = await chrome.storage.local.get('jobs');
  jobs = data.jobs || {};
  render();
}

async function update(id, patch) {
  const data = await chrome.storage.local.get('jobs');
  const cur = data.jobs || {};
  if (!cur[id]) return;
  if (patch.status && patch.status !== 'viewed' && !cur[id].appliedAt) patch.appliedAt = Date.now();
  Object.assign(cur[id], patch, { updatedAt: Date.now() });
  await chrome.storage.local.set({ jobs: cur });
}

async function remove(id) {
  const data = await chrome.storage.local.get('jobs');
  const cur = data.jobs || {};
  delete cur[id];
  await chrome.storage.local.set({ jobs: cur });
}

function editable(className, value, id, field) {
  const el = document.createElement('div');
  el.className = className;
  el.contentEditable = 'plaintext-only';
  el.spellcheck = false;
  el.title = 'Click to edit';
  el.textContent = value;
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { el.textContent = value; el.blur(); }
  });
  el.addEventListener('blur', () => {
    const v = el.textContent.trim();
    if (!v) { el.textContent = value; return; }
    if (v !== value) update(id, { [field]: v });
  });
  return el;
}

function card(job, index) {
  const el = document.createElement('div');
  el.className = `card s-${job.status}`;
  el.style.animationDelay = `${Math.min(index, 8) * 25}ms`;

  const company = job.company || 'Unknown company';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.style.setProperty('--h', hueFor(company));
  avatar.textContent = (company.match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase();

  const body = document.createElement('div');
  body.className = 'body';

  // Row 1: title + hover actions
  const row1 = document.createElement('div');
  row1.className = 'row1';

  const actions = document.createElement('div');
  actions.className = 'actions';

  const open = document.createElement('button');
  open.className = 'icon-btn';
  open.title = 'Open posting';
  open.disabled = !job.url;
  open.append(icon('M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4'));
  open.addEventListener('click', () => chrome.tabs.create({ url: job.url }));

  const del = document.createElement('button');
  del.className = 'icon-btn';
  if (pendingDelete === job.id) {
    del.classList.add('danger');
    del.textContent = 'Delete?';
  } else {
    del.title = 'Remove';
    del.append(icon('M6 6l12 12M18 6L6 18'));
  }
  del.addEventListener('click', () => {
    if (pendingDelete === job.id) {
      pendingDelete = null;
      remove(job.id);
    } else {
      pendingDelete = job.id;
      render();
      setTimeout(() => { if (pendingDelete === job.id) { pendingDelete = null; render(); } }, 3000);
    }
  });
  if (pendingDelete === job.id) actions.style.opacity = '1';
  actions.append(open, del);

  row1.append(editable('title', job.title || 'Untitled role', job.id, 'title'), actions);

  // Row 2: status pill + meta
  const row2 = document.createElement('div');
  row2.className = 'row2';

  const select = document.createElement('select');
  select.className = `pill p-${job.status}`;
  for (const [value, label] of Object.entries(STATUS_LABELS)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (value === job.status) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener('change', () => update(job.id, { status: select.value }));

  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = job.source || '';

  row2.append(select, meta);

  body.append(row1, editable('company', company, job.id, 'company'), dateLine(job), row2);
  el.append(avatar, body);
  return el;
}

function emptyState() {
  const [title, text] = query.trim() ? ['No matches', 'Try a different company or role.'] : EMPTY[filter];
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  const ic = document.createElement('div');
  ic.className = 'icon';
  ic.append(icon('M4 7h16M4 12h10M4 17h7', 20));
  const strong = document.createElement('strong');
  strong.textContent = title;
  const p = document.createElement('p');
  p.textContent = text;
  wrap.append(ic, strong, p);
  return wrap;
}

function render() {
  const all = Object.values(jobs);
  const count = s => all.filter(j => j.status === s).length;

  $('#nApplied').textContent = all.filter(j => j.status !== 'viewed').length;
  $('#nInterviewing').textContent = count('interviewing');
  $('#nOffer').textContent = count('offer');
  $('#nRejected').textContent = count('rejected');

  for (const btn of document.querySelectorAll('#filters button')) {
    const f = btn.dataset.f;
    if (!btn.dataset.label) btn.dataset.label = btn.textContent.trim();
    btn.textContent = btn.dataset.label;
    const c = document.createElement('span');
    c.className = 'count';
    c.textContent = all.filter(j => FILTERS[f](j.status)).length;
    btn.append(c);
    btn.classList.toggle('on', f === filter);
  }

  const q = query.trim().toLowerCase();
  const items = all
    .filter(j => FILTERS[filter](j.status))
    .filter(j => !q || `${j.title} ${j.company}`.toLowerCase().includes(q))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const list = $('#list');
  list.textContent = '';
  if (!items.length) {
    list.append(emptyState());
    return;
  }
  items.forEach((j, i) => list.append(card(j, i)));
}

// ---------- actions ----------
document.querySelectorAll('#filters button').forEach(btn => {
  btn.addEventListener('click', () => { filter = btn.dataset.f; render(); });
});

$('#search').addEventListener('input', e => { query = e.target.value; render(); });

$('#addPage').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    toast('Open a job page first.');
    return;
  }

  // Ask the page itself first; this works even if Chrome hides tab.url.
  let job = null;
  try {
    job = await chrome.tabs.sendMessage(tab.id, { type: 'extractJob' }, { frameId: 0 });
  } catch (_) { /* no content script: page predates install, or not a normal webpage */ }

  if (!job || !job.title) {
    if (!/^https?:/.test(tab.url || '')) {
      toast('Refresh the job page, then try again.');
      return;
    }
    job = { title: tab.title || 'Untitled role', company: hostLabel(tab.url), url: tab.url, source: hostLabel(tab.url) };
  }

  await chrome.runtime.sendMessage({ type: 'manualAdd', job });
  filter = 'active';
  render();
  toast(`Tracked: ${job.title}`);
});

$('#export').addEventListener('click', () => {
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const iso = ts => (ts ? new Date(ts).toISOString().slice(0, 10) : '');
  const rows = [['Company', 'Role', 'Status', 'Applied', 'First seen', 'Source', 'Link']];
  for (const j of Object.values(jobs).sort((a, b) => (b.appliedAt || 0) - (a.appliedAt || 0))) {
    rows.push([j.company, j.title, STATUS_LABELS[j.status], iso(j.appliedAt), iso(j.firstSeen), j.source, j.url]);
  }
  const csv = rows.map(r => r.map(esc).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `applications-${iso(Date.now())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// Live refresh when the background script logs something, but don't
// re-render while you're in the middle of editing a field.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.jobs) return;
  jobs = changes.jobs.newValue || {};
  if (document.activeElement && document.activeElement.isContentEditable) return;
  render();
});

load();
