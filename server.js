// guyfat-e - sinyal sunucusu
// Ses sunucudan GEÇMEZ: kullanıcılar birbirine doğrudan (WebRTC, P2P) bağlanır.
// Bu sunucu sadece sayfayı sunar ve bağlantı kurulumu için mesajları iletir.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const MAX_PER_ROOM = Number(process.env.MAX_PER_ROOM) || 10;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Kalıcı odalar: boşken bile listede görünür, şifre konamaz.
//   PERMANENT_ROOMS="oturma odası,oyun odası"
const PERMANENT_ROOMS = (process.env.PERMANENT_ROOMS ?? 'oturma odası')
  .split(',')
  .map((s) => s.trim().slice(0, 40).toLowerCase())
  .filter(Boolean);

// Giriş kodu: ayarlıysa kodu bilmeyen oda listesini göremez ve hiçbir odaya giremez.
//   ACCESS_CODE=123456   (boşsa giriş kodu sorulmaz)
const ACCESS_CODE = String(process.env.ACCESS_CODE || '');
const MAX_FAILS = 8; // aynı adresten bu kadar yanlış denemeden sonra 10 dakika beklet
const FAIL_WINDOW = 10 * 60 * 1000;
const fails = new Map(); // ip -> { n, until }
function checkCode(ip, code) {
  if (!ACCESS_CODE) return { ok: true };
  const now = Date.now();
  let f = fails.get(ip);
  if (f && f.until < now) { fails.delete(ip); f = null; }
  if (f && f.n >= MAX_FAILS) return { ok: false, message: 'Çok fazla yanlış deneme. 10 dakika sonra tekrar dene.' };
  const given = String(code ?? '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(ACCESS_CODE).digest();
  if (crypto.timingSafeEqual(a, b)) return { ok: true };
  if (!given) return { ok: false, message: '' }; // henüz kod girilmemiş: deneme sayılmaz
  f = f || { n: 0, until: now + FAIL_WINDOW };
  f.n++;
  fails.set(ip, f);
  return { ok: false, message: 'Giriş kodu yanlış.' };
}

// İsteğe bağlı TURN sunucusu (bazı ağlarda/CGNAT'ta doğrudan bağlantı kurulamazsa gerekir)
//   TURN_URL=turn:sunucu.com:3478  TURN_USER=kullanici  TURN_PASS=sifre
function iceServers() {
  const list = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  if (process.env.TURN_URL) {
    list.push({
      urls: process.env.TURN_URL.split(',').map((s) => s.trim()),
      username: process.env.TURN_USER || '',
      credential: process.env.TURN_PASS || '',
    });
  }
  return list;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function start(port, onListening) {
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/config') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*', // masaüstü programı için
    });
    return res.end(JSON.stringify({ iceServers: iceServers() }));
  }
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Bulunamadı');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// rooms: oda adı -> { password, peers: Map<id, {ws, name, muted, deafened}> }
const rooms = new Map();
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptId) {
  for (const [id, p] of room.peers) if (id !== exceptId) send(p.ws, msg);
}

function publicPeer(id, p) {
  return { id, name: p.name, muted: p.muted, deafened: p.deafened };
}

// ---- Oda listesi (lobi): programı açan herkes odaları ve içindekileri canlı görür ----
const lobby = new Set();
function roomList() {
  const names = new Set([...PERMANENT_ROOMS, ...rooms.keys()]);
  return [...names]
    .map((name) => {
      const room = rooms.get(name);
      return {
        name,
        permanent: PERMANENT_ROOMS.includes(name),
        locked: !!(room && room.password),
        peers: room ? [...room.peers.values()].map((p) => ({ name: p.name, muted: p.muted, deafened: p.deafened })) : [],
      };
    })
    .sort((a, b) => (b.permanent - a.permanent) || a.name.localeCompare(b.name, 'tr'));
}
let lobbyTimer = null;
function lobbyChanged() {
  if (lobbyTimer || lobby.size === 0) return;
  lobbyTimer = setTimeout(() => {
    lobbyTimer = null;
    const msg = { type: 'rooms', rooms: roomList() };
    for (const ws of lobby) send(ws, msg);
  }, 150);
}

wss.on('connection', (ws, req) => {
  const id = crypto.randomUUID();
  // Render gibi bir vekilin arkasındaysak gerçek adres x-forwarded-for başlığındadır
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
  let badTries = 0;
  const auth = (code) => {
    const c = checkCode(ip, code);
    // Aynı bağlantıdan art arda yanlış deneme: bağlantıyı kapat
    if (!c.ok && c.message && ++badTries >= 5) setTimeout(() => ws.terminate(), 200);
    return c;
  };
  let roomName = null;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'lobby') {
      const c = auth(msg.code);
      if (!c.ok) {
        lobby.delete(ws);
        return send(ws, { type: 'auth', message: c.message });
      }
      lobby.add(ws);
      return send(ws, { type: 'rooms', rooms: roomList() });
    }

    if (msg.type === 'join' && !roomName) {
      const rn = String(msg.room || '').trim().slice(0, 40).toLowerCase();
      const name = String(msg.name || '').trim().slice(0, 24) || 'Oyuncu';
      const permanent = PERMANENT_ROOMS.includes(rn);
      const password = permanent ? '' : String(msg.password || '');
      const c = auth(msg.code);
      if (!c.ok) return send(ws, { type: 'error', auth: true, message: c.message || 'Giriş kodu gerekli.' });
      if (!rn) return send(ws, { type: 'error', message: 'Oda adı gerekli.' });

      let room = rooms.get(rn);
      if (!room) {
        room = { password, peers: new Map() };
        rooms.set(rn, room);
      } else if (room.password && room.password !== password) {
        return send(ws, { type: 'error', message: 'Oda şifresi yanlış.' });
      }
      if (room.peers.size >= MAX_PER_ROOM) {
        return send(ws, { type: 'error', message: `Oda dolu (en fazla ${MAX_PER_ROOM} kişi).` });
      }

      roomName = rn;
      const me = { ws, name, muted: false, deafened: false };
      send(ws, {
        type: 'joined',
        id,
        room: rn,
        peers: [...room.peers].map(([pid, p]) => publicPeer(pid, p)),
      });
      room.peers.set(id, me);
      broadcast(room, { type: 'peer-joined', peer: publicPeer(id, me) }, id);
      console.log(`[${rn}] ${name} katıldı (${room.peers.size} kişi)`);
      lobbyChanged();
      return;
    }

    const room = roomName && rooms.get(roomName);
    if (!room) return;

    if (msg.type === 'signal') {
      const target = room.peers.get(msg.to);
      if (target) send(target.ws, { type: 'signal', from: id, data: msg.data });
    } else if (msg.type === 'state') {
      const me = room.peers.get(id);
      if (!me) return;
      me.muted = !!msg.muted;
      me.deafened = !!msg.deafened;
      broadcast(room, { type: 'peer-state', id, muted: me.muted, deafened: me.deafened }, id);
      lobbyChanged();
    }
  });

  ws.on('close', () => {
    lobby.delete(ws);
    const room = roomName && rooms.get(roomName);
    if (!room) return;
    const me = room.peers.get(id);
    room.peers.delete(id);
    broadcast(room, { type: 'peer-left', id });
    if (me) console.log(`[${roomName}] ${me.name} ayrıldı (${room.peers.size} kişi)`);
    if (room.peers.size === 0) rooms.delete(roomName);
    lobbyChanged();
  });
});

// Kopan bağlantıları temizle, tünellerin (cloudflared vb.) bağlantıyı kapatmasını önle
const pinger = setInterval(() => {
  const now = Date.now();
  for (const [ip, f] of fails) if (f.until < now) fails.delete(ip);
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

server.on('close', () => clearInterval(pinger));
server.listen(port, () => onListening && onListening(server.address().port));
return {
  server,
  close() {
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    server.close();
  },
};
}

module.exports = { start };

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  start(PORT, (port) => {
    console.log(`guyfat-e çalışıyor: http://localhost:${port}`);
    console.log('Arkadaşlarının bağlanabilmesi için HTTPS adresi gerekir (README.md\'ye bak).');
  });
}
