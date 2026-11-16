// guyfat-e - masaüstü programı (Electron)
const { app, BrowserWindow, ipcMain, session, Tray, Menu, globalShortcut, nativeImage, net, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { start: startServer } = require('../server.js');

if (!app.requestSingleInstanceLock()) app.quit();

const ICON = path.join(__dirname, '..', 'build', 'icon.png');
let win, tray, quitting = false;
let state = { muted: false, deafened: false, room: null };

// ---------------- Pencere ----------------
function createWindow() {
  win = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 420,
    minHeight: 480,
    backgroundColor: '#111318',
    title: 'guyfat-e',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // oyun ön plandayken de ses işlensin
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'public', 'index.html'));

  // Dış linkleri tarayıcıda aç
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Kapatınca tepsiye küçült (odadayken)
  let warned = false;
  win.on('close', (e) => {
    if (quitting || !state.room) return;
    e.preventDefault();
    win.hide();
    if (!warned && Notification.isSupported()) {
      warned = true;
      new Notification({ title: 'guyfat-e arka planda', body: 'Sohbet devam ediyor. Kapatmak için tepsideki simgeden "Çık"ı seç.', icon: ICON }).show();
    }
  });
}

function show() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------------- Tepsi ----------------
function updateTray() {
  if (!tray) return;
  const status = state.room ? `#${state.room}${state.muted ? ' · mikrofon kapalı' : ''}${state.deafened ? ' · ses kapalı' : ''}` : 'Odada değil';
  tray.setToolTip(`guyfat-e — ${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: status, enabled: false },
    { type: 'separator' },
    { label: 'Göster', click: show },
    { label: state.muted ? 'Mikrofonu aç' : 'Mikrofonu kapat', enabled: !!state.room, click: () => send('hotkey', 'mute') },
    { label: state.deafened ? 'Sesi aç' : 'Sesi kapat', enabled: !!state.room, click: () => send('hotkey', 'deaf') },
    { type: 'separator' },
    { label: 'Çık', click: () => { quitting = true; app.quit(); } },
  ]));
}

function send(ch, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, ...args);
}

ipcMain.on('state', (_e, s) => {
  state = { ...state, ...s };
  updateTray();
});

// ---------------- Sunucuyu bu bilgisayarda aç ----------------
let host = null; // { srv, port, tunnel, publicUrl }

function lanAddresses(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`);
  }
  return out;
}

function cloudflaredAsset() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  if (process.platform === 'win32') return { file: 'cloudflared.exe', url: `cloudflared-windows-${arch}.exe` };
  if (process.platform === 'darwin') return { file: 'cloudflared', url: `cloudflared-darwin-${arch}.tgz`, tgz: true };
  return { file: 'cloudflared', url: `cloudflared-linux-${arch}` };
}

function which(cmd) {
  return new Promise((resolve) => {
    execFile(process.platform === 'win32' ? 'where' : 'which', [cmd], (err, out) => resolve(err ? null : out.split(/\r?\n/)[0].trim() || null));
  });
}

async function getCloudflared(progress) {
  const onPath = await which('cloudflared');
  if (onPath) return onPath;
  const asset = cloudflaredAsset();
  const dir = path.join(app.getPath('userData'), 'bin');
  const bin = path.join(dir, asset.file);
  if (fs.existsSync(bin)) return bin;
  fs.mkdirSync(dir, { recursive: true });
  progress('Tünel aracı indiriliyor (yalnızca ilk seferde, ~40 MB)…');
  const res = await net.fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${asset.url}`);
  if (!res.ok) throw new Error(`İndirme başarısız (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (asset.tgz) {
    const tgz = bin + '.tgz';
    fs.writeFileSync(tgz, buf);
    await new Promise((ok, fail) => execFile('tar', ['-xzf', tgz, '-C', dir], (e) => (e ? fail(e) : ok())));
    fs.unlinkSync(tgz);
  } else {
    fs.writeFileSync(bin + '.part', buf);
    fs.renameSync(bin + '.part', bin);
  }
  fs.chmodSync(bin, 0o755);
  return bin;
}

function startTunnel(bin, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { windowsHide: true });
    let done = false;
    const timer = setTimeout(() => finish(new Error('Tünel 45 saniyede açılamadı.')), 45000);
    function finish(err, url) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) { child.kill(); reject(err); } else resolve({ child, url });
    }
    const scan = (d) => {
      const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) finish(null, m[0]);
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);
    child.on('error', (e) => finish(e));
    child.on('exit', (code) => {
      finish(new Error(`Tünel kapandı (kod ${code}).`));
      if (host && host.tunnel === child) {
        host.tunnel = null;
        host.publicUrl = null;
        send('host:status', { running: true, port: host.port, publicUrl: null, lan: lanAddresses(host.port), message: 'İnternet tüneli kapandı.' });
      }
    });
  });
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const srv = startServer(port, (p) => resolve({ srv, port: p }));
    srv.server.once('error', reject);
  });
}

ipcMain.handle('host:start', async () => {
  if (host) return { running: true, port: host.port, publicUrl: host.publicUrl, lan: lanAddresses(host.port) };
  const progress = (message) => send('host:status', { running: false, busy: true, message });
  progress('Sunucu başlatılıyor…');
  let r;
  try { r = await listen(3000); } catch { r = await listen(0); }
  host = { ...r, tunnel: null, publicUrl: null };
  const base = { running: true, port: host.port, lan: lanAddresses(host.port) };
  try {
    const bin = await getCloudflared(progress);
    progress('İnternet tüneli açılıyor…');
    const t = await startTunnel(bin, host.port);
    host.tunnel = t.child;
    host.publicUrl = t.url;
    return { ...base, publicUrl: t.url };
  } catch (e) {
    return { ...base, publicUrl: null, message: `İnternet tüneli açılamadı: ${e.message}` };
  }
});

function stopHost() {
  if (!host) return;
  if (host.tunnel) host.tunnel.kill();
  host.srv.close();
  host = null;
}
ipcMain.handle('host:stop', () => { stopHost(); return { running: false }; });

// ---------------- Başlangıç ----------------
app.on('second-instance', show);

app.whenReady().then(() => {
  // Mikrofon iznini otomatik ver
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'clipboard-sanitized-write', 'notifications'].includes(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => ['media', 'clipboard-sanitized-write', 'notifications'].includes(perm));

  createWindow();

  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.on('click', show);
  updateTray();

  // Hızlı tuşlar (her yerde çalışır)
  globalShortcut.register('CommandOrControl+Shift+M', () => send('hotkey', 'mute'));
  globalShortcut.register('CommandOrControl+Shift+D', () => send('hotkey', 'deaf'));
});

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopHost();
});
app.on('window-all-closed', () => app.quit());
