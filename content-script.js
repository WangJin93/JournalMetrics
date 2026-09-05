/**
 * JournalMetrics content script (v2)
 * - Injects journal metric badges on PubMed search result items & detail pages
 * - Result filtering (IF / JCR / CAS / TOP / OA), scoped per search query
 * - Page-level statistics with truthful totals (sci / known-non-SCI / unmatched)
 * - Full search-result analysis via NCBI E-utilities (optional, user-triggered)
 * - Access helper (reCAPTCHA mirror) kept as-is
 */
'use strict';

console.log('[JournalMetrics] Content script loaded');

// Access helper bootstrap (runs before DOM ready)
if (window.location.href.includes('google.com/recaptcha')) {
  redirectToRecaptchaNet();
}

let settings = {};
let filterIndex = {};
let filterIndexNoSpace = {};
let pubmedAbbIndex = {};
let pubmedAbbIndexNoSpace = {};
const injectedIds = new Set();
let dataLoaded = false;

// ---------------------- tiny helpers ----------------------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Allow only http(s) links coming from the local dataset. */
function safeUrl(url) {
  if (!url) return '';
  const s = String(url).trim();
  if (/^(https?:)?\/\//i.test(s) || /^https?:\/\//i.test(s)) {
    return /^https?:\/\//i.test(s) ? s : 'https:' + s;
  }
  return '';
}

function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; }
  return h.toString(36);
}

function getSearchTermFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get('term') || '';
  } catch (e) { return ''; }
}

/**
 * Best-effort parse of the total result count shown by PubMed.
 * Current PubMed markup (server-rendered):
 *   <div class="results-amount"><h3><span class="value">332,333</span> results</h3></div>
 * and the result chunk carries an explicit data-results-amount="332,333" attribute.
 */
function getPubMedTotalFromPage() {
  const wrapCount = document.querySelectorAll('.docsum-wrap').length;
  const accept = v => Number.isFinite(v) && v >= 1 && v >= wrapCount; // total can never be < visible items
  try {
    // 1) <span class="value">N</span> inside the results-amount header/paginator
    const valEl = document.querySelector('.results-amount .value');
    if (valEl) {
      const v = parseInt(String(valEl.textContent || '').replace(/[^\d]/g, ''), 10);
      if (accept(v)) return v;
    }
    // 2) explicit attribute on the results chunk: data-results-amount="N"
    const chunk = document.querySelector('[data-results-amount]');
    if (chunk) {
      const v = parseInt(String(chunk.getAttribute('data-results-amount') || '').replace(/[^\d]/g, ''), 10);
      if (accept(v)) return v;
    }
    // 3) any "N results" text inside a .results-amount container
    const textCandidates = [];
    document.querySelectorAll('.results-amount').forEach(el => {
      const txt = (el.textContent || '').replace(/[\u00a0\u200b]/g, ' ');
      const m = txt.match(/([\d,]+)\s*results?\b/i);
      if (m) textCandidates.push(parseInt(m[1].replace(/,/g, ''), 10));
    });
    for (const v of textCandidates) if (accept(v)) return v;
    // 4) last resort: scan body text, keep the LARGEST plausible "N results" (avoids picking up stray small counts)
    const bodyText = (document.body && document.body.innerText ? document.body.innerText : '').replace(/[\u00a0\u200b]/g, ' ');
    const re = /(\d[\d,]*)\s+results?\b/gi;
    let m, best = null;
    while ((m = re.exec(bodyText))) {
      const v = parseInt(m[1].replace(/,/g, ''), 10);
      if (accept(v) && (best === null || v > best)) best = v;
    }
    return best;
  } catch (e) { /* ignore */ }
  return null;
}

// ---------------------- data loading & journal lookup ----------------------
function normalize(text) {
  if (!text) return '';
  return String(text).trim().toUpperCase().replace(/[.,:;()\[\]'"\\/\-_]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function loadData() {
  const filterUrl = chrome.runtime.getURL('data/filter_data.json');
  const abbUrl = chrome.runtime.getURL('data/pubmed_abb_data.json');
  const [filterRes, abbRes] = await Promise.all([fetch(filterUrl), fetch(abbUrl)]);
  if (!filterRes.ok) throw new Error('filter_data: ' + filterRes.status);
  if (!abbRes.ok) throw new Error('pubmed_abb_data: ' + abbRes.status);
  const filterData = await filterRes.json();
  const abbData = await abbRes.json();
  buildIndex(filterData, abbData);
}

function buildIndex(filterData, abbData) {
  filterIndex = {};
  filterIndexNoSpace = {};
  pubmedAbbIndex = {};
  pubmedAbbIndexNoSpace = {};

  const addKey = (map, key, item) => {
    if (!key) return;
    if (!map[key]) map[key] = [];
    map[key].push(item);
  };

  for (const item of filterData) {
    const abb = item.abb || '';
    const pubmed_journal = item.pubmed_journal || '';
    if (!abb && !pubmed_journal) continue;

    const normKey = normalize(abb);
    addKey(filterIndex, normKey, item);
    if (normKey) addKey(filterIndexNoSpace, normKey.replace(/\s+/g, ''), item);

    if (abb.includes('(')) {
      const noParen = abb.replace(/\s*\([^)]*\)/g, '').trim();
      if (noParen && noParen !== abb) {
        const pk = normalize(noParen);
        addKey(filterIndex, pk, item);
        if (pk) addKey(filterIndexNoSpace, pk.replace(/\s+/g, ''), item);
      }
    }
    if (pubmed_journal) {
      const jk = normalize(pubmed_journal);
      addKey(filterIndex, jk, item);
      if (jk) addKey(filterIndexNoSpace, jk.replace(/\s+/g, ''), item);
    }
  }

  for (const item of abbData) {
    const abb = item.abb || '';
    if (!abb) continue;
    const k = normalize(abb);
    if (k && !pubmedAbbIndex[k]) pubmedAbbIndex[k] = item;
    const nk = k ? k.replace(/\s+/g, '') : '';
    if (nk && !pubmedAbbIndexNoSpace[nk]) pubmedAbbIndexNoSpace[nk] = item;
  }

  console.log('[JournalMetrics] Index built:', Object.keys(filterIndex).length, 'filter keys,',
    Object.keys(pubmedAbbIndex).length, 'abb keys');
}

async function loadSettings() {
  const defaults = globalThis.JM_DEFAULTS || {};
  return new Promise((resolve) => {
    chrome.storage.local.get(defaults, (result) => {
      settings = Object.assign({}, defaults, result);
      resolve();
    });
  });
}

/** Lookup a journal by text (abbreviation or full name). Returns enriched object or null. */
function findJournal(text) {
  if (!text || String(text).trim().length < 2) return null;
  const normText = normalize(text);
  const noSpaceText = normText.replace(/\s+/g, '');

  let items = filterIndex[normText];
  if (!items && noSpaceText) items = filterIndexNoSpace[noSpaceText];

  if (items && items.length > 0) {
    const item = items[0];
    return {
      journal: item.pubmed_journal || item.journal || '',
      journal_abb: item.abb || '',
      issn: item.pubmed_issn || item.issn || '',
      eissn: item.pubmed_eissn || '',
      sci: true,
      IF: item.IF || 'NA',
      Q: item.Q || 'NA',
      B: item.B || 'NA',
      T: item.T || '0',
      top: item.T === '1' ? 'Top Journal' : 'Non-Top Journal',
      selfCitationRate: item.s || '',
      website: item.w || '',
      oa: item.o || '',
      publisher: item.p || '',
      country: item.c || '',
      annualArticleCount: item.a || '',
      researchArticlesProportion: item.r || '',
      apc: item.x || '',
      cls: item.class || '',
      clsCn: item.class_cn || '',
      sub: item.subclass || '',
      subQ: item.subclass_quartile || ''
    };
  }

  let abbItem = pubmedAbbIndex[normText];
  if (!abbItem && noSpaceText) abbItem = pubmedAbbIndexNoSpace[noSpaceText];

  if (abbItem) {
    return {
      journal: abbItem.pubmed_journal || abbItem.journal || '',
      journal_abb: abbItem.abb || '',
      issn: abbItem.pubmed_issn || abbItem.issn || '',
      eissn: abbItem.pubmed_eissn || '',
      sci: false,
      IF: 'NA', Q: 'NA', B: 'NA', T: '0', top: 'NA'
    };
  }
  return null;
}

/** Journal lookup by (full journal name, source abbreviation) for E-utilities entries. */
function findJournalByNames(fullName, sourceAbb) {
  if (fullName) {
    const j = findJournal(fullName);
    if (j) return j;
  }
  if (sourceAbb && sourceAbb !== fullName) {
    const j = findJournal(sourceAbb);
    if (j) return j;
  }
  return null;
}

/** Uniform per-article record used for stats / filters / export. */
function makeRecord(journal, year, pmid) {
  const rec = { pmid: pmid || '', year: (year || '').toString() };
  if (!journal) {
    rec.kind = 'unknown';
    rec.name = 'Unknown journal';
    return rec;
  }
  if (journal.sci) {
    rec.kind = 'sci';
    rec.name = journal.journal_abb || journal.journal || '';
    rec.IF = journal.IF;
    rec.Q = journal.Q;
    rec.B = journal.B;
    rec.T = journal.T;
    rec.oa = journal.oa;
    rec.publisher = journal.publisher;
    rec.country = journal.country;
    rec.apc = journal.apc;
    rec.annual = journal.annualArticleCount;
    rec.cls = journal.cls;
    rec.clsCn = journal.clsCn;
    rec.sub = journal.sub;
    rec.subQ = journal.subQ;
    rec.website = journal.website;
    rec.selfCite = journal.selfCitationRate;
  } else {
    rec.kind = 'abb';
    rec.name = journal.journal_abb || journal.journal || '';
  }
  return rec;
}

// ---------------------- info injection ----------------------
function oaCategory(value) {
  if (value === undefined || value === null || value === '' || value === '0') return 'unknown';
  const s = String(value).toLowerCase();
  if (s === 'no' || s === 'non-oa' || s === 'closed') return 'non';
  return 'oa';
}

function createInfoBox(journal) {
  if (!journal || !journal.sci) {
    if (journal && journal.sci === false) {
      return '<div class="journal-info-box"><div class="info-item"><span class="label">SCI:</span><span class="value" style="color:#9E9E9E">No</span></div></div>';
    }
    return '';
  }

  const parts = [];
  if (settings.if && journal.IF && journal.IF !== 'NA' && journal.IF !== '0') {
    parts.push(`<div class="info-item if"><span class="label">IF:</span><span class="value">${escHtml(journal.IF)}</span></div>`);
  }
  if (settings.jcr && journal.Q && journal.Q !== 'NA' && journal.Q !== 'N/A') {
    const qColors = { Q1: '#4CAF50', Q2: '#2196F3', Q3: '#FF9800', Q4: '#F44336' };
    const color = qColors[journal.Q] || '#9E9E9E';
    parts.push(`<div class="info-item jcr" style="background-color:${color}"><span class="label">JCR:</span><span class="value">${escHtml(journal.Q)}</span></div>`);
  }
  if (settings.cas && journal.B && journal.B !== 'NA' && journal.B !== 'N/A') {
    const bColors = { B1: '#E91E63', B2: '#9C27B0', B3: '#673AB7', B4: '#3F51B5' };
    const color = bColors[journal.B] || '#9E9E9E';
    parts.push(`<div class="info-item cas" style="background-color:${color}"><span class="label">CAS:</span><span class="value">${escHtml(journal.B)}</span></div>`);
  }
  if (settings.top && journal.T === '1') {
    parts.push('<div class="info-item top"><span class="label">★</span><span class="value">TOP</span></div>');
  }
  if (settings.selfCitationRate && journal.selfCitationRate && journal.selfCitationRate !== '' && journal.selfCitationRate !== '0') {
    parts.push(`<div class="info-item"><span class="label">Self-Cite:</span><span class="value">${escHtml(journal.selfCitationRate)}</span></div>`);
  }
  if (settings.website && journal.website && journal.website !== '' && journal.website !== '0') {
    const href = safeUrl(journal.website);
    parts.push(`<div class="info-item"><span class="label">Website:</span><a href="${escHtml(href)}" target="_blank" rel="noopener noreferrer" class="link">Link</a></div>`);
  }
  if (settings.oa && journal.oa && journal.oa !== '' && journal.oa !== '0') {
    const cat = oaCategory(journal.oa);
    parts.push(`<div class="info-item oa-${cat}"><span class="label">OA:</span><span class="value">${escHtml(journal.oa)}</span></div>`);
  }
  if (settings.publisher && journal.publisher && journal.publisher !== '' && journal.publisher !== '0') {
    parts.push(`<div class="info-item"><span class="label">Publisher:</span><span class="value">${escHtml(journal.publisher)}</span></div>`);
  }
  if (settings.country && journal.country && journal.country !== '' && journal.country !== '0') {
    parts.push(`<div class="info-item"><span class="label">Country:</span><span class="value">${escHtml(journal.country)}</span></div>`);
  }
  if (settings.annualArticleCount && journal.annualArticleCount && journal.annualArticleCount !== '' && journal.annualArticleCount !== '0') {
    parts.push(`<div class="info-item"><span class="label">Articles/Year:</span><span class="value">${escHtml(journal.annualArticleCount)}</span></div>`);
  }
  if (settings.researchArticlesProportion && journal.researchArticlesProportion && journal.researchArticlesProportion !== '' && journal.researchArticlesProportion !== '0') {
    const pct = parseFloat(journal.researchArticlesProportion);
    const txt = isNaN(pct) ? journal.researchArticlesProportion : (pct * 100).toFixed(1) + '%';
    parts.push(`<div class="info-item"><span class="label">Research:</span><span class="value">${escHtml(txt)}</span></div>`);
  }
  if (settings.apc && journal.apc && journal.apc !== '' && journal.apc !== '0') {
    parts.push(`<div class="info-item"><span class="label">APC:</span><span class="value">${escHtml(journal.apc)}</span></div>`);
  }
  return parts.length ? '<div class="journal-info-box">' + parts.join('') + '</div>' : '';
}

function isValidJournal(journalName) {
  if (!journalName) return false;
  if (Object.keys(filterIndex).length === 0) return true;
  const normText = normalize(journalName);
  const noSpaceText = normText.replace(/\s+/g, '');
  if (filterIndex[normText] && filterIndex[normText].length > 0) return true;
  if (filterIndexNoSpace[noSpaceText] && filterIndexNoSpace[noSpaceText].length > 0) return true;
  return false;
}

function parseJournalFromCitation(citationText) {
  if (!citationText) return null;
  const parts = citationText.split('. ');
  if (parts.length >= 2) {
    const firstPart = parts[0].trim();
    if (firstPart.length > 3 && firstPart.length < 150) {
      const match = firstPart.match(/^[A-Z][a-zA-Z]*(( [A-Z][a-zA-Z]+)|( [A-Z]))*/);
      if (match && match[0].trim().length > 3) {
        const nextPart = parts[1].trim();
        if (nextPart.match(/^\d{4}/) || nextPart.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i)) {
          return match[0].trim().replace(/\s+/g, ' ').trim();
        }
      }
    }
  }
  const fallbackParts = citationText.split('.');
  if (fallbackParts.length >= 2) {
    const firstPart = fallbackParts[0].trim();
    if (firstPart.length > 3 && firstPart.length < 150) {
      const match = firstPart.match(/^[A-Z][a-zA-Z]*(( [A-Z][a-zA-Z]+)|( [A-Z]))*/);
      if (match && match[0].trim().length > 3) {
        return match[0].trim().replace(/\s+/g, ' ').trim();
      }
    }
  }
  return null;
}

function extractJournalText(wrapElement) {
  const journalCitation = wrapElement.querySelector('.docsum-journal-citation');
  if (journalCitation) {
    const text = journalCitation.textContent.trim();
    const journalPart = parseJournalFromCitation(text);
    if (journalPart && isValidJournal(journalPart)) return journalPart;
    return null;
  }
  const el = wrapElement.querySelector('.docsum-journal');
  if (el) {
    const text = el.textContent.trim();
    if (text.length > 3 && isValidJournal(text)) return text;
  }
  return null;
}

function extractYearFromCitation(wrapElement) {
  const citationEl = wrapElement.querySelector('.docsum-journal-citation');
  if (citationEl) {
    const m = citationEl.textContent.match(/\b(20\d{2})\b/);
    if (m) return m[1];
  }
  return '';
}

function storeRecord(wrapElement, record) {
  try { wrapElement.dataset.journalData = JSON.stringify(record); } catch (e) { /* ignore */ }
}

function enhancePage() {
  const docsumWraps = document.querySelectorAll('.docsum-wrap');
  for (const wrap of docsumWraps) {
    const titleLink = wrap.querySelector('.docsum-title');
    if (!titleLink) continue;
    const articleId = titleLink.dataset.articleId;
    if (!articleId) continue;
    if (injectedIds.has(articleId)) continue;

    const journalText = extractJournalText(wrap);
    const year = extractYearFromCitation(wrap);

    if (journalText) {
      const journal = findJournal(journalText);
      if (journal) {
        // record for stats/filters is always stored (even if all display options are off)
        storeRecord(wrap, makeRecord(journal, year, articleId));
        const html = createInfoBox(journal);
        if (html) injectInfoHtml(wrap, html, articleId);
      } else {
        // matched nothing: still record as unknown so stats are truthful
        storeRecord(wrap, { kind: 'unknown', name: journalText, year: year, pmid: articleId });
      }
    }
    injectedIds.add(articleId);
  }

  enhanceDetailPage();
  refreshFilterPanelCounts();
  syncActionBarVisibility();
  debouncedFilter();
}

function injectInfoHtml(wrapElement, html, articleId) {
  const existing = document.getElementById(`journal-info-${articleId}`);
  if (existing) existing.remove();
  const container = document.createElement('div');
  container.id = `journal-info-${articleId}`;
  container.className = 'journal-info-container';
  container.innerHTML = html;
  const docsumContent = wrapElement.querySelector('.docsum-content');
  if (docsumContent) docsumContent.appendChild(container);
  else wrapElement.appendChild(container);
}

function enhanceDetailPage() {
  const articleCitation = document.querySelector('.article-citation');
  if (!articleCitation) return;
  const existing = document.getElementById('journal-info-detail');
  if (existing) existing.remove();

  let journalText = '';
  const trigger = document.getElementById('full-view-journal-trigger');
  if (trigger) {
    journalText = trigger.textContent.trim();
  } else {
    const articleSource = articleCitation.querySelector('.article-source');
    if (articleSource) {
      const m = articleSource.textContent.trim().match(/^[A-Z][a-zA-Z]*(( [A-Z][a-zA-Z]+)|( [A-Z]))*/);
      if (m && m[0].trim().length > 3) journalText = m[0].trim();
    }
  }
  if (!journalText) return;

  const journal = findJournal(journalText);
  if (journal) {
    const html = createInfoBox(journal);
    if (html) {
      const container = document.createElement('div');
      container.id = 'journal-info-detail';
      container.className = 'journal-info-container';
      container.innerHTML = html;
      articleCitation.appendChild(container);
    }
  }
}

// ---------------------- settings / re-render ----------------------
function removeInjectedInfo() {
  document.querySelectorAll('.journal-info-container').forEach(el => el.remove());
  injectedIds.clear();
}

function reapplySettings() {
  removeInjectedInfo();
  enhancePage();
}

function observePage() {
  const observer = new MutationObserver((mutations) => {
    let shouldEnhance = false;
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const cls = node.classList;
        if (cls && (cls.contains('docsum-wrap') || cls.contains('article-citation') || cls.contains('article-source'))) {
          shouldEnhance = true;
        } else if (node.querySelectorAll && (node.querySelectorAll('.docsum-wrap, .article-citation, .article-source').length > 0)) {
          shouldEnhance = true;
        }
      }
    }
    if (shouldEnhance) {
      setTimeout(() => { enhancePage(); }, 500);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // settings changed from the popup → apply immediately, without page reload
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let displayChanged = false;
    for (const key of Object.keys(changes)) {
      if (Object.prototype.hasOwnProperty.call(globalThis.JM_DEFAULTS, key)) {
        settings[key] = changes[key].newValue;
        // only fields that change the injected badges require a re-render
        if (key !== 'maxResults' && key !== 'accessHelper') displayChanged = true;
      }
    }
    if (displayChanged) {
      reapplySettings();
      debouncedFilter();
    }
  });
}

// ---------------------- filter panel (query-scoped) ----------------------
const filterState = { ifMin: '', ifMax: '', jcrQuartiles: [], casBlocks: [], topOnly: false, oa: 'any' };

function filterStorageKey() {
  const term = getSearchTermFromUrl();
  const path = window.location.pathname || '/';
  return 'filterState:' + hashString(path + '|' + term);
}

function cloneFilterState() {
  return {
    ifMin: filterState.ifMin, ifMax: filterState.ifMax,
    jcrQuartiles: filterState.jcrQuartiles.slice(),
    casBlocks: filterState.casBlocks.slice(),
    topOnly: filterState.topOnly, oa: filterState.oa
  };
}

let filterDebounceTimer = null;
function debouncedFilter() {
  clearTimeout(filterDebounceTimer);
  filterDebounceTimer = setTimeout(filterArticles, 120);
}

function createStatsButton() {
  if (document.getElementById('stats-toggle')) return;
  const btn = document.createElement('button');
  btn.id = 'stats-toggle';
  btn.className = 'stats-toggle';
  btn.textContent = 'Analyze';
  btn.title = 'Analyze this page or the whole PubMed search result';
  btn.addEventListener('click', openAnalysisModal);
  document.body.appendChild(btn);
}

function createFilterPanel() {
  if (document.getElementById('filter-panel-wrapper')) return;
  const wrapper = document.createElement('div');
  wrapper.id = 'filter-panel-wrapper';
  wrapper.className = 'filter-panel-wrapper';

  wrapper.innerHTML = `
    <div class="filter-panel" id="filter-panel">
      <div class="filter-panel-header">
        <h3>📊 Filter (this search)</h3>
        <button class="filter-panel-close" id="filter-panel-close" title="Close">×</button>
      </div>
      <div class="filter-scope-note" id="filter-scope-note"></div>

      <div class="filter-section">
        <div class="filter-section-title">Impact Factor (IF)</div>
        <div class="filter-if-range">
          <input type="number" id="filter-if-min" placeholder="Min" step="0.1" min="0">
          <span>–</span>
          <input type="number" id="filter-if-max" placeholder="Max" step="0.1" min="0">
        </div>
      </div>

      <div class="filter-section">
        <div class="filter-section-title">JCR Quartile</div>
        <div class="filter-checkbox-group" id="filter-jcr-group">
          <label class="filter-checkbox-item" data-value="Q1"><input type="checkbox" value="Q1"> Q1 <span class="count-badge"></span></label>
          <label class="filter-checkbox-item" data-value="Q2"><input type="checkbox" value="Q2"> Q2 <span class="count-badge"></span></label>
          <label class="filter-checkbox-item" data-value="Q3"><input type="checkbox" value="Q3"> Q3 <span class="count-badge"></span></label>
          <label class="filter-checkbox-item" data-value="Q4"><input type="checkbox" value="Q4"> Q4 <span class="count-badge"></span></label>
        </div>
      </div>

      <div class="filter-section">
        <div class="filter-section-title">CAS Block</div>
        <div class="filter-checkbox-group" id="filter-cas-group">
          <label class="filter-checkbox-item" data-value="B1"><input type="checkbox" value="B1"> B1 <span class="count-badge"></span></label>
          <label class="filter-checkbox-item" data-value="B2"><input type="checkbox" value="B2"> B2 <span class="count-badge"></span></label>
          <label class="filter-checkbox-item" data-value="B3"><input type="checkbox" value="B3"> B3 <span class="count-badge"></span></label>
          <label class="filter-checkbox-item" data-value="B4"><input type="checkbox" value="B4"> B4 <span class="count-badge"></span></label>
        </div>
      </div>

      <div class="filter-section">
        <div class="filter-section-title">Other</div>
        <label class="filter-checkbox-item" id="filter-top-item"><input type="checkbox" id="filter-top"> Top <span class="count-badge"></span></label>
        <div class="filter-select-row">
          <select id="filter-oa"></select>
        </div>
      </div>

      <div class="filter-actions">
        <button class="filter-action-btn apply" id="filter-apply">Apply</button>
        <button class="filter-action-btn reset" id="filter-reset">Reset</button>
      </div>
      <div class="filter-stats" id="filter-stats"></div>
      <div class="filter-hint">Filters are remembered only for this search query.</div>
    </div>
    <button class="filter-panel-toggle" id="filter-panel-toggle" title="Filter current results">Filter</button>
  `;
  document.body.appendChild(wrapper);
  wrapper.style.display = 'none'; // shown by syncActionBarVisibility once results exist
  initFilterPanelEvents();
  syncActionBarVisibility();
}

function setCheckboxActive(cb) {
  cb.parentElement.classList.toggle('active', cb.checked);
}

function fillOaSelectOptions(sel) {
  const defs = [
    ['any', 'OA: any'],
    ['oa', 'OA: Open access'],
    ['non', 'OA: Non-OA'],
    ['unknown', 'OA: Unknown']
  ];
  sel.innerHTML = '';
  defs.forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
  });
}

function initFilterPanelEvents() {
  const toggleBtn = document.getElementById('filter-panel-toggle');
  const closeBtn = document.getElementById('filter-panel-close');
  const panel = document.getElementById('filter-panel');
  const applyBtn = document.getElementById('filter-apply');
  const resetBtn = document.getElementById('filter-reset');

  toggleBtn.addEventListener('click', () => panel.classList.toggle('open'));
  closeBtn.addEventListener('click', () => panel.classList.remove('open'));

  document.querySelectorAll('#filter-jcr-group input, #filter-cas-group input').forEach(cb => {
    cb.addEventListener('change', () => setCheckboxActive(cb));
  });
  document.getElementById('filter-top').addEventListener('change', function () { setCheckboxActive(this); });
  fillOaSelectOptions(document.getElementById('filter-oa'));
  applyBtn.addEventListener('click', applyFilters);
  resetBtn.addEventListener('click', resetFilters);
}

function filterIsActive() {
  return !!(filterState.ifMin || filterState.ifMax ||
    filterState.jcrQuartiles.length || filterState.casBlocks.length ||
    filterState.topOnly || filterState.oa !== 'any');
}

function applyFilters() {
  const v = id => document.getElementById(id);
  filterState.ifMin = v('filter-if-min').value.trim();
  filterState.ifMax = v('filter-if-max').value.trim();
  filterState.jcrQuartiles = Array.from(document.querySelectorAll('#filter-jcr-group input:checked')).map(cb => cb.value);
  filterState.casBlocks = Array.from(document.querySelectorAll('#filter-cas-group input:checked')).map(cb => cb.value);
  filterState.topOnly = v('filter-top').checked;
  filterState.oa = v('filter-oa').value;

  const key = filterStorageKey();
  chrome.storage.local.set({ [key]: { state: cloneFilterState(), savedAt: Date.now() } });
  filterArticles();
}

function resetFilters() {
  document.getElementById('filter-if-min').value = '';
  document.getElementById('filter-if-max').value = '';
  document.querySelectorAll('.filter-section input[type="checkbox"]').forEach(cb => {
    cb.checked = false; setCheckboxActive(cb);
  });
  document.getElementById('filter-oa').value = 'any';
  Object.assign(filterState, { ifMin: '', ifMax: '', jcrQuartiles: [], casBlocks: [], topOnly: false, oa: 'any' });

  const key = filterStorageKey();
  chrome.storage.local.remove(key);
  filterArticles();
}

function loadFilterState() {
  chrome.storage.local.get(filterStorageKey(), (result) => {
    const saved = result[filterStorageKey()];
    if (saved && saved.state) {
      Object.assign(filterState, saved.state);
      const v = id => document.getElementById(id);
      if (v('filter-if-min')) v('filter-if-min').value = filterState.ifMin;
      if (v('filter-if-max')) v('filter-if-max').value = filterState.ifMax;
      filterState.jcrQuartiles.forEach(q => {
        const cb = document.querySelector(`#filter-jcr-group input[value="${q}"]`);
        if (cb) { cb.checked = true; setCheckboxActive(cb); }
      });
      filterState.casBlocks.forEach(b => {
        const cb = document.querySelector(`#filter-cas-group input[value="${b}"]`);
        if (cb) { cb.checked = true; setCheckboxActive(cb); }
      });
      const topCb = document.getElementById('filter-top');
      if (topCb) { topCb.checked = filterState.topOnly; setCheckboxActive(topCb); }
      const oaSel = document.getElementById('filter-oa');
      if (oaSel) oaSel.value = filterState.oa;
      if (filterIsActive()) setTimeout(filterArticles, 150);
    } else {
      Object.assign(filterState, { ifMin: '', ifMax: '', jcrQuartiles: [], casBlocks: [], topOnly: false, oa: 'any' });
    }
    const note = document.getElementById('filter-scope-note');
    if (note) {
      const term = getSearchTermFromUrl();
      note.textContent = term ? `Query: ${term}` : 'PubMed search page';
    }
  });
}

function journalRecordOf(articleWrap) {
  const raw = articleWrap.dataset.journalData;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/** Does a record pass the current metric filters? Unknown / non-SCI pass unless explicitly excluded. */
function recordMatches(rec) {
  if (!rec || rec.kind !== 'sci') return true;

  const ifv = parseFloat(rec.IF);
  if (filterState.ifMin && (isNaN(ifv) || ifv < parseFloat(filterState.ifMin))) return false;
  if (filterState.ifMax && (isNaN(ifv) || ifv > parseFloat(filterState.ifMax))) return false;
  if (filterState.jcrQuartiles.length && !filterState.jcrQuartiles.includes(rec.Q)) return false;
  if (filterState.casBlocks.length && !filterState.casBlocks.includes(rec.B)) return false;
  if (filterState.topOnly && rec.T !== '1') return false;
  if (filterState.oa !== 'any') {
    const cat = oaCategory(rec.oa);
    if (cat !== filterState.oa) return false;
  }
  return true;
}

function filterArticles() {
  const articles = document.querySelectorAll('article.full-docsum');
  let visible = 0, hidden = 0;
  for (const article of articles) {
    const wrap = article.querySelector('.docsum-wrap');
    const rec = wrap ? journalRecordOf(wrap) : null;
    const ok = rec ? recordMatches(rec) : true;
    article.classList.toggle('filter-hidden', !ok);
    if (ok) visible++; else hidden++;
  }
  const statsEl = document.getElementById('filter-stats');
  if (statsEl) {
    const active = filterIsActive();
    statsEl.textContent = `${visible} of ${articles.length} articles visible` + (hidden ? ` (${hidden} hidden)` : '') + (active ? ' · filter on' : '');
  }
}

/** Live per-option counts shown on the filter panel. */
function refreshFilterPanelCounts() {
  if (!document.getElementById('filter-panel')) return;
  const counts = { jcr: {}, cas: {}, top: 0, oa: { any: 0, oa: 0, non: 0, unknown: 0 } };
  document.querySelectorAll('article.full-docsum').forEach(article => {
    const wrap = article.querySelector('.docsum-wrap');
    const rec = wrap ? journalRecordOf(wrap) : null;
    if (!rec || rec.kind !== 'sci') return;
    if (rec.Q) counts.jcr[rec.Q] = (counts.jcr[rec.Q] || 0) + 1;
    if (rec.B) counts.cas[rec.B] = (counts.cas[rec.B] || 0) + 1;
    if (rec.T === '1') counts.top++;
    const cat = oaCategory(rec.oa);
    counts.oa[cat]++;
    counts.oa.any++;
  });
  document.querySelectorAll('#filter-jcr-group .filter-checkbox-item').forEach(label => {
    const q = label.dataset.value;
    const span = label.querySelector('.count-badge');
    const n = counts.jcr[q] || 0;
    if (span) span.textContent = n;
  });
  document.querySelectorAll('#filter-cas-group .filter-checkbox-item').forEach(label => {
    const b = label.dataset.value;
    const span = label.querySelector('.count-badge');
    const n = counts.cas[b] || 0;
    if (span) span.textContent = n;
  });
  const topItem = document.getElementById('filter-top-item');
  const topBadge = topItem ? topItem.querySelector('.count-badge') : null;
  if (topBadge) topBadge.textContent = counts.top;
  const oaSel = document.getElementById('filter-oa');
  if (oaSel) {
    const opts = oaSel.options;
    if (opts[0]) opts[0].textContent = `OA: any (${counts.oa.any})`;
    if (opts[1]) opts[1].textContent = `OA: Open access (${counts.oa.oa})`;
    if (opts[2]) opts[2].textContent = `OA: Non-OA (${counts.oa.non})`;
    if (opts[3]) opts[3].textContent = `OA: Unknown (${counts.oa.unknown})`;
  }
}

// ---------------------- analysis modal / progress UI ----------------------
let modalRoot = null;

function closeModal() {
  if (modalRoot) { modalRoot.remove(); modalRoot = null; }
}

function showModal(title, bodyHtml, footerHtml) {
  closeModal();
  const root = document.createElement('div');
  root.className = 'jm-modal';
  root.innerHTML = `
    <div class="jm-modal-card">
      <div class="jm-modal-head">
        <span class="jm-modal-title"></span>
        <button class="jm-modal-close" title="Close">×</button>
      </div>
      <div class="jm-modal-body"></div>
      <div class="jm-modal-foot"></div>
    </div>`;
  root.querySelector('.jm-modal-title').textContent = title;
  const body = root.querySelector('.jm-modal-body');
  body.innerHTML = bodyHtml;
  const foot = root.querySelector('.jm-modal-foot');
  foot.innerHTML = footerHtml || '';
  root.querySelector('.jm-modal-close').addEventListener('click', closeModal);
  root.addEventListener('click', (e) => { if (e.target === root) closeModal(); });
  document.documentElement.appendChild(root);
  modalRoot = root;
  return root;
}

function currentWrapStats() {
  const wraps = document.querySelectorAll('.docsum-wrap');
  let processed = 0;
  wraps.forEach(w => { if (w.dataset && w.dataset.journalData) processed++; });
  return { total: wraps.length, processed };
}

function syncActionBarVisibility() {
  const statsBtn = document.getElementById('stats-toggle');
  const filterWrap = document.getElementById('filter-panel-wrapper');
  const hasResults = document.querySelectorAll('.docsum-wrap').length > 0;
  if (statsBtn) statsBtn.style.display = hasResults ? '' : 'none';
  if (filterWrap) filterWrap.style.display = hasResults ? '' : 'none';
}

/** Resolve the user-configured limit for full-search analysis (clamped 1..10000). */
function analysisLimit() {
  let n = parseInt(settings.maxResults, 10);
  if (isNaN(n)) n = 1000;
  return Math.min(10000, Math.max(1, n));
}

function openAnalysisModal() {
  const { total, processed } = currentWrapStats();
  const term = getSearchTermFromUrl();
  const searchCount = getPubMedTotalFromPage();
  const limit = analysisLimit();
  const onResultsPage = /^\/(\?|$)/.test(window.location.pathname) || total > 0;
  const pct = total > 0 ? Math.round(processed / total * 100) : 0;

  const html = `
    <div class="jm-row">PubMed results on this page: <b>${total}</b></div>
    <div class="jm-row">Recognized journal info: <b>${processed} / ${total}</b>${total ? ` (${pct}%)` : ''}</div>
    <div class="jm-row">Whole search hit count: <b>${searchCount ? searchCount.toLocaleString() : 'n/a'}</b>${searchCount ? ' <span class="jm-muted">(as shown by PubMed)</span>' : ''}</div>
    <div class="jm-row">Full-analysis limit: <b>${limit.toLocaleString()}</b> <span class="jm-muted">(configurable in the extension popup → Analysis Settings)</span></div>
    <div class="jm-row jm-term">Query: <span class="jm-muted">${escHtml(term || '(no query term)')}</span></div>
    <div class="jm-warn">Tip: use <b>Analyze all search results</b> to get statistics across the whole search (E-utilities) up to your configured limit, not just the current page.</div>`;
  const footer = `
    <div class="jm-btns">
      ${onResultsPage ? `<button class="jm-btn primary" id="jm-page">Analyze current page (${total})</button>` : ''}
      <button class="jm-btn primary" id="jm-all" ${term ? '' : 'disabled title="Run this from a PubMed results page with a search term"'}>Analyze all search results (${countLabel(searchCount, limit)})</button>
      <button class="jm-btn ghost" id="jm-cancel">Cancel</button>
    </div>`;

  const root = showModal('JournalMetrics Analysis', html, footer);
  root.querySelector('#jm-cancel').addEventListener('click', closeModal);
  const bPage = root.querySelector('#jm-page');
  if (bPage) bPage.addEventListener('click', async () => {
    closeModal();
    await runPageAnalysis();
  });
  const bAll = root.querySelector('#jm-all');
  if (bAll) bAll.addEventListener('click', async () => {
    closeModal();
    await runSearchAnalysis(term);
  });
}

/** Button label helper: show full count when within the limit, otherwise "first L of N". */
function countLabel(searchCount, limit) {
  if (searchCount && searchCount > 0) {
    return searchCount > limit ? `first ${limit.toLocaleString()} of ${searchCount.toLocaleString()}` : searchCount.toLocaleString();
  }
  return `up to ${limit.toLocaleString()}`;
}

function showProgressModal(title, initial) {
  const html = `
    <div class="jm-progress-label" id="jm-progress-label">Starting…</div>
    <div class="jm-progress-track"><div class="jm-progress-fill" id="jm-progress-fill"></div></div>
    <div class="jm-progress-sub" id="jm-progress-sub"></div>`;
  const footer = '<button class="jm-btn ghost" id="jm-progress-cancel">Cancel</button>';
  const root = showModal(title, html, footer);
  const fill = root.querySelector('#jm-progress-fill');
  const label = root.querySelector('#jm-progress-label');
  const sub = root.querySelector('#jm-progress-sub');
  const cancelBtn = root.querySelector('#jm-progress-cancel');
  cancelBtn.addEventListener('click', () => {
    searchCancelled = true;
    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Cancelling…';
    label.textContent = 'Cancelling…';
  });
  return {
    update(processed, total, text) {
      const p = total > 0 ? Math.min(100, Math.round(processed / total * 100)) : 0;
      if (fill) fill.style.width = p + '%';
      label.textContent = text || `${processed} / ${total}`;
      if (sub && total > 0) sub.textContent = `${p}%`;
    },
    done() { closeModal(); },
    setCancelDisabled() { cancelBtn.disabled = true; }
  };
}

// ---------------------- statistics aggregation ----------------------
function fmtIF(v) { return v == null || isNaN(v) ? null : Math.round(v * 100) / 100; }

function analyzeRecords(records, meta) {
  const sci = [], abb = [], unknown = [];
  for (const r of records) {
    if (r.kind === 'sci') sci.push(r);
    else if (r.kind === 'abb') abb.push(r);
    else unknown.push(r);
  }

  const ifValues = sci.map(r => parseFloat(r.IF)).filter(v => !isNaN(v) && v > 0);
  const avgIF = ifValues.length ? ifValues.reduce((a, b) => a + b, 0) / ifValues.length : 0;
  const sortedIF = ifValues.slice().sort((a, b) => a - b);
  const medianIF = sortedIF.length
    ? (sortedIF.length % 2 ? sortedIF[(sortedIF.length - 1) / 2] : (sortedIF[sortedIF.length / 2 - 1] + sortedIF[sortedIF.length / 2]) / 2)
    : 0;

  const jcrDist = { Q1: 0, Q2: 0, Q3: 0, Q4: 0, NA: 0 };
  sci.forEach(r => { const q = ['Q1', 'Q2', 'Q3', 'Q4'].includes(r.Q) ? r.Q : 'NA'; jcrDist[q]++; });
  const casDist = { B1: 0, B2: 0, B3: 0, B4: 0, NA: 0 };
  sci.forEach(r => { const b = ['B1', 'B2', 'B3', 'B4'].includes(r.B) ? r.B : 'NA'; casDist[b]++; });

  // discipline (class) distribution, top 12
  const clsCount = {};
  sci.forEach(r => {
    const label = (r.clsCn || r.cls || '').trim() || 'Other';
    clsCount[label] = (clsCount[label] || 0) + 1;
  });
  const clsDist = Object.entries(clsCount).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([label, count]) => ({ label, count }));

  const yearDist = {};
  let minYear = null, maxYear = null;
  for (const r of records) {
    const y = r.year;
    if (/^\d{4}$/.test(y || '')) {
      const key = String(parseInt(y, 10));
      yearDist[key] = (yearDist[key] || 0) + 1;
      const n = parseInt(y, 10);
      if (minYear === null || n < minYear) minYear = n;
      if (maxYear === null || n > maxYear) maxYear = n;
    }
  }

  const ifDist = { '<1': 0, '1-3': 0, '3-5': 0, '5-10': 0, '10-20': 0, '>=20': 0 };
  ifValues.forEach(v => {
    if (v < 1) ifDist['<1']++;
    else if (v < 3) ifDist['1-3']++;
    else if (v < 5) ifDist['3-5']++;
    else if (v < 10) ifDist['5-10']++;
    else if (v < 20) ifDist['10-20']++;
    else ifDist['>=20']++;
  });

  const oaDist = { oa: 0, non: 0, unknown: 0 };
  sci.forEach(r => { oaDist[oaCategory(r.oa)]++; });

  // journals aggregated (SCI only)
  const byJournal = new Map();
  sci.forEach(r => {
    const key = r.name || 'Unknown';
    let agg = byJournal.get(key);
    if (!agg) {
      agg = { name: key, count: 0, ifSum: 0, ifN: 0, q: r.Q || '', b: r.B || '', top: r.T === '1', oaCat: oaCategory(r.oa), apcSum: 0, apcN: 0, publisher: r.publisher || '', country: r.country || '', website: r.website || '' };
      byJournal.set(key, agg);
    }
    agg.count++;
    const iv = parseFloat(r.IF);
    if (!isNaN(iv) && iv > 0) { agg.ifSum += iv; agg.ifN++; }
    if (r.apc) {
      const m = String(r.apc).match(/(\d+(?:\.\d+)?)/);
      if (m && !isNaN(parseFloat(m[1]))) { agg.apcSum += parseFloat(m[1]); agg.apcN++; }
    }
  });
  const journals = Array.from(byJournal.values())
    .map(j => ({
      name: j.name,
      count: j.count,
      ifAvg: j.ifN ? fmtIF(j.ifSum / j.ifN) : null,
      jcr: j.q || 'NA',
      cas: j.b || 'NA',
      top: j.top ? 'TOP' : '',
      oa: j.oaCat === 'oa' ? 'OA' : (j.oaCat === 'non' ? 'Non-OA' : 'Unknown'),
      apc: j.apcN ? Math.round(j.apcSum / j.apcN) : null,
      publisher: j.publisher,
      country: j.country,
      website: j.website
    }))
    .sort((a, b) => b.count - a.count);

  const otherJournals = new Map();
  abb.forEach(r => {
    const key = r.name || 'Unknown';
    otherJournals.set(key, (otherJournals.get(key) || 0) + 1);
  });
  const others = Array.from(otherJournals.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  const unmatchedMap = new Map();
  unknown.forEach(r => {
    const key = r.name || 'Unknown journal';
    unmatchedMap.set(key, (unmatchedMap.get(key) || 0) + 1);
  });
  const unmatched = Array.from(unmatchedMap.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  return {
    version: 2,
    meta,
    summary: {
      total: records.length,
      sci: sci.length,
      abb: abb.length,
      unknown: unknown.length,
      withIf: ifValues.length,
      avgIF: fmtIF(avgIF) || 0,
      medianIF: fmtIF(medianIF) || 0,
      minYear, maxYear
    },
    dists: { jcrDist, casDist, clsDist, yearDist, ifDist, oaDist },
    journals,
    others,
    unmatched
  };
}

function buildMeta(scope, term, extra) {
  return Object.assign({
    scope,
    term: term || '',
    generatedAt: Date.now(),
    url: window.location.href,
    extVersion: '1.2.0'
  }, extra || {});
}

async function runPageAnalysis() {
  const { total } = currentWrapStats();
  if (total === 0) {
    showModal('JournalMetrics', '<p>No PubMed results found on this page. Open a search results page, then analyze again.</p>',
      '<button class="jm-btn ghost" id="jm-cancel2">Close</button>');
    modalRoot.querySelector('#jm-cancel2').addEventListener('click', closeModal);
    return;
  }

  // give the enhancer a short grace period to tag all items currently on the page
  let cur = currentWrapStats();
  const deadline = Date.now() + 3000;
  while (cur.processed < cur.total && Date.now() < deadline) {
    await sleep(200);
    cur = currentWrapStats();
  }

  const records = [];
  let unprocessed = 0;
  document.querySelectorAll('.docsum-wrap').forEach(wrap => {
    const rec = journalRecordOf(wrap);
    if (rec) records.push(rec);
    else unprocessed++;
  });

  const searchCount = getPubMedTotalFromPage();
  const meta = buildMeta('page', getSearchTermFromUrl(), {
    pageCount: total,
    analyzed: records.length,
    searchCount,
    unprocessed
  });
  const payload = analyzeRecords(records, meta);
  await openStats(payload);
}

// ---------------------- E-utilities full search analysis ----------------------
let searchCancelled = false;

function ncbiFetchJson(url) {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    fetch(url, { signal: ctrl.signal })
      .then(res => {
        clearTimeout(timer);
        if (!res.ok) { res.text().then(t => reject(new Error('NCBI HTTP ' + res.status + ': ' + String(t).slice(0, 200)))); return; }
        return res.json().then(resolve).catch(() => reject(new Error('Invalid JSON from NCBI')));
      })
      .catch(err => reject(err));
  });
}

async function esearchPubmed(term, retmax) {
  const url = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=' + retmax + '&tool=JournalMetrics&email=jinwang93%40suda.edu.cn&term=' + encodeURIComponent(term);
  const data = await ncbiFetchJson(url);
  const r = data && data.esearchresult;
  if (!r) throw new Error('esearch returned no result object');
  const count = parseInt(r.count, 10) || 0;
  return { count, ids: r.idlist || [] };
}

async function esummaryBatch(ids, progress) {
  const url = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&tool=JournalMetrics&email=jinwang93%40suda.edu.cn&id=' + encodeURIComponent(ids.join(','));
  const data = await ncbiFetchJson(url);
  const res = data && data.result;
  if (!res || !res.uids) throw new Error('esummary returned no result object');
  const out = [];
  for (const uid of res.uids) {
    const e = res[uid];
    if (!e) continue;
    const year = String(e.pubdate || e.epubdate || '').match(/\b(19|20)\d{2}\b/);
    out.push({
      pmid: uid,
      year: year ? year[0] : '',
      full: (e.fulljournalname || '').trim(),
      source: (e.source || '').trim()
    });
  }
  return out;
}

async function runSearchAnalysis(term) {
  if (!term) {
    showModal('JournalMetrics', '<p>No search term detected. Run this from a PubMed search results page.</p>', '<button class="jm-btn ghost" id="jm-close2">Close</button>');
    modalRoot.querySelector('#jm-close2').addEventListener('click', closeModal);
    return;
  }

  searchCancelled = false;
  const progress = showProgressModal('Analyzing whole search…');
  const limit = analysisLimit();

  try {
    progress.update(0, 1, 'Searching PubMed (esearch)…');
    const { count, ids } = await esearchPubmed(term, limit);
    const truncated = count > ids.length;
    if (count === 0 || ids.length === 0) {
      progress.done();
      showModal('JournalMetrics', '<p>PubMed returned no records for this query.</p>', '<button class="jm-btn ghost" id="jm-c3">Close</button>');
      modalRoot.querySelector('#jm-c3').addEventListener('click', closeModal);
      return;
    }
    progress.update(0, ids.length, `Fetching details for ${ids.length.toLocaleString()} PMIDs…`);
    progress.setCancelDisabled();

    const records = [];
    const BATCH = 200;
    let offset = 0;
    while (offset < ids.length && !searchCancelled) {
      const chunk = ids.slice(offset, offset + BATCH);
      const entries = await esummaryBatch(chunk);
      for (const en of entries) {
        const journal = findJournalByNames(en.full, en.source);
        if (journal) {
          records.push(makeRecord(journal, en.year, en.pmid));
        } else {
          records.push({ kind: 'unknown', name: (en.full || en.source || 'Unknown journal'), year: en.year, pmid: en.pmid });
        }
      }
      offset += BATCH;
      progress.update(Math.min(offset, ids.length), ids.length,
        `Analyzing ${Math.min(offset, ids.length).toLocaleString()} / ${ids.length.toLocaleString()} PMIDs…`);
      if (offset < ids.length && !searchCancelled) await sleep(400); // NCBI ≤3 req/s w/o API key
    }
    if (searchCancelled) {
      progress.done();
      showModal('JournalMetrics', '<p>Analysis cancelled. Only the current page can still be analyzed.</p>', '<button class="jm-btn ghost" id="jm-c4">Close</button>');
      modalRoot.querySelector('#jm-c4').addEventListener('click', closeModal);
      return;
    }

    const meta = buildMeta('search', term, {
      searchCount: count,
      analyzedIds: records.length,
      searchLimit: ids.length,
      limit: limit,
      truncated
    });
    const payload = analyzeRecords(records, meta);
    progress.done();
    await openStats(payload);
  } catch (e) {
    progress.done();
    showModal('JournalMetrics', `<p>Full-search analysis failed: ${escHtml(e.message || e)}</p>
      <p class="jm-muted">Check your network connection / proxy. You can still analyze the current page.</p>`,
      '<button class="jm-btn ghost" id="jm-c5">Close</button>');
    modalRoot.querySelector('#jm-c5').addEventListener('click', closeModal);
  }
}

function openStats(payload) {
  return new Promise((resolve) => {
    const fallback = () => { openStatsFallback(payload); resolve(); };
    try {
      chrome.runtime.sendMessage({ action: 'openStatsPage', statsData: payload }, () => {
        if (chrome.runtime.lastError) {
          // background unavailable (e.g. service worker failed) → open the page ourselves
          console.warn('[JournalMetrics] openStatsPage message failed, using direct fallback:', chrome.runtime.lastError.message);
          fallback();
        } else {
          resolve();
        }
      });
    } catch (e) {
      console.warn('[JournalMetrics] openStatsPage threw, using direct fallback:', e);
      fallback();
    }
  });
}

/** Direct fallback: store the payload and open stats.html without the background worker. */
function openStatsFallback(payload) {
  const showErr = (msg) => {
    try {
      showModal('JournalMetrics', `<p>Failed to open the statistics page: ${escHtml(msg)}</p>`,
        '<button class="jm-btn ghost" id="jm-stats-err2">Close</button>');
      modalRoot.querySelector('#jm-stats-err2').addEventListener('click', closeModal);
    } catch (e) { /* ignore */ }
  };
  try {
    chrome.storage.local.set({ statsData: payload }, () => {
      if (chrome.runtime.lastError) { showErr(chrome.runtime.lastError.message); return; }
      chrome.tabs.create({ url: chrome.runtime.getURL('stats.html') }, () => {
        if (chrome.runtime.lastError) showErr(chrome.runtime.lastError.message);
      });
    });
  } catch (e) {
    showErr(String(e && e.message || e));
  }
}

// ---------------------- access helper ----------------------
function detectBrowserCheck() {
  if (window.location.href.includes('google.com/recaptcha')) return true;
  if (!document.body) return false;
  const patterns = ['checking your browser', '正在检查浏览器', 'reCAPTCHA', 'RecaptchaChallengePageUi', 'BOQ_wizbind', 'google.com/recaptcha'];
  const htmlContent = document.documentElement ? document.documentElement.innerHTML : '';
  return patterns.some(p => htmlContent.includes(p));
}

function redirectToRecaptchaNet() {
  const currentUrl = window.location.href;
  const newUrl = currentUrl.replace(/https?:\/\/(?:www\.|recaptcha\.)google\.com\/recaptcha\//, 'https://recaptcha.net/recaptcha/');
  window.location.replace(newUrl);
}

function injectMainWorldScript() {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('main-world.js');
    script.onload = function () { this.remove(); };
    (document.documentElement || document.head || document.body).appendChild(script);
  } catch (e) { /* ignore */ }
}

function initAccessHelper() {
  if (!settings.accessHelper) return;
  if (window.location.href.includes('google.com/recaptcha')) {
    redirectToRecaptchaNet();
    return;
  }
  injectMainWorldScript();

  const checkAndBypass = () => {
    if (detectBrowserCheck()) {
      console.log('[JournalMetrics] Browser check detected');
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAndBypass, { once: true });
  } else {
    checkAndBypass();
  }

  const origPushState = history.pushState;
  history.pushState = function () {
    const result = origPushState.apply(this, arguments);
    if (window.location.href.includes('google.com/recaptcha')) redirectToRecaptchaNet();
    return result;
  };
  window.addEventListener('popstate', () => {
    if (window.location.href.includes('google.com/recaptcha')) redirectToRecaptchaNet();
  });
}

// ---------------------- boot ----------------------
async function initJournalEnhancement() {
  if (window !== window.top) return;
  try {
    await loadData();
    dataLoaded = true;
  } catch (error) {
    console.error('[JournalMetrics] Failed to load data:', error);
    return;
  }
  observePage();
  createFilterPanel();
  loadFilterState();
  enhancePage();
  setTimeout(enhancePage, 1500);
  setTimeout(enhancePage, 4000);
}

async function init() {
  try { await loadSettings(); } catch (e) { console.error('[JournalMetrics] loadSettings failed', e); }

  initAccessHelper();

  if (window === window.top) {
    const boot = () => {
      createStatsButton();
      syncActionBarVisibility();
      initJournalEnhancement();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'runStatistics') {
      openAnalysisModal();
      sendResponse({ success: true });
    }
    if (message.action === 'reinitAccessHelper') {
      settings.accessHelper = message.enabled;
      if (message.enabled) {
        injectMainWorldScript();
        if (detectBrowserCheck()) {
          showAccessStatus('🔄 Reloading to apply access helper…', 'blue');
          setTimeout(() => window.location.reload(), 500);
        }
      }
      sendResponse({ success: true });
    }
  });
}

function showAccessStatus(msg, color) {
  if (!document.documentElement) return;
  let el = document.getElementById('journal-info-access-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'journal-info-access-status';
    Object.assign(el.style, {
      position: 'fixed', top: '0', left: '0', width: '100%', zIndex: '2147483647',
      padding: '8px 16px', fontSize: '14px', fontWeight: '600', textAlign: 'center',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)', color: '#fff'
    });
    document.documentElement.appendChild(el);
  }
  const colors = { blue: '#2563eb', green: '#16a34a', red: '#dc2626', yellow: '#ca8a04' };
  el.style.background = colors[color] || colors.blue;
  el.textContent = msg;
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 5000);
}

init();
