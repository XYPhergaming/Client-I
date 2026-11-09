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
      IMGCHANGE: 'Change password of a locked image (IMGCHANGE <file.lock> <old_pass> <new_pass>)',
      DUALLOCK: 'Create a decoy trap (DUALLOCK <real.png> <decoy.png> <password>)',
      DUALOPEN: 'Open trapped image (DUALOPEN <file.duallock> <password>)',
      DUALCHANGE: 'Change trap password (DUALCHANGE <file.duallock> <old_pass> <new_pass>)'
    },
    commands: {
      // ==========================================
      // EXISTING COMMANDS (HIDE, SEEK, IMG...)
      // ==========================================
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

        this.printSystem('Encrypting ' + filename + '...');

        try {
          const blob = entry.content instanceof Blob ? entry.content : new Blob([entry.content]);
          const { salt, iv, ciphertext } = await encryptBlob(blob, password);
          
          const result = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
          result.set(salt, 0);
          result.set(iv, salt.length);
          result.set(ciphertext, salt.length + iv.length);
          const encryptedBlob = new Blob([result], { type: 'application/octet-stream' });

          const lockName = filename.replace(/\.[^.]+$/, '') + '.lock';
          const lockTarget = T.Utils.resolvePath(this.cwd, lockName);
          
          await T.Storage.set(lockTarget, { type: 'file', content: encryptedBlob, isBinary: true }, 'vfs');
          
          this.printSuccess('Image locked successfully!');
          this.printSystem('Saved as: ' + lockName);
          this.printSystem('Use IMGOPEN or IMGUNLOCK with your password to access it.');
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
          const arrayBuffer = await entry.content.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          if (bytes.length < 28) throw new Error('Invalid encrypted file.');

          const salt = bytes.slice(0, 16);
          const iv = bytes.slice(16, 28);
          const ciphertext = bytes.slice(28);

          const decryptedBlob = await decryptBlob(ciphertext, salt, iv, password);
          const url = URL.createObjectURL(decryptedBlob);
          showImageInWindow(this, url, filename);
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
          const arrayBuffer = await entry.content.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          const salt = bytes.slice(0, 16);
          const iv = bytes.slice(16, 28);
          const ciphertext = bytes.slice(28);

          const decryptedBlob = await decryptBlob(ciphertext, salt, iv, password);
          
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

        this.printSystem('Changing password for ' + filename + '...');

        try {
          const arrayBuffer = await entry.content.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          const salt = bytes.slice(0, 16);
          const iv = bytes.slice(16, 28);
          const ciphertext = bytes.slice(28);

          const decryptedBlob = await decryptBlob(ciphertext, salt, iv, oldPass);
          const { salt: newSalt, iv: newIv, ciphertext: newCiphertext } = await encryptBlob(decryptedBlob, newPass);
          
          const result = new Uint8Array(newSalt.length + newIv.length + newCiphertext.byteLength);
          result.set(newSalt, 0);
          result.set(newIv, newSalt.length);
          result.set(newCiphertext, newSalt.length + newIv.length);
          const encryptedBlob = new Blob([result], { type: 'application/octet-stream' });

          await T.Storage.set(target, { type: 'file', content: encryptedBlob, isBinary: true }, 'vfs');
          this.printSuccess('Password changed successfully!');
        } catch (e) {
          this.printError(e.message);
        }
      },

      // ==========================================
      // NEW COMMANDS: DUALLOCK, DUALOPEN, DUALCHANGE
      // ==========================================
      DUALLOCK: async function (arg) {
        const parts = arg.trim().split(/\s+/);
        if (parts.length < 3) return this.printError('Usage: DUALLOCK <real.png> <decoy.png> <password>');

        const realFile = parts[0];
        const decoyFile = parts[1];
        const password = parts.slice(2).join(' '); // In case password has spaces

        const realTarget = T.Utils.resolvePath(this.cwd, realFile);
        const decoyTarget = T.Utils.resolvePath(this.cwd, decoyFile);

        const realEntry = await T.Storage.get(realTarget, 'vfs');
        const decoyEntry = await T.Storage.get(decoyTarget, 'vfs');

        if (!realEntry || realEntry.type !== 'file' || !realEntry.isBinary) {
          return this.printError('Real image not found or invalid.');
        }
        if (!decoyEntry || decoyEntry.type !== 'file' || !decoyEntry.isBinary) {
          return this.printError('Decoy image not found or invalid.');
        }

        this.printSystem('Creating dual-layer trap...');

        try {
          // Encrypt the real image
          const realBlob = realEntry.content instanceof Blob ? realEntry.content : new Blob([realEntry.content]);
          const { salt, iv, ciphertext } = await encryptBlob(realBlob, password);

          // Prepare the decoy image (we'll store it as base64 string)
          let decoyDataUrl;
          if (decoyEntry.content instanceof Blob) {
            decoyDataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = () => reject(new Error('Failed to read decoy blob.'));
              reader.readAsDataURL(decoyEntry.content);
            });
          } else if (typeof decoyEntry.content === 'string') {
            const m = decoyTarget.match(/\.(png|jpe?g|gif|bmp|webp)$/i);
            const mime = m ? 'image/' + m[1].toLowerCase().replace('jpg', 'jpeg') : 'image/png';
            decoyDataUrl = 'data:' + mime + ';base64,' + decoyEntry.content;
          } else {
            throw new Error('Unsupported decoy format.');
          }

          // Build the container JSON
          const payload = {
            type: 'DUALLOCK',
            salt: arrayBufferToBase64(salt),
            iv: arrayBufferToBase64(iv),
            encryptedReal: arrayBufferToBase64(ciphertext),
            decoy: decoyDataUrl
          };

          const payloadString = JSON.stringify(payload);
          const containerBlob = new Blob([payloadString], { type: 'application/json' });

          const lockName = realFile.replace(/\.[^.]+$/, '') + '.duallock';
          const lockTarget = T.Utils.resolvePath(this.cwd, lockName);
          
          await T.Storage.set(lockTarget, { type: 'file', content: containerBlob, isBinary: true }, 'vfs');
          
          this.printSuccess('Dual-lock trap created successfully!');
          this.printSystem('Saved as: ' + lockName);
          this.printSystem('Correct password = Real image. Wrong password = Decoy image.');
        } catch (e) {
          this.printError('Trap creation failed: ' + e.message);
        }
      },

      DUALOPEN: async function (arg) {
        const match = arg.match(/^(\S+)\s+([\s\S]*)$/);
        if (!match) return this.printError('Usage: DUALOPEN <file.duallock> [password]');

        const filename = match[1];
        const password = match[2].trim(); // Can be empty

        const target = T.Utils.resolvePath(this.cwd, filename);
        const entry = await T.Storage.get(target, 'vfs');

        if (!entry || entry.type !== 'file') return this.printError('File not found.');

        this.printSystem('Decrypting ' + filename + '...');

        try {
          let payloadString;
          if (entry.content instanceof Blob) {
             payloadString = await entry.content.text();
          } else {
             payloadString = entry.content;
          }
          
          const payload = JSON.parse(payloadString);
          if (payload.type !== 'DUALLOCK') throw new Error('Invalid dual-lock file format.');

          const salt = new Uint8Array(base64ToArrayBuffer(payload.salt));
          const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));
          const ciphertext = new Uint8Array(base64ToArrayBuffer(payload.encryptedReal));

          let showReal = false;
          let imageUrl = payload.decoy; // Default to decoy

          // Try to decrypt the real image
          if (password) {
            try {
              const realBlob = await decryptBlob(ciphertext, salt, iv, password);
              imageUrl = URL.createObjectURL(realBlob);
              showReal = true;
            } catch (e) {
              // Decryption failed (wrong password), so we stick to the decoy
              showReal = false;
            }
          }

          // Show the image
          showImageInWindow(this, imageUrl, filename);
          
          if (showReal) {
            this.printSuccess('Access granted. (Real Image)');
          } else {
            // We can just print success to hide the fact that it's a decoy
            this.printSuccess('Access granted. (Decoy Image)'); 
          }

        } catch (e) {
          this.printError('Failed to open: ' + e.message);
        }
      },

      DUALCHANGE: async function (arg) {
        const parts = arg.trim().split(/\s+/);
        if (parts.length < 3) return this.printError('Usage: DUALCHANGE <file.duallock> <old_pass> <new_pass>');

        const filename = parts[0];
        const oldPass = parts[1];
        const newPass = parts[2];
        
        const target = T.Utils.resolvePath(this.cwd, filename);
        const entry = await T.Storage.get(target, 'vfs');
        if (!entry || entry.type !== 'file') return this.printError('File not found.');

        this.printSystem('Updating trap password...');

        try {
          let payloadString;
          if (entry.content instanceof Blob) {
             payloadString = await entry.content.text();
          } else {
             payloadString = entry.content;
          }
          
          const payload = JSON.parse(payloadString);
          if (payload.type !== 'DUALLOCK') throw new Error('Invalid dual-lock file format.');

          const salt = new Uint8Array(base64ToArrayBuffer(payload.salt));
          const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));
          const ciphertext = new Uint8Array(base64ToArrayBuffer(payload.encryptedReal));

          // 1. Decrypt with old password
          const realBlob = await decryptBlob(ciphertext, salt, iv, oldPass);

          // 2. Encrypt with new password
          const { salt: newSalt, iv: newIv, ciphertext: newCiphertext } = await encryptBlob(realBlob, newPass);

          // 3. Update payload
          payload.salt = arrayBufferToBase64(newSalt);
          payload.iv = arrayBufferToBase64(newIv);
          payload.encryptedReal = arrayBufferToBase64(newCiphertext);

          const newPayloadString = JSON.stringify(payload);
          const newBlob = new Blob([newPayloadString], { type: 'application/json' });

          await T.Storage.set(target, { type: 'file', content: newBlob, isBinary: true }, 'vfs');
          this.printSuccess('Trap password changed successfully!');
        } catch (e) {
          this.printError('Failed to change password: ' + e.message);
        }
      }
    }
  });
})();