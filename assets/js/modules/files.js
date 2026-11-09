'use strict';

TerminalSession.prototype.cmdImportDevice = async function() {
  if (!window.showOpenFilePicker) throw new Error('File System Access API not supported');
  try {
    const files = await window.showOpenFilePicker({ multiple: true });
    for (const h of files) {
      try {
        const f = await h.getFile();
        const name = h.name;
        if (/\.\.[\/\\]/.test(name) || /^[\/\\]/.test(name)) { this.printError('SKIPPED ' + name + ': PATH TRAVERSAL'); continue; }
        if (EXECUTABLE_EXT.test(name.toLowerCase())) { this.printError('SKIPPED ' + name + ': EXECUTABLE BLOCKED'); continue; }
        if (NATIVE_SCRIPT_EXT.test(name.toLowerCase())) { this.printError('SKIPPED ' + name + ': NATIVE SCRIPT BLOCKED'); continue; }
        const binary = await Utils.isBinaryFile(f);
        if (binary) {
          await Storage.set(Utils.resolvePath(this.cwd, name), { type: 'file', content: f, isBinary: true }, 'vfs');
          this.printSuccess('Imported: ' + name + ' (binary)');
        } else {
          const content = await f.text();
          const scan = Terminal.SecurityScanner.scan(name, content);
          if (!scan.safe) { this.printError('SKIPPED ' + name + ': ' + scan.reason); continue; }
          await Storage.set(Utils.resolvePath(this.cwd, name), { type: 'file', content }, 'vfs');
          this.printSuccess('Imported: ' + name);
        }
      } catch (e) { this.printError('FAILED ' + h.name + ': ' + (e.message || e)); }
    }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('File selection aborted');
    throw e;
  }
};

TerminalSession.prototype.cmdImportMasters = async function(arg) {
  const rawNames = String(arg).split('&').map(s => s.trim()).filter(Boolean);
  if (!rawNames.length) { this.printError('Usage: Import{name} or Import{name & name & ...}'); return false; }

  for (const rawName of rawNames) {
    const name = Utils.cleanName(rawName);
    if (!name || /[/\\{}]/.test(name) || name.length > 100) {
      this.printError('INVALID NAME: ' + name);
      return false;
    }
    if (Terminal.extensions[name.toLowerCase()]) {
      this.printError('ALREADY EXIST: ' + name);
      return false;
    }
    const id = Utils.generateId();
    this.print('<span id="' + id + '" class="text-blue-600">Importing ' + Utils.escapeHTML(name) + '...</span>', true);
    try {
      const res = await ExtensionManager.installMaster(name, msg => {
        const el = document.getElementById(id); if (el) el.textContent = msg;
      });
      const el = document.getElementById(id);
      if (el) { el.className = 'text-yellow-600'; el.textContent = res.info; }
    } catch (e) {
      const el = document.getElementById(id);
      const msg = String(e.message || e).toUpperCase();
      if (el) { el.className = 'text-red-600'; el.textContent = msg; }
      else this.printError(msg);
      return false;
    }
  }
  return true;
};

TerminalSession.prototype.cmdInstallPkg = async function(name) {
  name = String(name).trim();
  if (!name) { this.printError('Usage: Install{pkg}'); return false; }
  if (Terminal.extensions[name.toLowerCase()]) { this.printError('ALREADY EXIST: ' + name); return false; }
  const id = Utils.generateId();
  this.print('<span id="' + id + '" class="text-blue-600">Installing ' + Utils.escapeHTML(name) + '...</span>', true);
  try {
    const res = await ExtensionManager.installPkg(name, msg => {
      const el = document.getElementById(id); if (el) el.textContent = msg;
    });
    const el = document.getElementById(id);
    if (el) { el.className = 'text-yellow-600'; el.textContent = res.info; }
    return true;
  } catch (e) {
    const el = document.getElementById(id);
    const msg = String(e.message || e).toUpperCase();
    if (el) { el.className = 'text-red-600'; el.textContent = msg; }
    else this.printError(msg);
    return false;
  }
};

TerminalSession.prototype.cmdExportDir = async function(dir) {
  const all = await Storage.keys('vfs');
  const data = {};
  const pfx = dir === '/' ? '/' : dir + '/';
  let count = 0;
  for (const k of all) {
    if (k.startsWith(pfx) || k === dir) {
      const entry = await Storage.get(k, 'vfs');
      if (entry && entry.isBinary && entry.content instanceof Blob) {
        const b64 = await Utils.blobToBase64(entry.content);
        data[k] = { type: 'file', isBinary: true, base64: b64, name: k.split('/').pop() };
      } else if (entry && entry.type === 'file') {
        const scan = Terminal.SecurityScanner.scan(Utils.basename(k), entry.content);
        if (!scan.safe) throw new Error('EXPORT BLOCKED: ' + k + ' -> ' + scan.reason);
        data[k] = entry;
      } else { data[k] = entry; }
      count++;
    }
  }
  if (count === 0) throw new Error('EMPTY DIRECTORY');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dirName = dir === '/' ? 'root' : dir.split('/').filter(Boolean).pop() || 'root';
  a.download = dirName + '-backup-' + Date.now() + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  this.printSuccess('Exported folder: ' + dir);
};

TerminalSession.prototype.cmdExportAll = async function() {
  const all = await Storage.keys('vfs');
  const data = {};
  for (const k of all) {
    const entry = await Storage.get(k, 'vfs');
    if (entry && entry.isBinary && entry.content instanceof Blob) {
      const b64 = await Utils.blobToBase64(entry.content);
      data[k] = { type: 'file', isBinary: true, base64: b64, name: k.split('/').pop() };
    } else if (entry && entry.type === 'file') {
      const scan = Terminal.SecurityScanner.scan(Utils.basename(k), entry.content);
      if (!scan.safe) throw new Error('EXPORT BLOCKED: ' + k + ' -> ' + scan.reason);
      data[k] = entry;
    } else { data[k] = entry; }
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'vfs-full-backup-' + Date.now() + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  this.printSuccess('Exported entire system');
};

TerminalSession.prototype.cmdExportFile = async function(name) {
  const target = Utils.resolvePath(this.cwd, name);
  const entry = await Storage.get(target, 'vfs');
  if (!entry || entry.type !== 'file') throw new Error('NOT EXIST: ' + name);
  let blob;
  if (entry.isBinary && entry.content instanceof Blob) {
    blob = entry.content;
  } else {
    const scan = Terminal.SecurityScanner.scan(Utils.basename(name), entry.content);
    if (!scan.safe) throw new Error('EXPORT BLOCKED: ' + scan.reason);
    blob = new Blob([entry.content || ''], { type: 'text/plain' });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name.split('/').pop();
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  this.printSuccess('Exported: ' + name);
};

TerminalSession.prototype.cmdDelFile = async function(name) {
  const t = Utils.resolvePath(this.cwd, name);
  const prot = new Set(['/', '/home', '/home/' + state.settings.username]);
  if (prot.has(t)) throw new Error('Core folder is protected');
  const e = await Storage.get(t, 'vfs');
  if (!e) throw new Error('NOT EXIST: ' + name);
  if (e.type === 'dir') {
    const all = await Storage.keys('vfs');
    for (const k of all) if (k.startsWith(t + '/')) await Storage.remove(k, 'vfs');
  }
  await Storage.remove(t, 'vfs');
  this.printSuccess('Deleted: ' + name);
};

TerminalSession.prototype.cmdDelAllFiles = async function() {
  const all = await Storage.keys('vfs');
  const prot = new Set(['/', '/home', '/home/' + state.settings.username]);
  let n = 0;
  for (const k of all) if (!prot.has(k)) { await Storage.remove(k, 'vfs'); n++; }
  this.printSuccess('Deleted ' + n + ' items');
};

TerminalSession.prototype.cmdDelExt = async function(name) {
  const lower = name.toLowerCase();

  if (lower.startsWith('kit:')) {
    const kitName = lower.slice(4);
    const key = 'kit:' + kitName;
    const k = UI.kitWindows[key];
    if (k) {
      try { k.win.remove(); } catch (e) {}
      delete UI.kitWindows[key];
      this.printSuccess('Closed kit: ' + kitName);
    } else {
      this.printSuccess('No open kit: ' + kitName);
    }
    return;
  }

  if (!Terminal.extensions[lower]) throw new Error('NOT EXIST: ' + name);
  await ExtensionManager.remove(lower);
  this.printSuccess('Removed: ' + name);
};

TerminalSession.prototype.cmdDelAllExts = async function() {
  for (const extName of Object.keys(Terminal.extensions)) Terminal.unregisterExtension(extName);
  const keys = await Storage.keys('system');
  for (const k of keys) {
    if (typeof k !== 'string') continue;
    if (k.startsWith('ext:')) {
      const n = k.slice(4);
      await Storage.remove(k, 'system');
      await Storage.remove('ext_type:' + n, 'system');
    }
  }
  window.extAliases = {};
  this.printSuccess('All extensions removed');
};

TerminalSession.prototype.cmdRunFile = async function(arg) {
  if (!arg) throw new Error('Usage: RUN(file)');
  const fn = arg.split('/').pop();
  const dot = fn.lastIndexOf('.');
  const ext = dot > 0 ? '.' + fn.slice(dot + 1).toLowerCase() : '';
  const target = Utils.resolvePath(this.cwd, arg);
  const entry = await Storage.get(target, 'vfs');
  if (!entry || entry.type !== 'file') throw new Error('NOT EXIST: ' + arg);
  if (entry.isBinary) {
    this.printSystem('(binary file cannot be printed)');
    return;
  }
  if (ext && Terminal.runners[ext]) return Terminal.runners[ext].call(this, fn, entry.content);
  this.print(entry.content);
};

TerminalSession.prototype._renderVfsTree = async function(path, rootContainer) {
  const allKeys = await Storage.keys('vfs');
  const pfx = path === '/' ? '/' : path + '/';
  const firsts = new Set();
  for (const k of allKeys) if (k.startsWith(pfx) && k !== path) firsts.add(k.slice(pfx.length).split('/')[0]);
  
  let container = rootContainer;
  if (!container) {
    container = document.createElement('div');
    container.className = 'vfs-tree';
    container.style.paddingLeft = '10px';
    container.style.marginTop = '10px';
    container.style.borderLeft = '1px solid var(--line-1)';
  }

  let count = 0;
  for (const n of Array.from(firsts).sort()) {
    const entry = await Storage.get(pfx + n, 'vfs');
    const isDir = entry && entry.type === 'dir';
    const item = document.createElement('div');
    item.className = 'vfs-item ' + (isDir ? 'vfs-dir' : 'vfs-file');
    item.style.marginBottom = '4px';
    
    const icon = document.createElement('div');
    icon.className = 'vfs-icon';
    if (isDir) {
      icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
      icon.style.color = 'var(--amber)';
    } else {
      icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
      icon.style.color = 'var(--cyan)';
    }
    
    const label = document.createElement('span');
    label.textContent = n;
    
    item.appendChild(icon);
    item.appendChild(label);
    
    if (isDir) {
      item.style.cursor = 'pointer';
      item.onclick = async () => {
        const next = item.nextElementSibling;
        if (next && next.classList.contains('vfs-children')) {
          next.style.display = next.style.display === 'none' ? 'block' : 'none';
        } else {
          const children = document.createElement('div');
          children.className = 'vfs-children';
          children.style.display = 'block';
          item.after(children);
          await this._renderVfsTree(pfx + n, children);
        }
      };
    }
    container.appendChild(item);
    count++;
  }
  if (count === 0) {
    container.innerHTML = '<span style="color:var(--fg-2)">(empty)</span>';
  }
  
  if (!rootContainer) {
    this.printElement(container);
  }
};