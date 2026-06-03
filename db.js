const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

let db;

async function initDB() {
  db = await open({
    filename: path.join(__dirname, 'chat.db'),
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      nameColor TEXT DEFAULT NULL,
      banned INTEGER DEFAULT 0,
      createdAt INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS private_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_key TEXT NOT NULL,
      sender TEXT NOT NULL,
      receiver TEXT NOT NULL,
      message TEXT NOT NULL,
      createdAt INTEGER DEFAULT (strftime('%s','now'))
    );
  `);

  console.log("✅ Database Ready");
}

const USERNAME_RE = /^[\u0600-\u06FFa-zA-Z0-9_\-. ]{3,20}$/;

async function registerUser(username, password) {
  try {
    if (!USERNAME_RE.test(username))
      return { ok: false, error: "اسم غير صالح" };

    const hashed = await bcrypt.hash(password, 10);
    await db.run(
      "INSERT INTO users (username, password) VALUES (?, ?)",
      username,
      hashed
    );
    return { ok: true };
  } catch {
    return { ok: false, error: "الاسم مستخدم بالفعل" };
  }
}

async function loginUser(username, password) {
  const user = await db.get(
    "SELECT * FROM users WHERE username=?",
    username
  );

  if (!user) return { ok: false };

  const match = await bcrypt.compare(password, user.password);
  if (!match) return { ok: false };

  return {
    ok: true,
    user: {
      username: user.username,
      role: user.role,
      nameColor: user.nameColor
    }
  };
}

module.exports = {
  initDB,
  registerUser,
  loginUser
};
