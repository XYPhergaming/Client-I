'use strict';

const COMMAND_LIST = [
  'Import()',
  'Import{name}',
  '',
  'Export()',
  'Export(file)',
  'Export(*)',
  '',
  'Mini{}',
  'Mini{master_key}',
  '',
  'RUN{pkg}',
  'RUN(file)',
  '',
  'Kit{name}',
  'Kit',
  '',
  'del(file)',
  'del(*)',
  'del{ext}',
  'del{kit:name}',
  'del{*}',
  '',
  'clear',
  'clear(*)',
  'clear(name)',
  '',
  '?',
  '**',
  '*',
  'go <folder>',
  '..go',
  'cre <file>',
  'create <folder>',
  'edit name',
  '',
  '@master_key',
  '@key',
  '@key.CMD',
  '',
  'Install{pkg}',
  '@pkg',
  '',
  '@kit',
  '<ext>.<cmd> ...',
  '',
  '@sys',
  '',
  'cmd asa <alias>...',
  'asa',
  '',
  'CMD(arg)',
  '',
  'cmd1 & cmd2 & ...'
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
    const dateTimeStr = dd + '/' + mm + '/' + yyyy + ' & ' + hh + ':' + min + ':' + ss + ' ' + ampm;
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
  '@KEY'() { for (const usage of COMMAND_LIST) this.printSystem('  ' + usage); },
  '@MASTER_KEY'() {
    return (async () => {
      try {
        this.printSystem('Fetching available master keys...');
        const reg = await ExtensionManager.loadRegistry(window.URLS.masterRegistry, true);
        this.printSystem('[Available Master Keys]');
        for (const e of reg.extensions) this.printSystem('  ' + e.name.padEnd(14) + ' v' + e.version);
      } catch(e) { this.printError('COULD NOT LOAD MASTER_KEY.JSON: ' + e.message); }
    })();
  },
  '@PKG'() {
    return (async () => {
      try {
        this.printSystem('Fetching available packages...');
        const reg = await ExtensionManager.loadRegistry(window.URLS.pkgRegistry, true);
        this.printSystem('[Available Packages]');
        for (const e of reg.extensions) this.printSystem('  ' + e.name.padEnd(14) + ' v' + e.version);
      } catch(e) { this.printError('COULD NOT LOAD PKG.JSON: ' + e.message); }
    })();
  },
  '@KIT'() {
    return (async () => {
      try {
        this.printSystem('Fetching available kits...');
        const reg = await ExtensionManager.loadRegistry(window.URLS.kitRegistry, true);
        this.printSystem('[Available Kits]');
        const list = reg.kits || reg.extensions || [];
        for (const e of list) this.printSystem('  ' + e.name.padEnd(14) + ' v' + e.version);
      } catch(e) { this.printError('COULD NOT LOAD KIT.JSON: ' + e.message); }
    })();
  },
  KIT() {
    const open = Object.keys(UI.kitWindows)
      .map(k => k.replace(/^kit:/, ''))
      .sort();
    if (!open.length) { this.printSystem('(no kits open)'); return; }
    this.printSystem('[OPEN KITS]');
    for (const n of open) this.printSystem('  ' + n);
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
      this.printSystem('[FILES: ' + this.cwd + ']');
      await this._renderVfsTree(this.cwd);
    })();
  },
  '*'() {
    return (async () => {
      const container = document.createElement('div');
      container.className = 'folder-list';
      
      const getCfg = (k, def) => {
        try {
          const val = JSON.parse(localStorage.getItem('folder_cfg_' + k));
          if (val) return val;
        } catch (e) {}
        return def;
      };

      const defaultColor = state.settings.bgColor === 'bg-white' ? '#000000' : '#00ff41';
      const folderSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;

      const renderFolder = (id, name) => {
        const cfg = getCfg(id, { color: defaultColor });
        const el = document.createElement('div');
        el.className = 'folder-item';
        
        const gear = document.createElement('div');
        gear.className = 'folder-gear';
        gear.innerHTML = '&#9881;';
        gear.onclick = (e) => {
          e.stopPropagation();
          this._openFolderSettings(id, name, el, folderSvg);
        };

        const iconWrap = document.createElement('div');
        iconWrap.className = 'folder-icon';
        iconWrap.style.color = cfg.color;
        iconWrap.innerHTML = folderSvg;

        const label = document.createElement('div');
        label.className = 'folder-label';
        label.textContent = name;
        label.style.color = cfg.color;

        el.appendChild(iconWrap);
        el.appendChild(label);
        el.appendChild(gear);
        return el;
      };

      const renderAutoFolder = (id, name, items) => {
        const cfg = getCfg(id, { color: defaultColor });
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.width = '100%';
        wrapper.style.marginBottom = '10px';

        const el = document.createElement('div');
        el.className = 'folder-item';
        el.style.cursor = 'default';
        
        const gear = document.createElement('div');
        gear.className = 'folder-gear';
        gear.innerHTML = '&#9881;';
        gear.onclick = (e) => {
          e.stopPropagation();
          this._openFolderSettings(id, name, label, null);
        };

        const label = document.createElement('div');
        label.className = 'folder-label';
        label.textContent = name + '/';
        label.style.color = cfg.color;
        label.style.paddingLeft = '10px';

        el.appendChild(label);
        el.appendChild(gear);
        wrapper.appendChild(el);

        const listContainer = document.createElement('div');
        listContainer.style.cssText = 'margin-left: 25px; margin-top: 5px;';

        if (items.length === 0) {
          const none = document.createElement('div');
          none.textContent = 'None';
          none.style.color = 'var(--fg-2)';
          none.style.fontSize = '13px';
          listContainer.appendChild(none);
        } else {
          items.forEach(itemName => {
            const i = document.createElement('div');
            i.textContent = itemName;
            i.style.color = 'var(--fg-0)';
            i.style.fontSize = '13px';
            i.style.padding = '4px 0';
            listContainer.appendChild(i);
          });
        }
        
        wrapper.appendChild(listContainer);
        return wrapper;
      };

      const fFiles = renderFolder('FILES', 'FILES');
      fFiles.onclick = () => this._openExplorerWindow('FILES', this.cwd);
      container.appendChild(fFiles);

      const fPkg = renderFolder('PKG', 'PKG');
      fPkg.onclick = () => this._openExplorerWindow('PKG');
      container.appendChild(fPkg);

      const masters = Object.entries(Terminal.extensions).filter(([_, e]) => e.type === 'master').map(([n]) => n).sort();
      const fMaster = renderAutoFolder('MASTER_KEY', 'Master_Key', masters);
      container.appendChild(fMaster);

      const openKits = Object.keys(UI.kitWindows).map(k => k.replace(/^kit:/, '')).sort();
      const fKit = renderAutoFolder('KIT', 'Kit', openKits);
      container.appendChild(fKit);

      this.printElement(container);
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