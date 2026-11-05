(function () {
  'use strict';
  const T = Terminal;

  function printHeader(session, title) {
    session.printSystem('\n+--------------------------------------------------------------+');
    session.printSystem('|  ' + title.padEnd(58) + '  |');
    session.printSystem('+--------------------------------------------------------------+');
  }

  function printRow(session, key, value, status = '') {
    let valStr = String(value);
    if (valStr.length > 40) valStr = valStr.substring(0, 37) + '...';
    const statusStr = status ? ` [${status}]` : '';
    session.printSystem(`  ${key.padEnd(25)} : ${valStr}${statusStr}`);
  }

  function getOS(ua) {
    if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
    if (/Windows NT 6\.3/.test(ua)) return 'Windows 8.1';
    if (/Windows NT 6\.1/.test(ua)) return 'Windows 7';
    if (/Mac OS X/.test(ua)) return 'macOS';
    if (/Android/.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
    if (/Linux/.test(ua)) return 'Linux';
    return 'UNAVAILABLE';
  }

  function getBrowser(ua) {
    if (/Edg\//.test(ua)) return 'Microsoft Edge';
    if (/OPR\//.test(ua) || /Opera/.test(ua)) return 'Opera';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Safari\//.test(ua)) return 'Safari';
    return 'Unknown Browser';
  }

  async function showDevice(session) {
    printHeader(session, 'DEVICE INFORMATION');
    const ua = navigator.userAgent;
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua);
    const type = isMobile ? (/(iPad|Tablet)/i.test(ua) ? 'Tablet' : 'Mobile') : 'Desktop';

    printRow(session, 'Device Type', type);
    printRow(session, 'OS', getOS(ua));
    printRow(session, 'CPU Cores', navigator.hardwareConcurrency || 'UNAVAILABLE');
    printRow(session, 'Architecture', navigator.userAgentData ? (navigator.userAgentData.platform || 'UNAVAILABLE') : 'UNAVAILABLE');

    if (navigator.deviceMemory) {
      printRow(session, 'Device Memory', navigator.deviceMemory + ' GB', 'ESTIMATED');
    } else {
      printRow(session, 'Device Memory', 'UNAVAILABLE', 'UNSUPPORTED');
    }

    printRow(session, 'Touch Support', navigator.maxTouchPoints > 0 ? 'YES' : 'NO');
    if (navigator.maxTouchPoints > 0) {
      printRow(session, 'Max Touch Points', navigator.maxTouchPoints);
    }

    if (navigator.getBattery) {
      try {
        const battery = await navigator.getBattery();
        printRow(session, 'Battery Level', Math.round(battery.level * 100) + '%');
        printRow(session, 'Charging', battery.charging ? 'YES (Plugged In)' : 'NO (On Battery)');
      } catch (e) {
        printRow(session, 'Battery', 'UNAVAILABLE', 'ERROR');
      }
    } else {
      printRow(session, 'Battery', 'UNAVAILABLE', 'UNSUPPORTED');
    }
  }

  function showBrowser(session) {
    printHeader(session, 'BROWSER INTELLIGENCE');
    const ua = navigator.userAgent;

    printRow(session, 'Browser', getBrowser(ua));
    printRow(session, 'Language', navigator.language || 'UNAVAILABLE');
    printRow(session, 'Languages', (navigator.languages || []).join(', ') || 'UNAVAILABLE');
    printRow(session, 'Cookies Enabled', navigator.cookieEnabled ? 'YES' : 'NO');
    printRow(session, 'JS Enabled', 'YES');
    printRow(session, 'Online Status', navigator.onLine ? 'ONLINE' : 'OFFLINE');
    printRow(session, 'Do Not Track', navigator.doNotTrack || 'Not Set');
    printRow(session, 'Timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
    printRow(session, 'Timezone Offset', new Date().getTimezoneOffset() + ' mins');
    printRow(session, 'User Agent', ua);
  }

  function showScreen(session) {
    printHeader(session, 'DISPLAY DIAGNOSTICS');

    printRow(session, 'Screen Resolution', `${screen.width} x ${screen.height}`);
    printRow(session, 'Available Screen', `${screen.availWidth} x ${screen.availHeight}`);
    printRow(session, 'Window Inner Size', `${window.innerWidth} x ${window.innerHeight}`);
    printRow(session, 'Device Pixel Ratio', window.devicePixelRatio || 1);
    printRow(session, 'Color Depth', screen.colorDepth + ' bit');
    printRow(session, 'Pixel Depth', screen.pixelDepth + ' bit');

    const orientation = screen.orientation ? screen.orientation.type : 'UNAVAILABLE';
    printRow(session, 'Orientation', orientation);

    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    printRow(session, 'Dark Mode Preference', isDark ? 'ENABLED' : 'DISABLED');

    const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    printRow(session, 'Reduced Motion', isReduced ? 'ENABLED' : 'DISABLED');

    printRow(session, 'Fullscreen', document.fullscreenElement ? 'ACTIVE' : 'INACTIVE');
  }

  function showNetwork(session) {
    printHeader(session, 'NETWORK DIAGNOSTICS');
    printRow(session, 'Online Status', navigator.onLine ? 'CONNECTED' : 'DISCONNECTED');

    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      printRow(session, 'Network Type', conn.type || 'UNAVAILABLE', 'ESTIMATED');
      printRow(session, 'Effective Type', conn.effectiveType || 'UNAVAILABLE');
      printRow(session, 'Downlink Speed', conn.downlink ? conn.downlink + ' Mbps' : 'UNAVAILABLE', 'ESTIMATED');
      printRow(session, 'Round-Trip Time (RTT)', conn.rtt ? conn.rtt + ' ms' : 'UNAVAILABLE');
      printRow(session, 'Save Data', conn.saveData ? 'ENABLED' : 'DISABLED');
    } else {
      printRow(session, 'Network Information API', 'UNAVAILABLE', 'UNSUPPORTED');
    }
  }

  function showPerformance(session) {
    printHeader(session, 'PERFORMANCE MONITOR');

    if (performance.getEntriesByType) {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav) {
        printRow(session, 'DNS Lookup Time', Math.round(nav.domainLookupEnd - nav.domainLookupStart) + ' ms');
        printRow(session, 'Server Response Time', Math.round(nav.responseEnd - nav.requestStart) + ' ms');
        printRow(session, 'DOM Content Loaded', Math.round(nav.domContentLoadedEventEnd - nav.startTime) + ' ms');
        printRow(session, 'Page Load Time', Math.round(nav.loadEventEnd - nav.startTime) + ' ms');
      } else {
        printRow(session, 'Navigation Metrics', 'UNAVAILABLE');
      }
    }

    try {
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      if (fcp) printRow(session, 'First Contentful Paint', Math.round(fcp.startTime) + ' ms');
      else printRow(session, 'First Contentful Paint', 'UNAVAILABLE');
    } catch(e) {}

    if (performance.memory) {
      printRow(session, 'JS Heap Size', (performance.memory.usedJSHeapSize / 1048576).toFixed(2) + ' MB');
      printRow(session, 'JS Heap Limit', (performance.memory.jsHeapSizeLimit / 1048576).toFixed(2) + ' MB');
    } else {
      printRow(session, 'JS Heap Size', 'UNAVAILABLE', 'UNSUPPORTED');
    }

    printRow(session, 'Page Uptime', Math.floor(performance.now() / 1000) + ' seconds');
  }

  function showGraphics(session) {
    printHeader(session, 'GRAPHICS DIAGNOSTICS');

    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

    if (gl) {
      printRow(session, 'WebGL Support', 'YES');
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        printRow(session, 'WebGL Vendor', gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL));
        printRow(session, 'WebGL Renderer', gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
      } else {
        printRow(session, 'WebGL Vendor', 'UNAVAILABLE', 'PRIVACY PROTECTED');
        printRow(session, 'WebGL Renderer', 'UNAVAILABLE', 'PRIVACY PROTECTED');
      }
      printRow(session, 'WebGL Version', gl.getParameter(gl.VERSION));
      printRow(session, 'Max Texture Size', gl.getParameter(gl.MAX_TEXTURE_SIZE) + ' px');
    } else {
      printRow(session, 'WebGL Support', 'NO', 'UNSUPPORTED');
    }

    if (navigator.gpu) {
      printRow(session, 'WebGPU Support', 'YES (API Available)');
    } else {
      printRow(session, 'WebGPU Support', 'NO', 'UNSUPPORTED');
    }

    const audioCtx = window.AudioContext || window.webkitAudioContext;
    printRow(session, 'Audio Context API', audioCtx ? 'SUPPORTED' : 'UNSUPPORTED');
  }

  async function showPermissions(session) {
    printHeader(session, 'PERMISSION INSPECTOR');

    if (!navigator.permissions) {
      printRow(session, 'Permissions API', 'UNAVAILABLE', 'UNSUPPORTED');
      return;
    }

    const permissions = ['camera', 'microphone', 'geolocation', 'notifications', 'clipboard-read', 'clipboard-write'];

    for (const perm of permissions) {
      try {
        const status = await navigator.permissions.query({ name: perm });
        let color = status.state === 'granted' ? 'GRANTED' : (status.state === 'denied' ? 'DENIED' : 'PROMPT');
        printRow(session, perm.toUpperCase(), color);
      } catch (e) {
        printRow(session, perm.toUpperCase(), 'UNAVAILABLE', 'UNSUPPORTED');
      }
    }
  }

  async function handleInfoCmd(session, cmd) {
    if (!cmd || cmd === 'INFO') {
      printHeader(session, 'KALMA - FULL DIAGNOSTICS REPORT');
      await showDevice(session);
      showBrowser(session);
      showScreen(session);
      showNetwork(session);
      showPerformance(session);
      showGraphics(session);
      await showPermissions(session);
      session.printSuccess('Diagnostics Complete. Note: Some fields may show UNAVAILABLE due to browser privacy policies.');
      return;
    }

    if (cmd === 'DEVICE') await showDevice(session);
    else if (cmd === 'BROWSER') showBrowser(session);
    else if (cmd === 'SCREEN') showScreen(session);
    else if (cmd === 'NETWORK') showNetwork(session);
    else if (cmd === 'PERFORMANCE' || cmd === 'PERF') showPerformance(session);
    else if (cmd === 'GRAPHICS') showGraphics(session);
    else if (cmd === 'PERMISSIONS') await showPermissions(session);
  }

  T.registerExtension({
    name: 'info',
    info: 'Device Info & Diagnostics Master Key imported successfully! Use info to see everything.',
    commands: {
      INFO: function() { return handleInfoCmd(this, 'INFO'); },
      INFO_DEVICE: function() { return handleInfoCmd(this, 'DEVICE'); },
      INFO_BROWSER: function() { return handleInfoCmd(this, 'BROWSER'); },
      INFO_SCREEN: function() { return handleInfoCmd(this, 'SCREEN'); },
      INFO_NETWORK: function() { return handleInfoCmd(this, 'NETWORK'); },
      INFO_PERFORMANCE: function() { return handleInfoCmd(this, 'PERFORMANCE'); },
      INFO_GRAPHICS: function() { return handleInfoCmd(this, 'GRAPHICS'); },
      INFO_PERMISSIONS: function() { return handleInfoCmd(this, 'PERMISSIONS'); }
    }
  });
})();