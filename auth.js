const crypto = require('crypto');
const db     = require('./db');

// ===================== JWT خفيف بدون مكتبة خارجية =====================
// header.payload.signature  — HS256 بمفتاح من .env

if (!process.env.JWT_SECRET) {
  console.error('❌ خطأ فادح: متغير JWT_SECRET مش موجود في .env');
  process.exit(1);
}
const JWT_SECRET  = process.env.JWT_SECRET;
const TOKEN_TTL   = 8 * 60 * 60 * 1000; // 8 ساعات بالمللي ثانية

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function signToken(payload) {
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body    = b64url(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + TOKEN_TTL }));
  const sig     = b64url(crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = b64url(crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest());
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (Date.now() > payload.exp) return null;  // انتهت صلاحية التوكن
    return payload;
  } catch { return null; }
}

// ===================== Middleware: التحقق من المالك =====================
function authenticateOwner(req, res, next) {
  const token = req.headers['x-owner-token'];
  if (!token) return res.json({ ok: false, error: 'غير مصرح' });
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'owner') return res.json({ ok: false, error: 'التوكن غير صالح أو منتهي' });
  req.ownerUsername = payload.username;
  next();
}

// ===================== إصدار توكن للمالك بعد تسجيل الدخول =====================
function issueOwnerToken(username, password) {
  if (!db.verifyOwner(username, password)) return null;
  return signToken({ username, role: 'owner' });
}

// ===================== Device Fingerprint =====================
function generateFingerprint(deviceInfo) {
  const str = JSON.stringify(deviceInfo || {});
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

module.exports = { authenticateOwner, issueOwnerToken, generateFingerprint };
