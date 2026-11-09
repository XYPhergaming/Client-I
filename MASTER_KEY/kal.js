(function () {
  'use strict';
  const T = Terminal;

  // --- Helper for Image Loading (HIDE/SEEK) ---
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

  // --- Cryptographic Helpers for Image Lock/Unlock ---
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

    const result = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
    result.set(salt, 0);
    result.set(iv, salt.length);
    result.set(new Uint8Array(ciphertext), salt.length + iv.length);
    return new Blob([result], { type: 'application/octet-stream' });
  }

  async function decryptBlob(blob, password) {
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.length < 28) throw new Error('Invalid encrypted file.');

    const salt = bytes.slice(0, 16);
    const iv = bytes.slice(16, 28);
    const ciphertext = bytes.slice(28);

    const key = await deriveKey(password, salt);
    try {
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
      return new Blob([plaintext]);
    } catch (e) {
      throw new Error('Incorrect password or corrupted file.');
    }
  }

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
          const encryptedBlob = await encryptBlob(blob, password);
          
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
          const decryptedBlob = await decryptBlob(entry.content, password);
          const url = URL.createObjectURL(decryptedBlob);

          const win = document.createElement('div');
          win.style.cssText = 'position:fixed;z-index:9999;left:50px;top:80px;width:340px;height:400px;background:#fff;border:1px solid #374151;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.6);display:flex;flex-direction:column;overflow:hidden;';
          
          const header = document.createElement('div');
          header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:4px 8px; cursor:move; user-select:none; flex-shrink:0; background:#374151; color:#f3f4f6; border-bottom:1px solid #1f2937; font-family:monospace; font-size:11px; font-weight:bold;';
          
          const title = document.createElement('span');
          title.textContent = filename;
          title.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          
          const btnClose = document.createElement('button');
          btnClose.textContent = 'X';
          btnClose.style.cssText = 'background:transparent;border:1px solid currentColor;color:#00d8ff;width:20px;height:20px;border-radius:3px;cursor:pointer; display:flex; align-items:center; justify-content:center;';
          btnClose.onclick = (e) => { 
            e.stopPropagation(); 
            win.remove(); 
            URL.revokeObjectURL(url); 
          };
          
          header.appendChild(title); 
          header.appendChild(btnClose);
          win.appendChild(header);

          const imgEl = document.createElement('img');
          imgEl.src = url;
          imgEl.style.cssText = 'flex:1;object-fit:contain;width:100%;background:#000;';
          win.appendChild(imgEl);

          let dragging = false, sx, sy, ox, oy;
          const startDrag = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            const p = e.touches ? e.touches[0] : e;
            dragging = true; sx = p.clientX; sy = p.clientY;
            const r = win.getBoundingClientRect(); ox = r.left; oy = r.top;
            e.preventDefault();
          };
          header.addEventListener('mousedown', startDrag);
          header.addEventListener('touchstart', startDrag, { passive: false });
          const onMove = (ev) => {
            if (!dragging) return;
            const pt = ev.touches ? ev.touches[0] : ev;
            win.style.left = (ox + pt.clientX - sx) + 'px';
            win.style.top = (oy + pt.clientY - sy) + 'px';
          };
          const endDrag = () => { dragging = false; };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', endDrag);
          document.addEventListener('touchmove', onMove, { passive: false });
          document.addEventListener('touchend', endDrag);

          document.body.appendChild(win);
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
          const decryptedBlob = await decryptBlob(entry.content, password);
          
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
          const decryptedBlob = await decryptBlob(entry.content, oldPass);
          const encryptedBlob = await encryptBlob(decryptedBlob, newPass);
          
          await T.Storage.set(target, { type: 'file', content: encryptedBlob, isBinary: true }, 'vfs');
          this.printSuccess('Password changed successfully!');
        } catch (e) {
          this.printError(e.message);
        }
      }
    }
  });
})();