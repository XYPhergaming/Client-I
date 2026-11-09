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
    session.printSystem(`Sending ${method} -> ${currentUrl}`);
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
    session.printSystem(`Sending ${method} -> ${url}`);
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
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      session.printSuccess('Downloaded: ' + filename);
    } catch (e) { session.printError('Download failed: ' + e.message); }
  }

  function isValidIP(ip) {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4})$/.test(ip);
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
    } catch (e) { session.printError('IP LOOKUP ERROR: ' + e.message); }
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

  function cmdWeb(session, arg) {
    const url = strip(arg) || currentUrl;
    if (!url) throw new Error('Usage: web{https://example.com}');
    if (!/^https?:\/\//i.test(url)) throw new Error('INVALID URL');
    const zIdx = (window._zCounter || 100) + 1;
    window._zCounter = zIdx;
    
    const win = document.createElement('div');
    win.style.cssText = `position:fixed;z-index:${zIdx};left:50px;top:80px;width:340px;height:400px;background:#fff;border:1px solid #374151;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.6);display:flex;flex-direction:column;overflow:hidden;`;
    
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:8px; padding:4px 8px; cursor:move; user-select:none; flex-shrink:0; background:#374151; color:#f3f4f6; border-bottom:1px solid #1f2937; font-family:monospace; font-size:11px; font-weight:bold;';
    
    const title = document.createElement('span');
    title.textContent = url;
    title.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:4px;';
    
    const btnOpen = document.createElement('button');
    btnOpen.textContent = 'O';
    btnOpen.style.cssText = 'background:transparent;border:1px solid currentColor;color:#00d8ff;width:20px;height:20px;border-radius:3px;cursor:pointer;';
    btnOpen.onclick = (e) => { e.stopPropagation(); window.open(url, '_blank', 'noopener,noreferrer'); };
    
    const btnClose = document.createElement('button');
    btnClose.textContent = 'X';
    btnClose.style.cssText = 'background:transparent;border:1px solid currentColor;color:#00d8ff;width:20px;height:20px;border-radius:3px;cursor:pointer;';
    btnClose.onclick = (e) => { e.stopPropagation(); win.remove(); };
    
    controls.appendChild(btnOpen); 
    controls.appendChild(btnClose);
    header.appendChild(title); 
    header.appendChild(controls);
    
    win.appendChild(header);
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.cssText = 'flex:1;border:0;width:100%;background:#fff;';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
    win.appendChild(iframe);
    
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
      { pattern: /^(get|post|put|patch|delete)\{(https?:\/\/[^}]+)\}(?:\s*\{([\s\S]*)\})?$/i, handler: 'DIRECT' }
    ],
    commands: {
      URL: function(arg) { return cmdUrl(this, arg); },
      GET: function(arg) {
        const a = strip(arg);
        if (a && /^https?:\/\//i.test(a)) return directRequest(this, 'GET', a, null);
        return doRequest(this, 'GET');
      },
      POST: function(arg) {
        const a = strip(arg);
        if (a && /^https?:\/\//i.test(a)) return directRequest(this, 'POST', a, null);
        return doRequest(this, 'POST', arg);
      },
      PUT: function(arg) {
        const a = strip(arg);
        if (a && /^https?:\/\//i.test(a)) return directRequest(this, 'PUT', a, null);
        return doRequest(this, 'PUT', arg);
      },
      PATCH: function(arg) {
        const a = strip(arg);
        if (a && /^https?:\/\//i.test(a)) return directRequest(this, 'PATCH', a, null);
        return doRequest(this, 'PATCH', arg);
      },
      DELETE: function(arg) {
        const a = strip(arg);
        if (a && /^https?:\/\//i.test(a)) return directRequest(this, 'DELETE', a, null);
        return doRequest(this, 'DELETE');
      },
      DIRECT: function(captures) {
        if (!Array.isArray(captures)) return;
        const [method, url, body] = captures;
        return directRequest(this, String(method).toUpperCase(), url, body || null);
      },
      WEB: function(arg) { return cmdWeb(this, arg); },
      IP: function(arg) {
        const t = strip(arg);
        if (t) return cmdIpLookup(this, t);
        return cmdIp(this);
      },
      LODE: function(arg) { return cmdLode(this, arg); },
      LOAD: function(arg) { return cmdLode(this, arg); }
    }
  });
})();