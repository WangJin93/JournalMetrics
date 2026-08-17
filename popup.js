const DEFAULTS = {
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
  apc: false,
  accessHelper: true
};

const toggleMap = {
  ifToggle: 'if',
  jcrToggle: 'jcr',
  casToggle: 'cas',
  topToggle: 'top',
  accessHelperToggle: 'accessHelper',
  selfCitationToggle: 'selfCitationRate',
  websiteToggle: 'website',
  oaToggle: 'oa',
  publisherToggle: 'publisher',
  countryToggle: 'country',
  articleCountToggle: 'annualArticleCount',
  researchProportionToggle: 'researchArticlesProportion',
  apcToggle: 'apc'
};

function loadSettings() {
  chrome.storage.local.get(DEFAULTS, (settings) => {
    for (const [toggleId, settingKey] of Object.entries(toggleMap)) {
      const toggle = document.getElementById(toggleId);
      if (toggle) {
        toggle.checked = settings[settingKey];
      }
    }
  });
}

function saveSettings() {
  const settings = {};
  for (const [toggleId, settingKey] of Object.entries(toggleMap)) {
    const toggle = document.getElementById(toggleId);
    if (toggle) {
      settings[settingKey] = toggle.checked;
    }
  }
  
  chrome.storage.local.set(settings, () => {
    if (settings.accessHelper !== undefined) {
      chrome.runtime.sendMessage({ action: 'setAccessHelper', enabled: settings.accessHelper });
      
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'reinitAccessHelper', enabled: settings.accessHelper });
        }
      });
    }
  });
}

function init() {
  loadSettings();
  
  for (const toggleId of Object.keys(toggleMap)) {
    const toggle = document.getElementById(toggleId);
    if (toggle) {
      toggle.addEventListener('change', saveSettings);
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
