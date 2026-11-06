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

  function cmdWeb(session, arg) {
    const url = strip(arg) || currentUrl;
    if (!url) throw new Error('Usage: web{https://example.com}');
    if (!/^https?:\/\//i.test(url)) throw new Error('INVALID URL');

    const zIdx = (window._zCounter || 100) + 1;
    window._zCounter = zIdx;

    const win = document.createElement('div');
    win.style.cssText = `position:fixed;z-index:${zIdx};left:${60 + Math.random()*80}px;top:${60 + Math.random()*80}px;width:82vw;height:72vh;max-width:900px;background:#fff;border:2px solid #2563eb;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden;`;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 10px;background:#2563eb;color:#fff;font-size:12px;font-weight:bold;cursor:move;user-select:none;';

    const title = document.createElement('span');
    title.textContent = url;
    title.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

    const btnOpen = document.createElement('button');
    btnOpen.textContent = '↗';
    btnOpen.style.cssText = 'background:transparent;border:1px solid #fff;color:#fff;font-size:13px;cursor:pointer;padding:1px 6px;border-radius:3px;line-height:1;';
    btnOpen.onclick = (e) => { e.stopPropagation(); window.open(url, '_blank', 'noopener,noreferrer'); };

    const btnClose = document.createElement('button');
    btnClose.textContent = '✕';
    btnClose.style.cssText = 'background:transparent;border:none;color:#fff;font-size:16px;cursor:pointer;padding:0 4px;line-height:1;';
    btnClose.onclick = (e) => { e.stopPropagation(); win.remove(); };

    header.appendChild(title); header.appendChild(btnOpen); header.appendChild(btnClose);
    win.appendChild(header);

    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.cssText = 'flex:1;border:0;width:100%;background:#fff;';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    win.appendChild(iframe);

    let dragging = false, sx, sy, ox, oy;
    header.addEventListener('mousedown', (e) => {
      if (e.target === btnOpen || e.target === btnClose) return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      const r = win.getBoundingClientRect(); ox = r.left; oy = r.top;
      e.preventDefault();
    });
    header.addEventListener('touchstart', (e) => {
      if (e.target === btnOpen || e.target === btnClose) return;
      const p = e.touches[0];
      dragging = true; sx = p.clientX; sy = p.clientY;
      const r = win.getBoundingClientRect(); ox = r.left; oy = r.top;
    }, { passive: true });
    const onMove = (cx, cy) => { if (!dragging) return; win.style.left = (ox + cx - sx) + 'px'; win.style.top = (oy + cy - sy) + 'px'; };
    document.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    document.addEventListener('touchmove', (e) => { if (dragging) onMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    document.addEventListener('mouseup', () => { dragging = false; });
    document.addEventListener('touchend', () => { dragging = false; });

    document.body.appendChild(win);
    session.printSuccess('Web view opened.');
    session.printSystem('Some sites block iframe embedding — use ↗ to open in a real tab.');
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
      WEB: 'Open URL in floating window',
      IP: 'Show own IP info'
    },
    routes: [
      { pattern: /^(get|post|put|patch|delete)\{(https?:\/\/[^}]+)\}(?:\s*\{([\s\S]*)\})?$/i, handler: 'DIRECT' }
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
      IP: function() { return cmdIp(this); }
    }
  });
})();