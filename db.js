const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const path     = require('path');

const db = new Database(path.join(__dirname, 'chat.db'));

// ===================== مفتاح تشفير الرسائل الخاصة =====================
// لازم يكون موجود في .env  —  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
if (!process.env.MSG_SECRET) {
  console.error('❌ خطأ فادح: متغير MSG_SECRET مش موجود في .env — السيرفر مش هيشتغل بدونه.');
  process.exit(1);
}
const ENCRYPT_KEY = process.env.MSG_SECRET;
const KEY = crypto.scryptSync(ENCRYPT_KEY, 'salt_livechat_v3', 32);

function encryptMsg(text) {
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', KEY, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}

function decryptMsg(data) {
  try {
    const [ivHex, encHex] = data.split(':');
    const iv  = Buffer.from(ivHex, 'hex');
    const enc = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, iv);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch { return '[رسالة تالفة]'; }
}

// ===================== إنشاء الجداول =====================
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    username  TEXT UNIQUE NOT NULL,
    password  TEXT NOT NULL,
    role      TEXT DEFAULT 'member',
    nameColor TEXT DEFAULT NULL,
    banned    INTEGER DEFAULT 0,
    createdAt INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS owner (
    id       INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    password TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS banned_ips (
    ip        TEXT PRIMARY KEY,
    reason    TEXT,
    bannedAt  INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS banned_serials (
    serial    TEXT PRIMARY KEY,
    reason    TEXT,
    bannedAt  INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS private_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_key   TEXT NOT NULL,
    sender     TEXT NOT NULL,
    receiver   TEXT NOT NULL,
    message    TEXT NOT NULL,
    createdAt  INTEGER DEFAULT (strftime('%s','now'))
  );
`);

// إنشاء حساب المالك لأول مرة فقط — البيانات من .env
const ownerExists = db.prepare('SELECT id FROM owner WHERE id=1').get();
if (!ownerExists) {
  const ownerUser = process.env.OWNER_USERNAME || 'admin';
  const ownerPass = process.env.OWNER_PASSWORD;
  if (!ownerPass) {
    console.error('❌ خطأ: OWNER_PASSWORD مش موجود في .env — السيرفر مش هيشتغل بدونه.');
    process.exit(1);
  }
  const hashed = bcrypt.hashSync(ownerPass, 10);
  db.prepare('INSERT INTO owner (id, username, password) VALUES (1, ?, ?)').run(ownerUser, hashed);
  console.log(`✅ تم إنشاء حساب المالك: ${ownerUser} — غيّر كلمة المرور من لوحة التحكم`);
}

// ===================== دوال المستخدمين =====================
const USERNAME_RE = /^[\u0600-\u06FFa-zA-Z0-9_\-. ]{3,20}$/;

function registerUser(username, password) {
  try {
    if (!username || !USERNAME_RE.test(username.trim()))
      return { ok: false, error: 'الاسم يجب أن يكون 3-20 حرفاً (حروف وأرقام وشرطة سفلية فقط)' };
    if (!password || password.length < 6)
      return { ok: false, error: 'كلمة المرور قصيرة جداً (6 أحرف على الأقل)' };
    const clean  = username.trim();
    const hashed = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(clean, hashed);
    return { ok: true };
  } catch (e) {
    if (e.message.includes('UNIQUE')) return { ok: false, error: 'الاسم مستخدم بالفعل' };
    return { ok: false, error: 'خطأ في التسجيل' };
  }
}

function loginUser(username, password) {
  const owner = db.prepare('SELECT * FROM owner WHERE username=?').get(username);
  if (owner) {
    const match = bcrypt.compareSync(password, owner.password);
    if (!match) return { ok: false, error: 'كلمة المرور غلط' };
    return { ok: true, user: { username: owner.username, role: 'owner', nameColor: '#FFD700', banned: false } };
  }
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user)         return { ok: false, error: 'اليوزر مش موجود' };
  if (user.banned)   return { ok: false, error: 'أنت محظور' };
  const match = bcrypt.compareSync(password, user.password);
  if (!match)        return { ok: false, error: 'كلمة المرور غلط' };
  return { ok: true, user: { username: user.username, role: user.role, nameColor: user.nameColor, banned: false } };
}

function getAllUsers() {
  return db.prepare('SELECT id, username, role, nameColor, banned, createdAt FROM users ORDER BY createdAt DESC').all();
}

function setUserRole(username, role) {
  const valid = ['member', 'moderator', 'host', 'vip', 'admin'];
  if (!valid.includes(role)) return { ok: false, error: 'رول غير صحيح' };
  const info = db.prepare('UPDATE users SET role=? WHERE username=?').run(role, username);
  if (info.changes === 0) return { ok: false, error: 'المستخدم غير موجود' };
  return { ok: true };
}

function setUserColor(username, color) {
  db.prepare('UPDATE users SET nameColor=? WHERE username=?').run(color, username);
  return { ok: true };
}

function banUser(username) {
  db.prepare('UPDATE users SET banned=1 WHERE username=?').run(username);
  return { ok: true };
}

function unbanUser(username) {
  db.prepare('UPDATE users SET banned=0 WHERE username=?').run(username);
  return { ok: true };
}

// ===================== حظر بالـ IP =====================
function banIP(ip, reason) {
  db.prepare('INSERT OR REPLACE INTO banned_ips (ip, reason) VALUES (?, ?)').run(ip, reason || 'محظور');
  return { ok: true };
}

function unbanIP(ip) {
  db.prepare('DELETE FROM banned_ips WHERE ip=?').run(ip);
  return { ok: true };
}

function isIPBanned(ip) {
  return !!db.prepare('SELECT ip FROM banned_ips WHERE ip=?').get(ip);
}

function getAllBannedIPs() {
  return db.prepare('SELECT * FROM banned_ips ORDER BY bannedAt DESC').all();
}

// ===================== رسائل خاصة مشفرة =====================
function savePrivateMsg(sender, receiver, text) {
  const key = [sender, receiver].sort().join('__');
  const encrypted = encryptMsg(text);
  db.prepare('INSERT INTO private_messages (chat_key, sender, receiver, message) VALUES (?, ?, ?, ?)')
    .run(key, sender, receiver, encrypted);
}

function getPrivateMsgs(user1, user2) {
  const key = [user1, user2].sort().join('__');
  const rows = db.prepare('SELECT * FROM private_messages WHERE chat_key=? ORDER BY createdAt ASC').all(key);
  return rows.map(r => ({ ...r, message: decryptMsg(r.message) }));
}

function getAllPrivateChats() {
  const rows = db.prepare('SELECT DISTINCT chat_key FROM private_messages').all();
  return rows.map(r => {
    const msgs = db.prepare('SELECT * FROM private_messages WHERE chat_key=? ORDER BY createdAt ASC').all(r.chat_key);
    return { key: r.chat_key, messages: msgs.map(m => ({ ...m, message: decryptMsg(m.message) })) };
  });
}

// ===================== المالك =====================
function getRealOwnerUsername() {
  const owner = db.prepare('SELECT username FROM owner WHERE id=1').get();
  return owner ? owner.username : null;
}

function verifyOwner(username, password) {
  const owner = db.prepare('SELECT * FROM owner WHERE username=?').get(username);
  if (!owner) return false;
  return bcrypt.compareSync(password, owner.password);
}

function changeOwnerPassword(newPassword) {
  if (!newPassword || newPassword.length < 6) return { ok: false, error: 'كلمة المرور قصيرة جداً' };
  const hashed = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE owner SET password=? WHERE id=1').run(hashed);
  return { ok: true };
}

// ===================== حظر بالـ Serial =====================
function banSerial(serial, reason) {
  if (!serial) return { ok: false, error: 'serial مطلوب' };
  db.prepare('INSERT OR REPLACE INTO banned_serials (serial, reason) VALUES (?, ?)').run(serial, reason || 'محظور');
  return { ok: true };
}

function unbanSerial(serial) {
  db.prepare('DELETE FROM banned_serials WHERE serial=?').run(serial);
  return { ok: true };
}

function isSerialBanned(serial) {
  if (!serial) return false;
  return !!db.prepare('SELECT serial FROM banned_serials WHERE serial=?').get(serial);
}

function getAllBannedSerials() {
  return db.prepare('SELECT * FROM banned_serials ORDER BY bannedAt DESC').all();
}

module.exports = {
  registerUser, loginUser, getAllUsers,
  setUserRole, setUserColor,
  banUser, unbanUser,
  banIP, unbanIP, isIPBanned, getAllBannedIPs,
  banSerial, unbanSerial, isSerialBanned, getAllBannedSerials,
  savePrivateMsg, getPrivateMsgs, getAllPrivateChats,
  getRealOwnerUsername, verifyOwner, changeOwnerPassword,
};
// placeholder
