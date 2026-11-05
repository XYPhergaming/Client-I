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
    if (['POST', 'PUT', 'PATCH'].includes(method) && bodyArg) {
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
      // FIX: don't intercept after the extension is unregistered
      if (!T.extensions['internet']) return Reflect.get(target, prop, receiver);

      const cleanProp = prop.replace(/^INTERNET\./i, '');

      const match = cleanProp.match(/^(GET|POST|PUT|PATCH|DELETE)\{([\s\S]+?)\}(?:\s+([\s\S]*))?$/i);
      
      if (match) {
        const method = match[1].toUpperCase();
        const url = match[2];
        const inlineBody = (match[3] || '').trim();
        return function (arg) {
          const body = inlineBody || (arg ? String(arg).trim() : '');
          return handleInternetCmd(this, method, url, body);
        };
      }
      return Reflect.get(target, prop, receiver);
    }
  });

  T.registerExtension({
    name: 'internet',
    info: 'Internet Master Key imported successfully!',
    commands: {
      GET: function(arg) { return handleInternetCmd(this, 'GET', arg, ''); },
      POST: function(arg) { 
        const m = arg.match(/^\{([^}]+)\}([\s\S]*)$/);
        if (m) return handleInternetCmd(this, 'POST', m[1], m[2].trim());
        return handleInternetCmd(this, 'POST', arg, '');
      },
      PUT: function(arg) { 
        const m = arg.match(/^\{([^}]+)\}([\s\S]*)$/);
        if (m) return handleInternetCmd(this, 'PUT', m[1], m[2].trim());
        return handleInternetCmd(this, 'PUT', arg, '');
      },
      PATCH: function(arg) { 
        const m = arg.match(/^\{([^}]+)\}([\s\S]*)$/);
        if (m) return handleInternetCmd(this, 'PATCH', m[1], m[2].trim());
        return handleInternetCmd(this, 'PATCH', arg, '');
      },
      DELETE: function(arg) { return handleInternetCmd(this, 'DELETE', arg, ''); }
    }
  });
})();