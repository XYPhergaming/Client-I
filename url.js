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
    
    // Magic Proxy: Automatically resolves paths based on the name
    // No need to update this file ever again!
    pkg: new Proxy({}, { 
      get: (t, p) => typeof p === 'string' ? `PKG/${p}.js` : undefined 
    }),
    master: new Proxy({}, { 
      get: (t, p) => typeof p === 'string' ? `MASTER_KEY/${p}.js` : undefined 
    })
  };
})();