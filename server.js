require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const db         = require('./db');
const { authenticateOwner, issueOwnerToken } = require('./auth');
const { hasPermission, canActOn, canSendPrivateTo } = require('./permissions');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 30000,
  pingInterval: 10000,
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===================== Rate Limiting =====================
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 20,
  message: { ok: false, error: 'كتير أوي، استنى شوية وحاول تاني' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { ok: false, error: 'طلبات كتير جداً' },
});

app.use('/api/login',    authLimiter);
app.use('/api/register', authLimiter);
app.use('/api/owner',    apiLimiter);

app.get('/', (req, res) => res.redirect('/login.html'));

// ===================== تسجيل دخول المالك — يرجع JWT =====================
app.post('/api/owner/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const token = issueOwnerToken(username, password);
  if (!token) return res.json({ ok: false, error: 'بيانات المالك غلط' });
  res.json({ ok: true, token });
});

// ===================== الغرف الثابتة =====================
const STATIC_ROOMS = [
  { id: 'arabs',     name: '🌍 كل العرب' },
  { id: 'romantic',  name: '❤️ رومانسية' },
  { id: 'youth',     name: '👫 شباب وبنات' },
  { id: 'butterfly', name: '🦋 فرفشة' },
  { id: 'gulf',      name: '🌐 الخليج' },
  { id: 'help',      name: '💬 غرفة المساعدة' },
  { id: 'egypt',     name: '🇪🇬 مصر' },
  { id: 'palestine', name: '🇵🇸 فلسطين' },
  { id: 'syria',     name: '🇸🇾 سوريا' },
  { id: 'lebanon',   name: '🇱🇧 لبنان' },
  { id: 'algeria',   name: '🇩🇿 الجزائر' },
  { id: 'morocco',   name: '🇲🇦 المغرب' },
  { id: 'saudi',     name: '🇸🇦 السعودية' },
  { id: 'libya',     name: '🇱🇾 ليبيا' },
  { id: 'iraq',      name: '🇮🇶 العراق' },
];

const liveRooms    = {};
const onlineUsers  = {};
const ignoreList   = {};
const lockedPrivate = new Set();
const roomOperators = {}; // roomId → Set of usernames (IRC-style ops)

// ===================== مكافحة السبام =====================
const spamTracker = {};

// ===================== فلتر الكلمات والروابط =====================
const chatFilter = {
  words: [],
  linksBlocked: true,
};

const FILTER_EXEMPT = ['owner', 'admin'];

const URL_REGEX = /((https?:\/\/|www\.)[^\s]+|[a-zA-Z0-9\-]+\.(com|net|org|io|co|me|tv|ly|app|link|chat|site|xyz|online|store|info|club|live)\b[^\s]*)/gi;

function filterMessage(text, role) {
  if (FILTER_EXEMPT.includes(role)) return { ok: true, text };

  if (chatFilter.linksBlocked && URL_REGEX.test(text)) {
    URL_REGEX.lastIndex = 0;
    return { ok: false, ban: false, reason: '🚫 الروابط ممنوعة في هذا الشات' };
  }
  URL_REGEX.lastIndex = 0;

  for (const word of chatFilter.words) {
    if (!word) continue;
    const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (re.test(text)) {
      return { ok: false, ban: true, reason: '🚫 تم حظرك بسبب استخدام كلمات ممنوعة' };
    }
  }

  return { ok: true, text };
}

function checkSpam(username, text) {
  const now = Date.now();
  if (!spamTracker[username]) spamTracker[username] = { lastMsgs: [] };
  const tracker = spamTracker[username];

  if (tracker.mutedUntil && now < tracker.mutedUntil) return true;

  tracker.lastMsgs = tracker.lastMsgs.filter(m => now - m.time < 5000);
  tracker.lastMsgs.push({ text, time: now });

  if (tracker.lastMsgs.length >= 3) {
    const allSame = tracker.lastMsgs.every(m => m.text === text);
    if (allSame) {
      tracker.mutedUntil = now + 30000;
      tracker.lastMsgs = [];
      return true;
    }
  }
  return false;
}

STATIC_ROOMS.forEach(r => {
  liveRooms[r.id] = { ...r, isPrivate: false, owner: null, messages: [] };
});

const roleOrder = { owner: 0, admin: 1, moderator: 2, host: 3, vip: 4, member: 5, guest: 6 };

function getRoomList() {
  return Object.values(liveRooms).map(r => ({
    id: r.id,
    name: r.name,
    isPrivate: r.isPrivate,
    count: Object.values(onlineUsers).filter(u => u.room === r.id).length,
  }));
}

function getMemberList(roomId) {
  return Object.values(onlineUsers)
    .filter(u => u.room === roomId)
    .sort((a, b) => (roleOrder[a.role] ?? 6) - (roleOrder[b.role] ?? 6))
    .map(u => ({
      username:  u.username,
      role:      u.role,
      nameColor: u.nameColor,
      isGuest:   u.isGuest,
      muted:     u.muted,
      roomOp:    hasRoomOp(u),
    }));
}

function privateKey(a, b) { return [a, b].sort().join('__'); }

function systemMsg(roomId, text) {
  const msg = { type: 'system', text, time: Date.now() };
  if (liveRooms[roomId]) liveRooms[roomId].messages.push(msg);
  io.to(roomId).emit('message', msg);
}

function findUserByName(username) {
  return Object.values(onlineUsers).find(u => u.username === username);
}

// ===================== Room Operators (IRC-style) =====================
function getRoomOps(roomId) {
  if (!roomOperators[roomId]) roomOperators[roomId] = new Set();
  return roomOperators[roomId];
}

function isRoomOp(roomId, username) {
  return getRoomOps(roomId).has(username);
}

const AUTO_OP_ROLES = ['owner', 'admin', 'moderator', 'host'];

function hasRoomOp(user) {
  if (!user) return false;
  return AUTO_OP_ROLES.includes(user.role) || isRoomOp(user.room, user.username);
}

function cleanGuestOpsOnRoleChange(username) {
  Object.keys(roomOperators).forEach(roomId => {
    roomOperators[roomId]?.delete(username);
  });
}

// ===================== REST API =====================
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  res.json(db.registerUser(username, password));
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  res.json(db.loginUser(username, password));
});

// ===================== لوحة المالك =====================
app.get('/api/owner/users', authenticateOwner, (req, res) => {
  res.json({ ok: true, users: db.getAllUsers() });
});

app.get('/api/owner/online', authenticateOwner, (req, res) => {
  const users = Object.values(onlineUsers).map(u => ({
    username:   u.username,
    role:       u.role,
    room:       u.room,
    isGuest:    u.isGuest,
    muted:      u.muted,
    ip:         u.ip,
    deviceInfo: u.deviceInfo,
    fingerprint: u.fingerprint,
    joinedAt:   u.joinedAt,
  }));
  res.json({ ok: true, users });
});

app.get('/api/owner/private-chats', authenticateOwner, (req, res) => {
  res.json({ ok: true, chats: db.getAllPrivateChats() });
});

app.get('/api/owner/banned-ips', authenticateOwner, (req, res) => {
  res.json({ ok: true, ips: db.getAllBannedIPs() });
});

app.post('/api/owner/ban-ip', authenticateOwner, (req, res) => {
  const { ip, reason } = req.body || {};
  if (!ip) return res.json({ ok: false, error: 'IP مطلوب' });
  db.banIP(ip, reason);
  Object.values(onlineUsers).forEach(u => {
    if (u.ip === ip) {
      io.to(u.socketId).emit('kicked', { reason: 'تم حظرك' });
      io.sockets.sockets.get(u.socketId)?.disconnect(true);
    }
  });
  res.json({ ok: true });
});

app.post('/api/owner/unban-ip', authenticateOwner, (req, res) => {
  const { ip } = req.body || {};
  res.json(db.unbanIP(ip));
});

// ===================== Serials محظورة =====================
app.get('/api/owner/banned-serials', authenticateOwner, (req, res) => {
  res.json({ ok: true, serials: db.getAllBannedSerials() });
});

app.post('/api/owner/ban-serial', authenticateOwner, (req, res) => {
  const { serial, reason } = req.body || {};
  if (!serial) return res.json({ ok: false, error: 'serial مطلوب' });
  db.banSerial(serial, reason);
  Object.values(onlineUsers).forEach(u => {
    if (u.deviceInfo?.serial === serial || u.fingerprint === serial) {
      u.socket?.emit('auth_error', '🚫 أنت محظور');
      io.sockets.sockets.get(u.socketId)?.disconnect(true);
    }
  });
  res.json({ ok: true });
});

app.post('/api/owner/unban-serial', authenticateOwner, (req, res) => {
  const { serial } = req.body || {};
  res.json(db.unbanSerial(serial));
});

app.post('/api/owner/set-role', authenticateOwner, (req, res) => {
  const { username, role, requestedBy } = req.body || {};

  const realOwner = db.getRealOwnerUsername();
  if (username === realOwner) {
    return res.json({ ok: false, error: '❌ لا يمكن تغيير رتبة المالك الأصلي' });
  }

  const RANK = { owner: 0, admin: 1, moderator: 2, host: 3, vip: 4, member: 5, guest: 6 };
  const requesterUser = findUserByName(requestedBy);
  const requesterRole = requesterUser ? requesterUser.role : null;

  if (requestedBy && requestedBy !== realOwner && requesterRole) {
    const targetUser = findUserByName(username);
    const targetRole = targetUser ? targetUser.role : null;
    const newRoleRank = RANK[role];
    const requesterRank = RANK[requesterRole];

    const allowedRank = requesterRank + 1;
    if (newRoleRank !== allowedRank) {
      return res.json({ ok: false, error: '❌ تقدر تغير الرتبة اللي تحتك مباشرة بس' });
    }
    if (targetRole && RANK[targetRole] <= requesterRank) {
      return res.json({ ok: false, error: '❌ لا يمكن تغيير رتبة شخص في نفس مستواك أو أعلى' });
    }
  }

  const result = db.setUserRole(username, role);
  if (result.ok) {
    const u = findUserByName(username);
    if (u) {
      u.role = role;
      cleanGuestOpsOnRoleChange(username);
      io.to(u.room).emit('members_update', getMemberList(u.room));
      io.to(u.socketId).emit('your_role_updated', { role });
    }
  }
  res.json(result);
});

// ===================== Room Operators API =====================
app.post('/api/owner/room-op/add', authenticateOwner, (req, res) => {
  const { username, roomId } = req.body || {};
  if (!username || !roomId) return res.json({ ok: false, error: 'بيانات ناقصة' });
  getRoomOps(roomId).add(username);
  const u = findUserByName(username);
  if (u) {
    io.to(u.socketId).emit('room_op_granted', { roomId });
    io.to(roomId).emit('members_update', getMemberList(roomId));
  }
  res.json({ ok: true });
});

app.post('/api/owner/room-op/remove', authenticateOwner, (req, res) => {
  const { username, roomId } = req.body || {};
  if (!username || !roomId) return res.json({ ok: false, error: 'بيانات ناقصة' });
  getRoomOps(roomId).delete(username);
  const u = findUserByName(username);
  if (u) {
    io.to(u.socketId).emit('room_op_removed', { roomId });
    io.to(roomId).emit('members_update', getMemberList(roomId));
  }
  res.json({ ok: true });
});

app.get('/api/owner/room-ops', authenticateOwner, (req, res) => {
  const result = {};
  Object.keys(roomOperators).forEach(roomId => {
    result[roomId] = [...roomOperators[roomId]];
  });
  res.json({ ok: true, ops: result });
});

app.post('/api/owner/set-color', authenticateOwner, (req, res) => {
  const { username, color } = req.body || {};
  const result = db.setUserColor(username, color);
  if (result.ok) {
    const u = findUserByName(username);
    if (u) {
      u.nameColor = color;
      io.to(u.room).emit('members_update', getMemberList(u.room));
      io.to(u.socketId).emit('your_color_updated', { color });
    }
  }
  res.json(result);
});

app.post('/api/owner/ban', authenticateOwner, (req, res) => {
  const { username, banIP: shouldBanIP } = req.body || {};
  db.banUser(username);
  const u = findUserByName(username);
  if (u) {
    if (shouldBanIP && u.ip) db.banIP(u.ip, `محظور مع ${username}`);
    if (shouldBanIP && u.deviceInfo?.serial) db.banSerial(u.deviceInfo.serial, `محظور مع ${username}`);
    if (shouldBanIP && u.fingerprint) db.banSerial(u.fingerprint, `محظور مع ${username}`);
    io.to(u.socketId).emit('kicked', { reason: 'تم حظرك من قبل المالك' });
    io.sockets.sockets.get(u.socketId)?.disconnect(true);
  }
  res.json({ ok: true });
});

app.post('/api/owner/unban', authenticateOwner, (req, res) => {
  const { username } = req.body || {};
  res.json(db.unbanUser(username));
});

app.post('/api/owner/mute', authenticateOwner, (req, res) => {
  const { username } = req.body || {};
  const u = findUserByName(username);
  if (u) {
    u.muted = true;
    io.to(u.socketId).emit('you_muted');
    io.to(u.room).emit('members_update', getMemberList(u.room));
  }
  res.json({ ok: true });
});

app.post('/api/owner/unmute', authenticateOwner, (req, res) => {
  const { username } = req.body || {};
  const u = findUserByName(username);
  if (u) {
    u.muted = false;
    io.to(u.socketId).emit('you_unmuted');
    io.to(u.room).emit('members_update', getMemberList(u.room));
  }
  res.json({ ok: true });
});

app.post('/api/owner/kick', authenticateOwner, (req, res) => {
  const { username, reason } = req.body || {};
  const u = findUserByName(username);
  if (u) {
    io.to(u.socketId).emit('kicked', { reason: reason || 'تم طردك من قبل المالك' });
    io.sockets.sockets.get(u.socketId)?.disconnect(true);
  }
  res.json({ ok: true });
});

app.post('/api/owner/broadcast', authenticateOwner, (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.json({ ok: false, error: 'النص فارغ' });
  io.emit('announcement', { text: text.trim(), time: Date.now() });
  res.json({ ok: true });
});

app.post('/api/owner/change-password', authenticateOwner, (req, res) => {
  const { newPassword } = req.body || {};
  res.json(db.changeOwnerPassword(newPassword));
});

app.post('/api/owner/reset', authenticateOwner, (req, res) => {
  Object.values(liveRooms).forEach(r => { r.messages = []; });
  Object.keys(liveRooms).filter(id => liveRooms[id].isPrivate).forEach(id => delete liveRooms[id]);
  io.emit('full_reset');
  res.json({ ok: true });
});

// ===================== فلتر الكلمات والروابط =====================
app.get('/api/owner/filter', authenticateOwner, (req, res) => {
  res.json({ ok: true, words: chatFilter.words, linksBlocked: chatFilter.linksBlocked });
});

app.post('/api/owner/filter/words', authenticateOwner, (req, res) => {
  const { words } = req.body || {};
  if (!Array.isArray(words)) return res.json({ ok: false, error: 'تنسيق غلط' });
  chatFilter.words = words.map(w => w.trim().toLowerCase()).filter(Boolean);
  res.json({ ok: true, words: chatFilter.words });
});

app.post('/api/owner/filter/links', authenticateOwner, (req, res) => {
  const { blocked } = req.body || {};
  chatFilter.linksBlocked = !!blocked;
  res.json({ ok: true, linksBlocked: chatFilter.linksBlocked });
});

// ===================== Socket.io =====================
io.on('connection', (socket) => {

  const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim()
           || socket.handshake.address;

  if (db.isIPBanned(ip)) {
    socket.emit('auth_error', 'أنت محظور');
    socket.disconnect(true);
    return;
  }

  socket.on('join', (data) => {
    let user;

    if (data.isGuest) {
      const serial = data.deviceInfo?.serial || data.fingerprint || '';
      if (serial && db.isSerialBanned(serial)) {
        socket.emit('auth_error', '🚫 أنت محظور');
        socket.disconnect(true);
        return;
      }

      const guestName = (data.username || '').trim() || `زائر_${Date.now() % 9999}`;
      const exists    = findUserByName(guestName);
      const finalName = exists ? `${guestName}_${Math.floor(Math.random() * 99)}` : guestName;

      const initRoomGuest = (data.selectedRoom && liveRooms[data.selectedRoom]) ? data.selectedRoom : 'egypt';
      user = {
        socketId:    socket.id,
        username:    finalName,
        role:        'guest',
        nameColor:   null,
        isGuest:     true,
        room:        initRoomGuest,
        muted:       false,
        ip:          ip,
        deviceInfo:  data.deviceInfo || {},
        fingerprint: data.fingerprint || '',
        joinedAt:    Date.now(),
      };
    } else {
      const result = db.loginUser(data.username, data.password);
      if (!result.ok)         { socket.emit('auth_error', result.error); return; }
      if (result.user.banned) { socket.emit('auth_error', 'أنت محظور'); return; }

      const oldSession = findUserByName(result.user.username);
      if (oldSession) {
        io.to(oldSession.socketId).emit('kicked', { reason: 'تم الدخول من جهاز آخر' });
        io.sockets.sockets.get(oldSession.socketId)?.disconnect(true);
        delete onlineUsers[oldSession.socketId];
      }

      const initRoomMember = (data.selectedRoom && liveRooms[data.selectedRoom]) ? data.selectedRoom : 'egypt';
      user = {
        socketId:    socket.id,
        username:    result.user.username,
        role:        result.user.role,
        nameColor:   result.user.nameColor,
        isGuest:     false,
        room:        initRoomMember,
        muted:       false,
        ip:          ip,
        deviceInfo:  data.deviceInfo || {},
        fingerprint: data.fingerprint || '',
        joinedAt:    Date.now(),
      };
    }

    const initRoom = user.room;
    onlineUsers[socket.id] = user;
    socket.join(initRoom);

    // ✅ التعديل الأول: استبدال messages: [] بـ db.getRoomMessages(initRoom)
    socket.emit('joined', {
      user: {
        username:  user.username,
        role:      user.role,
        nameColor: user.nameColor,
        isGuest:   user.isGuest,
      },
      rooms:    getRoomList(),
      messages: db.getRoomMessages(initRoom),
      members:  getMemberList(initRoom),
      voiceEnabled: voiceSettings.enabled,
      voiceAllowed: user.role === 'owner' || voiceSettings.allowedUsers.has(user.username),
    });

    io.to(initRoom).emit('members_update', getMemberList(initRoom));
    io.emit('rooms_update', getRoomList());
    systemMsg(initRoom, `✦ ${user.username} دخل الغرفة`);
  });

  socket.on('change_room', (roomId) => {
    const user = onlineUsers[socket.id];
    if (!user || !liveRooms[roomId]) return;
    if (liveRooms[roomId].isPrivate && !hasPermission(user.role, 'canJoinPrivateRoom')) {
      socket.emit('perm_error', { action: 'join_private', msg: '❌ الغرف الخاصة للأعضاء المسجلين فقط' });
      return;
    }
    const old = user.room;
    socket.leave(old);
    systemMsg(old, `✦ ${user.username} غادر الغرفة`);
    io.to(old).emit('members_update', getMemberList(old));
    user.room = roomId;
    socket.join(roomId);
    // ✅ التعديل الثاني: استبدال messages: [] بـ db.getRoomMessages(roomId)
    socket.emit('room_changed', {
      roomId,
      roomName: liveRooms[roomId].name,
      messages: db.getRoomMessages(roomId),
      members:  getMemberList(roomId),
    });
    io.to(roomId).emit('members_update', getMemberList(roomId));
    io.emit('rooms_update', getRoomList());
    systemMsg(roomId, `✦ ${user.username} دخل الغرفة`);
  });

  socket.on('create_room', (data) => {
    const user = onlineUsers[socket.id];
    if (!user) return;
    if (!hasPermission(user.role, 'canCreateRoom')) {
      socket.emit('perm_error', { action: 'create_room', msg: '❌ صلاحيتك لا تسمح بإنشاء غرف' });
      return;
    }
    const roomId   = 'pvt_' + Date.now();
    const roomName = ((data && data.name) || `غرفة ${user.username}`).slice(0, 30);
    liveRooms[roomId] = { id: roomId, name: roomName, isPrivate: true, owner: user.username, messages: [] };
    io.emit('rooms_update', getRoomList());
    socket.emit('room_created', { roomId, roomName });
  });

  socket.on('send_message', (data) => {
    const user = onlineUsers[socket.id];
    if (!user || user.muted || !liveRooms[user.room]) return;
    const text = ((data && data.text) || '').trim().slice(0, 500);
    if (!text) return;

    const filterResult = filterMessage(text, user.role);
    if (!filterResult.ok) {
      socket.emit('filter_block', { msg: filterResult.reason });
      if (filterResult.ban) {
        if (!user.isGuest) db.banUser(user.username);
        setTimeout(() => {
          io.to(socket.id).emit('kicked', { reason: filterResult.reason });
          io.sockets.sockets.get(socket.id)?.disconnect(true);
        }, 500);
      }
      return;
    }
    const cleanText = filterResult.text;

    if (checkSpam(user.username, cleanText)) {
      socket.emit('spam_warning', { msg: '⚠️ أرسلت نفس الرسالة أكتر من مرة. تم كتمك 30 ثانية.' });
      user.muted = true;
      setTimeout(() => {
        if (onlineUsers[socket.id]) {
          onlineUsers[socket.id].muted = false;
          socket.emit('you_unmuted');
          io.to(user.room).emit('members_update', getMemberList(user.room));
        }
      }, 30000);
      io.to(user.room).emit('members_update', getMemberList(user.room));
      return;
    }

    const msg = {
      type:      'chat',
      id:        `${Date.now()}_${socket.id.slice(0, 4)}`,
      username:  user.username,
      role:      user.role,
      nameColor: user.nameColor,
      text:      cleanText,
      time:      Date.now(),
    };
    liveRooms[user.room].messages.push(msg);

    // ✅ التعديل الثالث: حفظ الرسالة في قاعدة البيانات
    db.saveRoomMessage(user.room, user.username, user.role, user.nameColor, cleanText);

    if (liveRooms[user.room].messages.length > 300)
      liveRooms[user.room].messages.shift();
    io.to(user.room).emit('message', msg);
  });

  socket.on('private_message', (data) => {
    const sender = onlineUsers[socket.id];
    if (!sender || sender.muted) return;
    const text = ((data && data.text) || '').trim().slice(0, 500);
    if (!text || !data.to) return;

    const filterResult = filterMessage(text, sender.role);
    if (!filterResult.ok) {
      socket.emit('filter_block', { msg: filterResult.reason });
      if (filterResult.ban) {
        if (!sender.isGuest) db.banUser(sender.username);
        setTimeout(() => {
          io.to(socket.id).emit('kicked', { reason: filterResult.reason });
          io.sockets.sockets.get(socket.id)?.disconnect(true);
        }, 500);
      }
      return;
    }
    const cleanText = filterResult.text;

    const recv = findUserByName(data.to);
    const receiverRole = recv ? recv.role : 'member';
    if (!canSendPrivateTo(sender.role, receiverRole)) {
      socket.emit('perm_error', { action: 'private_message', msg: '❌ لا يمكنك إرسال رسالة خاصة لهذا المستخدم' });
      return;
    }
    if (lockedPrivate.has(data.to) && sender.role !== 'owner') {
      socket.emit('perm_error', { action: 'private_message', msg: `🔒 ${data.to} أغلق الرسائل الخاصة` });
      return;
    }
    if (sender.role !== 'owner' && ignoreList[data.to]?.has(sender.username)) {
      socket.emit('private_message', { from: sender.username, to: data.to, text: cleanText, time: Date.now() });
      return;
    }
    if (ignoreList[sender.username]?.has(data.to)) {
      socket.emit('perm_error', { action: 'private_message', msg: `❌ أنت تتجاهل ${data.to}` });
      return;
    }

    db.savePrivateMsg(sender.username, data.to, cleanText);

    const msg = { from: sender.username, to: data.to, text: cleanText, time: Date.now() };
    socket.emit('private_message', msg);
    if (recv) io.to(recv.socketId).emit('private_message', msg);
  });

  socket.on('delete_message', (data) => {
    const user = onlineUsers[socket.id];
    if (!user || !hasPermission(user.role, 'canDeleteMsg')) return;
    const room = liveRooms[user.room];
    if (!room) return;
    const targetMsg = room.messages.find(m => m.id === data.msgId);
    if (targetMsg && targetMsg.username) {
      const targetUser = findUserByName(targetMsg.username);
      const targetRole = targetUser ? targetUser.role : 'member';
      if (user.role !== 'owner' && !canActOn(user.role, targetRole)) {
        socket.emit('perm_error', { action: 'delete_msg', msg: '❌ لا يمكنك حذف رسالة هذا المستخدم' });
        return;
      }
    }
    room.messages = room.messages.filter(m => m.id !== data.msgId);
    io.to(user.room).emit('message_deleted', { msgId: data.msgId });
  });

  socket.on('mute_user', (data) => {
    const admin = onlineUsers[socket.id];
    if (!admin) return;
    const target = findUserByName(data.username);
    if (!target) return;
    if (!hasPermission(admin.role, 'canMuteUsers') || !canActOn(admin.role, target.role)) {
      socket.emit('perm_error', { action: 'mute', msg: '❌ مش معك صلاحية الكتم' });
      return;
    }
    target.muted = true;
    io.to(target.socketId).emit('you_muted');
    io.to(target.room).emit('members_update', getMemberList(target.room));
  });

  socket.on('unmute_user', (data) => {
    const admin = onlineUsers[socket.id];
    if (!admin) return;
    const target = findUserByName(data.username);
    if (!target) return;
    if (!hasPermission(admin.role, 'canMuteUsers') || !canActOn(admin.role, target.role)) {
      socket.emit('perm_error', { action: 'unmute', msg: '❌ مش معك صلاحية رفع الكتم' });
      return;
    }
    target.muted = false;
    io.to(target.socketId).emit('you_unmuted');
    io.to(target.room).emit('members_update', getMemberList(target.room));
  });

  socket.on('kick_user', (data) => {
    const admin = onlineUsers[socket.id];
    if (!admin) return;
    const canKick = hasPermission(admin.role, 'canKickUsers') || hasRoomOp(admin);
    const target = findUserByName(data.username);
    if (!target) return;
    if (!canKick) {
      socket.emit('perm_error', { action: 'kick', msg: '❌ مش معك صلاحية الطرد' });
      return;
    }
    if (!hasPermission(admin.role, 'canKickUsers') && hasRoomOp(admin)) {
      if (admin.room !== target.room || AUTO_OP_ROLES.includes(target.role)) {
        socket.emit('perm_error', { action: 'kick', msg: '❌ مش معك صلاحية الطرد' });
        return;
      }
    } else if (!canActOn(admin.role, target.role)) {
      socket.emit('perm_error', { action: 'kick', msg: '❌ مش معك صلاحية الطرد' });
      return;
    }
    io.to(target.socketId).emit('kicked', { reason: data.reason || 'تم طردك من الغرفة' });
    io.sockets.sockets.get(target.socketId)?.disconnect(true);
  });

  socket.on('kick_ban_ip', (data) => {
    const admin = onlineUsers[socket.id];
    if (!admin) return;
    const canKick = hasPermission(admin.role, 'canKickUsers') || hasRoomOp(admin);
    if (!canKick) return;
    const target = findUserByName(data.username);
    if (!target) return;
    if (!hasPermission(admin.role, 'canKickUsers') && hasRoomOp(admin)) {
      if (admin.room !== target.room || AUTO_OP_ROLES.includes(target.role)) return;
    } else {
      if (!canActOn(admin.role, target.role)) return;
    }
    if (target.ip) db.banIP(target.ip, `محظور بواسطة ${admin.username}`);
    io.to(target.socketId).emit('kicked', { reason: 'تم طردك وحظرك من الشات' });
    io.sockets.sockets.get(target.socketId)?.disconnect(true);
  });

  socket.on('ban_user', (data) => {
    const admin = onlineUsers[socket.id];
    if (!admin) return;
    const canKick = hasPermission(admin.role, 'canKickUsers') || hasRoomOp(admin);
    if (!canKick) return;
    const target = findUserByName(data.username);
    if (!target) return;
    if (!hasPermission(admin.role, 'canKickUsers') && hasRoomOp(admin)) {
      if (admin.room !== target.room || AUTO_OP_ROLES.includes(target.role)) return;
    } else {
      if (!canActOn(admin.role, target.role)) return;
    }
    if (!target.isGuest) db.banUser(target.username);
    io.to(target.socketId).emit('kicked', { reason: 'تم حظرك من الشات' });
    io.sockets.sockets.get(target.socketId)?.disconnect(true);
  });

  socket.on('report_user', (data) => {
    const reporter = onlineUsers[socket.id];
    if (!reporter || !data.username || !data.reason) return;
    const ownerUsername = db.getRealOwnerUsername();
    const ownerUser = findUserByName(ownerUsername);
    const reportMsg = `🚨 بلاغ من ${reporter.username} ضد ${data.username}: ${data.reason}`;
    if (ownerUser) {
      io.to(ownerUser.socketId).emit('private_message', {
        from: '🚨 نظام البلاغات',
        to: ownerUsername,
        text: reportMsg,
        time: Date.now(),
      });
    }
  });

  socket.on('ignore_user', (data) => {
    const user = onlineUsers[socket.id];
    if (!user || !data.username || data.username === user.username) return;
    const target = findUserByName(data.username);
    if (target?.role === 'owner') {
      socket.emit('perm_error', { action: 'ignore', msg: '❌ لا يمكنك تجاهل المالك' });
      return;
    }
    if (!ignoreList[user.username]) ignoreList[user.username] = new Set();
    ignoreList[user.username].add(data.username);
    socket.emit('ignored_user', { username: data.username });
  });

  socket.on('unignore_user', (data) => {
    const user = onlineUsers[socket.id];
    if (!user || !data.username) return;
    ignoreList[user.username]?.delete(data.username);
    socket.emit('unignored_user', { username: data.username });
  });

  socket.on('lock_private', () => {
    const user = onlineUsers[socket.id];
    if (!user) return;
    lockedPrivate.add(user.username);
    socket.emit('private_locked', { locked: true });
  });

  socket.on('unlock_private', () => {
    const user = onlineUsers[socket.id];
    if (!user) return;
    lockedPrivate.delete(user.username);
    socket.emit('private_locked', { locked: false });
  });

  // ===================== فويس نوت =====================
  socket.on('send_voice', (data) => {
    const sender = onlineUsers[socket.id];
    if (!sender) return;

    if (!voiceSettings.enabled) {
      socket.emit('perm_error', { action: 'voice', msg: '🎙️ ميزة الفويس نوت غير مفعّلة حالياً' });
      return;
    }

    const canVoice = sender.role === 'owner' || voiceSettings.allowedUsers.has(sender.username);
    if (!canVoice) {
      socket.emit('perm_error', { action: 'voice', msg: '🎙️ لا تملك إذن إرسال فويس نوت' });
      return;
    }

    if (sender.muted) {
      socket.emit('perm_error', { action: 'voice', msg: '🔇 أنت مكتوم' });
      return;
    }

    const { audioData, duration, isPrivate, toUser } = data || {};
    if (!audioData) return;

    if (audioData.length > 2 * 1024 * 1024 * 1.37) {
      socket.emit('perm_error', { action: 'voice', msg: '🎙️ حجم الفويس كبير جداً (الحد 2MB)' });
      return;
    }

    const msg = {
      type:      'voice',
      id:        `v_${Date.now()}_${socket.id.slice(0, 4)}`,
      username:  sender.username,
      role:      sender.role,
      nameColor: sender.nameColor,
      audioData,
      duration:  Math.min(duration || 0, 120),
      time:      Date.now(),
      isPrivate: !!isPrivate,
    };

    if (isPrivate && toUser) {
      const recv = findUserByName(toUser);
      if (!recv) {
        socket.emit('perm_error', { action: 'voice', msg: '❌ المستخدم غير متصل' });
        return;
      }
      if (lockedPrivate.has(toUser) && sender.role !== 'owner') {
        socket.emit('perm_error', { action: 'voice', msg: `🔒 ${toUser} أغلق الرسائل الخاصة` });
        return;
      }
      msg.to = toUser;
      socket.emit('private_voice', msg);
      io.to(recv.socketId).emit('private_voice', msg);
    } else {
      if (!liveRooms[sender.room]) return;
      liveRooms[sender.room].messages.push({ ...msg, audioData: '[صوت]' });
      if (liveRooms[sender.room].messages.length > 300)
        liveRooms[sender.room].messages.shift();
      io.to(sender.room).emit('voice_message', msg);
    }
  });

  socket.on('disconnect', () => {
    const user = onlineUsers[socket.id];
    if (!user) return;
    const room = user.room;
    delete onlineUsers[socket.id];
    if (liveRooms[room]) {
      io.to(room).emit('members_update', getMemberList(room));
      systemMsg(room, `✦ ${user.username} غادر الشات`);
    }
    io.emit('rooms_update', getRoomList());
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n✅ شات لايف شغال على: http://localhost:${PORT}`);
  console.log(`👑 لتسجيل دخول المالك افتح: http://localhost:${PORT}/login.html\n`);
});

// ===================== الفويس نوت =====================
const voiceSettings = {
  enabled: false,
  allowedUsers: new Set(),
};

app.post('/api/owner/voice/toggle', authenticateOwner, (req, res) => {
  const { enabled } = req.body || {};
  voiceSettings.enabled = !!enabled;
  io.emit('voice_feature_update', { enabled: voiceSettings.enabled });
  res.json({ ok: true, enabled: voiceSettings.enabled });
});

app.post('/api/owner/voice/allow', authenticateOwner, (req, res) => {
  const { username, allow } = req.body || {};
  if (!username) return res.json({ ok: false, error: 'اسم مطلوب' });
  if (allow) {
    voiceSettings.allowedUsers.add(username);
  } else {
    voiceSettings.allowedUsers.delete(username);
  }
  const u = findUserByName(username);
  if (u) {
    io.to(u.socketId).emit('voice_permission_update', { allowed: !!allow });
  }
  res.json({ ok: true, allowed: allow, users: [...voiceSettings.allowedUsers] });
});

app.get('/api/owner/voice/settings', authenticateOwner, (req, res) => {
  res.json({
    ok: true,
    enabled: voiceSettings.enabled,
    allowedUsers: [...voiceSettings.allowedUsers],
  });
});
