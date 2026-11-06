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
      KEYBOARD: 'Open the virtual computer keyboard',
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

  /* ---------- Virtual keyboard ---------- */
  function openVirtualKeyboard(session) {
    const existing = document.getElementById('virtual-kb-overlay');
    if (existing) {
      existing.style.display = existing.style.display === 'none' ? 'flex' : 'none';
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'virtual-kb-overlay';
    overlay.style.cssText = 'position:fixed;left:0;right:0;bottom:0;background:#1f2937;color:#fff;padding:8px;z-index:10000;font-family:ui-monospace,monospace;font-size:14px;display:flex;flex-direction:column;gap:4px;box-shadow:0 -4px 12px rgba(0,0,0,0.4);border-top:2px solid #2563eb;';

    const rows = [
      ['`','1','2','3','4','5','6','7','8','9','0','-','=','Backspace'],
      ['Tab','q','w','e','r','t','y','u','i','o','p','[',']','\\'],
      ['Caps','a','s','d','f','g','h','j','k','l',';',"'",'Enter'],
      ['Shift','z','x','c','v','b','n','m',',','.','/','Shift'],
      ['Hide','Ctrl','Alt','Space','Ctrl','Alt','Hide']
    ];

    let shift = false;
    let caps = false;

    function relabel() {
      overlay.querySelectorAll('button[data-key]').forEach(b => {
        const k = b.dataset.key;
        if (k.length === 1 && /[a-z]/i.test(k)) {
          b.textContent = (shift || caps) ? k.toUpperCase() : k.toLowerCase();
        }
      });
    }

    function press(key) {
      if (!session.cap || !session.cap.isConnected) { overlay.remove(); return; }
      const target = session.cap;
      const v = target.value;
      const start = target.selectionStart != null ? target.selectionStart : v.length;
      const end   = target.selectionEnd   != null ? target.selectionEnd   : v.length;

      if (key === 'Hide') {
        overlay.style.display = 'none';
        return;
      }
      if (key === 'Shift') { shift = !shift; relabel(); return; }
      if (key === 'Caps')  { caps  = !caps;  relabel(); return; }
      if (key === 'Ctrl' || key === 'Alt') return;

      if (key === 'Backspace') {
        if (start === end && start > 0) target.value = v.slice(0, start - 1) + v.slice(end);
        else target.value = v.slice(0, start) + v.slice(end);
        try { target.setSelectionRange(Math.max(0, start - 1), Math.max(0, start - 1)); } catch(e) {}
        session.updateLine();
        target.focus();
        return;
      }

      if (key === 'Enter') {
        const submitted = target.value;
        target.value = '';
        session.updateLine();
        target.focus();
        (async () => {
          session.executing = true;
          try { await session.processInput(submitted); }
          finally { session.executing = false; }
        })();
        return;
      }

      if (key === 'Tab') {
        target.value = v.slice(0, start) + '  ' + v.slice(end);
        try { target.setSelectionRange(start + 2, start + 2); } catch(e) {}
        session.updateLine();
        target.focus();
        return;
      }

      if (key === 'Space') {
        target.value = v.slice(0, start) + ' ' + v.slice(end);
        try { target.setSelectionRange(start + 1, start + 1); } catch(e) {}
        session.updateLine();
        target.focus();
        return;
      }

      let out = key;
      if (key.length === 1 && /[a-z]/i.test(key)) {
        out = (shift !== caps) ? key.toUpperCase() : key.toLowerCase();
      }
      target.value = v.slice(0, start) + out + v.slice(end);
      try { target.setSelectionRange(start + out.length, start + out.length); } catch(e) {}
      session.updateLine();
      target.focus();
    }

    for (const row of rows) {
      const rowEl = document.createElement('div');
      rowEl.style.cssText = 'display:flex;gap:4px;justify-content:center;';
      for (const key of row) {
        const b = document.createElement('button');
        b.dataset.key = key;
        b.textContent = key;
        const isMod = ['Shift','Ctrl','Alt','Caps','Tab','Enter','Backspace','Hide'].includes(key);
        const width = key === 'Space' ? '140px' : (isMod ? 'auto' : '32px');
        b.style.cssText = 'padding:4px 8px;min-width:' + (key === 'Space' ? '140px' : '28px') +
          ';height:32px;background:#374151;color:#fff;border:1px solid #4b5563;border-radius:4px;' +
          'cursor:pointer;font-family:inherit;font-size:13px;';
        b.onmousedown = (e) => { e.preventDefault(); press(key); };
        rowEl.appendChild(b);
      }
      overlay.appendChild(rowEl);
    }

    document.body.appendChild(overlay);
    session.printSystem('Virtual keyboard opened. Input feeds the current session.');
    session.printSystem('Press "Hide" to hide, or KEYBOARD again to toggle.');
  }
})();