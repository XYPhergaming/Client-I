(function () {
  'use strict';
  const T = Terminal;
  let activeVoiceRecognition = null;
  let cachedVoice = null;

  function getConfig() {
    return {
      name: localStorage.getItem('jarvis_name') || 'ai',
      url: localStorage.getItem('jarvis_url') || '',
      key: localStorage.getItem('jarvis_key') || '',
      model: localStorage.getItem('jarvis_model') || '',
      lang: localStorage.getItem('jarvis_lang') || 'en-US'
    };
  }

  function getAIPrompt() {
    const cfg = getConfig();
    return (cfg.name || 'ai').toLowerCase() + '> ';
  }

  function getUserPrompt() {
    return (state.settings.username || 'user') + '> ';
  }

  // ---------- Robotic Voice ----------
  function pickVoice(lang) {
    if (!('speechSynthesis' in window)) return null;
    if (cachedVoice && cachedVoice.lang && cachedVoice.lang.startsWith((lang || 'en').split('-')[0])) return cachedVoice;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || !voices.length) return null;
    const prefs = [
      /Google UK English Male/i,
      /Google US English/i,
      /Microsoft David/i,
      /Microsoft Mark/i,
      /Daniel/i,
      /Alex/i,
      /Google UK English Female/i
    ];
    for (const re of prefs) {
      const v = voices.find(x => re.test(x.name));
      if (v) { cachedVoice = v; return v; }
    }
    const prefix = (lang || 'en').split('-')[0];
    const match = voices.find(x => x.lang === lang)
                || voices.find(x => x.lang.startsWith(prefix))
                || voices.find(x => x.lang.startsWith('en'))
                || voices[0];
    cachedVoice = match;
    return match;
  }

  function speak(text, lang) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const clean = String(text || '')
      .replace(/```[\s\S]*?```/g, ' code block ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[*_~#>]/g, '')
      .replace(/https?:\/\/\S+/g, ' link ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = lang;
    const v = pickVoice(lang);
    if (v) u.voice = v;
    u.pitch = 0.75;   // lower → more robotic/consistent
    u.rate = 1.0;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  }

  // Ensure voices load
  if ('speechSynthesis' in window && typeof window.speechSynthesis.onvoiceschanged !== 'undefined') {
    window.speechSynthesis.onvoiceschanged = () => {
      // just triggering getVoices to cache
      window.speechSynthesis.getVoices();
    };
  }

  // ---------- AI Request ----------
  async function askAI(session, prompt, speakReply) {
    const cfg = getConfig();
    if (!cfg.url || !cfg.key) {
      session.printError('CONFIGURATION MISSING. Use: ai.set');
      return;
    }
    const aiName = cfg.name || 'ai';
    const id = 'ai_r_' + Math.random().toString(36).slice(2);

    session.print(
      `<span style="color:#00d8ff;font-weight:bold">${T.Utils.escapeHTML(aiName)}&gt;</span> <span id="${id}" style="color:#eab308">Processing...</span>`,
      true
    );

    try {
      const sysPrompt = `You are ${aiName}, an AI assistant. You MUST reply in language: ${cfg.lang}. Keep answers concise.`;
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + cfg.key
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: prompt }
          ]
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'HTTP ' + res.status);
      const reply = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '[no response]';

      const el = document.getElementById(id);
      if (el) {
        el.style.color = '#22c55e';
        el.textContent = reply;
      }
      if (speakReply) speak(reply, cfg.lang);
    } catch (err) {
      const el = document.getElementById(id);
      if (el) {
        el.style.color = '#ef4444';
        el.textContent = 'Error: ' + err.message;
      }
    }
  }

  // ---------- Modes ----------
  function enterDefaultMode(session) {
    session.mode = 'ai_default';
    session.promptPrefix = getAIPrompt();
    session.updatePrompt();
    session.printSystem('AI: ' + (getConfig().name || 'ai'));
    session.printSystem('  /Chat  - Enter chat mode');
    session.printSystem('  /Voice - Enter voice mode');
    session.printSystem('  exit   - Close window');
  }

  function enterChatMode(session) {
    session.mode = 'ai_chat';
    session.promptPrefix = getUserPrompt();
    session.updatePrompt();
    session.printSystem('Chat mode. Type /exit to leave.');
  }

  function enterVoiceMode(session) {
    session.mode = 'ai_voice';
    session.promptPrefix = 'listening ';
    session.updatePrompt();
    session.printSystem('Voice mode. Speak now. Type /exit or /Chat.');
    startVoiceLoop(session);
  }

  function startVoiceLoop(session) {
    stopVoice();
    const cfg = getConfig();
    if (!cfg.key) { session.printError('Run ai.set first.'); enterDefaultMode(session); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { session.printError('VOICE NOT SUPPORTED'); enterDefaultMode(session); return; }

    const rec = new SR();
    rec.lang = cfg.lang;
    rec.continuous = true;
    rec.interimResults = false;

    rec.onresult = async (event) => {
      const last = event.results[event.results.length - 1];
      const transcript = (last[0].transcript || '').trim();
      if (!transcript) return;
      const userName = state.settings.username || 'user';
      session.print(`<span style="color:#a855f7;font-weight:bold">${T.Utils.escapeHTML(userName)}&gt;</span> ${T.Utils.escapeHTML(transcript)}`, true);
      await askAI(session, transcript, true);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed') {
        session.printError('MICROPHONE ACCESS DENIED');
        stopVoice();
        enterDefaultMode(session);
      }
    };
    rec.onend = () => {
      if (session.mode === 'ai_voice') {
        try { rec.start(); } catch (e) {}
      }
    };

    try { rec.start(); } catch (e) {}
    activeVoiceRecognition = rec;
  }

  function stopVoice() {
    if (activeVoiceRecognition) {
      try {
        activeVoiceRecognition.onend = null;
        activeVoiceRecognition.onresult = null;
        activeVoiceRecognition.onerror = null;
        activeVoiceRecognition.stop();
      } catch (e) {}
      activeVoiceRecognition = null;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  // ---------- Settings Modal (5 separate fields) ----------
  function openSettingsModal(session) {
    if (document.getElementById('ai-set-overlay')) return;
    const cfg = getConfig();

    const overlay = document.createElement('div');
    overlay.id = 'ai-set-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px;';

    const card = document.createElement('div');
    card.style.cssText = 'background:#031a0e;color:#00d8ff;padding:14px;border-radius:6px;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;box-shadow:0 0 20px rgba(37,99,235,0.4);border:1px solid #2563eb;font-family:\'Share Tech Mono\',monospace;display:flex;flex-direction:column;box-sizing:border-box;';

    const header = document.createElement('div');
    header.textContent = 'AI SETTINGS';
    header.style.cssText = 'font-size:14px;font-weight:bold;color:#00d8ff;margin-bottom:12px;border-bottom:1px solid #1e3a8a;padding-bottom:8px;text-align:center;letter-spacing:1px;';
    card.appendChild(header);

    const fieldDefs = [
      { key: 'ai-f-name',  label: 'NAME',     value: cfg.name,  placeholder: 'e.g. Kal',        type: 'text' },
      { key: 'ai-f-url',   label: 'URL',      value: cfg.url,   placeholder: 'https://api.openai.com/v1/chat/completions', type: 'text' },
      { key: 'ai-f-key',   label: 'KEY',      value: cfg.key,   placeholder: 'sk-xxx',          type: 'password' },
      { key: 'ai-f-model', label: 'MODEL',    value: cfg.model, placeholder: 'gpt-3.5-turbo',   type: 'text' },
      { key: 'ai-f-lang',  label: 'LANGUAGE', value: cfg.lang,  placeholder: 'en-US',           type: 'text' }
    ];

    const inputs = {};
    for (const f of fieldDefs) {
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom:10px;';

      const lbl = document.createElement('div');
      lbl.textContent = f.label;
      lbl.style.cssText = 'font-size:10px;color:#60a5fa;margin-bottom:3px;letter-spacing:1px;font-weight:bold;';

      const inp = document.createElement('input');
      inp.id = f.key;
      inp.type = f.type;
      inp.value = f.value || '';
      inp.placeholder = f.placeholder;
      inp.style.cssText = 'width:100%;background:#02120a;border:1px solid #1e3a8a;color:#00d8ff;padding:6px 8px;border-radius:3px;font-family:inherit;font-size:11px;box-sizing:border-box;outline:none;';
      inp.onfocus = () => { inp.style.borderColor = '#00d8ff'; inp.style.boxShadow = '0 0 4px #2563eb'; };
      inp.onblur  = () => { inp.style.borderColor = '#1e3a8a'; inp.style.boxShadow = 'none'; };

      row.appendChild(lbl);
      row.appendChild(inp);
      card.appendChild(row);
      inputs[f.key] = inp;
    }

    const err = document.createElement('div');
    err.style.cssText = 'font-size:10px;color:#ef4444;min-height:14px;margin-top:2px;letter-spacing:0.5px;';
    card.appendChild(err);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:10px;';

    const btnCancel = document.createElement('button');
    btnCancel.textContent = 'CANCEL';
    btnCancel.style.cssText = 'padding:6px 14px;font-size:11px;border:1px solid #1e3a8a;background:transparent;color:#60a5fa;border-radius:3px;cursor:pointer;font-family:inherit;';

    const btnSave = document.createElement('button');
    btnSave.textContent = 'SAVE';
    btnSave.style.cssText = 'padding:6px 14px;font-size:11px;border:1px solid #00d8ff;background:#1e3a8a;color:#00d8ff;border-radius:3px;cursor:pointer;font-family:inherit;';

    btnRow.appendChild(btnCancel);
    btnRow.appendChild(btnSave);
    card.appendChild(btnRow);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (session && session.cap) session.cap.focus();
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey);

    btnCancel.onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    btnSave.onclick = () => {
      const name = inputs['ai-f-name'].value.trim();
      const url  = inputs['ai-f-url'].value.trim();
      const key  = inputs['ai-f-key'].value.trim();
      const model = inputs['ai-f-model'].value.trim();
      const lang = inputs['ai-f-lang'].value.trim();

      if (!name)  { err.textContent = 'NAME IS REQUIRED'; return; }
      if (!url)   { err.textContent = 'URL IS REQUIRED'; return; }
      if (!key)   { err.textContent = 'KEY IS REQUIRED'; return; }
      if (!model) { err.textContent = 'MODEL IS REQUIRED'; return; }
      if (!lang)  { err.textContent = 'LANGUAGE IS REQUIRED'; return; }

      localStorage.setItem('jarvis_name', name);
      localStorage.setItem('jarvis_url', url);
      localStorage.setItem('jarvis_key', key);
      localStorage.setItem('jarvis_model', model);
      localStorage.setItem('jarvis_lang', lang);

      session.printSuccess('[+] AI configured as "' + name + '"');
      cachedVoice = null;

      if (session.mode === 'ai_default') {
        session.promptPrefix = getAIPrompt();
        session.updatePrompt();
      }

      close();
    };

    setTimeout(() => inputs['ai-f-name'].focus(), 50);
  }

  // ---------- Extension ----------
  T.registerExtension({
    name: 'ai',
    info: 'AI Assistant package. RUN{ai} to start. ai.set to configure.',
    descriptions: {
      SET:   'Open AI settings window',
      CHAT:  'Enter chat mode',
      VOICE: 'Enter voice mode',
      LANGS: 'Fetch available languages',
      INFO:  'Show current AI configuration',
      CLEAR: 'Clear saved config'
    },
    run: function () {
      enterDefaultMode(this);
    },
    scopedOnly: {
      INFO: function () {
        const cfg = getConfig();
        if (!cfg.url) return this.printSystem('No AI configured yet. Use ai.set.');
        this.printSystem('[ ' + cfg.name.toUpperCase() + ' CONFIGURATION ]');
        this.printSystem('URL:      ' + cfg.url);
        this.printSystem('Model:    ' + cfg.model);
        this.printSystem('Language: ' + cfg.lang);
        this.printSystem('API Key:  ' + '*'.repeat(Math.min(8, cfg.key.length)) + cfg.key.slice(-4));
      },
      CLEAR: function () {
        localStorage.removeItem('jarvis_name');
        localStorage.removeItem('jarvis_url');
        localStorage.removeItem('jarvis_key');
        localStorage.removeItem('jarvis_model');
        localStorage.removeItem('jarvis_lang');
        cachedVoice = null;
        this.printSuccess('Configuration cleared.');
      }
    },
    commands: {
      SET: function () { openSettingsModal(this); },
      CHAT: function () { enterChatMode(this); },
      VOICE: function () { enterVoiceMode(this); },
      LANGS: async function () {
        this.printSystem('Fetching languages...');
        try {
          const res = await fetch('https://restcountries.com/v3.1/all?fields=name,languages');
          if (!res.ok) throw new Error('Failed');
          const data = await res.json();
          const langSet = new Set();
          data.forEach(c => { if (c.languages) Object.values(c.languages).forEach(l => langSet.add(l)); });
          const sorted = Array.from(langSet).sort();
          this.printSystem('[+] ' + sorted.length + ' unique languages found.');
          this.printSystem('Use codes like: en-US, es-ES, hi-IN, bn-BD');
          const popular = ['English','Bengali','Hindi','Spanish','French','German','Arabic','Chinese','Japanese','Russian','Portuguese'];
          this.printSystem('----------------------------------------');
          popular.forEach(p => { if (sorted.includes(p)) this.printSystem('  - ' + p); });
        } catch (e) { this.printError('API Error: ' + e.message); }
      }
    },
    modes: {
      ai_default: {
        async onInput(session, input) {
          const trimmed = input.trim();
          if (!trimmed) return;
          const lower = trimmed.toLowerCase();

          session.print(session.promptEl.innerHTML + ' ' + T.Utils.escapeHTML(input), true);

          if (lower === '/chat')  { enterChatMode(session);  return; }
          if (lower === '/voice') { enterVoiceMode(session); return; }
          if (lower === 'exit')   { session.closeWindow();   return; }
          if (lower === '/exit')  { session.closeWindow();   return; }

          try { await session.executeScoped(trimmed); }
          catch (e) { session.printError(String(e.message || e).toUpperCase()); }
        }
      },
      ai_chat: {
        async onInput(session, input) {
          const trimmed = input.trim();
          if (!trimmed) return;
          const lower = trimmed.toLowerCase();

          if (lower === '/exit')  { enterDefaultMode(session); return; }
          if (lower === '/voice') { enterVoiceMode(session);   return; }
          if (lower === 'exit')   { enterDefaultMode(session); return; }

          const userName = state.settings.username || 'user';
          session.print(
            `<span style="color:#a855f7;font-weight:bold">${T.Utils.escapeHTML(userName)}&gt;</span> ${T.Utils.escapeHTML(input)}`,
            true
          );
          await askAI(session, input, false);
        }
      },
      ai_voice: {
        async onInput(session, input) {
          const trimmed = input.trim();
          if (!trimmed) return;
          const lower = trimmed.toLowerCase();

          if (lower === '/exit' || lower === 'exit') { stopVoice(); enterDefaultMode(session); return; }
          if (lower === '/chat') { stopVoice(); enterChatMode(session); return; }

          session.printSystem('Voice mode: use /exit or /Chat.');
        },
        onAbort(session) {
          stopVoice();
          enterDefaultMode(session);
        }
      }
    }
  });
})();