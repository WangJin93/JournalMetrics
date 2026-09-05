/**
 * JournalMetrics - single source of truth for user settings defaults.
 * Loaded in three contexts:
 *  - content script (listed in manifest content_scripts before content-script.js)
 *  - extension popup page (script tag in popup.html before popup.js)
 *  - background service worker (module, imported via `import './defaults.js';`)
 * In every context the value is exposed on `self.JM_DEFAULTS`.
 */
'use strict';

self.JM_DEFAULTS = {
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
  accessHelper: true,
  maxResults: 1000
};
