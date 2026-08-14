// เซิร์ฟเวอร์หลัก เปิด HTTP (+ HTTPS ปลอมสำหรับใช้ในร้าน ถ้า ENABLE_LOCAL_HTTPS ไม่ได้ตั้งเป็น false), ป้องกัน API ทุกเส้นด้วย login

const express = require('express');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

const db = require('./db');
const asyncHandler = require('./lib/asyncHandler');

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

// The self-signed CA + HTTPS listener below only make sense for the
// in-shop LAN setup, where installing that CA once on the iPad is a
// one-time manual step. A real deploy host (Railway, a VPS with Let's
// Encrypt, etc.) terminates real, browser-trusted HTTPS in front of this
// app on its own — plain HTTP internally is the correct, standard setup
// there, and generating a self-signed cert would just be pointless
// overhead nobody outside the shop could use anyway. Defaults to on so the
// current in-shop server needs zero config change; set to 'false' in the
// deploy host's environment variables to skip it.
const ENABLE_LOCAL_HTTPS = process.env.ENABLE_LOCAL_HTTPS !== 'false';

app.use(express.json());

if (ENABLE_LOCAL_HTTPS) {
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
}

app.use(express.static(path.join(__dirname, '..', 'public')));

// Product photos live in the product_images table (see server/db.js), not
// on local disk, so they survive moving this app to a different host.
// Public/unauthenticated to match how /uploads/* files used to be served
// by express.static above — a given id's bytes never change once created
// (replacing a photo makes a new id and deletes the old one), so this is
// safe to cache hard.
app.get('/uploads/:id', asyncHandler(async (req, res) => {
  const { rows: [image] } = await db.query('SELECT content_type, data FROM product_images WHERE id = $1', [req.params.id]);
  if (!image) return res.status(404).end();
  res.set('Content-Type', image.content_type);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(image.data);
}));

app.use('/api/auth', authRouter);

// Every other API route requires a valid session — the HTML/JS/CSS shells
// stay publicly served (see express.static above) and each page redirects
// to login.html itself via js/auth.js; this middleware is what actually
// keeps shop data out of reach without a session.
const requireAuth = asyncHandler(async (req, res, next) => {
  const user = await getSessionUser(parseCookies(req)[COOKIE_NAME]);
  if (!user) return res.status(401).json({ error: 'ไม่ได้เข้าสู่ระบบ' });
  req.user = user;
  next();
});

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'ต้องเป็นแอดมินเท่านั้น' });
  next();
}

app.use('/api/products', requireAuth, productsRouter);
app.use('/api/sales', requireAuth, salesRouter);
app.use('/api/reports', requireAuth, reportsRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/users', requireAuth, requireAdmin, usersRouter);

// Catches anything an asyncHandler-wrapped route passed to next(err), plus
// sync throws Express already catches on its own. Always a plain JSON 500 —
// never the framework's default HTML error page, which echoes the stack
// trace (internal file paths, code structure) straight into the response
// whenever NODE_ENV isn't 'production'.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

async function main() {
  await db.initSchema();

  http.createServer(app).listen(PORT, () => {
    console.log(`Mini POS (HTTP)  running at http://localhost:${PORT}`);
  });

  if (!ENABLE_LOCAL_HTTPS) {
    console.log('ENABLE_LOCAL_HTTPS=false — skipping self-signed HTTPS (deploy host is expected to provide real HTTPS in front of this app).');
    return;
  }

  // Camera access (barcode scanning) requires a secure context, which plain
  // HTTP on a LAN IP does not satisfy. This HTTPS listener uses a certificate
  // signed by a locally-generated CA (see server/lib/cert.js) — install the CA
  // once via /ca-cert and every future visit here is fully trusted, with no
  // per-restart or per-IP-change warnings.
  const { key, cert } = await generateServerCert();
  https.createServer({ key, cert }, app).listen(HTTPS_PORT, () => {
    console.log(`Mini POS (HTTPS) running at https://localhost:${HTTPS_PORT}`);
    for (const ip of localIPv4Addresses()) {
      console.log(`  also at             https://${ip}:${HTTPS_PORT}`);
    }
    console.log(`  install CA once at  http://localhost:${PORT}/ca-cert  (then trust it in Settings)`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
