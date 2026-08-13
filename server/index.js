// เซิร์ฟเวอร์หลัก เปิด HTTP+HTTPS, ป้องกัน API ทุกเส้นด้วย login │

const express = require('express');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

require('./db');

const productsRouter = require('./routes/products');
const salesRouter = require('./routes/sales');
const reportsRouter = require('./routes/reports');
const settingsRouter = require('./routes/settings');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const { generateServerCert, localIPv4Addresses, caCertPath } = require('./lib/cert');
const { getSessionUser, parseCookies, COOKIE_NAME } = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

app.use(express.json());

// Serve the CA's public certificate so it can be installed as a trusted
// profile on a device (Settings > General > VPN & Device Management, then
// enable full trust under About > Certificate Trust Settings). Reachable
// over plain HTTP since downloading a cert file doesn't need a secure
// context — only camera access does.
app.get('/ca-cert', (req, res) => {
  const pem = fs.readFileSync(caCertPath, 'utf8');
  const der = new crypto.X509Certificate(pem).raw;
  res.set('Content-Type', 'application/x-x509-ca-cert');
  res.set('Content-Disposition', 'attachment; filename="mini-pos-ca.crt"');
  res.send(der);
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', authRouter);

// Every other API route requires a valid session — the HTML/JS/CSS shells
// stay publicly served (see express.static above) and each page redirects
// to login.html itself via js/auth.js; this middleware is what actually
// keeps shop data out of reach without a session.
function requireAuth(req, res, next) {
  const user = getSessionUser(parseCookies(req)[COOKIE_NAME]);
  if (!user) return res.status(401).json({ error: 'ไม่ได้เข้าสู่ระบบ' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'ต้องเป็นแอดมินเท่านั้น' });
  next();
}

app.use('/api/products', requireAuth, productsRouter);
app.use('/api/sales', requireAuth, salesRouter);
app.use('/api/reports', requireAuth, reportsRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/users', requireAuth, requireAdmin, usersRouter);

http.createServer(app).listen(PORT, () => {
  console.log(`Mini POS (HTTP)  running at http://localhost:${PORT}`);
});

// Camera access (barcode scanning) requires a secure context, which plain
// HTTP on a LAN IP does not satisfy. This HTTPS listener uses a certificate
// signed by a locally-generated CA (see server/lib/cert.js) — install the CA
// once via /ca-cert and every future visit here is fully trusted, with no
// per-restart or per-IP-change warnings.
generateServerCert().then(({ key, cert }) => {
  https.createServer({ key, cert }, app).listen(HTTPS_PORT, () => {
    console.log(`Mini POS (HTTPS) running at https://localhost:${HTTPS_PORT}`);
    for (const ip of localIPv4Addresses()) {
      console.log(`  also at             https://${ip}:${HTTPS_PORT}`);
    }
    console.log(`  install CA once at  http://localhost:${PORT}/ca-cert  (then trust it in Settings)`);
  });
});
