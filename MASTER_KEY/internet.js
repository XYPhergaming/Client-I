(function () {
  'use strict';
  const T = Terminal;

  async function handleInternetCmd(session, method, url, bodyArg) {
    if (!url) {
      session.printError('INVALID URL');
      return;
    }
    
    // ব্র্যাকেট বা স্পেস থাকলে সেটি রিমুভ করা
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
        // JSON না টেক্সট তা অটো ডিটেক্ট করা
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
  
  // ম্যাজিক প্রোক্সি: index.html এ কিছু না লিখেই কমান্ড ধরা
  T.commands = new Proxy(originalCommands, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);

      // ১. GET{}, POST{} ইত্যাদি ফরম্যাট ধরা
      const match = prop.match(/^(GET|POST|PUT|PATCH|DELETE)\{(.*)\}$/i);
      if (match) {
        const method = match[1].toUpperCase();
        const url = match[2];
        return function(arg) {
          return handleInternetCmd(this, method, url, arg);
        };
      }

      // ২. GET {url}, POST {url} (স্পেস সহ) ফরম্যাট ধরা (Case sensitive URL এর জন্য ভালো)
      if (/^(GET|POST|PUT|PATCH|DELETE)$/i.test(prop)) {
        const method = prop.toUpperCase();
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
    info: 'Internet Master Key imported successfully! Use GET{}, POST{}, PUT{}, PATCH{}, DELETE{}'
  });
})();