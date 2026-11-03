(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // Base URL — auto-detect from where THIS file was loaded.
  //
  // If you move the whole project to a new host → nothing to change.
  // If url.js is on a CDN but extension files are elsewhere →
  // replace the IIFE below with a string, e.g.:
  //     const base = 'https://your-host.example.com/Prediction/';
  // ─────────────────────────────────────────────────────────────
  const base = (function () {
    const s = document.currentScript && document.currentScript.src;
    if (s) return s.substring(0, s.lastIndexOf('/') + 1);
    return window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
  })();

  window.URLS = {
    base: base,

    // Registry files (relative to base)
    pkgRegistry: 'pkg.json',
    masterRegistry: 'master_key.json',

    // Package files (relative to base; absolute URLs also work)
    pkg: {
      python: 'PKG/python.js',
      sql: 'PKG/sql.js'
    },

    // Master-key files (relative to base; absolute URLs also work)
    master: {
      master_key: 'MASTER_KEY/master_key.js'
    }
  };
})();