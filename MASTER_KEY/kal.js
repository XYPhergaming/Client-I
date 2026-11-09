(function () {
  'use strict';
  const T = Terminal;

  // ---- Helper: Read Image from VFS ----
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
          new DataView(header.buffer).setUint32(0, textBytes.length);

          const fullBytes = new Uint8Array(4 + textBytes.length);
          fullBytes.set(header, 0);
          fullBytes.set(textBytes, 4);

          // Check capacity (Reserve last 20% for IMGLOCK data if present)
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

      IMGLOCK: async function (arg) {
        const match = arg.match(/^(\S+)\s+([\s\S]+)$/);
        if (!match) return this.printError('Usage: IMGLOCK <file.png> <password>');

        const filename = match[1];
        const password = match[2].trim();
        const target = T.Utils.resolvePath(this.cwd, filename);
        const entry = await T.Storage.get(target, 'vfs');

        if (!entry || entry.type !== 'file' || !entry.isBinary) {
          return this.printError('Image not found or invalid.');
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
          
          const totalBytes = payloadBytes.length + 4;
          const neededBits = totalBytes * 8;
          const neededPixels = Math.ceil(neededBits / 3);
          const s = Math.ceil(Math.sqrt(neededPixels)) + 10; // Extra buffer

          // Create "weird" image (noise)
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
          ctx.putImageData(imageData, 0, 0);

          // Embed payload at the end (backwards)
          const lengthBytes = new Uint8Array(4);
          new DataView(lengthBytes.buffer).setUint32(0, payloadBytes.length);
          const fullBytes = new Uint8Array(4 + payloadBytes.length);
          fullBytes.set(lengthBytes, 0);
          fullBytes.set(payloadBytes, 4);

          const totalBits = fullBytes.length * 8;
          let bitIndex = 0;
          let byteIdx = fullBytes.length - 1;
          let currentByte = fullBytes[byteIdx];
          let bitIdx = 0;

          for (let i = data.length - 1; i >= 0; i--) {
            if (i % 4 === 3) continue;
            if (bitIndex >= totalBits) break;
            
            const bit = currentByte & 1;
            data[i] = (data[i] & 0xFE) | bit;
            
            currentByte >>= 1;
            bitIdx++;
            bitIndex++;
            if (bitIdx === 8) {
              bitIdx = 0;
              byteIdx--;
              if (byteIdx < 0) break;
              currentByte = fullBytes[byteIdx];
            }
          }
          ctx.putImageData(imageData, 0, 0);

          const base64Data = canvas.toDataURL('image/png').split(',')[1];
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Uint8Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
          const resultBlob = new Blob([byteNumbers], { type: 'image/png' });

          const lockName = filename.replace(/\.[^.]+$/, '') + '.lock';
          const lockTarget = T.Utils.resolvePath(this.cwd, lockName);
          
          await T.Storage.set(lockTarget, { type: 'file', content: resultBlob, isBinary: true }, 'vfs');
          
          this.printSuccess('Image locked successfully!');
          this.printSystem('Saved as: ' + lockName);
          this.printSystem('Note: You can rename it to .png to see the hidden container.');
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
          let dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read blob.'));
            reader.readAsDataURL(entry.content);
          });

          const img = new Image();
          let isImage = false;
          await new Promise((resolve) => {
            img.onload = () => { isImage = true; resolve(); };
            img.onerror = () => { isImage = false; resolve(); };
            img.src = dataUrl;
          });

          if (isImage) {
            // New container format
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

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

            const fullBytes = new Uint8Array(extractedBytes.reverse());
            if (fullBytes.length < 4) throw new Error('Invalid container format.');

            const length = new DataView(fullBytes.buffer).getUint32(0);
            if (length === 0 || length > fullBytes.length - 4) throw new Error('Invalid payload length.');
            
            const payloadBytes = fullBytes.slice(4, 4 + length);
            const payloadString = new TextDecoder().decode(payloadBytes);
            const payload = JSON.parse(payloadString);

            const salt = new Uint8Array(base64ToArrayBuffer(payload.salt));
            const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));
            const ciphertext = new Uint8Array(base64ToArrayBuffer(payload.data));

            const decryptedBlob = await decryptBlob(ciphertext, salt, iv, password);
            const url = URL.createObjectURL(decryptedBlob);
            showImageInWindow(this, url, filename.replace('.lock', '.png'));
            this.printSuccess('Image opened.');

          } else {
            // Old format fallback (Raw Binary)
            const arrayBuffer = await entry.content.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            if (bytes.length < 28) throw new Error('Invalid encrypted file.');
            const salt = bytes.slice(0, 16);
            const iv = bytes.slice(16, 28);
            const ciphertext = bytes.slice(28);
            const decryptedBlob = await decryptBlob(ciphertext, salt, iv, password);
            const url = URL.createObjectURL(decryptedBlob);
            showImageInWindow(this, url, filename);
            this.printSuccess('Image opened (Legacy format).');
          }

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
          let dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read blob.'));
            reader.readAsDataURL(entry.content);
          });

          const img = new Image();
          let isImage = false;
          await new Promise((resolve) => {
            img.onload = () => { isImage = true; resolve(); };
            img.onerror = () => { isImage = false; resolve(); };
            img.src = dataUrl;
          });

          let decryptedBlob;
          if (isImage) {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

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

            const fullBytes = new Uint8Array(extractedBytes.reverse());
            const length = new DataView(fullBytes.buffer).getUint32(0);
            const payloadBytes = fullBytes.slice(4, 4 + length);
            const payloadString = new TextDecoder().decode(payloadBytes);
            const payload = JSON.parse(payloadString);

            const salt = new Uint8Array(base64ToArrayBuffer(payload.salt));
            const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));
            const ciphertext = new Uint8Array(base64ToArrayBuffer(payload.data));

            decryptedBlob = await decryptBlob(ciphertext, salt, iv, password);
          } else {
            const arrayBuffer = await entry.content.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            const salt = bytes.slice(0, 16);
            const iv = bytes.slice(16, 28);
            const ciphertext = bytes.slice(28);
            decryptedBlob = await decryptBlob(ciphertext, salt, iv, password);
          }

          const outName = filename.replace(/\.lock$/i, '') + '_unlocked.png';
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
          // Extract
          let dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read blob.'));
            reader.readAsDataURL(entry.content);
          });

          const img = new Image();
          let isImage = false;
          await new Promise((resolve) => {
            img.onload = () => { isImage = true; resolve(); };
            img.onerror = () => { isImage = false; resolve(); };
            img.src = dataUrl;
          });

          if (!isImage) {
            return this.printError('Legacy .lock format cannot be changed directly. Please unlock and re-lock it.');
          }

          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;

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

          const fullBytes = new Uint8Array(extractedBytes.reverse());
          const length = new DataView(fullBytes.buffer).getUint32(0);
          const payloadBytes = fullBytes.slice(4, 4 + length);
          const payloadString = new TextDecoder().decode(payloadBytes);
          const payload = JSON.parse(payloadString);

          const salt = new Uint8Array(base64ToArrayBuffer(payload.salt));
          const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));
          const ciphertext = new Uint8Array(base64ToArrayBuffer(payload.data));

          const decryptedBlob = await decryptBlob(ciphertext, salt, iv, oldPass);
          
          // Re-encrypt
          const { salt: newSalt, iv: newIv, ciphertext: newCiphertext } = await encryptBlob(decryptedBlob, newPass);
          
          const newPayload = JSON.stringify({
            salt: arrayBufferToBase64(newSalt),
            iv: arrayBufferToBase64(newIv),
            data: arrayBufferToBase64(newCiphertext)
          });
          const newPayloadBytes = new TextEncoder().encode(newPayload);
          
          const lengthBytes = new Uint8Array(4);
          new DataView(lengthBytes.buffer).setUint32(0, newPayloadBytes.length);
          const newFullBytes = new Uint8Array(4 + newPayloadBytes.length);
          newFullBytes.set(lengthBytes, 0);
          newFullBytes.set(newPayloadBytes, 4);

          const totalBits = newFullBytes.length * 8;
          let bitIndex = 0;
          let byteIdx = newFullBytes.length - 1;
          let currByte = newFullBytes[byteIdx];
          let bIdx = 0;

          for (let i = data.length - 1; i >= 0; i--) {
            if (i % 4 === 3) continue;
            if (bitIndex >= totalBits) break;
            
            const bit = currByte & 1;
            data[i] = (data[i] & 0xFE) | bit;
            
            currByte >>= 1;
            bIdx++;
            bitIndex++;
            if (bIdx === 8) {
              bIdx = 0;
              byteIdx--;
              if (byteIdx < 0) break;
              currByte = newFullBytes[byteIdx];
            }
          }
          ctx.putImageData(imageData, 0, 0);

          const base64Data = canvas.toDataURL('image/png').split(',')[1];
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Uint8Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
          const resultBlob = new Blob([byteNumbers], { type: 'image/png' });

          await T.Storage.set(target, { type: 'file', content: resultBlob, isBinary: true }, 'vfs');
          this.printSuccess('Password changed successfully!');
        } catch (e) {
          this.printError(e.message);
        }
      }
    }
  });
})();