(function () {
  'use strict';
  const base = (function () {
    const s = document.currentScript && document.currentScript.src;
    if (s) return s.substring(0, s.lastIndexOf('/') + 1);
    return window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
  })();

  window.URLS = {
    base: base,
    pkgRegistry: 'pkg.json',
    masterRegistry: 'master_key.json',
    pkg: {
      python: 'PKG/python.js',
      sql: 'PKG/sql.js'
    },
    master: {
      master_key: 'MASTER_KEY/master_key.js'
    }
  };
})();