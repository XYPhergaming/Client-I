(function () {
  'use strict';
  const T = Terminal, S = T.Storage, U = T.Utils;

  async function readText(session, path) {
    const p = U.resolvePath(session.cwd, path);
    const entry = await S.get(p, 'vfs');
    if (!entry || entry.type !== 'file') throw new Error('Not a file: ' + path);
    return { path: p, content: entry.content || '' };
  }

  function tokenize(line) {
    return String(line || '').trim().split(/\s+/).filter(Boolean);
  }

  async function copyTree(srcPath, dstPath) {
    const src = await S.get(srcPath, 'vfs');
    if (!src) throw new Error('Not found: ' + srcPath);
    if (dstPath === srcPath || dstPath.startsWith(srcPath + '/')) {
      throw new Error('Cannot copy into itself');
    }
    const existing = await S.get(dstPath, 'vfs');
    let finalDst = dstPath;
    if (existing && existing.type === 'dir') {
      finalDst = (dstPath === '/' ? '' : dstPath) + '/' + U.basename(srcPath);
      if (await S.get(finalDst, 'vfs')) throw new Error('Already exists: ' + finalDst);
    } else if (existing) {
      throw new Error('Already exists: ' + dstPath);
    }
    await S.set(finalDst, JSON.parse(JSON.stringify(src)), 'vfs');
    if (src.type === 'dir') {
      const all = await S.keys('vfs');
      for (const k of all) {
        if (k.startsWith(srcPath + '/')) {
          const v = await S.get(k, 'vfs');
          await S.set(finalDst + k.slice(srcPath.length), JSON.parse(JSON.stringify(v)), 'vfs');
        }
      }
    }
    return finalDst;
  }

  async function deleteTree(path) {
    const all = await S.keys('vfs');
    for (const k of all) {
      if (k === path || k.startsWith(path + '/')) await S.remove(k, 'vfs');
    }
  }

  T.registerExtension({
    name: 'master_key',
    info: 'Master Key imported successfully! Commands: COPY, Move, Show, TREE, SEARCH, KEYBOARD, Use, HISTORY, List.',
    descriptions: {
      COPY:     'Copy a file or folder (COPY <src> <dst>)',
      MOVE:     'Move a file or folder (Move <src> <dst>)',
      SHOW:     'Show full content of a file (Show <file>)',
      TREE:     'Show complete folder tree',
      SEARCH:   'Search a file or folder by name (SEARCH <name>)',
      KEYBOARD: 'Toggle the virtual computer keyboard',
      USE:      'Show total files, folders and storage usage',
      HISTORY:  'Show previous command history',
      LIST:     'List all commands in a loaded extension (List{<ext>})'
    },
    routes: [
      { pattern: /^List\{\s*([^}]+?)\s*\}$/i, handler: 'LIST' }
    ],
    commands: {
      COPY: async function (arg) {
        const a = tokenize(arg);
        if (a.length !== 2) throw new Error('Usage: COPY <src> <dst>');
        const src = U.resolvePath(this.cwd, a[0]);
        const dst = U.resolvePath(this.cwd, a[1]);
        const finalDst = await copyTree(src, dst);
        this.printSuccess('Copied: ' + a[0] + ' -> ' + finalDst);
      },

      MOVE: async function (arg) {
        const a = tokenize(arg);
        if (a.length !== 2) throw new Error('Usage: Move <src> <dst>');
        const src = U.resolvePath(this.cwd, a[0]);
        const dst = U.resolvePath(this.cwd, a[1]);
        if (!await S.get(src, 'vfs')) throw new Error('Not found: ' + a[0]);
        const finalDst = await copyTree(src, dst);
        await deleteTree(src);
        this.printSuccess('Moved: ' + a[0] + ' -> ' + finalDst);
      },

      SHOW: async function (arg) {
        const a = tokenize(arg);
        if (!a.length) throw new Error('Usage: Show <file>');
        for (const f of a) {
          const { content } = await readText(this, f);
          this.print(content);
        }
      },

      TREE: async function (arg) {
        const root = U.resolvePath(this.cwd, String(arg || '').trim() || '.');
        const all = await S.keys('vfs');
        const lines = [root];
        const walk = async (dir, prefix) => {
          const pfx = dir === '/' ? '/' : dir + '/';
          const firsts = new Set();
          for (const k of all) {
            if (k.startsWith(pfx) && k !== dir) firsts.add(k.slice(pfx.length).split('/')[0]);
          }
          const items = [];
          for (const n of firsts) items.push([n, await S.get(pfx + n, 'vfs')]);
          items.sort((a, b) => a[0].localeCompare(b[0]));
          for (let i = 0; i < items.length; i++) {
            const [n, e] = items[i];
            const last = i === items.length - 1;
            lines.push(prefix + (last ? '`-- ' : '|-- ') + n + (e && e.type === 'dir' ? '/' : ''));
            if (e && e.type === 'dir') await walk(pfx + n, prefix + (last ? '    ' : '|   '));
          }
        };
        await walk(root, '');
        this.print(lines.join('\n'));
      },

      SEARCH: async function (arg) {
        const q = String(arg || '').trim().toLowerCase();
        if (!q) throw new Error('Usage: SEARCH <name>');
        const all = await S.keys('vfs');
        const matches = [];
        for (const k of all) {
          const base = U.basename(k);
          if (base && base.toLowerCase().includes(q)) {
            const e = await S.get(k, 'vfs');
            matches.push([k, e]);
          }
        }
        if (!matches.length) { this.printSystem('No matches for: ' + arg); return; }
        matches.sort((a, b) => a[0].localeCompare(b[0]));
        this.printSystem('[ Search results for "' + q + '" ]');
        for (const [p, e] of matches) {
          this.printSystem('  ' + p + (e && e.type === 'dir' ? '/' : ''));
        }
        this.printSystem('Total: ' + matches.length);
      },

      KEYBOARD: function () {
        openVirtualKeyboard(this);
      },

      USE: async function () {
        const all = await S.keys('vfs');
        let files = 0, dirs = 0, bytes = 0;
        for (const k of all) {
          const e = await S.get(k, 'vfs');
          if (!e) continue;
          if (e.type === 'dir') dirs++;
          else { files++; bytes += (e.content || '').length; }
        }
        this.printSystem('[ Storage Usage ]');
        this.printSystem('  Files:      ' + files);
        this.printSystem('  Folders:    ' + dirs);
        this.printSystem('  Total size: ' + U.formatSize(bytes));
      },

      HISTORY: function () {
        const h = this.history || [];
        if (!h.length) { this.printSystem('(no history)'); return; }
        this.printSystem('[ Command History ]');
        for (let i = 0; i < h.length; i++) this.printSystem('  ' + (i + 1) + '. ' + h[i]);
      },

      LIST: function (arg) {
        const name = String(arg || '').trim().toLowerCase();
        if (!name) throw new Error('Usage: List{<ext>}');
        const ext = T.extensions[name];
        if (!ext) throw new Error('NOT EXIST: ' + name);

        this.printSystem('[ ' + name + ' - Commands ]');
        const cmds = Object.keys(ext.commands || {})
          .filter(c => !c.startsWith('__'))
          .sort();
        const descs = ext.descriptions || {};
        if (!cmds.length) {
          this.printSystem('  (none)');
        } else {
          for (const c of cmds) {
            const desc = descs[c] || descs[c.toUpperCase()] || '';
            if (desc) this.printSystem('  ' + c.padEnd(18) + ' - ' + desc);
            else this.printSystem('  ' + c);
          }
        }

        if (Array.isArray(ext.routes) && ext.routes.length) {
          this.printSystem('');
          this.printSystem('[ Routes ]');
          for (const r of ext.routes) {
            this.printSystem('  ' + String(r.pattern) + '  ->  ' + r.handler);
          }
        }

        if (ext.info) {
          this.printSystem('');
          this.printSystem('[ Info ]');
          this.printSystem('  ' + ext.info);
        }
      }
    }
  });

  /* ---------- Virtual keyboard (Categorized & Responsive) ---------- */
  function openVirtualKeyboard(session) {
    const existing = document.getElementById('virtual-kb-overlay');
    if (existing) {
      existing.remove();
      if (session.cap) session.cap.removeAttribute('inputmode');
      return;
    }

    if (session.cap) session.cap.setAttribute('inputmode', 'none');

    const overlay = document.createElement('div');
    overlay.id = 'virtual-kb-overlay';
    overlay.style.cssText = 'position:fixed;left:0;right:0;bottom:0;background:#02120a;color:#00d8ff;padding:6px;z-index:10000;font-family:\'Share Tech Mono\',monospace;font-size:12px;display:flex;flex-direction:column;gap:6px;box-shadow:0 -4px 20px rgba(37,99,235,0.4);border-top:2px solid #2563eb;max-height:60vh;overflow-y:auto;box-sizing:border-box;animation:slideUp 0.2s ease-out;';

    const tabRow = document.createElement('div');
    tabRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid #1e3a8a;padding-bottom:6px;margin-bottom:4px;';

    const keypadContainer = document.createElement('div');
    keypadContainer.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

    let currentTab = 'abc';
    let shift = false;
    let caps = false;

    function closeKeyboard() {
      const ov = document.getElementById('virtual-kb-overlay');
      if (ov) ov.remove();
      if (session.cap) {
        session.cap.removeAttribute('inputmode');
        try { session.cap.focus(); } catch (e) {}
      }
    }

    function createBtn(text, keyData, flex = 1, color = '#03120a') {
      const b = document.createElement('button');
      b.textContent = text;
      b.style.cssText = `padding:6px 0;flex:${flex} 0 auto;min-width:26px;height:34px;background:${color};color:#60a5fa;border:1px solid #1e3a8a;border-radius:4px;cursor:pointer;font-family:inherit;font-size:12px;transition:all 0.1s;display:flex;align-items:center;justify-content:center;`;
      b.onmouseenter = () => { b.style.background = '#1e3a8a'; b.style.color = '#00d8ff'; b.style.boxShadow = '0 0 5px #2563eb'; };
      b.onmouseleave = () => { b.style.background = color; b.style.color = '#60a5fa'; b.style.boxShadow = 'none'; };
      b.onmousedown = (e) => { e.preventDefault(); handleKey(keyData); };
      b.ontouchstart = (e) => { e.preventDefault(); handleKey(keyData); };
      return b;
    }

    function handleKey(key) {
      if (!session.cap || !session.cap.isConnected) {
        closeKeyboard();
        return;
      }
      if (key === 'CLOSE') { closeKeyboard(); return; }

      const target = session.cap;
      const v = target.value;
      const start = target.selectionStart != null ? target.selectionStart : v.length;
      const end   = target.selectionEnd   != null ? target.selectionEnd   : v.length;

      if (key === 'Shift') { shift = !shift; renderKeys(); return; }
      if (key === 'Caps')  { caps  = !caps;  renderKeys(); return; }
      if (key === 'Ctrl+A') { target.select(); return; }
      if (key === 'Esc' || key === 'Tab' || key === 'Ctrl' || key === 'Alt' || key === 'Win' || key === 'Fn' || key === 'PrtSc' || key === 'ScrLk' || key === 'Pause') return;
      if (key.startsWith('F') && key.length > 1 && !isNaN(key[1])) return;

      if (key === 'Backspace') {
        if (start === end && start > 0) target.value = v.slice(0, start - 1) + v.slice(end);
        else target.value = v.slice(0, start) + v.slice(end);
        try { target.setSelectionRange(Math.max(0, start - 1), Math.max(0, start - 1)); } catch(e) {}
        session.updateLine();
        return;
      }

      if (key === 'Enter') {
        const submitted = target.value;
        target.value = '';
        session.updateLine();
        (async () => {
          session.executing = true;
          try { await session.processInput(submitted); }
          finally { session.executing = false; }
        })();
        return;
      }

      if (key === 'Space') {
        target.value = v.slice(0, start) + ' ' + v.slice(end);
        try { target.setSelectionRange(start + 1, start + 1); } catch(e) {}
        session.updateLine();
        return;
      }

      if (key === 'Up') {
        if (session.historyIndex > 0) {
          session.historyIndex--;
          target.value = session.history[session.historyIndex];
          try { target.setSelectionRange(target.value.length, target.value.length); } catch(e) {}
          session.updateLine();
        }
        return;
      }
      if (key === 'Down') {
        if (session.historyIndex < session.history.length - 1) {
          session.historyIndex++;
          target.value = session.history[session.historyIndex];
          try { target.setSelectionRange(target.value.length, target.value.length); } catch(e) {}
          session.updateLine();
        } else {
          session.historyIndex = session.history.length;
          target.value = '';
          session.updateLine();
        }
        return;
      }
      if (key === 'Left') {
        try { target.setSelectionRange(Math.max(0, start - 1), Math.max(0, start - 1)); } catch(e) {}
        return;
      }
      if (key === 'Right') {
        try { target.setSelectionRange(Math.min(v.length, start + 1), Math.min(v.length, start + 1)); } catch(e) {}
        return;
      }

      let out = key;
      if (key.length === 1 && /[a-z]/i.test(key)) {
        out = (shift !== caps) ? key.toUpperCase() : key.toLowerCase();
      }
      target.value = v.slice(0, start) + out + v.slice(end);
      try { target.setSelectionRange(start + out.length, start + out.length); } catch(e) {}
      session.updateLine();
    }

    function setTab(t) {
      currentTab = t;
      tabRow.querySelectorAll('button[data-tab]').forEach(b => {
        const isActive = b.dataset.tab === t;
        b.style.background = isActive ? '#1e3a8a' : 'transparent';
        b.style.color = isActive ? '#00d8ff' : '#60a5fa';
        b.style.borderColor = isActive ? '#00d8ff' : '#1e3a8a';
      });
      renderKeys();
    }

    function renderKeys() {
      keypadContainer.innerHTML = '';
      
      const addRow = (keys) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:4px;justify-content:center;flex-wrap:wrap;';
        keys.forEach(k => {
          if (typeof k === 'string') {
            let text = k;
            if (k.length === 1 && /[a-z]/i.test(k)) text = (shift || caps) ? k.toUpperCase() : k.toLowerCase();
            const flex = k === 'Space' ? 5 : (['Shift','Caps','Tab','Backspace','Enter','Esc','Ctrl','Alt','Win','Fn'].includes(k) ? 2 : 1);
            row.appendChild(createBtn(text, k, flex));
          } else {
            row.appendChild(createBtn(k.text, k.key, k.flex || 1, k.color || '#03120a'));
          }
        });
        keypadContainer.appendChild(row);
      };

      if (currentTab === 'abc') {
        addRow(['1','2','3','4','5','6','7','8','9','0']);
        addRow(['q','w','e','r','t','y','u','i','o','p']);
        addRow(['a','s','d','f','g','h','j','k','l']);
        addRow(['Shift','z','x','c','v','b','n','m','Backspace']);
        addRow([{text:'Ctrl+A', key:'Ctrl+A', flex:1.5}, 'Ctrl', 'Alt', 'Space', 'Left', 'Right']);
        addRow(['Up', 'Down', 'Tab', 'Enter']);
      } 
      else if (currentTab === 'sym') {
        addRow(['`','~','!','@','#','$','%','^','&','*','(',')']);
        addRow(['-','_','=','+','[','{',']','}','\\','|']);
        addRow([';',':','\'','"',',','<','.','>','/','?']);
        addRow(['Backspace', 'Enter']);
      }
      else if (currentTab === 'nav') {
        addRow(['Esc', 'Tab', 'Caps', 'Enter', 'Backspace']);
        addRow(['Up', 'Down', 'Left', 'Right']);
        addRow(['Home', 'End', 'PgUp', 'PgDn', 'Ins', 'Del']);
      }
      else if (currentTab === 'fkeys') {
        addRow(['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12']);
        addRow(['PrtSc', 'ScrLk', 'Pause', 'NumLk']);
      }

      const closeRow = document.createElement('div');
      closeRow.style.cssText = 'display:flex;justify-content:center;margin-top:6px;';
      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'HIDE KEYBOARD';
      closeBtn.style.cssText = 'padding:6px 16px;flex:1 0 auto;max-width:240px;height:34px;background:#1e3a8a;color:#00d8ff;border:1px solid #00d8ff;border-radius:4px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:bold;letter-spacing:1px;transition:all 0.15s;';
      closeBtn.onmouseenter = () => { closeBtn.style.background = '#2563eb'; closeBtn.style.boxShadow = '0 0 8px #2563eb'; };
      closeBtn.onmouseleave = () => { closeBtn.style.background = '#1e3a8a'; closeBtn.style.boxShadow = 'none'; };
      const doClose = (e) => { if (e) e.preventDefault(); closeKeyboard(); };
      closeBtn.onmousedown = doClose;
      closeBtn.ontouchstart = doClose;
      closeBtn.onclick = doClose;
      closeRow.appendChild(closeBtn);
      keypadContainer.appendChild(closeRow);
    }

    const tabs = [
      { id: 'abc', label: 'ABC' },
      { id: 'sym', label: 'SYM' },
      { id: 'nav', label: 'NAV' },
      { id: 'fkeys', label: 'F1-F12' }
    ];

    tabs.forEach(t => {
      const b = document.createElement('button');
      b.dataset.tab = t.id;
      b.textContent = t.label;
      b.style.cssText = 'padding:4px 10px;border:1px solid #1e3a8a;background:transparent;color:#60a5fa;border-radius:3px;cursor:pointer;font-family:inherit;font-size:11px;transition:all 0.2s;';
      b.onclick = (e) => { e.preventDefault(); setTab(t.id); };
      tabRow.appendChild(b);
    });

    overlay.appendChild(tabRow);
    overlay.appendChild(keypadContainer);
    document.body.appendChild(overlay);
    
    setTab('abc');
  }
})();