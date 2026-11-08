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
      lang: localStorage.getItem('jarvis_lang') || 'en-US',
      chatOut: localStorage.getItem('ai_chat_out') !== 'false',
      voiceOut: localStorage.getItem('ai_voice_out') !== 'false'
    };
  }

  function getAIPrompt() { return (getConfig().name || 'ai').toLowerCase() + '> '; }
  function getUserPrompt() { return (state.settings.username || 'user') + '> '; }

  function pickVoice(lang) {
    if (!('speechSynthesis' in window)) return null;
    const prefix = (lang || 'en').split('-')[0];
    if (cachedVoice && cachedVoice.lang && cachedVoice.lang.startsWith(prefix)) return cachedVoice;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || !voices.length) return null;
    const prefs = [/Google UK English Male/i, /Microsoft David/i, /Microsoft Mark/i, /\bDaniel\b/i, /\bAlex\b/i, /Google US English/i];
    for (const re of prefs) {
      const v = voices.find(x => re.test(x.name));
      if (v) { cachedVoice = v; return v; }
    }
    const match = voices.find(x => x.lang === lang) || voices.find(x => x.lang.startsWith(prefix)) || voices.find(x => x.lang.startsWith('en')) || voices[0];
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
    u.pitch = 0.75;
    u.rate = 1.0;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  }

  if ('speechSynthesis' in window && typeof window.speechSynthesis.onvoiceschanged !== 'undefined') {
    window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.getVoices(); };
  }

  async function askAI(session, prompt) {
    const cfg = getConfig();
    if (!cfg.url || !cfg.key) { session.printError('CONFIGURATION MISSING. Use /set'); return; }
    const aiName = cfg.name || 'ai';
    const chatOn = cfg.chatOut;
    const voiceOn = cfg.voiceOut;

    let processingEl = null;
    if (chatOn) {
      const id = 'ai_r_' + Math.random().toString(36).slice(2);
      session.print(`<span style="color:#00d8ff;font-weight:bold">${T.Utils.escapeHTML(aiName)}&gt;</span> <span id="${id}" style="color:#eab308">Processing...</span>`, true);
      processingEl = document.getElementById(id);
    }

    try {
      const sysPrompt = `You are ${aiName}, an AI assistant. You MUST reply in language: ${cfg.lang}. Keep answers concise.`;
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
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
      const reply = (data.choices && data.choices[0] && data.choices[0].message) ? data.choices[0].message.content : '[no response]';
      if (chatOn && processingEl) {
        processingEl.style.color = '#22c55e';
        processingEl.textContent = reply;
      }
      if (voiceOn) speak(reply, cfg.lang);
    } catch (err) {
      if (chatOn && processingEl) {
        processingEl.style.color = '#ef4444';
        processingEl.textContent = 'Error: ' + err.message;
      } else {
        session.printError('AI ERROR: ' + err.message);
      }
    }
  }

  function stopVoice() {
    if (activeVoiceRecognition) {
      try {
        activeVoiceRecognition.onend = null;
        activeVoiceRecognition.onresult = null;
        activeVoiceRecognition.onerror = null;
        activeVoiceRecognition.abort();
      } catch (e) {}
      activeVoiceRecognition = null;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  function enterDefaultMode(session) {
    stopVoice();
    session.mode = 'ai_default';
    session.promptPrefix = getAIPrompt();
    session.updatePrompt();
  }

  function enterChatMode(session) {
    stopVoice();
    session.mode = 'ai_chat';
    session.promptPrefix = getUserPrompt();
    session.updatePrompt();
  }

  async function enterVoiceMode(session) {
    stopVoice();

    const cfg = getConfig();
    if (!cfg.key) {
      session.printError('CONFIGURATION MISSING. Use /set');
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      session.printError('SPEECH RECOGNITION NOT SUPPORTED');
      return;
    }
    if (!window.isSecureContext) {
      session.printError('VOICE REQUIRES HTTPS');
      return;
    }

    // Warm-up mic permission (best-effort). If it fails, still try SpeechRecognition.
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
      } catch (err) {
        // Not fatal - SpeechRecognition has its own permission flow
        console.warn('getUserMedia warm-up failed:', err && err.name);
      }
    }

    session.mode = 'ai_voice';
    session.promptPrefix = getUserPrompt();
    session.updatePrompt();
    startVoiceLoop(session, SR);
  }

  function startVoiceLoop(session, SR) {
    const cfg = getConfig();
    const rec = new SR();
    rec.lang = cfg.lang;
    rec.continuous = true;
    rec.interimResults = false;
    let failed = false;

    rec.onresult = async (event) => {
      const last = event.results[event.results.length - 1];
      const transcript = (last[0].transcript || '').trim();
      if (!transcript) return;
      const userName = state.settings.username || 'user';
      session.print(`<span style="color:#a855f7;font-weight:bold">${T.Utils.escapeHTML(userName)}&gt;</span> ${T.Utils.escapeHTML(transcript)}`, true);
      await askAI(session, transcript);
    };

    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        failed = true;
        session.printError('MICROPHONE ACCESS DENIED — check browser permissions');
        stopVoice();
        enterDefaultMode(session);
      }
      // ignore no-speech, aborted, network
    };

    rec.onend = () => {
      if (!failed && session.mode === 'ai_voice' && activeVoiceRecognition === rec) {
        try { rec.start(); } catch (e) {}
      }
    };

    activeVoiceRecognition = rec;
    try { rec.start(); } catch (e) {
      failed = true;
      session.printError('SPEECH START FAILED: ' + (e.message || e));
      stopVoice();
      enterDefaultMode(session);
    }
  }

  async function runSlashCommand(session, input) {
    const raw = input.slice(1).trim();
    if (!raw) return;
    const upper = raw.toUpperCase();

    if (upper === 'CHAT')  { enterChatMode(session); return; }
    if (upper === 'VOICE') { await enterVoiceMode(session); return; }
    if (upper === 'EXIT') {
      if (session.mode === 'ai_default') session.closeWindow();
      else enterDefaultMode(session);
      return;
    }

    const ext = Terminal.extensions['ai'];
    if (ext && ext.commands && ext.commands[upper]) {
      try { await ext.commands[upper].call(session, ''); return; }
      catch (e) { session.printError(String(e.message || e).toUpperCase()); return; }
    }
    session.printError('INVALID KEY: ' + input);
  }

  function openSettingsModal(session) {
    if (document.getElementById('ai-set-overlay')) return;
    const cfg = getConfig();

    const overlay = document.createElement('div');
    overlay.id = 'ai-set-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px;';

    const card = document.createElement('div');
    card.style.cssText = 'background:#111827;color:#f3f4f6;padding:14px;border-radius:6px;width:100%;max-width:420px;max-height:92vh;overflow-y:auto;box-shadow:0 0 20px rgba(59,130,246,0.5);border:1px solid #3b82f6;font-family:\'Share Tech Mono\',monospace;display:flex;flex-direction:column;box-sizing:border-box;';

    const header = document.createElement('div');
    header.textContent = 'AI SETTINGS';
    header.style.cssText = 'font-size:14px;font-weight:bold;color:#f3f4f6;margin-bottom:12px;border-bottom:1px solid #374151;padding-bottom:8px;text-align:center;letter-spacing:1px;';
    card.appendChild(header);

    const fields = [
      { id: 'ai-f-name',  label: 'NAME',     value: cfg.name,  ph: 'e.g. Kal',            type: 'text' },
      { id: 'ai-f-url',   label: 'URL',      value: cfg.url,   ph: 'https://api.openai.com/v1/chat/completions', type: 'text' },
      { id: 'ai-f-key',   label: 'KEY',      value: cfg.key,   ph: 'sk-xxx',              type: 'password' },
      { id: 'ai-f-model', label: 'MODEL',    value: cfg.model, ph: 'gpt-3.5-turbo',       type: 'text' },
      { id: 'ai-f-lang',  label: 'LANGUAGE', value: cfg.lang,  ph: 'en-US',               type: 'text' }
    ];

    const inputs = {};
    for (const f of fields) {
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom:10px;';
      const lbl = document.createElement('div');
      lbl.textContent = f.label;
      lbl.style.cssText = 'font-size:10px;color:#93c5fd;margin-bottom:3px;letter-spacing:1px;font-weight:bold;';
      const inp = document.createElement('input');
      inp.id = f.id;
      inp.type = f.type;
      inp.value = f.value || '';
      inp.placeholder = f.ph;
      inp.style.cssText = 'width:100%;background:#1f2937;border:1px solid #374151;color:#f3f4f6;padding:6px 8px;border-radius:3px;font-family:inherit;font-size:12px;box-sizing:border-box;outline:none;';
      inp.onfocus = () => { inp.style.borderColor = '#3b82f6'; inp.style.boxShadow = '0 0 4px rgba(59,130,246,0.6)'; };
      inp.onblur  = () => { inp.style.borderColor = '#374151'; inp.style.boxShadow = 'none'; };
      row.appendChild(lbl);
      row.appendChild(inp);
      card.appendChild(row);
      inputs[f.id] = inp;
    }

    const makeToggle = (labelText, initial) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;margin-bottom:6px;border-top:1px solid #374151;';
      const lbl = document.createElement('div');
      lbl.textContent = labelText;
      lbl.style.cssText = 'font-size:11px;color:#93c5fd;letter-spacing:1px;font-weight:bold;';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.on = initial ? 'true' : 'false';
      const render = () => {
        const on = btn.dataset.on === 'true';
        btn.textContent = on ? 'ON' : 'OFF';
        btn.style.cssText = 'min-width:52px;padding:4px 10px;font-size:11px;border-radius:3px;cursor:pointer;font-family:inherit;transition:all 0.2s;font-weight:bold;' +
          (on ? 'border:1px solid #22c55e;background:#166534;color:#f3f4f6;' : 'border:1px solid #4b5563;background:#1f2937;color:#9ca3af;');
      };
      render();
      btn.onclick = () => { btn.dataset.on = btn.dataset.on === 'true' ? 'false' : 'true'; render(); };
      row.appendChild(lbl);
      row.appendChild(btn);
      card.appendChild(row);
      return btn;
    };

    const toggleChat  = makeToggle('CHAT (TEXT OUTPUT)',   cfg.chatOut);
    const toggleVoice = makeToggle('VOICE (SPEAK OUTPUT)', cfg.voiceOut);

    const err = document.createElement('div');
    err.style.cssText = 'font-size:10px;color:#ef4444;min-height:14px;margin-top:4px;letter-spacing:0.5px;';
    card.appendChild(err);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:8px;';
    const btnCancel = document.createElement('button');
    btnCancel.textContent = 'CANCEL';
    btnCancel.style.cssText = 'padding:6px 14px;font-size:11px;border:1px solid #374151;background:transparent;color:#93c5fd;border-radius:3px;cursor:pointer;font-family:inherit;font-weight:bold;';
    const btnSave = document.createElement('button');
    btnSave.textContent = 'SAVE';
    btnSave.style.cssText = 'padding:6px 14px;font-size:11px;border:1px solid #3b82f6;background:#1e3a8a;color:#f3f4f6;border-radius:3px;cursor:pointer;font-family:inherit;font-weight:bold;';
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
      localStorage.setItem('ai_chat_out',  toggleChat.dataset.on);
      localStorage.setItem('ai_voice_out', toggleVoice.dataset.on);
      cachedVoice = null;
      if (session.mode === 'ai_default') {
        session.promptPrefix = getAIPrompt();
        session.updatePrompt();
      }
      close();
    };

    setTimeout(() => inputs['ai-f-name'].focus(), 50);
  }

  T.registerExtension({
    name: 'ai',
    info: 'AI Assistant package. RUN{ai} to start. Use /set to configure.',
    descriptions: {
      SET:   'Open AI settings window',
      LANGS: 'Fetch available languages'
    },
    run: function () { enterDefaultMode(this); },
    scopedOnly: {
      INFO: function () {
        const cfg = getConfig();
        if (!cfg.url) return this.printSystem('No AI configured yet. Use /set.');
        this.printSystem('[ ' + cfg.name.toUpperCase() + ' CONFIGURATION ]');
        this.printSystem('URL:      ' + cfg.url);
        this.printSystem('Model:    ' + cfg.model);
        this.printSystem('Language: ' + cfg.lang);
        this.printSystem('API Key:  ' + '*'.repeat(Math.min(8, cfg.key.length)) + cfg.key.slice(-4));
        this.printSystem('Chat Out: ' + (cfg.chatOut ? 'ON' : 'OFF'));
        this.printSystem('Voice Out:' + (cfg.voiceOut ? 'ON' : 'OFF'));
      },
      CLEAR: function () {
        localStorage.removeItem('jarvis_name');
        localStorage.removeItem('jarvis_url');
        localStorage.removeItem('jarvis_key');
        localStorage.removeItem('jarvis_model');
        localStorage.removeItem('jarvis_lang');
        localStorage.removeItem('ai_chat_out');
        localStorage.removeItem('ai_voice_out');
        cachedVoice = null;
        this.printSuccess('Configuration cleared.');
      }
    },
    commands: {
      SET: function () { openSettingsModal(this); },
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
          session.print(session.promptEl.innerHTML + ' ' + T.Utils.escapeHTML(input), true);

          if (trimmed.startsWith('/')) { await runSlashCommand(session, trimmed); return; }

          // Non-slash: only config commands allowed
          const upper = trimmed.toUpperCase();
          const ext = Terminal.extensions['ai'];
          if (ext && ext.commands && ext.commands[upper]) {
            try { await ext.commands[upper].call(session, ''); return; }
            catch (e) { session.printError(String(e.message || e).toUpperCase()); return; }
          }
          session.printError('INVALID KEY: ' + trimmed);
        }
      },
      ai_chat: {
        async onInput(session, input) {
          const trimmed = input.trim();
          if (!trimmed) return;
          if (trimmed.startsWith('/')) { await runSlashCommand(session, trimmed); return; }

          const userName = state.settings.username || 'user';
          session.print(`<span style="color:#a855f7;font-weight:bold">${T.Utils.escapeHTML(userName)}&gt;</span> ${T.Utils.escapeHTML(input)}`, true);
          await askAI(session, input);
        }
      },
      ai_voice: {
        async onInput(session, input) {
          const trimmed = input.trim();
          if (!trimmed) return;
          if (trimmed.startsWith('/')) {
            await runSlashCommand(session, trimmed);
          }
        },
        onAbort(session) {
          stopVoice();
          enterDefaultMode(session);
        }
      }
    }
  });
})();