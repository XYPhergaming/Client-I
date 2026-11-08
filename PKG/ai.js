(function () {
  'use strict';
  const T = Terminal;

  function getConfig() {
    return {
      name: localStorage.getItem('jarvis_name') || 'JARVIS',
      url: localStorage.getItem('jarvis_url') || '',
      key: localStorage.getItem('jarvis_key') || '',
      model: localStorage.getItem('jarvis_model') || '',
      lang: localStorage.getItem('jarvis_lang') || 'en-US'
    };
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
      return session.printError('CONFIGURATION MISSING. Use: ai.SETTING{Name, URL, Key, Model, Language}');
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
    session.promptPrefix = 'jarvis> ';
    session.updatePrompt();
    session.printSystem(`Chatting with ${getConfig().name}. Type "exit" to quit.`);
  }

  T.registerExtension({
    name: 'ai',
    info: 'AI Assistant package. Use RUN{ai} or ai.SETTING to configure.',
    descriptions: {
      SETTING: 'Configure AI. Format: ai.SETTING{Name, URL, Key, Model, Language}',
      LANGS:   'Fetch available languages',
      VOICE:   'Activate microphone for voice commands',
      CHAT:    'Enter chat mode (ai.CHAT)',
      AI:      'Enter chat mode (same as CHAT)',
      INFO:    'Show current AI configuration (use ai.INFO)',
      CLEAR:   'Clear saved API keys (use ai.CLEAR)'
    },
    run: function () {
      enterChatMode(this);
    },
    scopedOnly: {
      INFO: function () {
        const cfg = getConfig();
        if (!cfg.url) return this.printSystem('No AI configured yet. Use ai.SETTING.');
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
      SETTING: function (arg) {
        if (!arg.trim()) {
          return this.printSystem('Usage: ai.SETTING{Name, URL, Key, Model, Language}\nExample: ai.SETTING{Friday, https://api.openai.com/v1/chat/completions, sk-xxx, gpt-3.5-turbo, en-US}');
        }
        const parts = arg.split(',').map(s => s.trim());
        if (parts.length < 5) {
          return this.printError('INVALID FORMAT. Please provide exactly 5 parameters separated by commas.');
        }
        const [name, url, key, model, lang] = parts;
        localStorage.setItem('jarvis_name', name);
        localStorage.setItem('jarvis_url', url);
        localStorage.setItem('jarvis_key', key);
        localStorage.setItem('jarvis_model', model);
        localStorage.setItem('jarvis_lang', lang);
        this.printSuccess(`[+] AI configured successfully as "${name}"!`);
        this.printSystem(`URL:      ${url}`);
        this.printSystem(`Model:    ${model}`);
        this.printSystem(`Language: ${lang}`);
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
        if (!cfg.key) return this.printError('Run ai.SETTING first to configure your AI.');
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