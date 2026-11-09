'use strict';

const FONT_FAMILIES = {
  mono:"ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace",
  courier:"'Courier New',Courier,monospace",
  consolas:"Consolas,Monaco,'Courier New',monospace",
  monaco:"Monaco,Consolas,'Courier New',monospace",
  menlo:"Menlo,Monaco,Consolas,'Courier New',monospace",
  lucida:"'Lucida Console',Monaco,monospace",
  source:"'Source Code Pro',ui-monospace,monospace",
  fira:"'Fira Code',ui-monospace,monospace",
  jetbrains:"'JetBrains Mono',ui-monospace,monospace",
  roboto:"'Roboto Mono',ui-monospace,monospace",
  ibmplex:"'IBM Plex Mono',ui-monospace,monospace",
  space:"'Space Mono',ui-monospace,monospace",
  inconsolata:"Inconsolata,ui-monospace,monospace",
  vt323:"'VT323',ui-monospace,monospace",
  sharetech:"'Share Tech Mono',ui-monospace,monospace",
  ubuntu:"'Ubuntu Mono',ui-monospace,monospace",
  anonymous:"'Anonymous Pro',ui-monospace,monospace"
};
const FONT_LABELS = {
  mono:'Monospace (default)', courier:'Courier New', consolas:'Consolas', monaco:'Monaco', menlo:'Menlo',
  lucida:'Lucida Console', source:'Source Code Pro', fira:'Fira Code', jetbrains:'JetBrains Mono',
  roboto:'Roboto Mono', ibmplex:'IBM Plex Mono', space:'Space Mono', inconsolata:'Inconsolata',
  vt323:'VT323 (terminal)', sharetech:'Share Tech Mono', ubuntu:'Ubuntu Mono', anonymous:'Anonymous Pro'
};

const EXECUTABLE_EXT = /\.(exe|dll|so|dylib|com|scr|msi|apk|ipa|bin|dat|jar|war|appimage|dmg|pkg|deb|rpm|app|cmd)$/i;
const NATIVE_SCRIPT_EXT = /\.(sh|bash|zsh|fish|bat|ps1|psm1|vbs|vbe|wsf|wsh|hta|jse)$/i;
const ACTIVE_HTML_EXT = /\.(html?|htm|svg|xhtml|xht|xml|xsl|xslt|rss|atom)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp|ico|tiff?|heic|avif)$/i;
const DOC_BINARY_EXT = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp)$/i;
const MEDIA_EXT = /\.(mp3|mp4|wav|ogg|webm|mov|avi|mkv|flac|m4a|m4v)$/i;
const FONT_EXT = /\.(woff2?|ttf|otf|eot)$/i;
const ARCHIVE_EXT = /\.(zip)$/i;

const Utils = {
  escapeHTML(s) {
    return String(s).replace(/[&<>'"]/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[c]));
  },
  escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },
  generateId() {
    return Math.random().toString(36).substring(2, 9);
  },
  resolvePath(cwd, p) {
    if (!p) return cwd;
    const parts = p.startsWith('/') ? p.split('/') : cwd.split('/').concat(p.split('/'));
    const r = [];
    for (const x of parts) {
      if (!x || x === '.') continue;
      if (x === '..') { if (r.length) r.pop(); }
      else r.push(x);
    }
    return '/' + r.join('/');
  },
  basename(p) {
    const s = String(p || '').replace(/^\/+|\/+$/g, '');
    if (!s) return '';
    const parts = s.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  },
  formatSize(b) {
    if (!b) return '0 B';
    const k = 1024, u = ['B','KB','MB','GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return (b / Math.pow(k, i)).toFixed(2) + ' ' + u[i];
  },
  truncate(s, n = 2000) {
    const x = String(s);
    return x.length > n ? x.slice(0, n) + '...' : x;
  },
  cleanName(s) {
    return String(s || '')
      .normalize('NFC')
      .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
      .trim();
  },
  async blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },
  async isBinaryFile(file) {
    if (IMAGE_EXT.test(file.name) || DOC_BINARY_EXT.test(file.name) ||
        MEDIA_EXT.test(file.name) || FONT_EXT.test(file.name) ||
        ARCHIVE_EXT.test(file.name)) return true;
    try {
      const slice = await file.slice(0, 512).arrayBuffer();
      const bytes = new Uint8Array(slice);
      for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0) return true;
    } catch (e) {}
    return false;
  }
};

function createCustomSelect(options, initialValue, onChange) {
  const wrap = document.createElement('div');
  wrap.style.position = 'relative'; wrap.style.width = '100%';

  const trigger = document.createElement('div');
  trigger.className = 'custom-select-trigger';
  trigger.style.cssText = 'padding:8px; border:1px solid var(--line-2); background:var(--bg-1); color:var(--green); cursor:pointer; display:flex; justify-content:space-between; align-items:center; font-size:12px; font-family:var(--term-font); transition:all 0.2s;';
  trigger.onmouseenter = () => { trigger.style.boxShadow = 'var(--glow-green)'; trigger.style.borderColor = 'var(--green)'; };
  trigger.onmouseleave = () => { trigger.style.boxShadow = 'none'; trigger.style.borderColor = 'var(--line-2)'; };

  const label = document.createElement('span');
  const currentOpt = options.find(o => o.value === initialValue) || options[0];
  label.textContent = currentOpt ? currentOpt.label : initialValue;
  label.style.fontFamily = currentOpt && currentOpt.fontFamily ? currentOpt.fontFamily : 'inherit';

  const arrow = document.createElement('span');
  arrow.innerHTML = '&#9662;';
  arrow.style.fontSize = '0.8em';

  trigger.appendChild(label);
  trigger.appendChild(arrow);

  let selectedValue = initialValue;

  trigger.onclick = (e) => {
    e.stopPropagation();

    const overlay = document.createElement('div');
    overlay.className = 'custom-select-overlay';

    const list = document.createElement('div');
    list.className = 'custom-select-list';

    const title = document.createElement('div');
    title.className = 'custom-select-title';
    title.textContent = 'SELECT OPTION';
    list.appendChild(title);

    options.forEach(opt => {
      const item = document.createElement('div');
      item.className = 'custom-select-item';
      item.textContent = opt.label;
      item.onclick = (ev) => {
        ev.stopPropagation();
        selectedValue = opt.value;
        label.textContent = opt.label;
        label.style.fontFamily = opt.fontFamily || 'inherit';
        if (onChange) onChange(selectedValue);
        overlay.remove();
      };
      list.appendChild(item);
    });

    overlay.onclick = (ev) => { if (ev.target === overlay) overlay.remove(); };
    overlay.appendChild(list);
    document.body.appendChild(overlay);
  };

  wrap.appendChild(trigger);

  return {
    wrap,
    getValue: () => selectedValue,
    setValue: (v) => {
      selectedValue = v;
      const o = options.find(x => x.value === v);
      if (o) {
        label.textContent = o.label;
        label.style.fontFamily = o.fontFamily || 'inherit';
      }
    }
  };
}

window.FONT_FAMILIES = FONT_FAMILIES;
window.FONT_LABELS = FONT_LABELS;
window.Utils = Utils;
window.createCustomSelect = createCustomSelect;