'use strict';

const UI = {
  miniWindows: {}, kitWindows: {}, fallbackWindow: null, activeSession: null,
  sFont: null, sBg: null, sFontFamily: null, sBrightness: null,

  init() {
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        const vh = window.visualViewport.height;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
        setTimeout(() => {
          const s = UI.activeSession || state.session;
          if (s && s.container) {
            s.container.scrollTop = s.container.scrollHeight;
          }
        }, 100);
      });
    }

    document.getElementById('workspace').addEventListener('click', () => {
      const sel = window.getSelection();
      if (sel && sel.toString().length) return;
      if (state.session) state.session.cap.focus();
    });
    document.addEventListener('paste', (e) => {
      if (!document.getElementById('editor').classList.contains('hidden')) return;
      if (!document.getElementById('settings').classList.contains('hidden')) return;
      const s = UI.activeSession || state.session;
      if (!s) return;
      if (s.cap.disabled) return;
      s.cap.focus();
      const txt = (e.clipboardData || window.clipboardData).getData('text');
      if (txt) { s.cap.value += txt; s.updateLine(); e.preventDefault(); }
    });
    window.addEventListener('keydown', e => {
      if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        const s = UI.activeSession || state.session;
        if (!s) return;
        if (!document.getElementById('editor').classList.contains('hidden')) return;
        if (!document.getElementById('settings').classList.contains('hidden')) return;
        e.preventDefault(); s.clear(); return;
      }
      if (!e.ctrlKey || e.key.toLowerCase() !== 'c') return;
      const s = UI.activeSession || state.session;
      if (!s) return;
      if (!document.getElementById('editor').classList.contains('hidden')) return;
      if (!document.getElementById('settings').classList.contains('hidden')) return;
      if (window.getSelection && window.getSelection().toString()) return;
      if (s.mode !== 'shell') {
        const handler = Terminal.modeHandlers[s.mode];
        if (handler && handler.onAbort) { e.preventDefault(); handler.onAbort(s); s.cap.value = ''; }
        return;
      }
      if (s.executing) return;
      e.preventDefault();
      s.print(s.promptEl.innerHTML + ' ' + Utils.escapeHTML(s.cap.value) + '^C', true);
      s.cap.value = '';
      s.updateLine();
    });
    const closeSettings = () => {
      document.getElementById('settings').classList.add('hidden');
      if (UI.activeSession) UI.activeSession.cap.focus();
    };
    document.getElementById('settings-cancel').onclick = closeSettings;
    document.getElementById('settings-save').onclick = async () => {
      const u = document.getElementById('s-user').value.trim() || 'user';
      const f = UI.sFont.getValue();
      const b = UI.sBg.getValue();
      const ff = UI.sFontFamily.getValue();
      const br = UI.sBrightness ? (parseFloat(UI.sBrightness.value) || 1.0) : 1.0;
      const oldUser = state.settings.username;
      state.settings = { username: u, fontColor: f, bgColor: b, fontFamily: ff, brightness: br };
      try { localStorage.setItem('webterm_settings', JSON.stringify(state.settings)); } catch (e) {}
      if (u !== oldUser && state.session) {
        const oldHome = '/home/' + oldUser, newHome = '/home/' + u;
        if (!(await Storage.get(newHome, 'vfs'))) await Storage.set(newHome, { type: 'dir' }, 'vfs');
        if (state.session.cwd === oldHome || state.session.cwd.startsWith(oldHome + '/')) state.session.cwd = newHome;
      }
      this.applySettings();
      closeSettings();
    };
  },

  attachInput(session) {
    const cap = session.cap;
    cap.addEventListener('compositionstart', () => { session._composing = true; });
    cap.addEventListener('compositionend', () => { session._composing = false; session.updateLine(); });
    cap.addEventListener('input', () => { if (!session._composing) session.updateLine(); });
    cap.addEventListener('focus', () => { UI.activeSession = session; session.updateLine(); });
    cap.addEventListener('click', () => session.updateLine());
    cap.addEventListener('keyup', (e) => {
      if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') session.updateLine();
    });
    cap.addEventListener('keydown', async e => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (session.executing && !session._inputResolver) return;
        const v = cap.value;
        cap.value = '';
        session.updateLine();
        if (session._inputResolver) {
          try { await session.processInput(v); }
          catch (err) { session.printError(err && err.message ? err.message : String(err)); }
          return;
        }
        session.executing = true;
        try { await session.processInput(v); }
        catch (err) { session.printError(err && err.message ? err.message : String(err)); }
        finally { session.executing = false; }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (session.historyIndex > 0) { session.historyIndex--; cap.value = session.history[session.historyIndex]; session.updateLine(); }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (session.historyIndex < session.history.length - 1) {
          session.historyIndex++;
          cap.value = session.history[session.historyIndex];
        } else {
          session.historyIndex = session.history.length;
          cap.value = '';
        }
        session.updateLine();
        return;
      }
    });
  },

  focusWindow(session) { if (!session) return; session.cap.focus(); UI.activeSession = session; },

  applyMiniTheme(session) {
    if (!session || !session.wrapper) return;
    const theme = session.customTheme || state.settings;
    const dark = theme.bgColor !== 'bg-white';
    
    let bg = dark ? 'var(--bg-1)' : '#ffffff';
    if (theme.bgColor === 'bg-black') bg = '#000000';

    const colorMap = {
      'text-black': dark ? '#000000' : '#000000',
      'text-white': '#ffffff',
      'text-green-600': 'var(--green)',
      'text-green-400': 'var(--green)',
      'text-cyan-400': 'var(--cyan)',
      'text-yellow-400': 'var(--amber)'
    };
    const fg = colorMap[theme.fontColor] || 'var(--fg-0)';
    const headerBg = 'var(--bg-3)';
    const headerFg = 'var(--fg-0)';
    const borderColor = 'var(--line-2)';
    const fam = FONT_FAMILIES[theme.fontFamily] || FONT_FAMILIES.mono;
    const brightness = (theme.brightness != null) ? theme.brightness : (state.settings.brightness || 1.0);
    
    if (session.container) {
      session.container.style.color = fg;
      session.container.style.background = bg;
      session.container.style.fontFamily = fam;
      session.container.style.filter = brightness !== 1.0 ? 'brightness(' + brightness + ')' : '';
    }
    session.wrapper.style.background = bg;
    session.wrapper.style.borderColor = borderColor;
    session.wrapper.classList.toggle('dark', dark);
    const header = session.wrapper.querySelector('.mini-header');
    if (header) { header.style.background = headerBg; header.style.color = headerFg; header.style.borderBottomColor = borderColor; }
  },

  openSettings() {
    document.getElementById('s-user').value = state.settings.username;
    const fontColorOptions = [
      { value: 'text-black', label: 'Black' },
      { value: 'text-white', label: 'White' },
      { value: 'text-green-600', label: 'Green (dark)' },
      { value: 'text-green-400', label: 'Green (bright)' },
      { value: 'text-cyan-400', label: 'Cyan' },
      { value: 'text-yellow-400', label: 'Yellow' }
    ];
    const bgColorOptions = [{ value: 'bg-white', label: 'White' }, { value: 'bg-black', label: 'Black' }];
    const fontFamilyOptions = Object.keys(FONT_FAMILIES).map(k => ({ value: k, label: FONT_LABELS[k] || k, fontFamily: FONT_FAMILIES[k] }));

    const fontWrap = document.getElementById('s-font-wrap'); fontWrap.innerHTML = '';
    UI.sFont = createCustomSelect(fontColorOptions, state.settings.fontColor, () => {});
    fontWrap.appendChild(UI.sFont.wrap);

    const bgWrap = document.getElementById('s-bg-wrap'); bgWrap.innerHTML = '';
    UI.sBg = createCustomSelect(bgColorOptions, state.settings.bgColor, () => {});
    bgWrap.appendChild(UI.sBg.wrap);

    const ffWrap = document.getElementById('s-fontfamily-wrap'); ffWrap.innerHTML = '';
    UI.sFontFamily = createCustomSelect(fontFamilyOptions, state.settings.fontFamily, (val) => {});
    ffWrap.appendChild(UI.sFontFamily.wrap);

    const brWrap = document.getElementById('s-brightness-wrap');
    if (brWrap) {
      brWrap.innerHTML = '';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0.5';
      slider.max = '2.5';
      slider.step = '0.05';
      slider.value = String(state.settings.brightness || 1.0);
      slider.style.cssText = 'flex:1;accent-color:var(--green);';
      const val = document.createElement('span');
      val.textContent = (state.settings.brightness || 1.0).toFixed(2) + 'x';
      val.style.cssText = 'min-width:48px;text-align:right;font-size:11px;font-weight:bold;color:var(--green);';
      slider.oninput = () => { val.textContent = (parseFloat(slider.value) || 1.0).toFixed(2) + 'x'; };
      row.appendChild(slider);
      row.appendChild(val);
      brWrap.appendChild(row);
      UI.sBrightness = slider;
    }

    document.getElementById('settings').classList.remove('hidden');
  },

  openMiniSettings(session) {
    const theme = session.customTheme || state.settings;
    const overlay = document.createElement('div');
    overlay.className = 'custom-select-overlay';
    overlay.style.zIndex = '200';
    
    const card = document.createElement('div');
    card.className = 'settings-card';
    card.style.cssText = 'width:85%; max-height:85%; padding:0; box-shadow:0 0 20px rgba(0,255,65,0.4);';
    
    const header = document.createElement('div');
    header.style.cssText = 'font-size:12px;font-weight:bold;color:var(--green);margin-bottom:10px;border-bottom:1px solid var(--line-2);padding:10px;text-align:center;letter-spacing:1px;text-transform:uppercase;background:var(--bg-3);';
    header.textContent = 'MINI SETTINGS';
    card.appendChild(header);
    
    const content = document.createElement('div');
    content.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:10px;background:var(--bg-2);';
    
    const makeRow = (labelText) => {
      const row = document.createElement('div');
      const lbl = document.createElement('label');
      lbl.textContent = labelText;
      lbl.style.cssText = 'font-size:10px;display:block;color:var(--cyan);margin-bottom:4px;text-transform:uppercase;letter-spacing:1px;';
      const wrap = document.createElement('div');
      row.appendChild(lbl); row.appendChild(wrap);
      return { row, wrap };
    };
    const r1 = makeRow('Font Color');
    const r2 = makeRow('Background');
    const r3 = makeRow('Font Family');
    content.appendChild(r1.row); content.appendChild(r2.row); content.appendChild(r3.row);
    
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px;padding:10px;background:var(--bg-3);';
    
    const btnCancel = document.createElement('button');
    btnCancel.textContent = 'CANCEL';
    btnCancel.className = 'btn-danger';
    
    const btnSave = document.createElement('button');
    btnSave.textContent = 'SAVE';
    btnSave.className = 'btn-primary';
    
    btnRow.appendChild(btnCancel); btnRow.appendChild(btnSave);
    card.appendChild(content); card.appendChild(btnRow);
    overlay.appendChild(card);
    session.wrapper.appendChild(overlay);

    const fontColorOptions = [
      { value: 'text-black', label: 'Black' },
      { value: 'text-white', label: 'White' },
      { value: 'text-green-600', label: 'Green (dark)' },
      { value: 'text-green-400', label: 'Green (bright)' },
      { value: 'text-cyan-400', label: 'Cyan' },
      { value: 'text-yellow-400', label: 'Yellow' }
    ];
    const bgColorOptions = [{ value: 'bg-white', label: 'White' }, { value: 'bg-black', label: 'Black' }];
    const fontFamilyOptions = Object.keys(FONT_FAMILIES).map(k => ({ value: k, label: FONT_LABELS[k] || k, fontFamily: FONT_FAMILIES[k] }));
    const msFont = createCustomSelect(fontColorOptions, theme.fontColor, () => {});
    const msBg = createCustomSelect(bgColorOptions, theme.bgColor, () => {});
    const msFf = createCustomSelect(fontFamilyOptions, theme.fontFamily, () => {});
    r1.wrap.appendChild(msFont.wrap);
    r2.wrap.appendChild(msBg.wrap);
    r3.wrap.appendChild(msFf.wrap);
    
    btnCancel.onclick = (e) => { e.stopPropagation(); overlay.remove(); };
    btnSave.onclick = (e) => {
      e.stopPropagation();
      session.customTheme = { fontColor: msFont.getValue(), bgColor: msBg.getValue(), fontFamily: msFf.getValue() };
      UI.applyMiniTheme(session);
      overlay.remove();
    };
  },

  applySettings() {
    const fam = FONT_FAMILIES[state.settings.fontFamily] || FONT_FAMILIES.mono;
    document.documentElement.style.setProperty('--term-font', fam);
    
    const bgMap = { 'bg-white': '#ffffff', 'bg-black': '#000000' };
    const fgMap = {
      'text-black': '#000000', 'text-white': '#ffffff',
      'text-green-600': '#00ff41', 'text-green-400': '#00ff41',
      'text-cyan-400': '#00d8ff', 'text-yellow-400': '#ffb000'
    };

    const bgColor = bgMap[state.settings.bgColor] || '#000000';
    const fgColor = fgMap[state.settings.fontColor] || '#00ff41';
    const brightness = state.settings.brightness || 1.0;

    document.body.style.backgroundColor = bgColor;
    document.body.style.color = fgColor;

    if (state.session) {
      state.session.container.className = 'term absolute inset-0 overflow-y-auto p-4 flex flex-col';
      state.session.container.style.backgroundColor = bgColor;
      state.session.container.style.color = fgColor;
      state.session.container.style.filter = brightness !== 1.0 ? 'brightness(' + brightness + ')' : '';
      state.session.updatePrompt();
    }

    for (const s of Object.values(UI.miniWindows)) this.applyMiniTheme(s);
    if (UI.fallbackWindow) this.applyMiniTheme(UI.fallbackWindow);
  },

  createSession() {
    state.session = new TerminalSession();
    Terminal.session = state.session;
    UI.activeSession = state.session;
    this.applySettings();
    UI.attachInput(state.session);
    state.session.cap.focus();
  }
};

window.UI = UI;