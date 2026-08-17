(function() {
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
    if (!window.chrome) {
      Object.defineProperty(window, 'chrome', {
        get: function() { return { runtime: {}, loadTimes: function() {} }; },
        configurable: true
      });
    }
  } catch (e) {}
  try {
    if (navigator.userAgentData && navigator.userAgentData.brands) {
      Object.defineProperty(navigator.userAgentData, 'brands', {
        get: function() {
          return [
            { brand: 'Google Chrome', version: '120' },
            { brand: 'Chromium', version: '120' },
            { brand: 'Not.A/Brand', version: '8' }
          ];
        },
        configurable: true
      });
    }
  } catch (e) {}
})();
