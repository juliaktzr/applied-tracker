// Runs on every page. Exits quickly unless the page looks like a job posting
// or an application confirmation.
(() => {
  if (window.__appliedTrackerLoaded) return;
  window.__appliedTrackerLoaded = true;

  const host = location.hostname.toLowerCase();
  const isTop = window === window.top;

  const KNOWN_HOSTS = [
    'myworkdayjobs.com', 'myworkdaysite.com', 'workday.com',
    'linkedin.com', 'joinhandshake.com',
    'greenhouse.io', 'lever.co', 'ashbyhq.com', 'icims.com',
    'smartrecruiters.com', 'jobvite.com', 'taleo.net',
    'successfactors.com', 'oraclecloud.com', 'workable.com', 'bamboohr.com'
  ];
  const onKnownHost = KNOWN_HOSTS.some(h => host === h || host.endsWith('.' + h));
  const isLinkedIn = host === 'linkedin.com' || host.endsWith('.linkedin.com');
  const isWorkday = /(^|\.)(myworkdayjobs|myworkdaysite|workday)\.com$/.test(host);

  // Inside embedded frames, only run for known application systems
  // (for example a Greenhouse form embedded on a company careers page).
  if (!isTop && !onKnownHost) return;

  const CONFIRM_PATTERNS = [
    /thank(s| you) for (applying|submitting|your application)/i,
    /\byour application (has been|was|is) (successfully )?(submitted|received|sent|complete)/i,
    /\bapplication (successfully )?(submitted|received)\b/i,
    /\bwe('ve| have) (successfully )?received your application/i,
    /\byour application was sent to\b/i,
    /\bsuccessfully (applied|submitted)\b/i,
    /\bapplication complete\b/i
  ];

  // ---------- helpers ----------
  const clean = s => (s || '').replace(/\s+/g, ' ').trim().slice(0, 160);

  const firstText = selectors => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const t = el && clean(el.textContent);
      if (t) return t;
    }
    return '';
  };

  const meta = name =>
    clean(document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.content);

  const titleCase = slug =>
    (slug || '')
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map(w => w[0].toUpperCase() + w.slice(1))
      .join(' ');

  const prettyHost = () => {
    const parts = host.replace(/^(www|careers|jobs|apply|boards|job-boards)\./, '').split('.');
    return titleCase(parts[0] || host);
  };

  // "Role at Company", "Role - Company", "Role | Company"
  function splitTitle(str) {
    const s = clean(str).replace(/\s*[|\-\u2013\u2014]\s*(LinkedIn|Handshake|Careers?|Jobs?|Workday)\s*$/i, '');
    let m = s.match(/^(.+?)\s+at\s+(.+)$/i);
    if (m) return { title: clean(m[1]), company: clean(m[2]) };
    m = s.match(/^(.+?)\s+[|\-\u2013\u2014]\s+(.+)$/);
    if (m) return { title: clean(m[1]), company: clean(m[2]) };
    return { title: s, company: '' };
  }

  // Many career sites include schema.org JobPosting data for Google Jobs.
  function fromJsonLd() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(s.textContent);
        const items = Array.isArray(data) ? data : data['@graph'] || [data];
        for (const it of items) {
          const t = it && it['@type'];
          if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) {
            const org = it.hiringOrganization;
            return {
              title: clean(it.title),
              company: clean(typeof org === 'string' ? org : org && org.name)
            };
          }
        }
      } catch (_) { /* malformed JSON-LD, ignore */ }
    }
    return null;
  }

  // ---------- site-specific extraction ----------
  function siteSpecific() {
    const path = location.pathname;
    const segs = path.split('/').filter(Boolean);
    const params = new URLSearchParams(location.search);

    if (isLinkedIn) {
      if (!path.startsWith('/jobs')) return { isPosting: false };
      const id = path.match(/\/jobs\/view\/(\d+)/)?.[1] || params.get('currentJobId');
      if (!id) return { isPosting: false };
      return {
        title: firstText([
          '.job-details-jobs-unified-top-card__job-title h1',
          '.job-details-jobs-unified-top-card__job-title',
          '.jobs-unified-top-card__job-title',
          '.top-card-layout__title',
          'main h1'
        ]),
        company: firstText([
          '.job-details-jobs-unified-top-card__company-name a',
          '.job-details-jobs-unified-top-card__company-name',
          '.jobs-unified-top-card__company-name',
          '.topcard__org-name-link'
        ]),
        url: `https://www.linkedin.com/jobs/view/${id}/`,
        source: 'LinkedIn',
        isPosting: true
      };
    }

    if (isWorkday) {
      let company = host.split('.')[0];
      // wd1.myworkdaysite.com/recruiting/<company>/...
      if (/^wd\d+$/.test(company)) {
        const i = segs.indexOf('recruiting');
        company = i >= 0 ? segs[i + 1] : company;
      }
      return {
        title: firstText(['[data-automation-id="jobPostingHeader"]', 'h1', 'h2']),
        company: titleCase(company),
        source: 'Workday',
        isPosting: /\/job\//.test(path) || !!document.querySelector('[data-automation-id="jobPostingHeader"]')
      };
    }

    if (host.endsWith('joinhandshake.com')) {
      return {
        title: firstText(['[data-hook="job-title"]', 'main h1', 'h1']),
        company: firstText(['[data-hook="employer-name"]', 'a[href*="/employers/"] div', 'a[href*="/employers/"]']),
        source: 'Handshake',
        isPosting: /\/(jobs|job-search)\/\d+/.test(path)
      };
    }

    if (host.endsWith('greenhouse.io')) {
      const slug = params.get('for') || (segs[0] !== 'embed' ? segs[0] : '');
      return {
        title: firstText(['.app-title', '.job__title h1', 'h1']),
        company: firstText(['.company-name']).replace(/^at\s+/i, '') || titleCase(slug),
        source: 'Greenhouse',
        isPosting: /\/jobs\/\d+/.test(path) || params.has('token') || params.has('gh_jid')
      };
    }

    if (host.endsWith('lever.co')) {
      return {
        title: firstText(['.posting-headline h2', 'h2', 'h1']),
        company: titleCase(segs[0]),
        source: 'Lever',
        isPosting: segs.length >= 2
      };
    }

    if (host.endsWith('ashbyhq.com')) {
      return {
        title: firstText(['h1']),
        company: titleCase(segs[0]),
        source: 'Ashby',
        isPosting: segs.length >= 2
      };
    }

    return null;
  }

  // Company career pages with no structured data: a job-ish URL with an ID
  // plus a visible "Apply" button.
  function looksLikeGenericPosting() {
    if (!isTop) return false;
    const u = location.pathname + location.search;
    if (!/(job|career|position|opening|opportunit|requisition)/i.test(u) || !/\d{3,}/.test(u)) return false;
    return [...document.querySelectorAll('a, button')].some(el => /^\s*apply\b/i.test(el.textContent || ''));
  }

  function getJob() {
    const ld = fromJsonLd();
    const site = siteSpecific();
    const fallback = splitTitle(meta('og:title') || document.title);
    const siteSaysNo = site && site.isPosting === false && isLinkedIn;
    const isPosting = !siteSaysNo && (!!ld || !!(site && site.isPosting) || looksLikeGenericPosting());

    const title = (ld && ld.title) || (site && site.title) || fallback.title;
    const company = (ld && ld.company) || (site && site.company) || fallback.company || prettyHost();

    return {
      title,
      company,
      url: (site && site.url) || location.href.split('#')[0],
      source: (site && site.source) || prettyHost(),
      isPosting: isPosting && !!title
    };
  }

  function pageShowsConfirmation() {
    if (isLinkedIn && !location.pathname.startsWith('/jobs')) return false;
    const text = (document.body && document.body.innerText || '').slice(0, 30000);
    return CONFIRM_PATTERNS.some(r => r.test(text));
  }

  function send(msg) {
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch (_) {
      // Extension was reloaded; this old content script is orphaned.
      return Promise.resolve(null);
    }
  }

  // ---------- main loop ----------
  let lastUrl = '';
  let seenSent = false;
  let appliedSent = false;
  let tabHasJob = false;

  send({ type: 'tabHasJob' }).then(r => { if (r && r.hasJob) tabHasJob = true; });

  function check() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      seenSent = false;
      appliedSent = false;
    }
    if (seenSent && appliedSent) return;

    const job = getJob();

    if (!seenSent && job.isPosting) {
      seenSent = true;
      tabHasJob = true;
      send({ type: 'jobSeen', job });
    }

    const eligible = job.isPosting || tabHasJob || onKnownHost;
    if (!appliedSent && eligible && pageShowsConfirmation()) {
      appliedSent = true;
      send({
        type: 'jobApplied',
        job: job.isPosting ? job : null,
        pageTitle: document.title,
        url: location.href
      });
    }
  }

  // LinkedIn, Workday, and Handshake are single-page apps, so watch for
  // DOM and URL changes instead of only checking once on load.
  let timer = null;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; check(); }, 800);
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => { if (location.href !== lastUrl) check(); }, 1000);
  check();

  // Popup asks for the current page's job when you click "Mark this page as applied".
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'extractJob' && isTop) sendResponse(getJob());
  });
})();
