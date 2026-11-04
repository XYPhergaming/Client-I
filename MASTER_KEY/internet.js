(function () {
  'use strict';
  const T = Terminal;

  async function handleInternetCmd(session, method, url, bodyArg) {
    if (!url) {
      session.printError('INVALID URL');
      return;
    }
    
    const cleanUrl = url.replace(/^\{|\}$/g, '').trim();
    if (!cleanUrl) {
      session.printError('INVALID URL');
      return;
    }

    let body = null;
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      if (!bodyArg) {
        session.printError('BODY REQUIRED FOR ' + method);
        return;
      }
      body = bodyArg.trim();
    }

    session.printSystem(`Sending ${method} request to ${cleanUrl}...`);
    try {
      const options = { method };
      if (body) {
        options.body = body;
        try {
          JSON.parse(body);
          options.headers = { 'Content-Type': 'application/json' };
        } catch (e) {
          options.headers = { 'Content-Type': 'text/plain' };
        }
      }
      
      const res = await fetch(cleanUrl, options);
      const text = await res.text();
      
      session.printSystem(`Status: ${res.status} ${res.statusText}`);
      session.printSystem('Response:');
      session.print(text);
    } catch (e) {
      session.printError('FETCH ERROR: ' + e.message);
    }
  }

  const originalCommands = T.commands;
  T.commands = new Proxy(originalCommands, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);

      const cleanProp = prop.replace(/^INTERNET\./i, '');

      const match = cleanProp.match(/^(GET|POST|PUT|PATCH|DELETE)\{(.*)\}$/i);
      if (match) {
        const method = match[1].toUpperCase();
        const url = match[2];
        return function(arg) {
          return handleInternetCmd(this, method, url, arg);
        };
      }

      if (/^(GET|POST|PUT|PATCH|DELETE)$/i.test(cleanProp)) {
        const method = cleanProp.toUpperCase();
        return function(arg) {
          let url = '';
          let body = '';
          const m = arg.match(/^\{(.*?)\}(.*)$/);
          if (m) {
            url = m[1];
            body = m[2].trim();
          } else {
            const parts = arg.split(' ');
            url = parts[0];
            body = parts.slice(1).join(' ');
          }
          return handleInternetCmd(this, method, url, body);
        };
      }

      return Reflect.get(target, prop, receiver);
    }
  });

  T.registerExtension({
    name: 'internet',
    info: 'Internet Master Key imported successfully! Use internet.GET{...} etc.'
  });
})();