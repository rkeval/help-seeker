// Serves the exported app and forwards /api to the backend, so the browser sees one origin (no CORS needed).
const http = require('http'), fs = require('fs'), path = require('path');
const DIST = process.argv[2], API = Number(process.argv[3]), PORT = Number(process.argv[4]);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png', '.ttf': 'font/ttf' };
http.createServer((req, res) => {
  if (req.url.startsWith('/api/') || req.url === '/healthz') {
    const up = http.request({ host: 'localhost', port: API, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(up); return;
  }
  let f = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log('proxy on', PORT));
