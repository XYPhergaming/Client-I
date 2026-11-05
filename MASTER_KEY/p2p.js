(function () {
  'use strict';
  const T = Terminal;
  const PEER_CDN = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
  
  let peer = null;
  let conns = {}; 
  let hostConn = null; 
  let isHost = false;
  let myRoomId = null;
  let myId = null;
  let myName = null;
  let users = {};
  let pendingFiles = {};
  let roomStartTime = null;
  let userStartTime = null;
  let peerLibLoaded = false;

  // টাইট সিকিউরিটি: বিপজ্জনক ফাইল এক্সটেনশন এবং ক্ষতিকর কোড প্যাটার্ন
  const BLOCKED_EXTENSIONS = [
    'exe', 'sh', 'bat', 'cmd', 'vbs', 'py', 'rb', 'pl', 'cgi', 'bin', 'dll', 'so', 'apk', 'app', 'msi', 'dmg', 'js', 'jsx', 'ts', 'tsx', 'html', 'htm', 'svg'
  ];
  const BLOCKED_PATTERNS = [
    /<script/i, /javascript:/i, /eval\s*\(/i, /Function\s*\(/i, /document\.cookie/i, /localStorage/i,
    /sessionStorage/i, /fetch\s*\(/i, /XMLHttpRequest/i, /WebSocket/i, /child_process/i, /require\s*\(/i,
    /import\s*\(/i, /os\.system/i, /rm\s+-rf/i, /format\s+c:/i, /\.\.\//i
  ];

  function scanFile(filename, content) {
    const ext = filename.split('.').pop().toLowerCase();
    if (BLOCKED_EXTENSIONS.includes(ext)) {
      return { safe: false, reason: 'Dangerous extension detected: .' + ext };
    }
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(content)) {
        return { safe: false, reason: 'Malicious code pattern detected: ' + pattern.toString() };
      }
    }
    return { safe: true };
  }

  async function loadPeerLib() {
    if (peerLibLoaded || window.Peer) { peerLibLoaded = true; return; }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PEER_CDN;
      script.onload = () => { peerLibLoaded = true; resolve(); };
      script.onerror = () => reject(new Error('Failed to load PeerJS library'));
      document.head.appendChild(script);
    });
  }

  function cleanup() {
    if (peer) { try { peer.destroy(); } catch(e){} peer = null; }
    conns = {};
    hostConn = null;
    isHost = false;
    myRoomId = null;
    myId = null;
    myName = null;
    users = {};
    pendingFiles = {};
    roomStartTime = null;
    userStartTime = null;
  }

  async function handleRoom(session, roomId) {
    if (peer) cleanup();
    await loadPeerLib();

    myRoomId = roomId;
    myName = T.getUsername();
    session.printSystem(`Connecting to room ${roomId}...`);

    peer = new Peer('KALMA-ROOM-' + roomId);
    
    peer.on('open', () => {
      isHost = true;
      startHost(session, roomId, peer);
    });

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        try { peer.destroy(); } catch(e){}
        peer = null;
        isHost = false;
        startClient(session, roomId);
      } else {
        session.printError('Connection Error: ' + err.message);
        cleanup();
      }
    });
  }

  function startHost(session, roomId, hostPeer) {
    peer = hostPeer;
    roomStartTime = Date.now();
    userStartTime = Date.now();
    myId = '01';
    users[myId] = myName;

    session.printSuccess(`Room ${roomId} created. You are the host (01/${myName}).`);
    updateTitle(session);

    peer.on('connection', (conn) => {
      conn.on('data', (data) => {
        if (data.type === 'join') {
          let newId = null;
          for (let i = 2; i <= 99; i++) {
            const idStr = i.toString().padStart(2, '0');
            if (!users[idStr]) { newId = idStr; break; }
          }
          if (!newId) {
            conn.send({ type: 'error', message: 'Room is full' });
            conn.close();
            return;
          }
          users[newId] = data.name;
          conns[newId] = conn;
          conn.send({ type: 'joined', id: newId, users, roomStartTime });
          broadcast({ type: 'system', text: `${newId}/${data.name} joined the room.` });
          broadcast({ type: 'userlist', users });
        } else if (data.type === 'chat') {
          broadcast(data);
        } else if (data.type === 'file_offer') {
          const scan = scanFile(data.filename, data.content);
          if (!scan.safe) {
            session.printError(`Blocked file ${data.filename} from ${data.senderId}: ${scan.reason}`);
            conn.send({ type: 'error', message: `Security Alert: File ${data.filename} was blocked. Reason: ${scan.reason}` });
            return;
          }
          broadcast(data);
        }
      });

      conn.on('close', () => {
        for (const [id, c] of Object.entries(conns)) {
          if (c === conn) {
            const name = users[id];
            delete users[id];
            delete conns[id];
            broadcast({ type: 'system', text: `${id}/${name} left the room.` });
            broadcast({ type: 'userlist', users });
            break;
          }
        }
      });
    });

    peer.on('error', (err) => {
      session.printError('Host Error: ' + err.message);
    });
  }

  function startClient(session, roomId) {
    peer = new Peer();
    roomStartTime = Date.now();
    userStartTime = Date.now();

    peer.on('open', () => {
      hostConn = peer.connect('KALMA-ROOM-' + roomId);
      
      hostConn.on('open', () => {
        hostConn.send({ type: 'join', name: myName });
      });

      hostConn.on('data', (data) => {
        if (data.type === 'joined') {
          myId = data.id;
          users = data.users;
          roomStartTime = data.roomStartTime || Date.now();
          session.printSuccess(`Joined room ${roomId} as ${myId}/${myName}.`);
          updateTitle(session);
          session.printSystem(`Users: ${Object.keys(users).length}:[${Object.entries(users).map(([i,n])=>`${i}:${n}`).join(' ||| ')}]`);
        } else if (data.type === 'chat') {
          handleIncoming(session, data);
        } else if (data.type === 'system') {
          session.printSystem(data.text);
        } else if (data.type === 'userlist') {
          users = data.users;
          session.printSystem(`Users: ${Object.keys(users).length}:[${Object.entries(users).map(([i,n])=>`${i}:${n}`).join(' ||| ')}]`);
        } else if (data.type === 'file_offer') {
          handleIncoming(session, data);
        } else if (data.type === 'error') {
          session.printError(data.message);
        }
      });

      hostConn.on('close', () => {
        session.printError('Disconnected from host.');
        cleanup();
        updateTitle(session);
      });
    });

    peer.on('error', (err) => {
      session.printError('Client Error: ' + err.message);
      cleanup();
    });
  }

  function broadcast(data) {
    if (isHost) {
      handleIncoming(T.session, data);
      for (const conn of Object.values(conns)) {
        if (conn.open) conn.send(data);
      }
    } else if (hostConn && hostConn.open) {
      hostConn.send(data);
    }
  }

  function updateTitle(session) {
    if (session.wrapper) {
      const titleSpan = session.wrapper.querySelector('.mini-header span');
      if (titleSpan) titleSpan.textContent = `p2p | Room: ${myRoomId || 'None'}`;
    }
  }

  function handleIncoming(session, data) {
    if (data.type === 'chat') {
      session.printSystem(`[${data.senderId}/${data.senderName}]: ${data.text}`);
    } else if (data.type === 'system') {
      session.printSystem(data.text);
    } else if (data.type === 'userlist') {
      const list = Object.entries(data.users).map(([id, name]) => `${id}:${name}`).join(' ||| ');
      session.printSystem(`Users: ${Object.keys(data.users).length}:[${list}]`);
    } else if (data.type === 'file_offer') {
      const scan = scanFile(data.filename, data.content);
      if (!scan.safe) {
        session.printError(`Blocked file ${data.filename} from ${data.senderId}: ${scan.reason}`);
        return;
      }
      pendingFiles[data.filename] = data.content;
      session.printSystem(`[Im/${data.filename}] Received file from ${data.senderId}/${data.senderName}. Use 'im ${data.filename}' to save.`);
    }
  }

  async function cmdRoom(session, roomId) {
    if (!roomId) throw new Error('Usage: room{roomId}');
    await handleRoom(session, roomId);
  }

  function cmdMsg(session, text) {
    if (!myRoomId) throw new Error('You are not in a room.');
    broadcast({ type: 'chat', senderId: myId, senderName: myName, text });
  }

  function cmdUsers(session) {
    if (!myRoomId) throw new Error('You are not in a room.');
    const list = Object.entries(users).map(([id, name]) => `${id}:${name}`).join(' ||| ');
    session.printSystem(`Users: ${Object.keys(users).length}:[${list}]`);
  }

  async function cmdExport(session, filename) {
    if (!myRoomId) throw new Error('You are not in a room.');
    const target = T.Utils.resolvePath(session.cwd, filename);
    const file = await T.Storage.get(target, 'vfs');
    if (!file || file.type !== 'file') throw new Error('File not found: ' + filename);
    
    const scan = scanFile(filename, file.content);
    if (!scan.safe) {
      session.printError('Security Alert: ' + scan.reason);
      return;
    }

    broadcast({ type: 'file_offer', filename, content: file.content, senderId: myId, senderName: myName });
    session.printSystem(`Exported ${filename} to the room.`);
  }

  async function cmdImport(session, filename) {
    if (!myRoomId) throw new Error('You are not in a room.');
    if (!pendingFiles[filename]) throw new Error('No pending file named ' + filename);
    
    const content = pendingFiles[filename];
    const scan = scanFile(filename, content);
    if (!scan.safe) {
      session.printError('Security Alert: ' + scan.reason);
      delete pendingFiles[filename];
      return;
    }

    const target = T.Utils.resolvePath(session.cwd, filename);
    await T.Storage.set(target, { type: 'file', content }, 'vfs');
    delete pendingFiles[filename];
    session.printSuccess(`Saved ${filename} to terminal.`);
  }

  function cmdUptime(session) {
    if (!myRoomId) throw new Error('You are not in a room.');
    
    const format = (ms) => {
      const sec = Math.floor(ms / 1000);
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      return `${h}H ${m}M ${s}S`;
    };

    const roomUp = format(Date.now() - roomStartTime);
    const userUp = format(Date.now() - userStartTime);
    session.printSystem(`Uptime: ${roomUp} / ${userUp}`);
  }

  const originalCommands = T.commands;
  T.commands = new Proxy(originalCommands, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      const upper = prop.toUpperCase();

      if (upper.startsWith('ROOM{') && upper.endsWith('}')) {
        return function() { return cmdRoom(this, prop.slice(5, -1)); };
      }
      if (upper === 'ROOM') {
        return function(arg) { return cmdRoom(this, arg); };
      }

      if (prop.startsWith('/')) {
        return function(arg) { 
          const text = prop.slice(1) + (arg ? ' ' + arg : '');
          return cmdMsg(this, text); 
        };
      }

      if (upper === 'USER') return function() { return cmdUsers(this); };
      if (upper === 'UPTIME') return function() { return cmdUptime(this); };

      if (upper.startsWith('EX/')) {
        return function() { return cmdExport(this, prop.slice(3)); };
      }
      if (upper === 'EX') {
        return function(arg) { return cmdExport(this, arg); };
      }

      if (upper.startsWith('IM/')) {
        return function() { return Promise.resolve(); };
      }
      if (upper === 'IM') {
        return function(arg) { return cmdImport(this, arg); };
      }

      return Reflect.get(target, prop, receiver);
    }
  });

  T.registerExtension({
    name: 'p2p',
    info: 'P2P Room Chat loaded. Commands: room{id}, /msg, user, Ex/file, Im/file, im file, Uptime',
    commands: {
      P2P: function() { this.printSystem('P2P is active. Use room{id} to join.'); }
    }
  });
})();
