/**
 * serve.js — Chạy web VN trên máy và cho các máy cùng mạng LAN vào xem (không cần cài thêm gói nào).
 *
 *   node tools/serve.js            → cổng 8080
 *   node tools/serve.js 3000       → cổng 3000
 *
 * Thường không cần gõ lệnh: nhấp đúp CHAY-WEB.bat (Windows) hoặc chay-web.command (Mac).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');           // thư mục web-vn
const PORT = parseInt(process.argv[2] || process.env.PORT || '8080', 10);
const HOST = '0.0.0.0';                               // nghe trên mọi card mạng để máy khác trong LAN vào được

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.mp4': 'video/mp4',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8'
};
const BLOCK = /(^|[\\/])(\.git|node_modules|tools|backups)([\\/]|$)/; // không cho xem mã nguồn công cụ / git / file sao lưu

/* ---------- Sao lưu dữ liệu giám sát của web VN ----------
 * Trang analytics.html gửi file sao lưu về đây, lưu vào thư mục riêng web-vn/backups/ (đổi bằng biến BACKUP_DIR).
 *   GET  /api/backup/health    — kiểm tra
 *   GET  /api/backup/list      — danh sách file
 *   POST /api/backup/save-batch — lưu file { files: [{ fileName, content, encoding: 'base64' | 'utf8' }] }
 *   POST /api/backup/download  — tải 1 file { name, pin } — cần mã PIN của trang giám sát; sai 5 lần khoá 15 phút
 * Chỉ nhận tên file dạng hohai-vn_YYYY-MM-DD.xlsx / .xls / .json. Thư mục backups/ không xem được qua web. */
const crypto = require('crypto');
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(ROOT, 'backups'));
const BACKUP_NAME = /^hohai-vn_\d{4}-\d{2}-\d{2}\.(xlsx|xls|json)$/;
// SHA-256('hohai-vn:' + PIN) — giống PIN_HASH trong js/monitor.js
const PIN_HASH = process.env.BACKUP_PIN_HASH || '1c27bf2815fd0f4a37fa4c9c9b5ca42997d9468657546d5fb8c370913bd55c6a';
const MAX_BODY = 60 * 1024 * 1024;
const pinFails = {};
const BK_TYPES = { '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel', '.json': 'application/json; charset=utf-8' };

function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function readJSON(req, cb) {
  const chunks = []; let size = 0, done = false;
  req.on('data', (c) => { size += c.length; if (size > MAX_BODY && !done) { done = true; cb(new Error('too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { if (done) return; done = true; try { cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { cb(e); } });
  req.on('error', (e) => { if (!done) { done = true; cb(e); } });
}

function handleBackup(req, res, url) {
  if (url === '/api/backup/health' && req.method === 'GET') {
    return sendJSON(res, 200, { status: 'ok', service: 'HoHai VN backup', backupDir: BACKUP_DIR, features: ['base64', 'download'] });
  }
  if (url === '/api/backup/list' && req.method === 'GET') {
    let names = [];
    try { names = fs.readdirSync(BACKUP_DIR); } catch (e) { names = []; }
    const files = names.filter((n) => BACKUP_NAME.test(n)).map((n) => {
      const st = fs.statSync(path.join(BACKUP_DIR, n));
      return { name: n, size: st.size, created: st.birthtime.toISOString(), modified: st.mtime.toISOString() };
    });
    return sendJSON(res, 200, { count: files.length, files });
  }
  if (url === '/api/backup/save-batch' && req.method === 'POST') {
    return readJSON(req, (err, body) => {
      if (err || !body || !Array.isArray(body.files) || !body.files.length) return sendJSON(res, 400, { error: 'Bad request' });
      if (body.files.some((f) => !f || !BACKUP_NAME.test(String(f.fileName || '')) || typeof f.content !== 'string')) return sendJSON(res, 400, { error: 'Invalid file name' });
      try {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const out = body.files.map((f) => {
          const p = path.join(BACKUP_DIR, f.fileName);
          fs.writeFileSync(p, f.encoding === 'base64' ? Buffer.from(f.content, 'base64') : f.content, f.encoding === 'base64' ? undefined : 'utf8');
          console.log('  [Sao lưu] Đã lưu ' + f.fileName);
          return { fileName: f.fileName, size: fs.statSync(p).size, success: true };
        });
        sendJSON(res, 200, { success: true, files: out });
      } catch (e) { sendJSON(res, 500, { error: 'Cannot save: ' + e.message }); }
    });
  }
  if (url === '/api/backup/download' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || '';
    if (pinFails[ip] && pinFails[ip].until > Date.now()) return sendJSON(res, 429, { error: 'Locked' });
    return readJSON(req, (err, body) => {
      if (err || !body) return sendJSON(res, 400, { error: 'Bad request' });
      const hash = crypto.createHash('sha256').update('hohai-vn:' + String(body.pin || '')).digest('hex');
      if (hash !== PIN_HASH) {
        const f = pinFails[ip] || (pinFails[ip] = { n: 0, until: 0 });
        if (++f.n >= 5) { f.n = 0; f.until = Date.now() + 15 * 60e3; }
        return sendJSON(res, 401, { error: 'Wrong PIN' });
      }
      delete pinFails[ip];
      const name = String(body.name || '');
      if (!BACKUP_NAME.test(name)) return sendJSON(res, 403, { error: 'File not allowed' });
      const p = path.join(BACKUP_DIR, name);
      if (!fs.existsSync(p)) return sendJSON(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': BK_TYPES[path.extname(name)] || 'application/octet-stream', 'Content-Disposition': 'attachment; filename="' + name + '"', 'Cache-Control': 'no-store' });
      fs.createReadStream(p).pipe(res);
    });
  }
  return sendJSON(res, 404, { error: 'API not found' });
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { rel = '/'; }
  if (rel.indexOf('/api/backup/') === 0) return handleBackup(req, res, rel);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || BLOCK.test(path.relative(ROOT, file))) { res.writeHead(403); return res.end('403'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h1>404</h1><p>Không có trang này. <a href="/">Về trang chủ</a></p>');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache'   // luôn lấy bản mới khi sửa web
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error('\n  Cổng ' + PORT + ' đang bị chương trình khác dùng. Thử: node tools/serve.js ' + (PORT + 1) + '\n');
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const ips = lanAddresses();
  console.log('\n  Web HoHai VN đang chạy  /  网站已启动\n');
  console.log('  Trên máy này / 本机:            http://localhost:' + PORT);
  ips.forEach((ip) => console.log('  Máy khác cùng mạng / 局域网:  http://' + ip + ':' + PORT));
  console.log('  Trang giám sát / 监控页面:       http://' + (ips[0] || 'localhost') + ':' + PORT + '/analytics.html');
  console.log('  File sao lưu / 备份文件:         ' + BACKUP_DIR);
  console.log('\n  Máy khác không vào được? Chạy MO-TUONG-LUA.bat (Windows) một lần.');
  console.log('  其他电脑打不开？请运行一次 MO-TUONG-LUA.bat（Windows）。');
  console.log('\n  Đóng cửa sổ này để tắt web.  关闭此窗口即可停止网站。\n');
});
