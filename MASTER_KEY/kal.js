(function () {
  'use strict';
  const T = Terminal;

  // ---- Helper: Read ArrayBuffer safely from Blob or String ----
  async function getArrayBuffer(content) {
    if (content instanceof Blob) {
      return await content.arrayBuffer();
    }
    if (typeof content === 'string') {
      try {
        const bin = atob(content);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
      } catch (e) {
        return new TextEncoder().encode(content).buffer;
      }
    }
    throw new Error('Unsupported file content type.');
  }

  // ---- Helper: Read Image from VFS ----
  async function loadImageFromVFS(session, path) {
    const target = T.Utils.resolvePath(session.cwd, path);
    const entry = await T.Storage.get(target, 'vfs');

    if (!entry || entry.type !== 'file') {
      throw new Error('File not found or invalid at ' + target);
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
      if (entry.content.startsWith('data:image/')) {
        dataUrl = entry.content;
      } else {
        const m = target.match(/\.(png|jpe?g|gif|bmp|webp)$/i);
        const mime = m ? 'image/' + m[1].toLowerCase().replace('jpg', 'jpeg') : 'image/png';
        dataUrl = 'data:' + mime + ';base64,' + entry.content;
      }
    } else {
      throw new Error('Unsupported image format.');
    }

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Failed to decode image. The file may be corrupted by the "edit" command.'));
      img.src = dataUrl;
    });
    return { img, dataUrl };
  }

  // ---- Helper: Crypto Functions ----
  async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  async function encryptBlob(blob, password) {
    const arrayBuffer = await blob.arrayBuffer();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, arrayBuffer);
    return { salt, iv, ciphertext: new Uint8Array(ciphertext) };
  }

  async function decryptBlob(ciphertext, salt, iv, password) {
    const key = await deriveKey(password, salt);
    try {
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
      return new Blob([plaintext]);
    } catch (e) {
      throw new Error('Incorrect password');
    }
  }

  // ---- Helper: Base64 Utils ----
  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  // ---- Helper: Extract Payload from Image (LSB Backwards) ----
  function extractPayloadFromLSB(data) {
    const bits = [];
    for (let i = data.length - 1; i >= 0; i--) {
      if (i % 4 === 3) continue;
      bits.push(data[i] & 1);
    }
    
    const extractedBytes = [];
    let currentByte = 0;
    let bitIdx = 0;
    for (let i = 0; i < bits.length; i++) {
      currentByte |= (bits[i] << bitIdx);
      bitIdx++;
      if (bitIdx === 8) { extractedBytes.push(currentByte); currentByte = 0; bitIdx = 0; }
    }

    const magic = new TextEncoder().encode('KALMA');
    if (extractedBytes.length < magic.length) return null;

    let match = true;
    for (let i = 0; i < magic.length; i++) {
      if (extractedBytes[i] !== magic[i]) { match = false; break; }
    }
    if (!match) return null;

    const lenBytes = new Uint8Array(extractedBytes.slice(magic.length, magic.length + 4));
    const len = new DataView(lenBytes.buffer).getUint32(0, true);
    if (len > 0 && len <= extractedBytes.length - magic.length - 4) {
      const payloadBytes = new Uint8Array(extractedBytes.slice(magic.length + 4, magic.length + 4 + len));
      try {
        return JSON.parse(new TextDecoder().decode(payloadBytes));
      } catch (e) { return null; }
    }
    return null;
  }

  // ---- Helper: Extract Payload from Bytes (Appended Data Legacy) ----
  function extractPayloadFromBytes(bytes) {
    const magic = new TextEncoder().encode('KALMADATA');
    for (let i = bytes.length - magic.length - 4; i >= Math.max(0, bytes.length - 1024 * 1024); i--) {
      let match = true;
      for (let j = 0; j < magic.length; j++) {
        if (bytes[i + j] !== magic[j]) { match = false; break; }
      }
      if (match) {
        const lenBytes = bytes.slice(i + magic.length, i + magic.length + 4);
        const len = new DataView(lenBytes.buffer).getUint32(0, true);
        if (len > 0 && len <= bytes.length - i - magic.length - 4) {
          const payloadBytes = bytes.slice(i + magic.length + 4, i + magic.length + 4 + len);
          try { return JSON.parse(new TextDecoder().decode(payloadBytes)); } catch (e) {}
        }
      }
    }
    return null;
  }

  // ---- Helper: Image Viewer Window ----
  function showImageInWindow(session, dataUrl, title) {
    const zIdx = (window._zCounter || 100) + 1;
    window._zCounter = zIdx;

    const win = document.createElement('div');
    win.className = 'mini-window fade-in';
    win.style.zIndex = zIdx;
    win.style.left = '50px';
    win.style.top = '80px';
    win.style.width = '340px';
    win.style.height = '400px';
    win.style.display = 'flex';
    win.style.flexDirection = 'column';
    
    const header = document.createElement('div');
    header.className = 'mini-header';
    
    const titleEl = document.createElement('span');
    titleEl.textContent = title;
    titleEl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    
    const btnClose = document.createElement('button');
    btnClose.className = 'mini-btn';
    btnClose.textContent = 'X';
    
    header.appendChild(titleEl); 
    header.appendChild(btnClose);
    win.appendChild(header);

    const imgEl = document.createElement('img');
    imgEl.src = dataUrl;
    imgEl.style.cssText = 'flex:1;object-fit:contain;width:100%;background:#02120a;';
    win.appendChild(imgEl);

    let dragging = false, sx, sy, ox, oy;
    const startDrag = (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const p = e.touches ? e.touches[0] : e;
      dragging = true; sx = p.clientX; sy = p.clientY;
      const r = win.getBoundingClientRect(); ox = r.left; oy = r.top;
      e.preventDefault();
    };
    
    const onMove = (ev) => {
      if (!dragging) return;
      const pt = ev.touches ? ev.touches[0] : ev;
      win.style.left = (ox + pt.clientX - sx) + 'px';
      win.style.top = (oy + pt.clientY - sy) + 'px';
    };
    
    const endDrag = () => { dragging = false; };
    const cleanup = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', endDrag);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', endDrag);
      if (imgEl.src.startsWith('blob:')) URL.revokeObjectURL(imgEl.src);
      win.remove();
    };

    btnClose.onclick = (e) => { e.stopPropagation(); cleanup(); };
    
    header.addEventListener('mousedown', startDrag);
    header.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', endDrag);

    document.body.appendChild(win);
  }


  // ---- Register Extension ----
  T.registerExtension({
    name: 'kal',
    info: 'Steganography and Image Security Suite loaded.',
    descriptions: {
      HIDE: 'Hide text in PNG (HIDE <file.png> <text>)',
      SEEK: 'Extract hidden text (SEEK <file.png>)',
      IMGLOCK: 'Lock an image with a password (IMGLOCK <file.png> <password>)',
      IMGOPEN: 'View a locked image (IMGOPEN <file.lock> <password>)',
      IMGUNLOCK: 'Decrypt and save a locked image (IMGUNLOCK <file.lock> <password>)',
      IMGCHANGE: 'Change password of a locked image (IMGCHANGE <file.lock> <old_pass> <new_pass>)'
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
          new DataView(header.buffer).setUint32(0, textBytes.length, true);

          const fullBytes = new Uint8Array(4 + textBytes.length);
          fullBytes.set(header, 0);
          fullBytes.set(textBytes, 4);

          const maxCapacity = Math.floor((data.length * 3) / 8);
          if (fullBytes.length > maxCapacity) {
            return this.printError('Text too large! Image can hold max ' + maxCapacity + ' bytes.');
          }

          let bitIndex = 0;
          for (let i = 0; i < data.length; i++) {
            if (i % 4 === 3) continue;
            if (bitIndex >= fullBytes.length * 8) break;
            const byteIdx = Math.floor(bitIndex / 8);
            const bitOffset = bitIndex % 8;
            const bit = (fullBytes[byteIdx] >> bitOffset) & 1;
            data[i] = (data[i] & 0xFE) | bit;
            bitIndex++;
          }

          ctx.putImageData(imageData, 0, 0);

          const base64Data = canvas.toDataURL('image/png').split(',')[1];
          const byteCharacters = atob(base64Data);
          const newPngBytes = new Uint8Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) newPngBytes[i] = byteCharacters.charCodeAt(i);

          const newName = filename.replace(/\.[^.]+$/, '_secret.png');
          const newTarget = T.Utils.resolvePath(this.cwd, newName);
          const blob = new Blob([newPngBytes], { type: 'image/png' });
          
          await T.Storage.set(newTarget, { type: 'file', content: blob, isBinary: true }, 'vfs');
          this.printSuccess('Secret text hidden successfully!');
          this.printSystem('Saved as: ' + newName);

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

          const extractedBytes = [];
          let currentByte = 0;
          let bitIdx = 0;
          for (let i = 0; i < bits.length; i++) {
            currentByte |= (bits[i] << bitIdx);
            bitIdx++;
            if (bitIdx === 8) { extractedBytes.push(currentByte); currentByte = 0; bitIdx = 0; }
          }

          if (extractedBytes.length < 4) return this.printError('No hidden data found.');

          const lenBytes = new Uint8Array(extractedBytes.slice(0, 4));
          const textLength = new DataView(lenBytes.buffer).getUint32(0, true);

          if (textLength === 0 || textLength > extractedBytes.length - 4) {
            return this.printError('No valid hidden text detected.');
          }

          const textBytes = new Uint8Array(extractedBytes.slice(4, 4 + textLength));
          const hiddenText = new TextDecoder().decode(textBytes);

          this.printSystem('----------------------------------------');
          this.printSuccess('[ HIDDEN TEXT FOUND ]');
          this.print(hiddenText);
          this.printSystem('----------------------------------------');

        } catch (e) {
          this.printError(e.message);
        }
      },

      IMGLOCK: async function (arg) {
        const match = arg.match(/^(\S+)\s+([\s\S]+)$/);
        if (!match) return this.printError('Usage: IMGLOCK <file.png> <password>');

        const filename = match[1];
        const password = match[2].trim();
        const target = T.Utils.resolvePath(this.cwd, filename);
        const entry = await T.Storage.get(target, 'vfs');

        if (!entry || entry.type !== 'file') {
          return this.printError('File not found.');
        }
        if (typeof entry.content === 'string' && !entry.isBinary) {
           return this.printError('Cannot lock a text file. Please lock a binary image.');
        }

        this.printSystem('Encrypting and creating container for ' + filename + '...');

        try {
          const blob = entry.content instanceof Blob ? entry.content : new Blob([entry.content]);
          const { salt, iv, ciphertext } = await encryptBlob(blob, password);
          
          const payload = JSON.stringify({
            salt: arrayBufferToBase64(salt),
            iv: arrayBufferToBase64(iv),
            data: arrayBufferToBase64(ciphertext)
          });
          const payloadBytes = new TextEncoder().encode(payload);
          
          const magic = new TextEncoder().encode('KALMA');
          const lengthBytes = new Uint8Array(4);
          new DataView(lengthBytes.buffer).setUint32(0, payloadBytes.length, true);

          const fullBytes = new Uint8Array(magic.length + lengthBytes.length + payloadBytes.length);
          fullBytes.set(magic, 0);
          fullBytes.set(lengthBytes, magic.length);
          fullBytes.set(payloadBytes, magic.length + lengthBytes.length);

          const totalBits = fullBytes.length * 8;
          const neededPixels = Math.ceil(totalBits / 3);
          const s = Math.ceil(Math.sqrt(neededPixels)) + 20;

          const canvas = document.createElement('canvas');
          canvas.width = s;
          canvas.height = s;
          const ctx = canvas.getContext('2d');
          const imageData = ctx.createImageData(s, s);
          const data = imageData.data;
          
          for (let i = 0; i < data.length; i += 4) {
            data[i] = Math.floor(Math.random() * 256);
            data[i+1] = Math.floor(Math.random() * 256);
            data[i+2] = Math.floor(Math.random() * 256);
            data[i+3] = 255;
          }
          
          let bitIndex = 0;
          for (let i = data.length - 1; i >= 0; i--) {
            if (i % 4 === 3) continue;
            if (bitIndex >= totalBits) break;
            
            const byteIdx = fullBytes.length - 1 - Math.floor(bitIndex / 8);
            const bitOffset = bitIndex % 8;
            const bit = (fullBytes[byteIdx] >> bitOffset) & 1;
            data[i] = (data[i] & 0xFE) | bit;
            bitIndex++;
          }
          
          ctx.putImageData(imageData, 0, 0);

          const base64Data = canvas.toDataURL('image/png').split(',')[1];
          const byteCharacters = atob(base64Data);
          const pngBytes = new Uint8Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) pngBytes[i] = byteCharacters.charCodeAt(i);

          const resultBlob = new Blob([pngBytes], { type: 'image/png' });

          const lockName = filename.replace(/\.[^.]+$/, '') + '.lock';
          const lockTarget = T.Utils.resolvePath(this.cwd, lockName);
          
          await T.Storage.set(lockTarget, { type: 'file', content: resultBlob, isBinary: true }, 'vfs');
          
          this.printSuccess('Image locked successfully!');
          this.printSystem('Saved as: ' + lockName);
        } catch (e) {
          this.printError('Lock failed: ' + e.message);
        }
      },

      IMGOPEN: async function (arg) {
        const match = arg.match(/^(\S+)\s+([\s\S]+)$/);
        if (!match) return this.printError('Usage: IMGOPEN <file.lock> <password>');

        const filename = match[1];
        const password = match[2].trim();
        const target = T.Utils.resolvePath(this.cwd, filename);
        const entry = await T.Storage.get(target, 'vfs');

        if (!entry || entry.type !== 'file') return this.printError('Locked file not found.');

        this.printSystem('Decrypting ' + filename + '...');

        try {
          const arrayBuffer = await getArrayBuffer(entry.content);
          const bytes = new Uint8Array(arrayBuffer);
          let payload = null;

          try {
            const dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = () => reject(new Error('Failed to read.'));
              reader.readAsDataURL(new Blob([arrayBuffer]));
            });
            const img = new Image();
            await new Promise((res) => { img.onload = res; img.onerror = res; img.src = dataUrl; });
            if (img.width > 0) {
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              payload = extractPayloadFromLSB(imageData.data);
            }
          } catch (e) {}

          if (!payload) {
            payload = extractPayloadFromBytes(bytes);
          }

          if (!payload) {
            throw new Error('File is not a valid locked container.');
          }

          const salt = new Uint8Array(base64ToArrayBuffer(payload.salt));
          const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));
          const ciphertext = new Uint8Array(base64ToArrayBuffer(payload.data));

          let decryptedBlob;
          try {
            decryptedBlob = await decryptBlob(ciphertext, salt, iv, password);
          } catch (e) {
            throw new Error('Incorrect password.');
          }

          const url = URL.createObjectURL(decryptedBlob);
          showImageInWindow(this, url, filename.replace('.lock', '.png'));
          this.printSuccess('Image opened.');

        } catch (e) {
          this.printError(e.message);
        }
      },

      IMGUNLOCK: async function (arg) {
        const match = arg.match(/^(\S+)\s+([\s\S]+)$/);
        if (!match) return this.printError('Usage: IMGUNLOCK <file.lock> <password>');

        const filename = match[1];
        const password = match[2].trim();
        const target = T.Utils.resolvePath(this.cwd, filename);
        const entry = await T.Storage.get(target, 'vfs');

        if (!entry || entry.type !== 'file') return this.printError('Locked file not found.');

        this.printSystem('Decrypting ' + filename + '...');

        try {
          const arrayBuffer = await getArrayBuffer(entry.content);
          const bytes = new Uint8Array(arrayBuffer);
          let payload = null;

          try {
            const dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = () => reject(new Error('Failed to read.'));
              reader.readAsDataURL(new Blob([arrayBuffer]));
            });
            const img = new Image();
            await new Promise((res) => { img.onload = res; img.onerror = res; img.src = dataUrl; });
            if (img.width > 0) {
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              payload = extractPayloadFromLSB(imageData.data);
            }
          } catch (e) {}

          if (!payload) {
            payload = extractPayloadFromBytes(bytes);
          }

          if (!payload) {
            throw new Error('File is not a valid locked container.');
          }

          const salt = new Uint8Array(base64ToArrayBuffer(payload.salt));
          const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));
          const ciphertext = new Uint8Array(base64ToArrayBuffer(payload.data));

          let decryptedBlob;
          try {
            decryptedBlob = await decryptBlob(ciphertext, salt, iv, password);
          } catch (e) {
            throw new Error('Incorrect password.');
          }

          const outName = filename.replace(/\.[^.]+$/, '') + '_unlocked.png';
          const outTarget = T.Utils.resolvePath(this.cwd, outName);
          
          await T.Storage.set(outTarget, { type: 'file', content: decryptedBlob, isBinary: true }, 'vfs');
          this.printSuccess('Image decrypted successfully!');
          this.printSystem('Saved as: ' + outName);
        } catch (e) {
          this.printError(e.message);
        }
      },

      IMGCHANGE: async function (arg) {
        const parts = arg.trim().split(/\s+/);
        if (parts.length < 3) return this.printError('Usage: IMGCHANGE <file.lock> <old_pass> <new_pass>');

        const filename = parts[0];
        const oldPass = parts[1];
        const newPass = parts[2];
        
        const target = T.Utils.resolvePath(this.cwd, filename);
        const entry = await T.Storage.get(target, 'vfs');
        if (!entry || entry.type !== 'file') return this.printError('Locked file not found.');

        this.printSystem('Updating password for ' + filename + '...');

        try {
          const arrayBuffer = await getArrayBuffer(entry.content);
          const bytes = new Uint8Array(arrayBuffer);
          let payload = null;

          try {
            const dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = () => reject(new Error('Failed to read.'));
              reader.readAsDataURL(new Blob([arrayBuffer]));
            });
            const img = new Image();
            await new Promise((res) => { img.onload = res; img.onerror = res; img.src = dataUrl; });
            if (img.width > 0) {
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              payload = extractPayloadFromLSB(imageData.data);
            }
          } catch (e) {}

          if (!payload) {
            payload = extractPayloadFromBytes(bytes);
          }

          if (!payload) {
            throw new Error('File is not a valid locked container.');
          }

          const salt = new Uint8Array(base64ToArrayBuffer(payload.salt));
          const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));
          const ciphertext = new Uint8Array(base64ToArrayBuffer(payload.data));

          let decryptedBlob;
          try {
            decryptedBlob = await decryptBlob(ciphertext, salt, iv, oldPass);
          } catch (e) {
            throw new Error('Incorrect old password.');
          }
          
          const { salt: newSalt, iv: newIv, ciphertext: newCiphertext } = await encryptBlob(decryptedBlob, newPass);
          
          const newPayload = JSON.stringify({
            salt: arrayBufferToBase64(newSalt),
            iv: arrayBufferToBase64(newIv),
            data: arrayBufferToBase64(newCiphertext)
          });
          const newPayloadBytes = new TextEncoder().encode(newPayload);
          
          const magic = new TextEncoder().encode('KALMA');
          const lengthBytes = new Uint8Array(4);
          new DataView(lengthBytes.buffer).setUint32(0, newPayloadBytes.length, true);

          const fullBytes = new Uint8Array(magic.length + lengthBytes.length + newPayloadBytes.length);
          fullBytes.set(magic, 0);
          fullBytes.set(lengthBytes, magic.length);
          fullBytes.set(newPayloadBytes, magic.length + lengthBytes.length);

          const totalBits = fullBytes.length * 8;
          
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read.'));
            reader.readAsDataURL(new Blob([arrayBuffer]));
          });
          const img = new Image();
          await new Promise((res) => { img.onload = res; img.onerror = res; img.src = dataUrl; });
          
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;

          let bitIndex = 0;
          for (let i = data.length - 1; i >= 0; i--) {
            if (i % 4 === 3) continue;
            if (bitIndex >= totalBits) break;
            
            const byteIdx = fullBytes.length - 1 - Math.floor(bitIndex / 8);
            const bitOffset = bitIndex % 8;
            const bit = (fullBytes[byteIdx] >> bitOffset) & 1;
            data[i] = (data[i] & 0xFE) | bit;
            bitIndex++;
          }
          ctx.putImageData(imageData, 0, 0);

          const base64Data = canvas.toDataURL('image/png').split(',')[1];
          const byteCharacters = atob(base64Data);
          const pngBytes = new Uint8Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) pngBytes[i] = byteCharacters.charCodeAt(i);

          const resultBlob = new Blob([pngBytes], { type: 'image/png' });
          await T.Storage.set(target, { type: 'file', content: resultBlob, isBinary: true }, 'vfs');
          this.printSuccess('Password changed successfully!');
        } catch (e) {
          this.printError(e.message);
        }
      }
    }
  });
})();