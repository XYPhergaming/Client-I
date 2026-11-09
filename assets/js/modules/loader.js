'use strict';

const ExtensionManager = {
  get baseUrl() { return window.URLS.base; },
  resolveUrl(p) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return p;
    try { return new URL(p, this.baseUrl).href; } catch (e) { return p; }
  },
  async fetchWithFallback(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const text = await r.text();
    if (/^\s*<!doctype/i.test(text) || /^\s*<html/i.test(text)) {
      throw new Error('Server returned HTML (likely 404)');
    }
    return text;
  },
  async fetchRaw(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  },
  async loadRegistry(url, refresh = false) {
    const absUrl = this.resolveUrl(url);
    const cacheKey = 'reg_' + absUrl.split('/').pop().split('?')[0];
    if (!refresh) {
      const cached = await Storage.get(cacheKey, 'system');
      if (cached) return cached;
    }
    const fetchUrl = absUrl + (absUrl.includes('?') ? '&' : '?') + 'v=' + Terminal.version;
    try {
      const text = await this.fetchWithFallback(fetchUrl);
      const data = JSON.parse(text);
      await Storage.set(cacheKey, data, 'system');
      return data;
    } catch (e) {
      const cached = await Storage.get(cacheKey, 'system');
      if (cached) return cached;
      throw new Error('Registry unavailable: ' + e.message);
    }
  },
  async installPkg(name, onProgress) {
    const reg = await this.loadRegistry(window.URLS.pkgRegistry, true);
    const entry = reg.extensions.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!entry) throw new Error('NOT EXIST: ' + name);
    if (Terminal.extensions[entry.name.toLowerCase()]) throw new Error('ALREADY EXIST: ' + entry.name);
    const relPath = (window.URLS.pkg || {})[entry.name.toLowerCase()];
    if (!relPath) throw new Error('NOT EXIST: ' + entry.name);
    if (onProgress) onProgress('Downloading ' + entry.name + '...');
    const abs = this.resolveUrl(relPath);
    const fetchUrl = abs + (abs.includes('?') ? '&' : '?') + 'v=' + Terminal.version;
    const code = await this.fetchWithFallback(fetchUrl);
    if (entry.sha256) {
      const h = await Terminal.sha256(code);
      if (h !== entry.sha256) throw new Error('Integrity check failed: ' + entry.name);
    }
    if (Terminal.extensions[entry.name.toLowerCase()]) Terminal.unregisterExtension(entry.name);
    new Function('Terminal', code)(Terminal);
    if (!Terminal.extensions[entry.name.toLowerCase()]) throw new Error('Extension failed to register: ' + entry.name);
    Terminal.extensions[entry.name.toLowerCase()].type = 'pkg';
    await Storage.set('ext:' + entry.name.toLowerCase(), code, 'system');
    await Storage.set('ext_type:' + entry.name.toLowerCase(), 'pkg', 'system');
    return { name: entry.name, info: 'INSTALL SUCCESSFUL: ' + entry.name.toUpperCase() };
  },
  async installMaster(name, onProgress) {
    const lower = name.toLowerCase();
    if (Terminal.extensions[lower]) throw new Error('ALREADY EXIST: ' + name);
    const reg = await this.loadRegistry(window.URLS.masterRegistry, true);
    const entry = reg.extensions.find(x => x.name.toLowerCase() === lower);
    if (!entry) throw new Error('NOT EXIST: ' + name);
    const relPath = (window.URLS.master || {})[entry.name.toLowerCase()];
    if (!relPath) throw new Error('NOT EXIST: ' + entry.name);
    if (onProgress) onProgress('Importing ' + entry.name + '...');
    const abs = this.resolveUrl(relPath);
    const fetchUrl = abs + (abs.includes('?') ? '&' : '?') + 'v=' + Terminal.version;
    const code = await this.fetchWithFallback(fetchUrl);
    if (entry.sha256) {
      const h = await Terminal.sha256(code);
      if (h !== entry.sha256) throw new Error('Integrity check failed: ' + entry.name);
    }
    new Function('Terminal', code)(Terminal);
    if (!Terminal.extensions[lower]) throw new Error('Master key failed to register: ' + entry.name);
    Terminal.extensions[lower].type = 'master';
    return { name: entry.name, info: 'IMPORT SUCCESSFUL: ' + entry.name.toUpperCase() };
  },
  async remove(name) {
    const lower = name.toLowerCase();
    if (Terminal.extensions[lower]) {
      Terminal.unregisterExtension(lower);
      await Storage.remove('ext:' + lower, 'system');
      await Storage.remove('ext_type:' + lower, 'system');
      for (const [alias, ext] of Object.entries(window.extAliases)) if (ext === lower) delete window.extAliases[alias];
    }
  },
  async loadAll() {
    const keys = await Storage.keys('system');
    for (const key of keys) {
      if (typeof key !== 'string' || !key.startsWith('ext:')) continue;
      const name = key.slice(4);
      const type = await Storage.get('ext_type:' + name, 'system');
      if (type !== 'pkg') {
        await Storage.remove(key, 'system');
        await Storage.remove('ext_type:' + name, 'system');
        continue;
      }
      const code = await Storage.get(key, 'system');
      if (!code) continue;
      try {
        new Function('Terminal', code)(Terminal);
        if (Terminal.extensions[name.toLowerCase()]) Terminal.extensions[name.toLowerCase()].type = type;
      } catch (e) { console.warn('Failed to load ' + name + ': ' + e.message); }
    }
  }
};
window.ExtensionManager = ExtensionManager;