const os = require('os');
const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

const dataDir = path.join(__dirname, '..', 'data');
const caKeyPath = path.join(dataDir, 'ca-key.pem');
const caCertPath = path.join(dataDir, 'ca-cert.pem');

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function localIPv4Addresses() {
  const addrs = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const info of iface || []) {
      if (info.family === 'IPv4' && !info.internal) addrs.push(info.address);
    }
  }
  return addrs;
}

// The root CA is generated once and cached on disk. Install its public cert
// on a device (via GET /ca-cert) and it stays trusted forever — every leaf
// certificate this server issues afterwards (even across restarts and LAN
// IP changes) is signed by this same CA, so no per-visit browser warning.
async function getOrCreateCA() {
  if (fs.existsSync(caKeyPath) && fs.existsSync(caCertPath)) {
    return {
      key: fs.readFileSync(caKeyPath, 'utf8'),
      cert: fs.readFileSync(caCertPath, 'utf8'),
    };
  }

  const pems = await selfsigned.generate([{ name: 'commonName', value: 'Mini POS Local CA' }], {
    notAfterDate: daysFromNow(3650),
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    ],
  });

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(caKeyPath, pems.private, { mode: 0o600 });
  fs.writeFileSync(caCertPath, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

// The leaf (server) certificate is cheap to regenerate, so it's rebuilt
// fresh on every start with whatever LAN IPs are currently active — no
// staleness problem when DHCP hands out a new address.
async function generateServerCert() {
  const ca = await getOrCreateCA();

  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...localIPv4Addresses().map(ip => ({ type: 7, ip })),
  ];

  const pems = await selfsigned.generate([{ name: 'commonName', value: 'mini-pos.local' }], {
    notAfterDate: daysFromNow(825),
    keySize: 2048,
    algorithm: 'sha256',
    ca,
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true, critical: false },
      { name: 'subjectAltName', altNames, critical: false },
    ],
  });

  return { key: pems.private, cert: pems.cert, caCert: ca.cert };
}

module.exports = { generateServerCert, getOrCreateCA, localIPv4Addresses, caCertPath };
