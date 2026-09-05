'use strict';

const DEFAULTS = globalThis.JM_DEFAULTS || {};

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

// numeric settings rendered as number inputs
const numberInputs = {
  maxResultsInput: 'maxResults'
};
const NUMBER_MIN = 1;
const NUMBER_MAX = 10000;
const NUMBER_DEFAULT = 1000;

function normalizeNumber(value, fallback) {
  let n = parseInt(value, 10);
  if (isNaN(n)) n = fallback;
  return Math.min(NUMBER_MAX, Math.max(NUMBER_MIN, n));
}

function loadSettings() {
  chrome.storage.local.get(DEFAULTS, (settings) => {
    for (const [toggleId, settingKey] of Object.entries(toggleMap)) {
      const toggle = document.getElementById(toggleId);
      if (toggle) toggle.checked = settings[settingKey] === true;
    }
    for (const [inputId, settingKey] of Object.entries(numberInputs)) {
      const input = document.getElementById(inputId);
      if (input) {
        const def = DEFAULTS[settingKey] != null ? DEFAULTS[settingKey] : NUMBER_DEFAULT;
        input.value = normalizeNumber(settings[settingKey], def);
      }
    }
  });
}

function saveSettings() {
  const settings = {};
  for (const [toggleId, settingKey] of Object.entries(toggleMap)) {
    const toggle = document.getElementById(toggleId);
    if (toggle) settings[settingKey] = toggle.checked;
  }
  for (const [inputId, settingKey] of Object.entries(numberInputs)) {
    const input = document.getElementById(inputId);
    if (input) settings[settingKey] = normalizeNumber(input.value, DEFAULTS[settingKey] != null ? DEFAULTS[settingKey] : NUMBER_DEFAULT);
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

function resetToDefaults() {
  for (const [toggleId, settingKey] of Object.entries(toggleMap)) {
    const toggle = document.getElementById(toggleId);
    if (toggle) toggle.checked = DEFAULTS[settingKey] === true;
  }
  for (const [inputId, settingKey] of Object.entries(numberInputs)) {
    const input = document.getElementById(inputId);
    if (input) input.value = DEFAULTS[settingKey] != null ? DEFAULTS[settingKey] : NUMBER_DEFAULT;
  }
  saveSettings();
}

function init() {
  loadSettings();
  for (const toggleId of Object.keys(toggleMap)) {
    const toggle = document.getElementById(toggleId);
    if (toggle) toggle.addEventListener('change', saveSettings);
  }
  for (const inputId of Object.keys(numberInputs)) {
    const input = document.getElementById(inputId);
    if (input) {
      input.addEventListener('change', saveSettings);
      input.addEventListener('blur', () => {
        input.value = normalizeNumber(input.value, DEFAULTS[numberInputs[inputId]] != null ? DEFAULTS[numberInputs[inputId]] : NUMBER_DEFAULT);
      });
    }
  }
  document.getElementById('reset-all').addEventListener('click', resetToDefaults);
  document.getElementById('open-pubmed').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openPubMed' });
  });
}

document.addEventListener('DOMContentLoaded', init);
