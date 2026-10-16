// Stores jobs in chrome.storage.local, keyed by company + title.
// Statuses: viewed, applied, interviewing, offer, rejected.
// Auto-detection only ever moves a job from viewed to applied; everything
// past that is set by hand in the popup.

const VIEWED_TTL_MS = 30 * 24 * 60 * 60 * 1000; // drop never-applied views after 30 days
const TAB_JOB_TTL_MS = 3 * 60 * 60 * 1000;       // how long a tab "remembers" the job it showed

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const keyFor = job => `${norm(job.company)}|${norm(job.title)}`;

const hostLabel = url => {
  try {
    const h = new URL(url).hostname.replace(/^(www|careers|jobs|apply)\./, '');
    const first = h.split('.')[0];
    return first.charAt(0).toUpperCase() + first.slice(1);
  } catch (_) {
    return 'Unknown';
  }
};

// Serialize read-modify-write so simultaneous messages don't clobber each other.
let queue = Promise.resolve();
function withLock(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function upsert(job, status) {
  return withLock(async () => {
    const { jobs = {} } = await chrome.storage.local.get('jobs');
    const now = Date.now();
    const id = keyFor(job);
    const existing = jobs[id];

    if (existing) {
      if (status === 'applied' && existing.status === 'viewed') {
        existing.status = 'applied';
        existing.appliedAt = now;
      }
      if (!existing.url && job.url) existing.url = job.url;
      existing.updatedAt = now;
    } else {
      jobs[id] = {
        id,
        title: job.title || 'Untitled role',
        company: job.company || hostLabel(job.url),
        url: job.url || '',
        source: job.source || hostLabel(job.url),
        status,
        firstSeen: now,
        appliedAt: status === 'applied' ? now : null,
        updatedAt: now
      };
    }

    for (const [k, j] of Object.entries(jobs)) {
      if (j.status === 'viewed' && now - j.updatedAt > VIEWED_TTL_MS) delete jobs[k];
    }

    await chrome.storage.local.set({ jobs });
    return jobs[id];
  });
}

async function flashBadge(tabId) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#16a34a' });
    await chrome.action.setBadgeText({ tabId, text: '\u2713' });
    setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 6000);
  } catch (_) { /* tab closed */ }
}

const tabKey = id => `tab_${id}`;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;

  (async () => {
    switch (msg && msg.type) {
      case 'jobSeen': {
        await upsert(msg.job, 'viewed');
        if (tabId != null) {
          await chrome.storage.session.set({ [tabKey(tabId)]: { job: msg.job, at: Date.now() } });
        }
        sendResponse({ ok: true });
        break;
      }

      case 'jobApplied': {
        let job = msg.job;
        // Confirmation pages often don't name the job, so fall back to the
        // last posting this tab showed.
        if (!job && tabId != null) {
          const k = tabKey(tabId);
          const saved = (await chrome.storage.session.get(k))[k];
          if (saved && Date.now() - saved.at < TAB_JOB_TTL_MS) job = saved.job;
        }
        if (!job) {
          job = { title: msg.pageTitle || 'Unknown role', company: hostLabel(msg.url), url: msg.url, source: hostLabel(msg.url) };
        }
        await upsert(job, 'applied');
        if (tabId != null) flashBadge(tabId);
        sendResponse({ ok: true });
        break;
      }

      case 'manualAdd': {
        const rec = await upsert(msg.job, 'applied');
        sendResponse({ ok: true, job: rec });
        break;
      }

      case 'tabHasJob': {
        let hasJob = false;
        if (tabId != null) {
          const k = tabKey(tabId);
          const saved = (await chrome.storage.session.get(k))[k];
          hasJob = !!(saved && Date.now() - saved.at < TAB_JOB_TTL_MS);
        }
        sendResponse({ hasJob });
        break;
      }

      default:
        sendResponse(null);
    }
  })();

  return true; // keep the channel open for the async response
});

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove(tabKey(tabId)).catch(() => {});
});
