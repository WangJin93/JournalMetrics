// Shared default settings (single source of truth) - see defaults.js
import './defaults.js';
const DEFAULT_SETTINGS = globalThis.JM_DEFAULTS;

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
    const merged = Object.assign({}, DEFAULT_SETTINGS, stored);
    chrome.storage.local.set(merged);
    console.log('[JournalMetrics] Plugin initialized with settings:', merged);
  });

  if (details.reason === 'update') {
    console.log('[JournalMetrics] Plugin updated, refreshing rulesets');
    setAccessHelperEnabled(true);
  }
});

chrome.runtime.onUpdateAvailable.addListener((details) => {
  console.log('[JournalMetrics] Update available:', details.version);
});

async function setAccessHelperEnabled(enabled) {
  try {
    if (enabled) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: ['pubmed_rules']
      });
    } else {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: ['pubmed_rules']
      });
    }
    console.log('[JournalMetrics] Access helper ' + (enabled ? 'enabled' : 'disabled'));
  } catch (e) {
    console.error('[JournalMetrics] Failed to update rulesets:', e);
  }
}

chrome.storage.local.get('accessHelper', (result) => {
  if (result.accessHelper !== false) {
    setAccessHelperEnabled(true);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getSettings') {
    chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
      sendResponse(settings);
    });
    return true;
  }

  if (message.action === 'setAccessHelper') {
    const enabled = message.enabled;
    chrome.storage.local.set({ accessHelper: enabled }, () => {
      setAccessHelperEnabled(enabled);
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'reloadTab') {
    if (sender.tab) {
      chrome.tabs.reload(sender.tab.id, { bypassCache: true });
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'openPubMed') {
    chrome.tabs.create({ url: 'https://pubmed.ncbi.nlm.nih.gov/' });
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'openStatsPage') {
    const statsData = message.statsData || {};
    chrome.storage.local.set({ statsData: statsData }, () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('stats.html') }, (tab) => {
        if (chrome.runtime.lastError) {
          console.error('[JournalMetrics] Error creating stats tab:', chrome.runtime.lastError);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          console.log('[JournalMetrics] Stats tab created:', tab.id);
          sendResponse({ success: true });
        }
      });
    });
    return true;
  }
});
