'use strict';

const Storage = {
  db: null,
  init() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('WebTermDB', 200);
      r.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('vfs')) db.createObjectStore('vfs');
        if (!db.objectStoreNames.contains('system')) db.createObjectStore('system');
      };
      r.onsuccess = e => { this.db = e.target.result; res(); };
      r.onerror = e => rej(e.target.error);
    });
  },
  _t(s, m) { return this.db.transaction(s, m).objectStore(s); },
  get(k, s = 'vfs') { return new Promise((res, rej) => { const r = this._t(s, 'readonly').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  set(k, v, s = 'vfs') { return new Promise((res, rej) => { const r = this._t(s, 'readwrite').put(v, k); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); },
  remove(k, s = 'vfs') { return new Promise((res, rej) => { const r = this._t(s, 'readwrite').delete(k); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); },
  keys(s = 'vfs') { return new Promise((res, rej) => { const r = this._t(s, 'readonly').getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
};

window.Storage = Storage;