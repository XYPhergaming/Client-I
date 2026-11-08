'use strict';

async function boot() {
  try {
    if (!window.URLS || !window.URLS.base) throw new Error('backend.js config not loaded');
    await Storage.init();
    if (!(await Storage.get('/', 'vfs'))) await Storage.set('/', { type: 'dir' }, 'vfs');
    if (!(await Storage.get('/home', 'vfs'))) await Storage.set('/home', { type: 'dir' }, 'vfs');
    const home = '/home/' + state.settings.username;
    if (!(await Storage.get(home, 'vfs'))) await Storage.set(home, { type: 'dir' }, 'vfs');
    await ExtensionManager.loadAll();
    UI.init();
    UI.createSession();
  } catch (e) {
    console.error(e);
    const el = document.getElementById('boot-error');
    if (el) el.classList.remove('hidden');
  }
}

window.addEventListener('DOMContentLoaded', boot);