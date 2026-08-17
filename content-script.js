console.log('[JournalMetrics] Content script loaded');

if (window.location.href.includes('google.com/recaptcha')) {
  redirectToRecaptchaNet();
}

injectMainWorldScript();
modifyNavigator();

let filterIndex = {};
let filterIndexNoSpace = {};
let pubmedAbbIndex = {};
let pubmedAbbIndexNoSpace = {};
let settings = {};
const injectedIds = new Set();
let dataLoaded = false;

function injectMainWorldScript() {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('main-world.js');
    script.onload = function() { this.remove(); };
    (document.documentElement || document.head || document.body).appendChild(script);
  } catch (e) {
    console.log('[JournalMetrics] Failed to inject main world script:', e);
  }
}

function modifyNavigator() {
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: function() { return undefined; },
      configurable: true
    });
  } catch (e) {}

  try {
    Object.defineProperty(Navigator.prototype, 'languages', {
      get: function() { return ['en-US', 'en']; },
      configurable: true
    });
  } catch (e) {}

  try {
    Object.defineProperty(Navigator.prototype, 'platform', {
      get: function() { return 'Win32'; },
      configurable: true
    });
  } catch (e) {}

  try {
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
      get: function() { return 8; },
      configurable: true
    });
  } catch (e) {}

  try {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', {
      get: function() { return 8; },
      configurable: true
    });
  } catch (e) {}

  try {
    if (navigator.plugins && navigator.plugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', {
        get: function() {
          return {
            length: 3,
            item: function(i) { return null; },
            namedItem: function() { return null; }
          };
        },
        configurable: true
      });
    }
  } catch (e) {}

  try {
    const originalQuery = window.permissions.query;
    window.permissions.query = function(parameters) {
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission });
      }
      return originalQuery.call(this, parameters);
    };
  } catch (e) {}
}

function detectBrowserCheck() {
  if (window.location.href.includes('google.com/recaptcha')) {
    return true;
  }
  
  if (!document.body) return false;
  
  const patterns = [
    'checking your browser',
    '正在检查浏览器',
    'reCAPTCHA',
    'RecaptchaChallengePageUi',
    'BOQ_wizbind',
    'google.com/recaptcha'
  ];
  
  const htmlContent = document.documentElement ? document.documentElement.innerHTML : '';
  
  for (let i = 0; i < patterns.length; i++) {
    if (htmlContent.includes(patterns[i])) {
      return true;
    }
  }
  return false;
}

function bypassBrowserCheck() {
  console.log('[JournalMetrics] Detected browser check');
  
  if (window.location.href.includes('google.com/recaptcha')) {
    redirectToRecaptchaNet();
    return;
  }
}

function redirectToRecaptchaNet() {
  var currentUrl = window.location.href;
  var newUrl = currentUrl.replace(/https?:\/\/(?:www\.|recaptcha\.)google\.com\/recaptcha\//, 'https://recaptcha.net/recaptcha/');
  console.log('[JournalMetrics] Redirecting Google reCAPTCHA to recaptcha.net:', newUrl);
  window.location.replace(newUrl);
}

function showAccessStatus(msg, color) {
  if (!document.documentElement) return;
  
  let el = document.getElementById('journal-info-access-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'journal-info-access-status';
    el.style.position = 'fixed';
    el.style.top = '0';
    el.style.left = '0';
    el.style.width = '100%';
    el.style.zIndex = '2147483647';
    el.style.padding = '8px 16px';
    el.style.fontSize = '14px';
    el.style.fontWeight = '600';
    el.style.textAlign = 'center';
    el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
    el.style.color = '#fff';
    document.documentElement.appendChild(el);
    
    if (document.body) {
      document.body.style.paddingTop = '40px';
    }
  }
  
  const colors = {
    blue: '#2563eb',
    green: '#16a34a',
    red: '#dc2626',
    yellow: '#ca8a04'
  };
  
  el.style.background = colors[color] || colors.blue;
  el.textContent = msg;
  
  setTimeout(function() {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
      if (document.body) {
        document.body.style.paddingTop = '';
      }
    }
  }, 5000);
}

function initAccessHelper() {
  if (!settings.accessHelper) return;
  
  console.log('[JournalMetrics] Access helper enabled (reCAPTCHA mirror mode)');

  if (window.location.href.includes('google.com/recaptcha')) {
    redirectToRecaptchaNet();
    return;
  }

  const checkAndBypass = function() {
    if (detectBrowserCheck()) {
      console.log('[JournalMetrics] Browser check detected');
      bypassBrowserCheck();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAndBypass, { once: true });
  } else {
    checkAndBypass();
  }

  const origPushState = history.pushState;
  history.pushState = function() {
    const result = origPushState.apply(this, arguments);
    if (window.location.href.includes('google.com/recaptcha')) {
      redirectToRecaptchaNet();
    }
    return result;
  };

  window.addEventListener('popstate', function() {
    if (window.location.href.includes('google.com/recaptcha')) {
      redirectToRecaptchaNet();
    }
  });
}

async function initJournalEnhancement() {
  if (window !== window.top) return;
  
  try {
    await loadData();
    dataLoaded = true;
    console.log('[JournalMetrics] Data loaded successfully');
  } catch (error) {
    console.error('[JournalMetrics] Failed to load data:', error);
    showLoadError();
    return;
  }
  
  observePage();
  enhancePage();
  
  setTimeout(enhancePage, 2000);
  setTimeout(enhancePage, 5000);
  
  createFilterPanel();
  loadFilterState();
}

async function init() {
  console.log('[JournalMetrics] Starting initialization...');
  
  try {
    await loadSettings();
  } catch (error) {
    console.error('[JournalMetrics] Failed to load settings:', error);
  }
  
  initAccessHelper();
  
  if (window === window.top) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        createStatsButton();
        initJournalEnhancement();
      });
    } else {
      createStatsButton();
      initJournalEnhancement();
    }
  }
  
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'runStatistics') {
      runStatistics();
    }
    
    if (message.action === 'reinitAccessHelper') {
      settings.accessHelper = message.enabled;
      console.log('[JournalMetrics] Access helper reinitialized:', message.enabled);
      if (message.enabled) {
        injectMainWorldScript();
        modifyNavigator();
        if (detectBrowserCheck()) {
          showAccessStatus('🔄 Reloading to apply access helper...', 'blue');
          setTimeout(() => {
            window.location.reload(true);
          }, 500);
        }
      }
      sendResponse({ success: true });
    }
  });
}

function showLoadError() {
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = 'position: fixed; top: 10px; right: 10px; background: #f44336; color: white; padding: 12px 20px; border-radius: 8px; z-index: 9999; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);';
  errorDiv.innerHTML = '<strong>JournalMetrics</strong><br>Failed to load journal data.<br>Please reload the page.';
  document.body.appendChild(errorDiv);
  setTimeout(() => errorDiv.remove(), 10000);
}

async function loadData() {
  const filterUrl = chrome.runtime.getURL('data/filter_data.json');
  const abbUrl = chrome.runtime.getURL('data/pubmed_abb_data.json');
  
  console.log('[JournalMetrics] Loading data from:', filterUrl, abbUrl);
  
  const [filterRes, abbRes] = await Promise.all([fetch(filterUrl), fetch(abbUrl)]);
  
  if (!filterRes.ok) throw new Error(`filter_data: ${filterRes.status}`);
  if (!abbRes.ok) throw new Error(`pubmed_abb_data: ${abbRes.status}`);
  
  const filterData = await filterRes.json();
  const abbData = await abbRes.json();
  
  console.log('[JournalMetrics] Loaded data:', filterData.length, 'filter entries,', abbData.length, 'abb entries');
  
  buildIndex(filterData, abbData);
}

function normalize(text) {
  if (!text) return '';
  return text.trim().toUpperCase().replace(/[.,:;()\[\]'"\\/\-_]/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildIndex(filterData, abbData) {
  filterIndex = {};
  filterIndexNoSpace = {};
  pubmedAbbIndex = {};
  pubmedAbbIndexNoSpace = {};
  
  for (const item of filterData) {
    const abb = item.abb || '';
    const pubmed_journal = item.pubmed_journal || '';
    
    if (!abb && !pubmed_journal) continue;
    
    const normKey = normalize(abb);
    const noSpaceKey = normKey.replace(/\s+/g, '');
    
    if (!filterIndex[normKey]) filterIndex[normKey] = [];
    filterIndex[normKey].push(item);
    
    if (noSpaceKey && !filterIndexNoSpace[noSpaceKey]) {
      filterIndexNoSpace[noSpaceKey] = [];
    }
    if (noSpaceKey) {
      filterIndexNoSpace[noSpaceKey].push(item);
    }
    
    if (abb.includes('(')) {
      const abbWithoutParens = abb.replace(/\s*\([^)]*\)/g, '').trim();
      if (abbWithoutParens && abbWithoutParens !== abb) {
        const parenNormKey = normalize(abbWithoutParens);
        const parenNoSpaceKey = parenNormKey.replace(/\s+/g, '');
        
        if (!filterIndex[parenNormKey]) filterIndex[parenNormKey] = [];
        filterIndex[parenNormKey].push(item);
        
        if (parenNoSpaceKey && !filterIndexNoSpace[parenNoSpaceKey]) {
          filterIndexNoSpace[parenNoSpaceKey] = [];
        }
        if (parenNoSpaceKey) {
          filterIndexNoSpace[parenNoSpaceKey].push(item);
        }
      }
    }
    
    if (pubmed_journal) {
      const journalNormKey = normalize(pubmed_journal);
      const journalNoSpaceKey = journalNormKey.replace(/\s+/g, '');
      
      if (!filterIndex[journalNormKey]) filterIndex[journalNormKey] = [];
      filterIndex[journalNormKey].push(item);
      
      if (journalNoSpaceKey && !filterIndexNoSpace[journalNoSpaceKey]) {
        filterIndexNoSpace[journalNoSpaceKey] = [];
      }
      if (journalNoSpaceKey) {
        filterIndexNoSpace[journalNoSpaceKey].push(item);
      }
    }
  }
  
  for (const item of abbData) {
    const abb = item.abb || '';
    if (!abb) continue;
    
    const normKey = normalize(abb);
    const noSpaceKey = normKey.replace(/\s+/g, '');
    
    if (!pubmedAbbIndex[normKey]) {
      pubmedAbbIndex[normKey] = item;
    }
    
    if (noSpaceKey && !pubmedAbbIndexNoSpace[noSpaceKey]) {
      pubmedAbbIndexNoSpace[noSpaceKey] = item;
    }
  }
  
  console.log('[JournalMetrics] Built index:', 
    Object.keys(filterIndex).length, 'filter keys,', 
    Object.keys(filterIndexNoSpace).length, 'filter no-space keys,',
    Object.keys(pubmedAbbIndex).length, 'abb keys,',
    Object.keys(pubmedAbbIndexNoSpace).length, 'abb no-space keys');
}

async function loadSettings() {
  const defaults = {
    if: true,
    jcr: true,
    cas: true,
    top: true,
    selfCitationRate: false,
    website: false,
    oa: false,
    publisher: false,
    country: false,
    annualArticleCount: false,
    researchArticlesProportion: false,
    apc: false
  };
  
  return new Promise((resolve) => {
    chrome.storage.local.get(defaults, (result) => {
      settings = result;
      console.log('[JournalMetrics] Loaded settings:', settings);
      resolve();
    });
  });
}

function findJournal(text) {
  if (!text || text.trim().length < 2) return null;
  
  console.time('[JournalMetrics] findJournal');
  
  const normText = normalize(text);
  const noSpaceText = normText.replace(/\s+/g, '');
  
  let items = filterIndex[normText];
  if (!items && noSpaceText) {
    items = filterIndexNoSpace[noSpaceText];
  }
  
  if (items && items.length > 0) {
    const item = items[0];
    console.timeEnd('[JournalMetrics] findJournal');
    console.log('[JournalMetrics] Found in filter:', item.abb, 'IF:', item.IF);
    return {
      journal: item.pubmed_journal || item.journal,
      journal_abb: item.abb,
      issn: item.pubmed_issn || item.issn,
      eissn: item.pubmed_eissn || '',
      sci: true,
      IF: item.IF,
      Q: item.Q,
      B: item.B,
      T: item.T,
      top: item.T === '1' ? 'Top Journal' : 'Non-Top Journal',
      selfCitationRate: item.s || '',
      website: item.w || '',
      oa: item.o || '',
      publisher: item.p || '',
      country: item.c || '',
      annualArticleCount: item.a || '',
      researchArticlesProportion: item.r || '',
      apc: item.x || ''
    };
  }
  
  let abbItem = pubmedAbbIndex[normText];
  if (!abbItem && noSpaceText) {
    abbItem = pubmedAbbIndexNoSpace[noSpaceText];
  }
  
  if (abbItem) {
    console.timeEnd('[JournalMetrics] findJournal');
    console.log('[JournalMetrics] Found in abb:', abbItem.abb);
    return {
      journal: abbItem.pubmed_journal || abbItem.journal,
      journal_abb: abbItem.abb,
      issn: abbItem.pubmed_issn || abbItem.issn,
      eissn: abbItem.pubmed_eissn || '',
      sci: false,
      IF: 'NA',
      Q: 'NA',
      B: 'NA',
      T: '0',
      top: 'NA'
    };
  }
  
  console.timeEnd('[JournalMetrics] findJournal');
  return null;
}

function isValidJournal(journalName) {
  if (!journalName) return false;
  
  if (Object.keys(filterIndex).length === 0) {
    return true;
  }
  
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
        const candidate = match[0].trim();
        
        const nextPart = parts[1].trim();
        if (nextPart.match(/^\d{4}/) || nextPart.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i)) {
          return candidate.replace(/\s+/g, ' ').trim();
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

function createInfoBox(journal) {
  if (!journal) return null;
  
  let html = '<div class="journal-info-box">';
  
  if (journal.sci) {
    if (settings.if && journal.IF && journal.IF !== 'NA') {
      html += `<div class="info-item if"><span class="label">IF:</span><span class="value">${journal.IF}</span></div>`;
    }
    if (settings.jcr && journal.Q && journal.Q !== 'NA') {
      const qColors = { 'Q1': '#4CAF50', 'Q2': '#2196F3', 'Q3': '#FF9800', 'Q4': '#F44336' };
      const color = qColors[journal.Q] || '#9E9E9E';
      html += `<div class="info-item jcr" style="background-color:${color}"><span class="label">JCR:</span><span class="value">${journal.Q}</span></div>`;
    }
    if (settings.cas && journal.B && journal.B !== 'NA' && journal.B !== 'N/A') {
      const bColors = { 'B1': '#E91E63', 'B2': '#9C27B0', 'B3': '#673AB7', 'B4': '#3F51B5' };
      const color = bColors[journal.B] || '#9E9E9E';
      html += `<div class="info-item cas" style="background-color:${color}"><span class="label">CAS:</span><span class="value">${journal.B}</span></div>`;
    }
    if (settings.top && journal.T === '1') {
      html += `<div class="info-item top"><span class="label">★</span><span class="value">TOP</span></div>`;
    }
    
    if (settings.selfCitationRate && journal.selfCitationRate && journal.selfCitationRate !== '' && journal.selfCitationRate !== '0') {
      html += `<div class="info-item"><span class="label">Self-Cite:</span><span class="value">${journal.selfCitationRate}</span></div>`;
    }
    if (settings.website && journal.website && journal.website !== '' && journal.website !== '0') {
      html += `<div class="info-item"><span class="label">Website:</span><a href="${journal.website}" target="_blank" class="link">Link</a></div>`;
    }
    if (settings.oa && journal.oa && journal.oa !== '' && journal.oa !== '0') {
      let oaClass = 'oa-no';
      if (journal.oa.toLowerCase() === 'yes') oaClass = 'oa-yes';
      else if (journal.oa.toLowerCase() === 'hybrid') oaClass = 'oa-hybrid';
      else if (journal.oa.toLowerCase() === 'transformative') oaClass = 'oa-transformative';
      html += `<div class="info-item ${oaClass}"><span class="label">OA:</span><span class="value">${journal.oa}</span></div>`;
    }
    if (settings.publisher && journal.publisher && journal.publisher !== '' && journal.publisher !== '0') {
      html += `<div class="info-item"><span class="label">Publisher:</span><span class="value">${journal.publisher}</span></div>`;
    }
    if (settings.country && journal.country && journal.country !== '' && journal.country !== '0') {
      html += `<div class="info-item"><span class="label">Country:</span><span class="value">${journal.country}</span></div>`;
    }
    if (settings.annualArticleCount && journal.annualArticleCount && journal.annualArticleCount !== '' && journal.annualArticleCount !== '0') {
      html += `<div class="info-item"><span class="label">Articles/Year:</span><span class="value">${journal.annualArticleCount}</span></div>`;
    }
    if (settings.researchArticlesProportion && journal.researchArticlesProportion && journal.researchArticlesProportion !== '' && journal.researchArticlesProportion !== '0') {
      html += `<div class="info-item"><span class="label">Research:</span><span class="value">${(parseFloat(journal.researchArticlesProportion) * 100).toFixed(1)}%</span></div>`;
    }
    if (settings.apc && journal.apc && journal.apc !== '' && journal.apc !== '0') {
      html += `<div class="info-item"><span class="label">APC:</span><span class="value">${journal.apc}</span></div>`;
    }
  } else {
    html += `<div class="info-item"><span class="label">SCI:</span><span class="value" style="color:#9E9E9E">No</span></div>`;
  }
  
  html += '</div>';
  return html;
}

function enhancePage() {
  console.log('[JournalMetrics] Enhancing page...');
  
  const docsumWraps = document.querySelectorAll('.docsum-wrap');
  console.log('[JournalMetrics] Found', docsumWraps.length, 'docsum-wrap elements');
  
  for (const wrap of docsumWraps) {
    const titleLink = wrap.querySelector('.docsum-title');
    if (!titleLink) continue;
    
    const articleId = titleLink.dataset.articleId;
    if (!articleId) continue;
    
    if (injectedIds.has(articleId)) continue;
    
    const journalText = extractJournalText(wrap);
    if (journalText) {
      console.log('[JournalMetrics] Article', articleId, 'journal text:', journalText);
      
      const journal = findJournal(journalText);
      if (journal) {
        console.log('[JournalMetrics] Matched:', journal.journal_abb, 'IF:', journal.IF);
        injectInfo(wrap, journal, articleId);
        injectedIds.add(articleId);
      } else {
        console.log('[JournalMetrics] No match for:', journalText);
      }
    } else {
      console.log('[JournalMetrics] No journal text found for article', articleId);
    }
  }
  
  enhanceDetailPage();
}

function enhanceDetailPage() {
  const articleCitation = document.querySelector('.article-citation');
  if (!articleCitation) return;
  
  const existing = document.getElementById('journal-info-detail');
  if (existing) existing.remove();
  
  const journalActionsTrigger = document.getElementById('full-view-journal-trigger');
  let journalText = '';
  
  if (journalActionsTrigger) {
    journalText = journalActionsTrigger.textContent.trim();
  } else {
    const articleSource = articleCitation.querySelector('.article-source');
    if (articleSource) {
      const text = articleSource.textContent.trim();
      const match = text.match(/^[A-Z][a-zA-Z]*(( [A-Z][a-zA-Z]+)|( [A-Z]))*/);
      if (match && match[0].trim().length > 3) {
        journalText = match[0].trim();
      }
    }
  }
  
  if (!journalText) return;
  
  console.log('[JournalMetrics] Detail page journal:', journalText);
  
  const journal = findJournal(journalText);
  if (journal) {
    console.log('[JournalMetrics] Detail page matched:', journal.journal_abb, 'IF:', journal.IF);
    
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

function extractJournalText(wrapElement) {
  const journalCitation = wrapElement.querySelector('.docsum-journal-citation');
  if (journalCitation) {
    const text = journalCitation.textContent.trim();
    const journalPart = parseJournalFromCitation(text);
    if (journalPart) {
      if (isValidJournal(journalPart)) {
        return journalPart;
      }
    }
    return null;
  }
  
  const selectors = [
    '.docsum-journal'
  ];
  
  for (const sel of selectors) {
    const el = wrapElement.querySelector(sel);
    if (el) {
      const text = el.textContent.trim();
      if (text.length > 3 && isValidJournal(text)) {
        return text;
      }
    }
  }
  
  return null;
}

function injectInfo(wrapElement, journal, articleId) {
  const html = createInfoBox(journal);
  if (!html) return;
  
  const existing = document.querySelector(`#journal-info-${articleId}`);
  if (existing) existing.remove();
  
  const container = document.createElement('div');
  container.id = `journal-info-${articleId}`;
  container.className = 'journal-info-container';
  container.innerHTML = html;
  
  const docsumContent = wrapElement.querySelector('.docsum-content');
  if (docsumContent) {
    docsumContent.appendChild(container);
  } else {
    wrapElement.appendChild(container);
  }
  
  const year = extractYearFromCitation(wrapElement);
  journal.year = year;
  
  wrapElement.dataset.journalData = JSON.stringify(journal);
}

function extractYearFromCitation(wrapElement) {
  const citationEl = wrapElement.querySelector('.docsum-journal-citation');
  if (citationEl) {
    const text = citationEl.textContent;
    const yearMatch = text.match(/\b(20\d{2})\b/);
    if (yearMatch) {
      return yearMatch[1];
    }
  }
  return '';
}

function observePage() {
  const observer = new MutationObserver((mutations) => {
    let shouldEnhance = false;
    
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.classList && node.classList.contains('docsum-wrap')) {
            shouldEnhance = true;
          }
          if (node.querySelectorAll && node.querySelectorAll('.docsum-wrap').length > 0) {
            shouldEnhance = true;
          }
          if (node.classList && (node.classList.contains('article-citation') || node.classList.contains('article-source'))) {
            shouldEnhance = true;
          }
          if (node.querySelectorAll && (node.querySelectorAll('.article-citation').length > 0 || node.querySelectorAll('.article-source').length > 0)) {
            shouldEnhance = true;
          }
        }
      }
    }
    
    if (shouldEnhance) {
      setTimeout(() => {
        enhancePage();
        filterArticles();
      }, 800);
    }
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
  
  chrome.storage.onChanged.addListener((changes) => {
    Object.assign(settings, changes);
    enhancePage();
  });
}

const filterState = {
  ifMin: '',
  ifMax: '',
  jcrQuartiles: [],
  casBlocks: []
};

function createStatsButton() {
  if (document.getElementById('stats-toggle')) return;
  
  const btn = document.createElement('button');
  btn.id = 'stats-toggle';
  btn.className = 'stats-toggle';
  btn.textContent = 'Stats';
  btn.title = 'Run Statistics Analysis';
  
  btn.addEventListener('click', runStatistics);
  
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
        <h3>📊 Filter</h3>
        <button class="filter-panel-close" id="filter-panel-close">×</button>
      </div>
      
      <div class="filter-section">
        <div class="filter-section-title">Impact Factor (IF)</div>
        <div class="filter-if-range">
          <input type="number" id="filter-if-min" placeholder="Min" step="0.1">
          <span>-</span>
          <input type="number" id="filter-if-max" placeholder="Max" step="0.1">
        </div>
      </div>
      
      <div class="filter-section">
        <div class="filter-section-title">JCR Quartile</div>
        <div class="filter-checkbox-group" id="filter-jcr-group">
          <label class="filter-checkbox-item" data-value="Q1">
            <input type="checkbox" value="Q1"> Q1
          </label>
          <label class="filter-checkbox-item" data-value="Q2">
            <input type="checkbox" value="Q2"> Q2
          </label>
          <label class="filter-checkbox-item" data-value="Q3">
            <input type="checkbox" value="Q3"> Q3
          </label>
          <label class="filter-checkbox-item" data-value="Q4">
            <input type="checkbox" value="Q4"> Q4
          </label>
        </div>
      </div>
      
      <div class="filter-section">
        <div class="filter-section-title">CAS Block</div>
        <div class="filter-checkbox-group" id="filter-cas-group">
          <label class="filter-checkbox-item" data-value="B1">
            <input type="checkbox" value="B1"> B1
          </label>
          <label class="filter-checkbox-item" data-value="B2">
            <input type="checkbox" value="B2"> B2
          </label>
          <label class="filter-checkbox-item" data-value="B3">
            <input type="checkbox" value="B3"> B3
          </label>
          <label class="filter-checkbox-item" data-value="B4">
            <input type="checkbox" value="B4"> B4
          </label>
        </div>
      </div>
      
      <div class="filter-actions">
        <button class="filter-action-btn apply" id="filter-apply">Apply</button>
        <button class="filter-action-btn reset" id="filter-reset">Reset</button>
      </div>
      
      <div class="filter-stats" id="filter-stats"></div>
    </div>
    
    <button class="filter-panel-toggle" id="filter-panel-toggle">Filter</button>
  `;
  
  document.body.appendChild(wrapper);
  
  initFilterPanelEvents();
}

function initFilterPanelEvents() {
  const toggleBtn = document.getElementById('filter-panel-toggle');
  const closeBtn = document.getElementById('filter-panel-close');
  const panel = document.getElementById('filter-panel');
  const applyBtn = document.getElementById('filter-apply');
  const resetBtn = document.getElementById('filter-reset');
  
  toggleBtn.addEventListener('click', () => {
    panel.classList.toggle('open');
  });
  
  closeBtn.addEventListener('click', () => {
    panel.classList.remove('open');
  });
  
  applyBtn.addEventListener('click', applyFilters);
  
  resetBtn.addEventListener('click', resetFilters);
  
  const jcrCheckboxes = document.querySelectorAll('#filter-jcr-group input[type="checkbox"]');
  jcrCheckboxes.forEach(cb => {
    cb.addEventListener('change', (e) => {
      const label = e.target.parentElement;
      if (e.target.checked) {
        label.classList.add('active');
      } else {
        label.classList.remove('active');
      }
    });
  });
  
  const casCheckboxes = document.querySelectorAll('#filter-cas-group input[type="checkbox"]');
  casCheckboxes.forEach(cb => {
    cb.addEventListener('change', (e) => {
      const label = e.target.parentElement;
      if (e.target.checked) {
        label.classList.add('active');
      } else {
        label.classList.remove('active');
      }
    });
  });
}

function applyFilters() {
  const ifMin = document.getElementById('filter-if-min').value;
  const ifMax = document.getElementById('filter-if-max').value;
  
  const jcrCheckboxes = document.querySelectorAll('#filter-jcr-group input[type="checkbox"]:checked');
  const jcrQuartiles = Array.from(jcrCheckboxes).map(cb => cb.value);
  
  const casCheckboxes = document.querySelectorAll('#filter-cas-group input[type="checkbox"]:checked');
  const casBlocks = Array.from(casCheckboxes).map(cb => cb.value);
  
  filterState.ifMin = ifMin;
  filterState.ifMax = ifMax;
  filterState.jcrQuartiles = jcrQuartiles;
  filterState.casBlocks = casBlocks;
  
  chrome.storage.local.set({ filterState: filterState });
  filterArticles();
}

function resetFilters() {
  document.getElementById('filter-if-min').value = '';
  document.getElementById('filter-if-max').value = '';
  
  document.querySelectorAll('.filter-section input[type="checkbox"]').forEach(cb => {
    cb.checked = false;
    cb.parentElement.classList.remove('active');
  });
  
  filterState.ifMin = '';
  filterState.ifMax = '';
  filterState.jcrQuartiles = [];
  filterState.casBlocks = [];
  
  chrome.storage.local.set({ filterState: filterState });
  filterArticles();
}

function filterArticles() {
  const articles = document.querySelectorAll('article.full-docsum');
  let visibleCount = 0;
  
  for (const article of articles) {
    const wrap = article.querySelector('.docsum-wrap');
    if (!wrap) {
      article.classList.remove('filter-hidden');
      visibleCount++;
      continue;
    }
    
    let journal = null;
    
    if (wrap.dataset.journalData) {
      try {
        journal = JSON.parse(wrap.dataset.journalData);
      } catch (e) {
        journal = null;
      }
    }
    
    if (!journal || !journal.sci) {
      article.classList.remove('filter-hidden');
      visibleCount++;
      continue;
    }
    
    let match = true;
    
    if (filterState.ifMin) {
      const ifValue = parseFloat(journal.IF);
      if (isNaN(ifValue) || ifValue < parseFloat(filterState.ifMin)) {
        match = false;
      }
    }
    
    if (filterState.ifMax && match) {
      const ifValue = parseFloat(journal.IF);
      if (isNaN(ifValue) || ifValue > parseFloat(filterState.ifMax)) {
        match = false;
      }
    }
    
    if (filterState.jcrQuartiles.length > 0 && match) {
      if (!filterState.jcrQuartiles.includes(journal.Q)) {
        match = false;
      }
    }
    
    if (filterState.casBlocks.length > 0 && match) {
      if (!filterState.casBlocks.includes(journal.B)) {
        match = false;
      }
    }
    
    if (match) {
      article.classList.remove('filter-hidden');
      visibleCount++;
    } else {
      article.classList.add('filter-hidden');
    }
  }
  
  const statsEl = document.getElementById('filter-stats');
  if (statsEl) {
    statsEl.textContent = `${visibleCount} of ${articles.length} articles visible`;
  }
}

function runStatistics() {
  const docsumWraps = document.querySelectorAll('.docsum-wrap');
  const totalCount = docsumWraps.length;
  
  if (totalCount === 0) {
    alert('No articles found on this page.');
    return;
  }
  
  const journalDataList = [];
  
  for (const wrap of docsumWraps) {
    if (wrap.dataset.journalData) {
      try {
        const journal = JSON.parse(wrap.dataset.journalData);
        if ((journal.journal_abb || journal.abb) && journal.IF && journal.IF !== 'NA' && parseFloat(journal.IF) > 0) {
          journalDataList.push(journal);
        }
      } catch (e) {
        console.error('[JournalMetrics] Failed to parse journal data:', e);
      }
    }
  }
  
  const processedCount = Array.from(docsumWraps).filter(w => w.dataset.journalData).length;
  const progress = Math.round((processedCount / totalCount) * 100);
  
  if (processedCount < totalCount) {
    const proceed = confirm(`Only ${processedCount} of ${totalCount} articles have been processed (${progress}%). Some articles may not have journal data yet.\n\nDo you want to proceed with analysis?`);
    if (!proceed) return;
  }
  
  if (journalDataList.length === 0) {
    alert('No SCI journal data found. Please wait for the page to fully load and try again.');
    return;
  }
  
  const stats = analyzeStatistics(journalDataList);
  stats.timestamp = Date.now();
  
  chrome.runtime.sendMessage({ action: 'openStatsPage', statsData: stats }, (response) => {
    if (chrome.runtime.lastError) {
      alert('Failed to open statistics page: ' + chrome.runtime.lastError.message);
    } else if (!response || !response.success) {
      alert('Failed to open statistics page.');
    }
  });
}

function analyzeStatistics(journalDataList) {
  const totalCount = journalDataList.length;
  const sciCount = journalDataList.filter(j => j.IF && parseFloat(j.IF) > 0).length;
  
  const ifValues = journalDataList
    .map(j => parseFloat(j.IF))
    .filter(v => !isNaN(v));
  
  const avgIF = ifValues.length > 0 ? ifValues.reduce((a, b) => a + b, 0) / ifValues.length : 0;
  
  ifValues.sort((a, b) => a - b);
  const medianIF = ifValues.length > 0 
    ? (ifValues.length % 2 === 0 
      ? (ifValues[ifValues.length / 2 - 1] + ifValues[ifValues.length / 2]) / 2 
      : ifValues[Math.floor(ifValues.length / 2)])
    : 0;
  
  const jcrDistribution = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  journalDataList.forEach(j => {
    if (j.Q && jcrDistribution[j.Q] !== undefined) {
      jcrDistribution[j.Q]++;
    }
  });
  
  const casDistribution = { B1: 0, B2: 0, B3: 0, B4: 0 };
  journalDataList.forEach(j => {
    if (j.B && casDistribution[j.B] !== undefined) {
      casDistribution[j.B]++;
    }
  });
  
  const yearDistribution = {};
  journalDataList.forEach(j => {
    const year = j.year || '';
    if (year && /^\d{4}$/.test(year)) {
      yearDistribution[year] = (yearDistribution[year] || 0) + 1;
    }
  });
  
  const ifDistribution = {
    '< 1': 0,
    '1-3': 0,
    '3-5': 0,
    '5-10': 0,
    '10-20': 0,
    '>= 20': 0
  };
  
  ifValues.forEach(ifVal => {
    if (ifVal < 1) ifDistribution['< 1']++;
    else if (ifVal < 3) ifDistribution['1-3']++;
    else if (ifVal < 5) ifDistribution['3-5']++;
    else if (ifVal < 10) ifDistribution['5-10']++;
    else if (ifVal < 20) ifDistribution['10-20']++;
    else ifDistribution['>= 20']++;
  });
  
  const journalCounts = {};
  journalDataList.forEach(j => {
    const key = j.journal_abb || j.journal;
    if (!journalCounts[key]) {
      journalCounts[key] = {
        name: key,
        count: 0,
        ifSum: 0,
        jcr: j.Q,
        cas: j.B,
        selfCitationSum: 0,
        selfCitationCount: 0,
        oaCount: 0,
        apcSum: 0,
        apcCount: 0,
        annualArticleSum: 0,
        annualArticleCount: 0,
        publisher: j.publisher || j.p || '',
        country: j.country || j.c || '',
        website: j.website || j.w || ''
      };
    }
    journalCounts[key].count++;
    journalCounts[key].ifSum += parseFloat(j.IF) || 0;
    
    const selfCiteVal = j.selfCitationRate || j.s;
    if (selfCiteVal !== '' && selfCiteVal !== null && selfCiteVal !== undefined && !isNaN(parseFloat(selfCiteVal))) {
      journalCounts[key].selfCitationSum += parseFloat(selfCiteVal);
      journalCounts[key].selfCitationCount++;
    }
    
    const oaVal = j.oa || j.o;
    if (oaVal && oaVal.toLowerCase() !== 'no') {
      journalCounts[key].oaCount++;
    }
    
    const apcVal = j.apc || j.x;
    if (apcVal !== '' && apcVal !== null && apcVal !== undefined && apcVal !== 'NA') {
      const match = apcVal.match(/(\d+(?:\.\d+)?)/);
      if (match && !isNaN(parseFloat(match[1]))) {
        journalCounts[key].apcSum += parseFloat(match[1]);
        journalCounts[key].apcCount++;
      }
    }
    
    const articleCountVal = j.annualArticleCount || j.a;
    if (articleCountVal !== '' && articleCountVal !== null && articleCountVal !== undefined && articleCountVal !== 'NA' && !isNaN(parseFloat(articleCountVal))) {
      journalCounts[key].annualArticleSum += parseFloat(articleCountVal);
      journalCounts[key].annualArticleCount++;
    }
  });
  
  const topJournals = Object.values(journalCounts)
    .map(j => ({
      name: j.name,
      count: j.count,
      avgIF: j.count > 0 ? j.ifSum / j.count : 0,
      jcr: j.jcr,
      cas: j.cas,
      avgSelfCitation: j.selfCitationCount > 0 ? j.selfCitationSum / j.selfCitationCount : 0,
      oa: j.oaCount > 0 ? 'Yes' : 'No',
      avgAPC: j.apcCount > 0 ? (j.apcSum / j.apcCount).toFixed(0) : '-',
      avgAnnualArticles: j.annualArticleCount > 0 ? Math.round(j.annualArticleSum / j.annualArticleCount) : '-',
      publisher: j.publisher,
      country: j.country,
      website: j.website
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  const oaDistribution = {
    'OA': journalDataList.filter(j => {
      const oaVal = j.oa || j.o;
      return oaVal && oaVal.toLowerCase() !== 'no';
    }).length,
    'Non-OA': journalDataList.filter(j => {
      const oaVal = j.oa || j.o;
      return !oaVal || oaVal.toLowerCase() === 'no';
    }).length
  };
  
  return {
    totalCount,
    sciCount,
    avgIF,
    medianIF,
    jcrDistribution,
    casDistribution,
    yearDistribution,
    ifDistribution,
    oaDistribution,
    topJournals
  };
}

function loadFilterState() {
  chrome.storage.local.get('filterState', (result) => {
    if (result.filterState) {
      filterState.ifMin = result.filterState.ifMin || '';
      filterState.ifMax = result.filterState.ifMax || '';
      filterState.jcrQuartiles = result.filterState.jcrQuartiles || [];
      filterState.casBlocks = result.filterState.casBlocks || [];
      
      if (document.getElementById('filter-if-min')) {
        document.getElementById('filter-if-min').value = filterState.ifMin;
      }
      if (document.getElementById('filter-if-max')) {
        document.getElementById('filter-if-max').value = filterState.ifMax;
      }
      
      filterState.jcrQuartiles.forEach(q => {
        const cb = document.querySelector(`#filter-jcr-group input[value="${q}"]`);
        if (cb) {
          cb.checked = true;
          cb.parentElement.classList.add('active');
        }
      });
      
      filterState.casBlocks.forEach(b => {
        const cb = document.querySelector(`#filter-cas-group input[value="${b}"]`);
        if (cb) {
          cb.checked = true;
          cb.parentElement.classList.add('active');
        }
      });
      
      if (filterState.ifMin || filterState.ifMax || filterState.jcrQuartiles.length > 0 || filterState.casBlocks.length > 0) {
        setTimeout(filterArticles, 100);
      }
    }
  });
}

init();
