(function () {
  'use strict';
  const T = Terminal;
  let currentUrl = '';

  function strip(s) { return String(s || '').trim(); }

  function cmdUrl(session, arg) {
    const url = strip(arg);
    if (!url) {
      if (!currentUrl) session.printSystem('(no URL set)');
      else session.printSystem('URL: ' + currentUrl);
      return;
    }
    if (!/^https?:\/\//i.test(url)) throw new Error('INVALID URL (must start with http:// or https://)');
    currentUrl = url;
    session.printSuccess('URL set: ' + url);
  }

  async function doRequest(session, method, bodyArg) {
    if (!currentUrl) throw new Error('NO URL SET. Use url{https://...} first.');
    const options = { method };
    if (['POST', 'PUT', 'PATCH'].includes(method) && bodyArg) {
      const body = strip(bodyArg);
      if (body) {
        options.body = body;
        try { JSON.parse(body); options.headers = { 'Content-Type': 'application/json' }; }
        catch (e) { options.headers = { 'Content-Type': 'text/plain' }; }
      }
    }
    session.printSystem(`Sending ${method} → ${currentUrl}`);
    try {
      const res = await fetch(currentUrl, options);
      const text = await res.text();
      session.printSystem(`Status: ${res.status} ${res.statusText}`);
      session.printSystem('Response:');
      session.print(text);
    } catch (e) { session.printError('FETCH ERROR: ' + e.message); }
  }

  async function directRequest(session, method, url, bodyArg) {
    if (!url || !/^https?:\/\//i.test(url)) throw new Error('INVALID URL');
    const options = { method };
    if (['POST', 'PUT', 'PATCH'].includes(method) && bodyArg) {
      const body = strip(bodyArg);
      if (body) {
        options.body = body;
        try { JSON.parse(body); options.headers = { 'Content-Type': 'application/json' }; }
        catch (e) { options.headers = { 'Content-Type': 'text/plain' }; }
      }
    }
    session.printSystem(`Sending ${method} → ${url}`);
    try {
      const res = await fetch(url, options);
      const text = await res.text();
      session.printSystem(`Status: ${res.status} ${res.statusText}`);
      session.printSystem('Response:');
      session.print(text);
    } catch (e) { session.printError('FETCH ERROR: ' + e.message); }
  }

  async function cmdLode(session, arg) {
    const url = strip(arg);
    if (!url) throw new Error('Usage: lode{url}');
    if (!/^https?:\/\//i.test(url)) throw new Error('INVALID URL');
    
    session.printSystem('Downloading: ' + url);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const filename = url.split('/').pop().split('?')[0] || 'download';
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      session.printSuccess('Downloaded: ' + filename);
    } catch (e) {
      session.printError('Download failed: ' + e.message);
    }
  }

  function isValidIP(ip) {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/.test(ip);
  }

  async function cmdIpLookup(session, ip) {
    ip = strip(ip);
    if (!ip) return cmdIp(session);
    if (!isValidIP(ip)) throw new Error('INVALID IP ADDRESS FORMAT');
    
    session.printSystem('Fetching IP info for ' + ip + '...');
    try {
      const res = await fetch('https://ipapi.co/' + ip + '/json/');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data.error) throw new Error(data.reason || 'Lookup failed');
      session.printSystem('IP:       ' + (data.ip || 'N/A'));
      session.printSystem('City:     ' + (data.city || 'N/A'));
      session.printSystem('Region:   ' + (data.region || 'N/A'));
      session.printSystem('Country:  ' + (data.country_name || 'N/A') + ' (' + (data.country_code || '?') + ')');
      session.printSystem('Postal:   ' + (data.postal || 'N/A'));
      session.printSystem('ISP:      ' + (data.org || 'N/A'));
      session.printSystem('Timezone: ' + (data.timezone || 'N/A'));
      session.printSystem('Lat/Lon:  ' + (data.latitude || '?') + ', ' + (data.longitude || '?'));
    } catch (e) {
      session.printError('IP LOOKUP ERROR: ' + e.message);
    }
  }

  function cmdWeb(session, arg) {
    const url = strip(arg) || currentUrl;
    if (!url) throw new Error('Usage: web{https://example.com}');
    if (!/^https?:\/\//i.test(url)) throw new Error('INVALID URL');

    const zIdx = (window._zCounter || 100) + 1;
    window._zCounter = zIdx;

    const win = document.createElement('div');
    win.style.cssText = `position:fixed;z-index:${zIdx};left:50px;top:80px;width:340px;height:400px;background:#02120a;border:1px solid #1e3a8a;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.6);display:flex;flex-direction:column;overflow:hidden;min-width:180px;min-height:120px;`;
    
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 10px;background:#031a0e;color:#00d8ff;font-size:11px;font-family:monospace;font-weight:bold;cursor:move;user-select:none;border-bottom:1px solid #1e3a8a;flex-shrink:0;';

    const title = document.createElement('span');
    title.textContent = url;
    title.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:4px;align-items:center;';

    const btnMinus = document.createElement('button');
    btnMinus.textContent = '-';
    btnMinus.style.cssText = 'background:transparent;border:1px solid currentColor;color:#00d8ff;font-size:12px;cursor:pointer;width:20px;height:20px;border-radius:3px;display:flex;align-items:center;justify-content:center;opacity:0.7;';
    btnMinus.onmousedown = (e) => e.stopPropagation();
    btnMinus.ontouchstart = (e) => e.stopPropagation();
    btnMinus.onclick = (e) => { e.stopPropagation(); win.style.width = Math.max(180, win.offsetWidth - 40) + 'px'; win.style.height = Math.max(120, win.offsetHeight - 40) + 'px'; };

    const btnPlus = document.createElement('button');
    btnPlus.textContent = '+';
    btnPlus.style.cssText = 'background:transparent;border:1px solid currentColor;color:#00d8ff;font-size:12px;cursor:pointer;width:20px;height:20px;border-radius:3px;display:flex;align-items:center;justify-content:center;opacity:0.7;';
    btnPlus.onmousedown = (e) => e.stopPropagation();
    btnPlus.ontouchstart = (e) => e.stopPropagation();
    btnPlus.onclick = (e) => { e.stopPropagation(); win.style.width = (win.offsetWidth + 40) + 'px'; win.style.height = (win.offsetHeight + 40) + 'px'; };

    const btnOpen = document.createElement('button');
    btnOpen.textContent = '↗';
    btnOpen.style.cssText = 'background:transparent;border:1px solid currentColor;color:#00d8ff;font-size:12px;cursor:pointer;width:20px;height:20px;border-radius:3px;display:flex;align-items:center;justify-content:center;opacity:0.7;';
    btnOpen.onmousedown = (e) => e.stopPropagation();
    btnOpen.ontouchstart = (e) => e.stopPropagation();
    btnOpen.onclick = (e) => { e.stopPropagation(); window.open(url, '_blank', 'noopener,noreferrer'); };

    const btnClose = document.createElement('button');
    btnClose.textContent = '×';
    btnClose.style.cssText = 'background:transparent;border:1px solid currentColor;color:#00d8ff;font-size:14px;cursor:pointer;width:20px;height:20px;border-radius:3px;display:flex;align-items:center;justify-content:center;opacity:0.7;';
    btnClose.onmousedown = (e) => e.stopPropagation();
    btnClose.ontouchstart = (e) => e.stopPropagation();
    btnClose.onclick = (e) => { e.stopPropagation(); win.remove(); };

    controls.appendChild(btnMinus); controls.appendChild(btnPlus); controls.appendChild(btnOpen); controls.appendChild(btnClose);
    header.appendChild(title); header.appendChild(controls);
    win.appendChild(header);

    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.cssText = 'flex:1;border:0;width:100%;background:#fff;';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    win.appendChild(iframe);

    // Drag logic fixed to target the header container, ignoring buttons
    let dragging = false, sx, sy, ox, oy;
    const startDrag = (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const p = e.touches ? e.touches[0] : e;
      dragging = true; sx = p.clientX; sy = p.clientY;
      const r = win.getBoundingClientRect(); ox = r.left; oy = r.top;
      e.preventDefault();
    };
    header.addEventListener('mousedown', startDrag);
    header.addEventListener('touchstart', startDrag, { passive: false });
    
    const onMove = (ev) => {
      if (!dragging) return;
      const pt = ev.touches ? ev.touches[0] : ev;
      win.style.left = (ox + pt.clientX - sx) + 'px'; 
      win.style.top = (oy + pt.clientY - sy) + 'px';
    };
    const endDrag = () => { dragging = false; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', endDrag);
    
    document.body.appendChild(win);
  }

  async function cmdIp(session) {
    session.printSystem('Fetching IP info from ipapi.co...');
    try {
      const res = await fetch('https://ipapi.co/json/');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      session.printSystem('IP:       ' + (data.ip || 'N/A'));
      session.printSystem('City:     ' + (data.city || 'N/A'));
      session.printSystem('Region:   ' + (data.region || 'N/A'));
      session.printSystem('Country:  ' + (data.country_name || 'N/A') + ' (' + (data.country_code || '?') + ')');
      session.printSystem('Postal:   ' + (data.postal || 'N/A'));
      session.printSystem('ISP:      ' + (data.org || 'N/A'));
      session.printSystem('Timezone: ' + (data.timezone || 'N/A'));
      session.printSystem('Lat/Lon:  ' + (data.latitude || '?') + ', ' + (data.longitude || '?'));
    } catch (e) { session.printError('IP FETCH ERROR: ' + e.message); }
  }

  T.registerExtension({
    name: 'internet',
    info: 'Internet master key loaded.',
    descriptions: {
      URL: 'Set target URL (url{https://...})',
      GET: 'GET current URL (or get{https://...})',
      POST: 'POST body (post {body})',
      PUT: 'PUT body (put {body})',
      PATCH: 'PATCH body (patch {body})',
      DELETE: 'DELETE current URL',
      WEB: 'Open URL in floating mini window (web{url})',
      IP: 'Show own IP (ip) or lookup specific IP (IP{1.1.1.1})',
      LODE: 'Download a file from URL (lode{url})'
    },
    routes: [
      { pattern: /^(get|post|put|patch|delete)\{(https?:\/\/[^}]+)\}(?:\s*\{([\s\S]*)\})?$/i, handler: 'DIRECT' },
      { pattern: /^IP\{\s*([^}]+?)\s*\}$/i, handler: 'IP_LOOKUP' }
    ],
    commands: {
      URL: function(arg) { return cmdUrl(this, arg); },
      GET: function(arg) {
        if (arg && /^https?:\/\//i.test(strip(arg))) return directRequest(this, 'GET', strip(arg), null);
        return doRequest(this, 'GET');
      },
      POST: function(arg) {
        if (arg && /^https?:\/\//i.test(strip(arg))) return directRequest(this, 'POST', strip(arg), null);
        return doRequest(this, 'POST', arg);
      },
      PUT: function(arg) {
        if (arg && /^https?:\/\//i.test(strip(arg))) return directRequest(this, 'PUT', strip(arg), null);
        return doRequest(this, 'PUT', arg);
      },
      PATCH: function(arg) {
        if (arg && /^https?:\/\//i.test(strip(arg))) return directRequest(this, 'PATCH', strip(arg), null);
        return doRequest(this, 'PATCH', arg);
      },
      DELETE: function(arg) {
        if (arg && /^https?:\/\//i.test(strip(arg))) return directRequest(this, 'DELETE', strip(arg), null);
        return doRequest(this, 'DELETE');
      },
      DIRECT: function(captures) {
        if (!Array.isArray(captures)) return;
        const [method, url, body] = captures;
        return directRequest(this, String(method).toUpperCase(), url, body || null);
      },
      WEB: function(arg) { return cmdWeb(this, arg); },
      IP: function() { return cmdIp(this); },
      IP_LOOKUP: function(ip) { return cmdIpLookup(this, ip); },
      LODE: function(arg) { return cmdLode(this, arg); },
      LOAD: function(arg) { return cmdLode(this, arg); }
    }
  });
})();