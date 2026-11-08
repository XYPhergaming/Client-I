(function () {
  'use strict';
  const T = Terminal;

  function getConfig() {
    return {
      name: localStorage.getItem('jarvis_name') || 'AI',
      url: localStorage.getItem('jarvis_url') || '',
      key: localStorage.getItem('jarvis_key') || '',
      model: localStorage.getItem('jarvis_model') || '',
      lang: localStorage.getItem('jarvis_lang') || 'en-US'
    };
  }

  function getPrompt() {
    const cfg = getConfig();
    return (cfg.name || 'ai').toLowerCase() + '> ';
  }

  function speak(text, lang, name) {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      const voices = window.speechSynthesis.getVoices();
      const matchedVoice = voices.find(v => v.lang.includes(lang) || v.lang.replace('_', '-').includes(lang));
      if (matchedVoice) utterance.voice = matchedVoice;
      window.speechSynthesis.speak(utterance);
    }
  }

  async function askAI(session, prompt) {
    const cfg = getConfig();
    if (!cfg.url || !cfg.key) {
      return session.printError('CONFIGURATION MISSING. Use: ai.set');
    }

    session.print(`<span class="text-blue-600">[${cfg.name}]:</span> <span class="text-yellow-600">Processing...</span>`, true);

    try {
      const sysPrompt = `You are ${cfg.name}, an AI assistant. You MUST reply in the following language: ${cfg.lang}. Keep answers concise and helpful.`;

      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.key}`
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

      if (!res.ok) {
        throw new Error(data.error?.message || JSON.stringify(data) || `HTTP ${res.status}`);
      }

      const reply = data.choices[0].message.content;
      session.print(`<span class="text-blue-600">[${cfg.name}]:</span> <span class="text-green-600">${T.Utils.escapeHTML(reply)}</span>`, true);
      speak(reply, cfg.lang, cfg.name);

    } catch (err) {
      session.printError(`SYSTEM ERROR: ${err.message}`);
    }
  }

  function enterChatMode(session) {
    session.mode = 'jarvis';
    session.promptPrefix = getPrompt();
    session.updatePrompt();
  }

  function openSettingsModal(session) {
    if (document.getElementById('ai-set-overlay')) return;

    const cfg = getConfig();
    const overlay = document.createElement('div');
    overlay.id = 'ai-set-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px;animation:fadeIn 0.2s ease-out;';

    const card = document.createElement('div');
    card.style.cssText = 'background:#031a0e;color:#00d8ff;padding:16px;border-radius:6px;width:100%;max-width:440px;box-shadow:0 0 20px rgba(37,99,235,0.4);border:1px solid #2563eb;font-family:\'Share Tech Mono\',monospace;display:flex;flex-direction:column;box-sizing:border-box;animation:slideUp 0.2s ease-out;';

    const header = document.createElement('div');
    header.textContent = 'AI CONFIGURATION';
    header.style.cssText = 'font-size:14px;font-weight:bold;color:#00d8ff;margin-bottom:10px;border-bottom:1px solid #1e3a8a;padding-bottom:8px;text-align:center;letter-spacing:1px;';
    card.appendChild(header);

    const hint = document.createElement('div');
    hint.textContent = 'Format: Name, URL, Key, Model, Language';
    hint.style.cssText = 'font-size:10px;color:#60a5fa;margin-bottom:6px;letter-spacing:0.5px;';
    card.appendChild(hint);

    const ta = document.createElement('textarea');
    ta.value = cfg.url ? [cfg.name, cfg.url, cfg.key, cfg.model, cfg.lang].join(', ') : '';
    ta.placeholder = 'Friday, https://api.openai.com/v1/chat/completions, sk-xxx, gpt-3.5-turbo, en-US';
    ta.style.cssText = 'width:100%;height:90px;background:#02120a;border:1px solid #1e3a8a;color:#00d8ff;padding:8px;border-radius:3px;font-family:inherit;font-size:11px;resize:vertical;box-sizing:border-box;outline:none;line-height:1.5;';
    card.appendChild(ta);

    const errorMsg = document.createElement('div');
    errorMsg.style.cssText = 'font-size:10px;color:#ef4444;min-height:14px;margin-top:6px;letter-spacing:0.5px;';
    card.appendChild(errorMsg);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:8px;';

    const btnCancel = document.createElement('button');
    btnCancel.textContent = 'CANCEL';
    btnCancel.style.cssText = 'padding:6px 14px;font-size:11px;border:1px solid #1e3a8a;background:transparent;color:#60a5fa;border-radius:3px;cursor:pointer;font-family:inherit;transition:all 0.2s;';

    const btnSave = document.createElement('button');
    btnSave.textContent = 'SAVE';
    btnSave.style.cssText = 'padding:6px 14px;font-size:11px;border:1px solid #00d8ff;background:#1e3a8a;color:#00d8ff;border-radius:3px;cursor:pointer;font-family:inherit;transition:all 0.2s;';

    btnRow.appendChild(btnCancel);
    btnRow.appendChild(btnSave);
    card.appendChild(btnRow);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    ta.focus();

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    document.addEventListener('keydown', onKey);

    btnCancel.onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    btnSave.onclick = () => {
      const val = ta.value.trim();
      if (!val) { errorMsg.textContent = 'PLEASE ENTER CONFIGURATION'; return; }
      const parts = val.split(',').map(s => s.trim());
      if (parts.length < 5) { errorMsg.textContent = 'INVALID FORMAT: NEED 5 PARAMETERS'; return; }
      const [name, url, key, model, lang] = parts;
      if (!name) { errorMsg.textContent = 'NAME IS REQUIRED'; return; }
      if (!url) { errorMsg.textContent = 'URL IS REQUIRED'; return; }
      if (!key) { errorMsg.textContent = 'KEY IS REQUIRED'; return; }
      if (!model) { errorMsg.textContent = 'MODEL IS REQUIRED'; return; }
      if (!lang) { errorMsg.textContent = 'LANGUAGE IS REQUIRED'; return; }

      localStorage.setItem('jarvis_name', name);
      localStorage.setItem('jarvis_url', url);
      localStorage.setItem('jarvis_key', key);
      localStorage.setItem('jarvis_model', model);
      localStorage.setItem('jarvis_lang', lang);

      session.printSuccess(`[+] AI configured as "${name}"`);

      // Update prompt if currently in chat mode
      if (session.mode === 'jarvis') {
        session.promptPrefix = getPrompt();
        session.updatePrompt();
      }

      close();
    };
  }

  T.registerExtension({
    name: 'ai',
    info: 'AI Assistant package. Use RUN{ai} or ai.set to configure.',
    descriptions: {
      SET:   'Open AI configuration modal (ai.set)',
      LANGS: 'Fetch available languages',
      VOICE: 'Activate microphone for voice commands',
      CHAT:  'Enter chat mode (ai.CHAT)',
      AI:    'Enter chat mode (same as CHAT)',
      INFO:  'Show current AI configuration (use ai.INFO)',
      CLEAR: 'Clear saved API keys (use ai.CLEAR)'
    },
    run: function () {
      enterChatMode(this);
    },
    scopedOnly: {
      INFO: function () {
        const cfg = getConfig();
        if (!cfg.url) return this.printSystem('No AI configured yet. Use ai.set.');
        this.printSystem(`[ ${cfg.name.toUpperCase()} CONFIGURATION ]`);
        this.printSystem(`URL:      ${cfg.url}`);
        this.printSystem(`Model:    ${cfg.model}`);
        this.printSystem(`Language: ${cfg.lang}`);
        this.printSystem(`API Key:  ${'*'.repeat(cfg.key.length > 8 ? 8 : cfg.key.length)}${cfg.key.slice(-4)}`);
      },
      CLEAR: function () {
        localStorage.removeItem('jarvis_name');
        localStorage.removeItem('jarvis_url');
        localStorage.removeItem('jarvis_key');
        localStorage.removeItem('jarvis_model');
        localStorage.removeItem('jarvis_lang');
        this.printSuccess('Configuration and API keys cleared.');
      }
    },
    commands: {
      SET: function () {
        openSettingsModal(this);
      },

      LANGS: async function () {
        this.printSystem('Fetching available languages...');
        try {
          const res = await fetch('https://restcountries.com/v3.1/all?fields=name,languages');
          if (!res.ok) throw new Error('Failed to fetch data');
          const data = await res.json();
          const langSet = new Set();
          data.forEach(country => {
            if (country.languages) Object.values(country.languages).forEach(lang => langSet.add(lang));
          });
          const sortedLangs = Array.from(langSet).sort();
          this.printSystem(`[+] Found ${sortedLangs.length} unique languages.`);
          this.printSystem('Use standard codes like en-US, es-ES, hi-IN.');
          this.printSystem('----------------------------------------');
          const popular = ['English', 'Bengali', 'Hindi', 'Spanish', 'French', 'German', 'Arabic', 'Chinese', 'Japanese', 'Russian', 'Portuguese'];
          popular.forEach(p => { if (sortedLangs.includes(p)) this.printSystem(`  - ${p}`); });
          this.printSystem('----------------------------------------');
          this.printSystem('For full list search "ISO language codes".');
        } catch (e) {
          this.printError('API Error: ' + e.message);
        }
      },

      VOICE: function () {
        const cfg = getConfig();
        if (!cfg.key) return this.printError('Run ai.set first to configure your AI.');
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return this.printError('VOICE NOT SUPPORTED ON THIS BROWSER.');
        const recognition = new SpeechRecognition();
        recognition.lang = cfg.lang;
        recognition.onresult = (event) => {
          const speechResult = event.results[0][0].transcript;
          this.printSystem(`[VOICE INPUT]: "${speechResult}"`);
          askAI(this, speechResult);
        };
        recognition.onerror = (e) => this.printError('VOICE ERROR: ' + e.error);
        this.printSystem(`[*] Listening in ${cfg.lang}...`);
        recognition.start();
      },

      CHAT: function () { enterChatMode(this); },
      AI: function () { enterChatMode(this); }
    },
    modes: {
      jarvis: {
        onInput: async function (session, input) {
          session.print(session.promptEl.innerHTML + ' ' + T.Utils.escapeHTML(input), true);
          const trimmed = input.trim();

          if (trimmed === 'exit' || trimmed === 'quit') {
            if (session.opts && session.opts.scope === 'pkg') {
              session.requestExit();
              return;
            }
            session.mode = 'shell';
            session.promptPrefix = '';
            session.updatePrompt();
            return;
          }

          await askAI(session, trimmed);
        }
      }
    }
  });
})();