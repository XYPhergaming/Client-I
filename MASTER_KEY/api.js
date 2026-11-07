(function () {
  'use strict';
  const T = Terminal;

  // Helper to format JSON beautifully
  function prettyPrint(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return String(obj);
    }
  }

  async function executeRequest(session, method, url, bodyStr) {
    if (!url) return session.printError(`Usage: api.${method} <url> ${['POST', 'PUT', 'PATCH'].includes(method) ? '<json_body>' : ''}`);
    
    // Validate URL
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url; // Auto-add https if missing
    }

    const options = { method };
    if (bodyStr) {
      try {
        JSON.parse(bodyStr); // Check if valid JSON
        options.headers = { 'Content-Type': 'application/json' };
        options.body = bodyStr;
      } catch (e) {
        session.printError("Invalid JSON Body. Please provide a valid JSON string.");
        return;
      }
    }

    session.printSystem(`Sending ${method} request to ${url}...`);
    const startTime = performance.now();

    try {
      const response = await fetch(url, options);
      const endTime = performance.now();
      const timeTaken = (endTime - startTime).toFixed(2);

      session.printSystem(`----------------------------------------`);
      
      // Status and Time
      const statusColor = response.ok ? 'text-green-600' : 'text-red-600';
      session.print(`<span class="${statusColor}">STATUS: ${response.status} ${response.statusText}</span>`, true);
      session.printSystem(`TIME:   ${timeTaken} ms`);

      // Headers
      session.printSystem(`[ RESPONSE HEADERS ]`);
      response.headers.forEach((val, key) => {
        session.printSystem(`  ${key}: ${val}`);
      });
      session.printSystem(`----------------------------------------`);

      // Body
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        session.print(prettyPrint(data));
      } else {
        const text = await response.text();
        session.print(text || '(Empty Body)');
      }
      session.printSystem(`----------------------------------------`);

    } catch (error) {
      session.printError(`Request Failed: ${error.message}`);
      if (error.message.includes('Failed to fetch')) {
        session.printSystem("Note: This usually happens due to CORS (Cross-Origin Resource Sharing) policies on the target server, or network issues.");
      }
    }
  }

  T.registerExtension({
    name: 'api',
    info: 'API Checker loaded. Commands: GET, POST, PUT, PATCH, DELETE',
    descriptions: {
      GET: 'Send a GET request (api.GET <url>)',
      POST: 'Send a POST request (api.POST <url> <json_body>)',
      PUT: 'Send a PUT request (api.PUT <url> <json_body>)',
      PATCH: 'Send a PATCH request (api.PATCH <url> <json_body>)',
      DELETE: 'Send a DELETE request (api.DELETE <url>)'
    },
    commands: {
      GET: async function (arg) {
        await executeRequest(this, 'GET', arg.trim(), null);
      },
      POST: async function (arg) {
        const parts = arg.trim().split(/\s+/);
        const url = parts[0];
        const body = parts.slice(1).join(' ');
        await executeRequest(this, 'POST', url, body);
      },
      PUT: async function (arg) {
        const parts = arg.trim().split(/\s+/);
        const url = parts[0];
        const body = parts.slice(1).join(' ');
        await executeRequest(this, 'PUT', url, body);
      },
      PATCH: async function (arg) {
        const parts = arg.trim().split(/\s+/);
        const url = parts[0];
        const body = parts.slice(1).join(' ');
        await executeRequest(this, 'PATCH', url, body);
      },
      DELETE: async function (arg) {
        await executeRequest(this, 'DELETE', arg.trim(), null);
      }
    }
  });
})();