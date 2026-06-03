const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

require('dotenv').config();

const db = new Database(path.join(__dirname, 'chat.db'));

if (!process.env.MSG_SECRET) {
  console.error('❌ MSG_SECRET missing in environment variables');
  process.exit(1);
}

const KEY = crypto.scryptSync(process.env.MSG_SECRET, 'salt_livechat_v3', 32);

function encryptMsg(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptMsg(data) {
  try {
    const [ivHex, encHex] = data.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, iv);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return '[رسالة تالفة]';
  }
}

/* ===================== الجداول ===================== */

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  nameColor TEXT DEFAULT NULL,
  banned INTEGER DEFAULT 0,
  createdAt INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS banned_ips (
  ip TEXT PRIMARY KEY,
  reason TEXT,
  bannedAt INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS banned_serials (
  serial TEXT PRIMARY KEY,
  reason TEXT,
  bannedAt INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS private_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_key TEXT NOT NULL,
  sender TEXT NOT NULL,
  receiver TEXT NOT NULL,
  message TEXT NOT NULL,
  createdAt INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS room_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT NOT NULL,
  username TEXT NOT NULL,
  role TEXT,
  nameColor TEXT,
  message TEXT NOT NULL,
  createdAt INTEGER DEFAULT (strftime('%s','now'))
);
`);

/* ===================== المستخدمين ===================== */

const USERNAME_RE = /^[\u0600-\u06FFa-zA-Z0-9_\-. ]{3,20}$/;

function registerUser(username, password) {
  try {
    if (!USERNAME_RE.test(username))
      return { ok: false, error: "اسم غير صالح" };

    const hashed = bcrypt.hashSync(password, 10);
    db.prepare("INSERT INTO users (username, password) VALUES (?, ?)")
      .run(username, hashed);

    return { ok: true };
  } catch {
    return { ok: false, error: "الاسم مستخدم بالفعل" };
  }
}

function loginUser(username, password) {
  const user = db.prepare("SELECT * FROM users WHERE username=?")
    .get(username);

  if (!user) return { ok: false };
  if (user.banned) return { ok: false, error: "أنت محظور" };

  const match = bcrypt.compareSync(password, user.password);
  if (!match) return { ok: false };

  return {
    ok: true,
    user: {
      username: user.username,
      role: user.role,
      nameColor: user.nameColor,
      banned: false
    }
  };
}

function getAllUsers() {
  return db.prepare("SELECT id, username, role, nameColor, banned, createdAt FROM users")
    .all();
}

function setUserRole(username, role) {
  db.prepare("UPDATE users SET role=? WHERE username=?")
    .run(role, username);
  return { ok: true };
}

function setUserColor(username, color) {
  db.prepare("UPDATE users SET nameColor=? WHERE username=?")
    .run(color, username);
  return { ok: true };
}

function banUser(username) {
  db.prepare("UPDATE users SET banned=1 WHERE username=?")
    .run(username);
  return { ok: true };
}

function unbanUser(username) {
  db.prepare("UPDATE users SET banned=0 WHERE username=?")
    .run(username);
  return { ok: true };
}

/* ===================== IP & Serial ===================== */

function banIP(ip, reason) {
  db.prepare("INSERT OR REPLACE INTO banned_ips (ip, reason) VALUES (?, ?)")
    .run(ip, reason || 'محظور');
  return { ok: true };
}

function unbanIP(ip) {
  db.prepare("DELETE FROM banned_ips WHERE ip=?")
    .run(ip);
  return { ok: true };
}

function isIPBanned(ip) {
  return !!db.prepare("SELECT ip FROM banned_ips WHERE ip=?")
    .get(ip);
}

function getAllBannedIPs() {
  return db.prepare("SELECT * FROM banned_ips").all();
}

function banSerial(serial, reason) {
  db.prepare("INSERT OR REPLACE INTO banned_serials (serial, reason) VALUES (?, ?)")
    .run(serial, reason || 'محظور');
  return { ok: true };
}

function unbanSerial(serial) {
  db.prepare("DELETE FROM banned_serials WHERE serial=?")
    .run(serial);
  return { ok: true };
}

function isSerialBanned(serial) {
  return !!db.prepare("SELECT serial FROM banned_serials WHERE serial=?")
    .get(serial);
}

function getAllBannedSerials() {
  return db.prepare("SELECT * FROM banned_serials").all();
}

/* ===================== الرسائل ===================== */

function savePrivateMsg(sender, receiver, text) {
  const key = [sender, receiver].sort().join('__');
  const encrypted = encryptMsg(text);

  db.prepare(`
    INSERT INTO private_messages (chat_key, sender, receiver, message)
    VALUES (?, ?, ?, ?)
  `).run(key, sender, receiver, encrypted);
}

function getAllPrivateChats() {
  const rows = db.prepare("SELECT * FROM private_messages").all();
  return rows.map(r => ({
    ...r,
    message: decryptMsg(r.message)
  }));
}

/* ✅ حفظ رسائل الغرف */

function saveRoomMessage(room, username, role, nameColor, message) {
  db.prepare(`
    INSERT INTO room_messages (room, username, role, nameColor, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(room, username, role, nameColor, message);
}

function getRoomMessages(room, limit = 50) {
  return db.prepare(`
    SELECT * FROM room_messages
    WHERE room = ?
    ORDER BY createdAt DESC
    LIMIT ?
  `).all(room, limit).reverse();
}

module.exports = {
  registerUser,
  loginUser,
  getAllUsers,
  setUserRole,
  setUserColor,
  banUser,
  unbanUser,
  banIP,
  unbanIP,
  isIPBanned,
  getAllBannedIPs,
  banSerial,
  unbanSerial,
  isSerialBanned,
  getAllBannedSerials,
  savePrivateMsg,
  getAllPrivateChats,
  saveRoomMessage,
  getRoomMessages
};
