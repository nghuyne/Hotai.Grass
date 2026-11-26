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
const BLOCK = /(^|[\\/])(\.git|node_modules|tools)([\\/]|$)/; // không cho xem mã nguồn công cụ / git

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
  console.log('\n  Máy khác không vào được? Chạy MO-TUONG-LUA.bat (Windows) một lần.');
  console.log('  其他电脑打不开？请运行一次 MO-TUONG-LUA.bat（Windows）。');
  console.log('\n  Đóng cửa sổ này để tắt web.  关闭此窗口即可停止网站。\n');
});
