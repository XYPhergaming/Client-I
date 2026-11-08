'use strict';

const COMMAND_LIST = [
  ['Import()', 'Import files from device (binary + text)'],
  ['Install{pkg}', 'Install a package'],
  ['Import{name}', 'Import master key(s) — use "name & name & ..."'],
  ['Export()', 'Export current folder'],
  ['Export(file)', 'Export a specific file'],
  ['Export(*)', 'Export entire terminal'],
  ['Mini{}', 'Open a default mini terminal'],
  ['Mini{master_key}', 'Open master-key mini window'],
  ['del(file)', 'Delete file or folder'],
  ['del(*)', 'Delete all files'],
  ['del{ext}', 'Remove an extension'],
  ['del{*}', 'Remove all extensions'],
  ['edit name', 'Edit file or rename folder'],
  ['?', 'Show current location'],
  ['**', 'List files in current folder'],
  ['*', 'List files + extensions'],
  ['go <folder>', 'Enter a folder'],
  ['..go', 'Go up one level'],
  ['cre <file>', 'Create empty file'],
  ['create <folder>', 'Create folder'],
  ['RUN{pkg}', 'Open package in mini window'],
  ['RUN(file)', 'Run a file (via registered runner, else print)'],
  ['@sys', 'System info + terminal settings'],
  ['@key', 'Show this list'],
  ['@pkg', 'Show available packages'],
  ['@master_key', 'Show available master keys'],
  ['<ext>.<cmd> ...', 'Run a command from a loaded extension'],
  ['@key.CMD ...', 'Run any @key command from any scope'],
  ['<cmd> asa <alias>...', 'Create a command alias'],
  ['asa', 'List aliases'],
  ['clear', 'Clear screen'],
  ['clear(*)', 'Clear screen + remove all Master Keys'],
  ['clear(name)', 'Clear screen + remove a specific Master Key'],
  ['exit', 'Close current mini window'],
  ['CMD(arg)', 'Run any core/extension command with () syntax'],
  ['cmd1 & cmd2 & ...', 'Chain commands sequentially (stops on failure)']
];

const CORE_HANDLERS = {
  '@SYS'() {
    const ua = navigator.userAgent;
    let os = 'UNKNOWN';
    if (/Windows/.test(ua)) os = 'WINDOWS';
    else if (/Mac OS|Macintosh/.test(ua)) os = 'MACOS';
    else if (/Android/.test(ua)) os = 'ANDROID';
    else if (/iPhone|iPad|iPod/.test(ua)) os = 'IOS';
    else if (/Linux/.test(ua)) os = 'LINUX';
    let browser = 'UNKNOWN';
    if (/Edg\//.test(ua)) browser = 'EDGE';
    else if (/OPR\/|Opera/.test(ua)) browser = 'OPERA';
    else if (/Chrome\//.test(ua)) browser = 'CHROME';
    else if (/Firefox\//.test(ua)) browser = 'FIREFOX';
    else if (/Safari\//.test(ua)) browser = 'SAFARI';
    const platform = navigator.platform || 'UNKNOWN';
    let netType = 'UNKNOWN';
    if (navigator.connection) netType = navigator.connection.effectiveType || navigator.connection.type || 'UNKNOWN';
    netType = netType.toLowerCase();
    const mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(2) + ' MB' : 'N/A';
    const up = Math.floor(performance.now() / 1000);
    const upStr = Math.floor(up / 60) + 'm ' + (up % 60) + 's';
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hours24 = now.getHours();
    const ampm = hours24 >= 12 ? 'PM' : 'AM';
    const h12 = hours24 % 12 || 12;
    const hh = String(h12).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const dateTimeStr = `${dd}/${mm}/${yyyy} & ${hh}:${min}:${ss} ${ampm}`;
    this.print('');
    this.printSystem('KALMA ' + Terminal.version);
    this.printSystem('UPTIME: ' + upStr);
    this.printSystem('OS: ' + os);
    this.printSystem('NETWORK: ' + netType);
    this.printSystem('MEMORY: ' + mem);
    this.printSystem('SCREEN: ' + screen.width + 'x' + screen.height);
    this.printSystem('WINDOW: ' + window.innerWidth + 'x' + window.innerHeight);
    this.printSystem('BROWSER: ' + browser);
    this.printSystem('PLATFORM: ' + platform);
    this.printSystem('DATE & TIME: ' + dateTimeStr);
    UI.openSettings();
  },
  '@KEY'() { for (const [usage, desc] of COMMAND_LIST) this.printSystem('  ' + usage.padEnd(28) + desc); },
  '@MASTER_KEY'() {
    return (async () => {
      try {
        this.printSystem('Fetching available master keys...');
        const reg = await ExtensionManager.loadRegistry(window.URLS.masterRegistry, true);
        this.printSystem('[Available Master Keys]');
        for (const e of reg.extensions) this.printSystem('  ' + e.name.padEnd(14) + ' v' + e.version + ' - ' + e.description);
      } catch(e) { this.printError('COULD NOT LOAD MASTER_KEY.JSON: ' + e.message); }
    })();
  },
  '@PKG'() {
    return (async () => {
      try {
        this.printSystem('Fetching available packages...');
        const reg = await ExtensionManager.loadRegistry(window.URLS.pkgRegistry, true);
        this.printSystem('[Available Packages]');
        for (const e of reg.extensions) this.printSystem('  ' + e.name.padEnd(14) + ' v' + e.version + ' - ' + e.description);
      } catch(e) { this.printError('COULD NOT LOAD PKG.JSON: ' + e.message); }
    })();
  },
  CLEAR(arg) {
    this.clear();
    if (arg === '*') {
      const tempKeys = [];
      for (const [name, ext] of Object.entries(Terminal.extensions)) {
        if (ext.type === 'master') tempKeys.push(name);
      }
      for (const name of tempKeys) Terminal.unregisterExtension(name);
    } else if (arg) {
      const lower = arg.toLowerCase();
      const ext = Terminal.extensions[lower];
      if (ext && ext.type === 'master') Terminal.unregisterExtension(lower);
    }
  },
  '?'() { this.printSystem(this.cwd); },
  '**'() {
    return (async () => {
      const all = await Storage.keys('vfs');
      const pfx = this.cwd === '/' ? '/' : this.cwd + '/';
      const firsts = new Set();
      for (const k of all) if (k.startsWith(pfx) && k !== this.cwd) firsts.add(k.slice(pfx.length).split('/')[0]);
      const items = [];
      for (const n of firsts) items.push([n, await Storage.get(pfx + n, 'vfs') || { type: 'file' }]);
      items.sort((a, b) => a[0].localeCompare(b[0]));
      if (!items.length) this.printSystem('  (empty)');
      else for (const [n, e] of items) {
        if (e.type === 'dir') this.printSystem('  ' + n + '/');
        else {
          let size = 0;
          if (e.isBinary && e.content instanceof Blob) size = e.content.size;
          else size = (e.content || '').length;
          this.printSystem('  ' + n + '  (' + Utils.formatSize(size) + ')');
        }
      }
    })();
  },
  '*'() {
    return (async () => {
      this.printSystem('[FILES]');
      const all = await Storage.keys('vfs');
      const pfx = this.cwd === '/' ? '/' : this.cwd + '/';
      const firsts = new Set();
      for (const k of all) if (k.startsWith(pfx) && k !== this.cwd) firsts.add(k.slice(pfx.length).split('/')[0]);
      const items = [];
      for (const n of firsts) items.push([n, await Storage.get(pfx + n, 'vfs') || { type: 'file' }]);
      items.sort((a, b) => a[0].localeCompare(b[0]));
      if (!items.length) this.printSystem('  (empty)');
      else for (const [n, e] of items) {
        if (e.type === 'dir') this.printSystem('  ' + n + '/');
        else {
          let size = 0;
          if (e.isBinary && e.content instanceof Blob) size = e.content.size;
          else size = (e.content || '').length;
          this.printSystem('  ' + n + '  (' + Utils.formatSize(size) + ')');
        }
      }
      this.printSystem('[EXTENSIONS]');
      const exts = Object.keys(Terminal.extensions);
      if (!exts.length) this.printSystem('  (none)');
      else for (const n of exts) this.printSystem('  ' + n);
    })();
  },
  'ASA'() {
    const kA = Object.keys(keyAliases);
    const cA = Object.keys(cmdAliases);
    const eA = Object.keys(extAliases);
    if (!kA.length && !cA.length && !eA.length) { this.printSystem('(no aliases)'); return; }
    if (kA.length) { this.printSystem('[KEY ALIASES]'); for (const a of kA) this.printSystem('  ' + a + ' -> ' + keyAliases[a]); }
    if (cA.length) { this.printSystem('[COMMAND ALIASES]'); for (const a of cA) this.printSystem('  ' + a + ' -> ' + cmdAliases[a]); }
    if (eA.length) { this.printSystem('[EXT ALIASES]'); for (const a of eA) this.printSystem('  ' + a + ' -> ' + extAliases[a] + '.*'); }
  },
  'GO'(arg) {
    const name = arg.trim();
    if (!name) throw new Error('Usage: go <folder>');
    return (async () => {
      const t = Utils.resolvePath(this.cwd, name);
      const e = await Storage.get(t, 'vfs');
      if (!e || e.type !== 'dir') throw new Error('NOT EXIST: ' + name);
      this.cwd = t;
      this.updatePrompt();
    })();
  },
  '..GO'() { this.cwd = Utils.resolvePath(this.cwd, '..'); this.updatePrompt(); },
  CRE(arg) {
    const name = arg.trim();
    if (!name) throw new Error('Usage: cre <filename>');
    return (async () => {
      const t = Utils.resolvePath(this.cwd, name);
      if (await Storage.get(t, 'vfs')) throw new Error('THIS KEY IS ALREADY EXIST: ' + name);
      await Storage.set(t, { type: 'file', content: '' }, 'vfs');
      this.printSuccess('File created: ' + name);
    })();
  },
  CREATE(arg) {
    const name = arg.trim();
    if (!name) throw new Error('Usage: create <folder>');
    return (async () => {
      const t = Utils.resolvePath(this.cwd, name);
      if (await Storage.get(t, 'vfs')) throw new Error('THIS KEY IS ALREADY EXIST: ' + name);
      await Storage.set(t, { type: 'dir' }, 'vfs');
      this.printSuccess('Folder created: ' + name);
    })();
  },
  EDIT(arg) {
    const name = arg.trim();
    if (!name) throw new Error('Usage: edit <name>');
    return (async () => {
      const t = Utils.resolvePath(this.cwd, name);
      const e = await Storage.get(t, 'vfs');
      if (!e) throw new Error('NOT EXIST: ' + name);
      if (e.type === 'dir') {
        const newName = prompt('Rename folder "' + name + '" to:', name);
        if (newName === null) return;
        const trimmed = newName.trim();
        if (!trimmed || trimmed === name) return;
        const newT = Utils.resolvePath(this.cwd, trimmed);
        if (newT === t) return;
        if (newT.startsWith(t + '/')) throw new Error('Cannot rename folder into itself');
        if (await Storage.get(newT, 'vfs')) throw new Error('THIS KEY IS ALREADY EXIST: ' + trimmed);
        const all = await Storage.keys('vfs');
        await Storage.set(newT, e, 'vfs');
        for (const k of all) {
          if (k.startsWith(t + '/')) {
            const v = await Storage.get(k, 'vfs');
            await Storage.set(newT + k.slice(t.length), v, 'vfs');
            await Storage.remove(k, 'vfs');
          }
        }
        await Storage.remove(t, 'vfs');
        this.printSuccess('Renamed: ' + name + ' -> ' + trimmed);
        return;
      }
      await new Promise(resolve => {
        const ov = document.getElementById('editor');
        const ta = document.getElementById('editor-text');
        const nameInput = document.getElementById('editor-name');
        nameInput.value = name;
        ov.classList.remove('hidden');
        ta.value = e.content || '';
        ta.focus();
        const cl = document.getElementById('editor-close');
        const sv = document.getElementById('editor-save');
        const cleanup = () => {
          ov.classList.add('hidden');
          cl.onclick = null; sv.onclick = null;
          document.getElementById('capture').focus();
          resolve();
        };
        cl.onclick = () => cleanup();
        sv.onclick = async () => {
          const newName = nameInput.value.trim() || name;
          const newT = Utils.resolvePath(this.cwd, newName);
          if (newT !== t) {
            if (await Storage.get(newT, 'vfs')) { this.printError('THIS KEY IS ALREADY EXIST: ' + newName); return; }
            await Storage.remove(t, 'vfs');
          }
          await Storage.set(newT, { type: 'file', content: ta.value }, 'vfs');
          this.printSuccess('Saved: ' + newName);
          cleanup();
        };
      });
    })();
  }
};

window.CORE_HANDLERS = CORE_HANDLERS;
window.COMMAND_LIST = COMMAND_LIST;