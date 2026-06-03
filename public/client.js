// ===================== حالة التطبيق =====================
const state = {
  socket:          null,
  me:              null,   // { username, role, nameColor, isGuest }
  currentRoom:     'egypt',
  privateWith:     null,   // اسم الشخص في المحادثة الخاصة
  ownerToken:      null,   // JWT للمالك فقط
  ownerTabActive:  'online',
  ignoreList:      new Set(),  // أسماء المتجاهلين
  privateLocked:   false,      // قفل الخاص
  voiceEnabled:    false,      // هل الفويس نوت مفعّل
  voiceAllowed:    false,      // هل المستخدم مسموح له بالفويس
  mediaRecorder:   null,       // MediaRecorder instance
  audioChunks:     [],         // chunks الصوت
  isRecording:     false,      // حالة التسجيل
  recordStartTime: 0,          // وقت بدء التسجيل
};

// ===================== بدء =====================
window.addEventListener('DOMContentLoaded', () => {
  const authData = JSON.parse(sessionStorage.getItem('livechat_auth') || 'null');
  if (!authData) { window.location.replace('login.html'); return; }
  if (authData.ownerToken) state.ownerToken = authData.ownerToken;
  connectSocket(authData);
});

// ===================== معلومات الجهاز =====================
function getDeviceInfo() {
  const ua = navigator.userAgent;

  // ===== OS =====
  let os = 'Unknown';
  let osVersion = '';
  if (/Windows NT 10.0/i.test(ua))      { os = 'Windows'; osVersion = '10/11'; }
  else if (/Windows NT 6.3/i.test(ua))  { os = 'Windows'; osVersion = '8.1'; }
  else if (/Windows NT 6.1/i.test(ua))  { os = 'Windows'; osVersion = '7'; }
  else if (/Windows/i.test(ua))         { os = 'Windows'; }
  else if (/Android/i.test(ua)) {
    os = 'Android';
    const m = ua.match(/Android\s([\d.]+)/i);
    if (m) osVersion = m[1];
  }
  else if (/iPhone.*OS/i.test(ua)) {
    os = 'iOS';
    const m = ua.match(/OS ([\d_]+)/i);
    if (m) osVersion = m[1].replace(/_/g, '.');
  }
  else if (/iPad.*OS/i.test(ua)) {
    os = 'iPadOS';
    const m = ua.match(/OS ([\d_]+)/i);
    if (m) osVersion = m[1].replace(/_/g, '.');
  }
  else if (/Mac OS X/i.test(ua)) {
    os = 'macOS';
    const m = ua.match(/Mac OS X ([\d_]+)/i);
    if (m) osVersion = m[1].replace(/_/g, '.');
  }
  else if (/Linux/i.test(ua))           { os = 'Linux'; }

  // ===== Browser =====
  let browser = 'Other';
  let browserVersion = '';
  if (/SamsungBrowser\/([\d.]+)/i.test(ua)) {
    browser = 'Samsung Browser'; browserVersion = ua.match(/SamsungBrowser\/([\d.]+)/i)?.[1] || '';
  } else if (/OPR\/([\d.]+)/i.test(ua) || /Opera\/([\d.]+)/i.test(ua)) {
    browser = 'Opera'; browserVersion = ua.match(/OPR\/([\d.]+)/i)?.[1] || '';
  } else if (/Edg\/([\d.]+)/i.test(ua)) {
    browser = 'Edge'; browserVersion = ua.match(/Edg\/([\d.]+)/i)?.[1] || '';
  } else if (/YaBrowser\/([\d.]+)/i.test(ua)) {
    browser = 'Yandex'; browserVersion = ua.match(/YaBrowser\/([\d.]+)/i)?.[1] || '';
  } else if (/UCBrowser\/([\d.]+)/i.test(ua)) {
    browser = 'UC Browser'; browserVersion = ua.match(/UCBrowser\/([\d.]+)/i)?.[1] || '';
  } else if (/Chrome\/([\d.]+)/i.test(ua)) {
    browser = 'Chrome'; browserVersion = ua.match(/Chrome\/([\d.]+)/i)?.[1]?.split('.')[0] || '';
  } else if (/Firefox\/([\d.]+)/i.test(ua)) {
    browser = 'Firefox'; browserVersion = ua.match(/Firefox\/([\d.]+)/i)?.[1]?.split('.')[0] || '';
  } else if (/Safari\/([\d.]+)/i.test(ua)) {
    browser = 'Safari'; browserVersion = ua.match(/Version\/([\d.]+)/i)?.[1]?.split('.')[0] || '';
  }

  // ===== Device / Brand =====
  let device = 'Unknown';
  let brand  = 'Unknown';
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua);

  if (/iPhone/i.test(ua)) {
    brand = 'Apple'; device = 'iPhone';
  } else if (/iPad/i.test(ua)) {
    brand = 'Apple'; device = 'iPad';
  } else if (/SM-[A-Z0-9]+/i.test(ua)) {
    brand = 'Samsung';
    device = ua.match(/(SM-[A-Z0-9]+)/i)?.[1] || 'Samsung';
  } else if (/SAMSUNG/i.test(ua)) {
    brand = 'Samsung'; device = 'Samsung';
  } else if (/Xiaomi|MI\s|Redmi|POCO/i.test(ua)) {
    brand = 'Xiaomi';
    const m = ua.match(/(Redmi[^\s;)]+|POCO[^\s;)]+|MI\s[^\s;)]+|M[0-9]+[^\s;)]+)/i);
    device = m?.[1] || 'Xiaomi';
  } else if (/HUAWEI|Honor/i.test(ua)) {
    brand = /Honor/i.test(ua) ? 'Honor' : 'Huawei';
    const m = ua.match(/(?:HUAWEI|Honor)[- ]([^\s;)]+)/i);
    device = m ? (brand + ' ' + m[1]) : brand;
  } else if (/OPPO|CPH[0-9]/i.test(ua)) {
    brand = 'OPPO';
    const m = ua.match(/(CPH[0-9]+)/i);
    device = m?.[1] || 'OPPO';
  } else if (/vivo/i.test(ua)) {
    brand = 'vivo';
    const m = ua.match(/vivo\s([^\s;)]+)/i);
    device = m ? ('vivo ' + m[1]) : 'vivo';
  } else if (/OnePlus/i.test(ua)) {
    brand = 'OnePlus';
    const m = ua.match(/OnePlus([^\s;)]+)/i);
    device = m ? ('OnePlus ' + m[1]) : 'OnePlus';
  } else if (/Tecno/i.test(ua)) {
    brand = 'Tecno'; device = 'Tecno';
  } else if (/itel/i.test(ua)) {
    brand = 'itel'; device = 'itel';
  } else if (!isMobile) {
    brand = os === 'Windows' ? 'PC' : os === 'macOS' ? 'Mac' : 'Desktop';
    device = brand;
  }

  // ===== Serial (Fingerprint) =====
  // --- Base hash (UA + screen + timezone + cpu) ---
  function fnv32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return h.toString(16).toUpperCase().padStart(8, '0');
  }

  const baseRaw = [ua, navigator.language, screen.width, screen.height,
                   screen.colorDepth || 0, navigator.hardwareConcurrency || 0,
                   navigator.deviceMemory || 0,
                   Intl.DateTimeFormat().resolvedOptions().timeZone].join('|');
  const baseHash = fnv32(baseRaw);

  // --- Canvas Fingerprint (بصمة كارت الشاشة) ---
  let canvasHash = '00000000';
  try {
    const cv = document.createElement('canvas');
    cv.width = 200; cv.height = 50;
    const ctx = cv.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f0f';
    ctx.fillRect(0, 0, 200, 50);
    ctx.fillStyle = '#0ff';
    ctx.font = '18px Arial';
    ctx.fillText('شات لايف 🔒 BanCheck', 10, 30);
    ctx.fillStyle = 'rgba(255,100,0,0.5)';
    ctx.font = '14px Georgia';
    ctx.fillText('livechat.fingerprint', 20, 45);
    canvasHash = fnv32(cv.toDataURL());
  } catch(e) {}

  // --- WebGL Fingerprint (بصمة كارت الشاشة / GPU) ---
  let webglHash = '00000000';
  let gpuInfo   = 'unknown';
  try {
    const gl = document.createElement('canvas').getContext('webgl')
            || document.createElement('canvas').getContext('experimental-webgl');
    if (gl) {
      const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbgInfo) {
        const renderer = gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL) || '';
        const vendor   = gl.getParameter(dbgInfo.UNMASKED_VENDOR_WEBGL)   || '';
        gpuInfo   = `${vendor}|${renderer}`;
        webglHash = fnv32(gpuInfo);
      } else {
        const r = gl.getParameter(gl.RENDERER) || '';
        const v = gl.getParameter(gl.VENDOR)   || '';
        gpuInfo   = `${v}|${r}`;
        webglHash = fnv32(gpuInfo);
      }
    }
  } catch(e) {}

  // --- AudioContext Fingerprint (بصمة كارت الصوت) ---
  let audioHash = '00000000';
  try {
    const AudioCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (AudioCtx) {
      const ctx2 = new AudioCtx(1, 44100, 44100);
      const osc  = ctx2.createOscillator();
      const cmp  = ctx2.createDynamicsCompressor();
      osc.type = 'triangle';
      osc.frequency.value = 1000;
      cmp.threshold.value = -50;
      cmp.knee.value       = 40;
      cmp.ratio.value      = 12;
      cmp.attack.value     = 0;
      cmp.release.value    = 0.2;
      osc.connect(cmp);
      cmp.connect(ctx2.destination);
      osc.start(0);
      ctx2.startRendering();
      ctx2.oncomplete = function(e) {
        const buf = e.renderedBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += Math.abs(buf[i]);
        audioHash = fnv32(sum.toString());
      };
    }
  } catch(e) {}

  // --- دمج الكل في Serial واحد ---
  // موبايل: base فقط (مش محتاج canvas/webgl)
  // كمبيوتر: base + canvas + webgl + audio
  const serial = isMobile
    ? baseHash
    : `${baseHash}-${canvasHash}-${webglHash}-${audioHash}`;

  return {
    userAgent:      ua,
    platform:       navigator.platform,
    language:       navigator.language,
    screen:         `${screen.width}x${screen.height}`,
    timezone:       Intl.DateTimeFormat().resolvedOptions().timeZone,
    gpu:            gpuInfo,
    isMobile,
    os:             osVersion ? `${os} ${osVersion}` : os,
    browser:        browserVersion ? `${browser} ${browserVersion}` : browser,
    brand,
    device,
    serial,
  };
}

function getFingerprint(info) {
  const str = JSON.stringify(info);
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(16).padStart(8, '0');
}

// ===================== اتصال Socket =====================
function connectSocket(joinPayload) {
  state.socket = io();

  state.socket.on('auth_error', (err) => {
    sessionStorage.removeItem('livechat_auth');
    window.location.replace('login.html?error=' + encodeURIComponent(err));
  });

  state.socket.on('joined', (data) => {
    state.me = data.user;
    state.currentRoom = joinPayload.selectedRoom || 'egypt';
    state.voiceEnabled = data.voiceEnabled || false;
    state.voiceAllowed = data.voiceAllowed || false;
    showChatScreen(data);
  });

  state.socket.on('voice_feature_update', ({ enabled }) => {
    state.voiceEnabled = enabled;
    updateVoiceBtn();
    showAnno(enabled ? '🎙️ تم تفعيل الفويس نوت' : '🎙️ تم إيقاف الفويس نوت');
  });

  state.socket.on('voice_permission_update', ({ allowed }) => {
    state.voiceAllowed = allowed;
    updateVoiceBtn();
    showAnno(allowed ? '✅ أُذن لك بإرسال فويس نوت' : '❌ تم سحب إذن الفويس منك');
  });

  state.socket.on('voice_message', (msg) => {
    appendVoiceMessage(msg, false);
  });

  state.socket.on('private_voice', (msg) => {
    if (state.ignoreList.has(msg.username)) return;
    if (msg.username === state.me.username || state.privateWith === msg.username || state.privateWith === msg.to) {
      appendVoiceMessage(msg, true);
    } else if (msg.username !== state.me.username) {
      showAnno(`🎙️ فويس نوت خاص من ${msg.username}`);
    }
  });

  state.socket.on('room_op_granted', ({ roomId }) => {
    if (state.currentRoom === roomId) state.me.roomOp = true;
  });

  state.socket.on('room_op_removed', ({ roomId }) => {
    if (state.currentRoom === roomId) state.me.roomOp = false;
  });

  state.socket.on('message',         (msg)  => appendMessage(msg));
  state.socket.on('members_update',  (list) => renderMembers(list));
  state.socket.on('rooms_update',    (list) => renderRooms(list));

  state.socket.on('message_deleted', ({ msgId }) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) el.remove();
  });

  state.socket.on('room_changed', (data) => {
    state.currentRoom = data.roomId;
    document.getElementById('room-name-header').textContent = data.roomName;
    document.getElementById('messages-area').innerHTML = '';
    data.messages.forEach(m => appendMessage(m));
    renderMembers(data.members);
    scrollBottom();
  });

  state.socket.on('private_message', (msg) => {
    // تجاهل الرسائل من المتجاهلين
    if (state.ignoreList.has(msg.from)) return;
    if (state.privateWith === msg.from || state.privateWith === msg.to) {
      appendPrivateMessage(msg);
    } else if (msg.from !== state.me.username) {
      showAnno(`💬 رسالة خاصة من ${msg.from}`);
    }
  });

  state.socket.on('ignored_user', ({ username }) => {
    state.ignoreList.add(username);
    showAnno(`🚫 تم تجاهل ${username}`);
  });

  state.socket.on('unignored_user', ({ username }) => {
    state.ignoreList.delete(username);
    showAnno(`✅ تم إلغاء تجاهل ${username}`);
  });

  state.socket.on('private_locked', ({ locked }) => {
    state.privateLocked = locked;
    updateLockBtn();
    showAnno(locked ? '🔒 الرسائل الخاصة مقفولة' : '🔓 الرسائل الخاصة مفتوحة');
  });

  state.socket.on('announcement', (data) => showAnno(`📢 ${data.text}`));

  state.socket.on('kicked', (data) => {
    alert(data.reason || 'تم طردك');
    logout();
  });

  state.socket.on('you_muted', () => {
    document.getElementById('muted-icon').style.display = 'inline';
    const inp = document.getElementById('msg-input');
    inp.disabled    = true;
    inp.placeholder = 'أنت مكتوم 🔇';
  });

  state.socket.on('you_unmuted', () => {
    document.getElementById('muted-icon').style.display = 'none';
    const inp = document.getElementById('msg-input');
    inp.disabled    = false;
    inp.placeholder = 'اكتب رسالة...';
  });

  state.socket.on('your_role_updated', ({ role }) => {
    state.me.role = role;
    updateMyBadge();
    // إظهار/إخفاء زر لوحة التحكم
    document.getElementById('owner-panel-btn').style.display =
      role === 'owner' ? 'inline' : 'none';
  });

  state.socket.on('your_color_updated', ({ color }) => {
    state.me.nameColor = color;
    updateMyBadge();
  });

  state.socket.on('room_created', ({ roomId }) => {
    state.socket.emit('change_room', roomId);
  });

  state.socket.on('perm_error', ({ msg }) => {
    showAnno(msg);
  });

  state.socket.on('filter_block', ({ msg }) => {
    showAnno(msg);
  });

  state.socket.on('chat_reset', () => {
    document.getElementById('messages-area').innerHTML = '';
    showAnno('🔄 تم إعادة ضبط الشات');
  });

  state.socket.on('connect', () => {
    const info = getDeviceInfo();
    state.socket.emit('join', {
      ...joinPayload,
      fingerprint: getFingerprint(info),
      deviceInfo:  info,
    });
  });

  state.socket.on('connect_error', () => {
    sessionStorage.removeItem('livechat_auth');
    window.location.replace('login.html?error=' + encodeURIComponent('تعذّر الاتصال بالخادم'));
  });
}

// ===================== عرض الشات =====================
function showChatScreen(data) {
  document.getElementById('chat-screen').style.display = 'flex';
  updateMyBadge();

  if (state.me.role === 'owner') {
    document.getElementById('owner-panel-btn').style.display = 'inline';
    // المالك لا يحتاج زر قفل الخاص — رسائله تصل دائماً
    const lockBtn = document.getElementById('lock-private-btn');
    if (lockBtn) lockBtn.style.display = 'none';
  }

  const area = document.getElementById('messages-area');
  area.innerHTML = '';
  data.messages.forEach(m => appendMessage(m));
  renderMembers(data.members);
  renderRooms(data.rooms);
  scrollBottom();

  document.getElementById('msg-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) sendMessage();
  });

  // تحديث زر الفويس بعد ما تتحمل الصفحة
  updateVoiceBtn();
}

function updateMyBadge() {
  const nameEl  = document.getElementById('my-name');
  const badgeEl = document.getElementById('my-badge');
  nameEl.textContent  = state.me.username;
  nameEl.style.color  = state.me.nameColor || '';
  badgeEl.className   = 'badge';
  const b = roleBadge(state.me.role);
  if (b) {
    badgeEl.textContent = b;
    badgeEl.classList.add(`badge-${state.me.role}`);
  } else {
    badgeEl.textContent = '';
  }
}

// ===================== رسائل =====================
function appendMessage(msg) {
  const area = document.getElementById('messages-area');
  if (!area) return;

  if (msg.type === 'system') {
    const el = document.createElement('div');
    el.className   = 'msg-system';
    el.textContent = msg.text;
    area.appendChild(el);
  } else {
    const isOwn = msg.username === state.me?.username;
    const el    = document.createElement('div');
    el.className = `msg ${isOwn ? 'own' : 'other'}`;
    el.id        = `msg-${msg.id}`;

    const badge     = roleBadge(msg.role);
    const colorAttr = msg.nameColor ? `style="color:${msg.nameColor}"` : '';
    const canDelete = ['owner', 'admin', 'moderator'].includes(state.me?.role);

    el.innerHTML = `
      <div class="msg-meta">
        ${badge ? `<span class="badge badge-${msg.role}">${badge}</span>` : ''}
        <span class="msg-name" ${colorAttr}>${escHtml(msg.username)}</span>
        ${canDelete ? `<button class="msg-delete-btn" onclick="deleteMsg('${msg.id}')" title="حذف">🗑️</button>` : ''}
      </div>
      <div class="msg-bubble">${escHtml(msg.text)}</div>
      <div class="msg-time">${formatTime(msg.time)}</div>
    `;
    area.appendChild(el);
  }
  scrollBottom();
}

function appendPrivateMessage(msg) {
  const area  = document.getElementById('messages-area');
  const isOwn = msg.from === state.me.username;
  const el    = document.createElement('div');
  el.className = `msg ${isOwn ? 'own' : 'other'}`;
  el.innerHTML = `
    <div class="msg-meta">
      <span class="msg-name">${escHtml(isOwn ? 'أنت' : msg.from)}</span>
    </div>
    <div class="msg-bubble" style="border: 1.5px dashed #4f8ef7">${escHtml(msg.text)}</div>
    <div class="msg-time">${formatTime(msg.time)}</div>
  `;
  area.appendChild(el);
  scrollBottom();
}

function sendMessage() {
  const input = document.getElementById('msg-input');
  const text  = input.value.trim();
  if (!text) return;

  if (state.privateWith) {
    state.socket.emit('private_message', { to: state.privateWith, text });
  } else {
    state.socket.emit('send_message', { text });
  }
  input.value = '';
}

function deleteMsg(msgId) {
  state.socket.emit('delete_message', { msgId });
}

// ===================== الأعضاء =====================
function renderMembers(members) {
  const list  = document.getElementById('members-list');
  const count = document.getElementById('members-count');
  if (!list) return;
  count.textContent = members.length;

  list.innerHTML = members.map(m => {
    const badge     = roleBadge(m.role);
    const colorAttr = m.nameColor ? `style="color:${m.nameColor}"` : '';
    const dotClass  = m.muted ? 'member-dot muted' : 'member-dot';
    return `<div class="member-item" onclick="toggleMemberDropdown(event,'${escAttr(m.username)}','${m.role}','${m.muted}','${m.roomOp||false}')">
      <div class="${dotClass}" title="${m.muted ? 'مكتوم' : 'أونلاين'}"></div>
      <span class="member-name" ${colorAttr}>${escHtml(m.username)}</span>
      ${badge ? `<span class="member-badge">${badge}</span>` : ''}
      <div class="dd-menu" onclick="event.stopPropagation()"></div>
    </div>`;
  }).join('');
}

// ===================== الغرف =====================
function toggleRoomsPanel() {
  document.getElementById('rooms-panel').classList.toggle('hidden');
}

function renderRooms(rooms) {
  const list = document.getElementById('rooms-list');
  if (!list) return;
  list.innerHTML = rooms.map(r => `
    <div class="room-item ${r.id === state.currentRoom ? 'active' : ''}" onclick="changeRoom('${r.id}')">
      <span>${r.isPrivate ? '🔒 ' : ''}${escHtml(r.name)}</span>
      <span class="room-count">${r.count}</span>
    </div>
  `).join('');

  // إظهار/إخفاء حقل إنشاء غرفة بناءً على الصلاحية
  const createSection = document.getElementById('create-room-section');
  if (createSection) {
    createSection.style.display = canCreateRoomClient(state.me?.role) ? '' : 'none';
  }
}

function changeRoom(roomId) {
  if (roomId === state.currentRoom) return;
  closePrivate();
  state.socket.emit('change_room', roomId);
  document.getElementById('rooms-panel').classList.add('hidden');
}

function createRoom() {
  const name = document.getElementById('new-room-name').value.trim();
  if (!name) return;
  state.socket.emit('create_room', { name });
  document.getElementById('new-room-name').value = '';
}

// ===================== الخاص =====================
function openPrivate(username) {
  state.privateWith = username;
  document.getElementById('private-indicator').style.display = 'flex';
  document.getElementById('private-with').textContent = username;
  document.getElementById('messages-area').innerHTML = '';
  document.getElementById('msg-input').placeholder   = `رسالة لـ ${username}...`;
}

function closePrivate() {
  state.privateWith = null;
  document.getElementById('private-indicator').style.display = 'none';
  document.getElementById('msg-input').placeholder = 'اكتب رسالة...';
  document.getElementById('messages-area').innerHTML = '';
}

// ===================== Dropdown العضو =====================
function toggleMemberDropdown(event, username, role, muted, roomOp) {
  event.stopPropagation();
  if (username === state.me.username) return;

  const item = event.currentTarget;
  const menu = item.querySelector('.dd-menu');

  // أغلق أي dropdown تاني مفتوح
  document.querySelectorAll('.member-item.dd-active').forEach(el => {
    if (el !== item) el.classList.remove('dd-active');
  });

  const isOpen = item.classList.contains('dd-active');
  if (isOpen) { item.classList.remove('dd-active'); return; }

  // ابني المحتوى
  menu.innerHTML = buildDropdownHTML(username, role, muted, roomOp);

  // افتح
  item.classList.add('dd-active');

  // تحقق لو هيطلع برا الشاشة
  const rect = menu.getBoundingClientRect();
  if (rect.left < 0) {
    item.classList.add('dd-open-left');
  } else {
    item.classList.remove('dd-open-left');
  }
}

function ddToggleSub(el, event) {
  event.stopPropagation();
  el.classList.toggle('open');
}

// أغلق كل الـ dropdowns لو ضغط برا
document.addEventListener('click', () => {
  document.querySelectorAll('.member-item.dd-active').forEach(el => el.classList.remove('dd-active'));
});

function buildDropdownHTML(username, role, muted, roomOp) {
  const isMuted   = muted === 'true' || muted === true;
  const myRole    = state.me.role;
  const isIgnored = state.ignoreList.has(username);

  const RANK = { owner:0, admin:1, moderator:2, host:3, vip:4, member:5, guest:6 };
  const autoOpRoles = ['owner','admin','moderator','host'];
  const badgeLabels = { owner:'👑 تاج', admin:'🛡️ ادمن', moderator:'👑 أونر', host:'🎖️ هوست', vip:'⭐ نجمة', member:'👤 عضو', guest:'زائر' };
  const allRoles = ['admin','moderator','host','vip','member','guest'];

  const u = escAttr(username);
  let h = '';

  // Header
  h += `<div class="dd-menu-header">${escHtml(username)}</div><hr>`;

  // ===== للكل =====
  h += `<button class="dd-menu-item success" onclick="sendWelcome('${u}');closeDDMenu(this)">👋 ترحيب</button>`;

  const privateAllowed = canSendPrivateClient(myRole, role);
  if (privateAllowed) {
    h += `<button class="dd-menu-item info" onclick="openPrivate('${u}')">💬 رسالة خاصة</button>`;
  }

  h += `<button class="dd-menu-item" onclick="mentionUser('${u}');closeDDMenu(this)">@ Mention</button>`;

  if (role !== 'owner') {
    h += `<hr>`;
    if (isIgnored) {
      h += `<button class="dd-menu-item success" onclick="unignoreUser('${u}');closeDDMenu(this)">👁️ إلغاء التجاهل</button>`;
    } else {
      h += `<button class="dd-menu-item" onclick="ignoreUser('${u}');closeDDMenu(this)">🚫 تجاهل</button>`;
    }
    h += `<button class="dd-menu-item danger" onclick="reportUser('${u}');closeDDMenu(this)">🚨 إبلاغ</button>`;
  }

  // ===== قسم الإدارة (Hammers / Kicks / Staff) =====
  if (!['owner','admin'].includes(role)) {
    h += `<hr>`;

    // Hammers (كتم)
    h += `<div class="dd-expand" onclick="ddToggleSub(this,event)">`;
    h += `<div class="dd-expand-header"><span>🔨 Hammers</span><span class="dd-arrow-icon">▼</span></div>`;
    h += `<div class="dd-sub-list">`;
    if (isMuted) {
      h += `<button class="dd-sub-item success" onclick="unmuteUser('${u}');closeDDMenu(this)">🔊 رفع الكتم</button>`;
    } else {
      h += `<button class="dd-sub-item" onclick="muteUser('${u}');closeDDMenu(this)">🔇 كتم</button>`;
      h += `<button class="dd-sub-item" onclick="muteUserTemp('${u}',10);closeDDMenu(this)">🔇 كتم 10 دقايق</button>`;
      h += `<button class="dd-sub-item" onclick="muteUserTemp('${u}',60);closeDDMenu(this)">🔇 كتم ساعة</button>`;
    }
    h += `</div></div>`;

    // Kicks
    h += `<div class="dd-expand" onclick="ddToggleSub(this,event)">`;
    h += `<div class="dd-expand-header"><span>👢 Kicks</span><span class="dd-arrow-icon">▼</span></div>`;
    h += `<div class="dd-sub-list">`;
    h += `<button class="dd-sub-item danger" onclick="kickUser('${u}');closeDDMenu(this)">👢 طرد سريع</button>`;
    h += `<button class="dd-sub-item danger" onclick="kickBanIP('${u}');closeDDMenu(this)">🌐 طرد + باند IP</button>`;
    h += `</div></div>`;

    // Staff (رتب + باند)
    h += `<div class="dd-expand" onclick="ddToggleSub(this,event)">`;
    h += `<div class="dd-expand-header"><span>⚙️ Staff</span><span class="dd-arrow-icon">▼</span></div>`;
    h += `<div class="dd-sub-list">`;
    h += `<button class="dd-sub-item danger" onclick="banUser('${u}');closeDDMenu(this)">🚫 باند</button>`;

    // رفع رتبة
    const canPromote = allRoles.filter(r => RANK[r] < RANK[role]);
    if (canPromote.length) {
      h += `<div class="dd-role-label">⬆️ رفع رتبة</div>`;
      canPromote.forEach(r => {
        h += `<button class="dd-sub-item info" onclick="promoteUser('${u}','${r}');closeDDMenu(this)">⬆️ ${badgeLabels[r]}</button>`;
      });
    }

    // تنزيل رتبة
    const canDemote = allRoles.filter(r => RANK[r] > RANK[role]);
    if (canDemote.length) {
      h += `<div class="dd-role-label">⬇️ تنزيل رتبة</div>`;
      canDemote.forEach(r => {
        h += `<button class="dd-sub-item" onclick="promoteUser('${u}','${r}');closeDDMenu(this)">⬇️ ${badgeLabels[r]}</button>`;
      });
    }

    h += `</div></div>`;
  }

  return h;
}

function closeDDMenu(el) {
  const item = el.closest('.member-item');
  if (item) item.classList.remove('dd-active');
}

function mentionUser(username) {
  const input = document.getElementById('msg-input');
  if (input) {
    input.value = (input.value + ` @${username} `).trimStart();
    input.focus();
  }
  document.querySelectorAll('.member-item.dd-active').forEach(el => el.classList.remove('dd-active'));
}

// ===================== مودال العضو =====================
// ===== دوال فحص الصلاحيات (Client-side للـ UI فقط) =====
function canSendPrivateClient(myRole, targetRole) {
  // guest يقدر يبعت خاص
  if (myRole === 'guest') return true;
  if (targetRole === 'guest') return true;
  if (myRole === 'member') {
    const RANK = { owner:0, admin:1, moderator:2, host:3, vip:4, member:5, guest:6 };
    return RANK[targetRole] <= RANK['vip'];
  }
  return true;
}
function canMuteClient(role)      { return ['owner','admin','moderator','host'].includes(role); }
function canKickClient(role)      { return ['owner','admin','moderator'].includes(role); }
function canCreateRoomClient(role){ return ['owner','admin','moderator','host','vip'].includes(role); }

// ===== تجاهل =====
function ignoreUser(username) {
  state.socket.emit('ignore_user', { username });
}
function unignoreUser(username) {
  state.socket.emit('unignore_user', { username });
}

// ===== قفل / فتح الخاص =====
function togglePrivateLock() {
  if (state.privateLocked) {
    state.socket.emit('unlock_private');
  } else {
    state.socket.emit('lock_private');
  }
}
function updateLockBtn() {
  const btn = document.getElementById('lock-private-btn');
  if (!btn) return;
  btn.textContent = state.privateLocked ? '🔒 الخاص مقفول' : '🔓 قفل الخاص';
  btn.style.background = state.privateLocked ? '#ffeaea' : '#f0f4ff';
  btn.style.color      = state.privateLocked ? '#e74c3c' : '#4f8ef7';
}


function promoteUser(username, role) {
  const labels = { owner:'👑 تاج', admin:'🛡️ ادمن', moderator:'👑 أونر', host:'🎖️ هوست', vip:'⭐ نجمة', member:'👤 عضو' };
  if (!confirm(`ترقية ${username} إلى ${labels[role]}؟`)) return;
  fetch('/api/owner/set-role', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'x-owner-token': state.ownerToken || '' },
    body: JSON.stringify({ username, role, requestedBy: state.me.username }),
  })
  .then(r => r.json())
  .then(r => {
    if (r.ok) {
    } else {
      alert(r.error || 'فشل الترقية');
    }
  });
}

function sendWelcome(username) {
  const msgs = [
    `👋 أهلاً وسهلاً بـ ${username} في الشات! 🎉`,
    `🌹 مرحباً ${username}، يسعدنا وجودك معنا!`,
    `✨ حياك الله يا ${username}!`,
  ];
  const text = msgs[Math.floor(Math.random() * msgs.length)];
  state.socket.emit('send_message', { text });
}


function muteUser(username) {
  state.socket.emit('mute_user', { username });
}
function muteUserTemp(username, minutes) {
  state.socket.emit('mute_user', { username, minutes });
}
function unmuteUser(username) {
  state.socket.emit('unmute_user', { username });
}
function kickUser(username) {
  if (!confirm(`طرد ${username}؟`)) return;
  state.socket.emit('kick_user', { username, reason: 'تم طردك من الغرفة' });
}

function kickBanIP(username) {
  if (!confirm(`طرد + باند IP لـ ${username}؟`)) return;
  state.socket.emit('kick_ban_ip', { username });
}

function banUser(username) {
  if (!confirm(`باند ${username}؟`)) return;
  state.socket.emit('ban_user', { username });
}

function reportUser(username) {
  const reason = prompt(`سبب الإبلاغ عن ${username}:`);
  if (!reason || !reason.trim()) return;
  state.socket.emit('report_user', { username, reason: reason.trim() });
  alert('✅ تم إرسال البلاغ للمالك');
}

// ===================== لوحة تحكم المالك =====================
function openOwnerPanel() {
  document.getElementById('owner-panel').classList.remove('hidden');
  loadOwnerTab('online');
}
function closeOwnerPanel() {
  document.getElementById('owner-panel').classList.add('hidden');
}

function ownerTab(tab, btn) {
  state.ownerTabActive = tab;
  document.querySelectorAll('.otab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadOwnerTab(tab);
}

function loadOwnerTab(tab) {
  const content = document.getElementById('owner-content');

  if (tab === 'online') {
    ownerFetch('/api/owner/online').then(r => {
      if (!r.ok) return;
      content.innerHTML = `
        <table class="owner-table">
          <tr><th>الاسم</th><th>الدور</th><th>الغرفة</th><th>IP</th><th>الجهاز / الماركة</th><th>المتصفح</th><th>النظام</th><th>Serial</th><th>إجراءات</th></tr>
          ${r.users.map(u => `<tr>
            <td><b>${escHtml(u.username)}</b>${u.isGuest ? ' <span style="color:#aaa;font-size:0.75rem">(زائر)</span>' : ''}</td>
            <td>${roleBadge(u.role) || u.role}</td>
            <td>${escHtml(u.room || '')}</td>
            <td style="font-size:0.75rem;color:#f90;direction:ltr">${escHtml(u.ip || '?')}</td>
            <td style="font-size:0.78rem">
              ${u.deviceInfo?.isMobile ? '📱' : '🖥️'}
              ${escHtml(u.deviceInfo?.device || '?')}
              ${u.deviceInfo?.brand && u.deviceInfo.brand !== u.deviceInfo?.device ? `<span style="color:#aaa">(${escHtml(u.deviceInfo.brand)})</span>` : ''}
            </td>
            <td style="font-size:0.78rem">${escHtml(u.deviceInfo?.browser || '?')}</td>
            <td style="font-size:0.78rem">${escHtml(u.deviceInfo?.os || '?')}</td>
            <td style="font-size:0.72rem;color:#888;direction:ltr;font-family:monospace">${escHtml(u.deviceInfo?.serial || '?')}</td>
            <td>
              <button class="btn-xs red" onclick="ownerBanWithIP('${escAttr(u.username)}')">🚫 حظر شامل</button>
              <button class="btn-xs orange" onclick="ownerBanIP('${escAttr(u.ip||'')}','${escAttr(u.username)}')">🔒 IP فقط</button>
            </td>
          </tr>`).join('')}
        </table>`;
    });
  }

  else if (tab === 'banned-serials') {
    ownerFetch('/api/owner/banned-serials').then(r => {
      if (!r.ok) return;
      content.innerHTML = `
        <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
          <input id="manual-serial-input" type="text" class="input" placeholder="أدخل Serial يدوياً للحظر..." style="flex:1;font-family:monospace;font-size:0.85rem">
          <button class="btn-xs red" onclick="ownerBanSerialManual()" style="white-space:nowrap;padding:8px 14px">🚫 حظر</button>
        </div>` +
        (r.serials.length === 0
          ? '<p style="color:#aaa;text-align:center;margin-top:2rem">لا توجد Serials محظورة</p>'
          : `<table class="owner-table">
              <tr><th>Serial</th><th>السبب</th><th>التاريخ</th><th>إجراء</th></tr>
              ${r.serials.map(b => `<tr>
                <td style="color:#9b59b6;font-weight:bold;font-family:monospace;direction:ltr">${escHtml(b.serial)}</td>
                <td>${escHtml(b.reason || '-')}</td>
                <td style="font-size:0.75rem;color:#aaa">${new Date(b.bannedAt * 1000).toLocaleString('ar-EG')}</td>
                <td><button class="btn-xs green" onclick="ownerUnbanSerial('${escAttr(b.serial)}')">✅ رفع الحظر</button></td>
              </tr>`).join('')}
            </table>`);
    });
  }

  else if (tab === 'banned-ips') {
    ownerFetch('/api/owner/banned-ips').then(r => {
      if (!r.ok) return;
      content.innerHTML = r.ips.length === 0
        ? '<p style="color:#aaa;text-align:center;margin-top:2rem">لا توجد IPs محظورة</p>'
        : `<table class="owner-table">
            <tr><th>IP</th><th>السبب</th><th>التاريخ</th><th>إجراء</th></tr>
            ${r.ips.map(b => `<tr>
              <td style="color:#f90;font-weight:bold">${escHtml(b.ip)}</td>
              <td>${escHtml(b.reason || '-')}</td>
              <td style="font-size:0.75rem;color:#aaa">${new Date(b.bannedAt * 1000).toLocaleString('ar-EG')}</td>
              <td><button class="btn-xs green" onclick="ownerUnbanIP('${escAttr(b.ip)}')">✅ رفع الحظر</button></td>
            </tr>`).join('')}
          </table>`;
    });
  }

  else if (tab === 'users') {
    ownerFetch('/api/owner/users').then(r => {
      if (!r.ok) return;
      content.innerHTML = `
        <table class="owner-table">
          <tr><th>الاسم</th><th>الدور</th><th>لون الاسم</th><th>إجراءات</th></tr>
          ${r.users.map(u => `<tr>
            <td><span style="color:${u.nameColor || 'inherit'}">${escHtml(u.username)}</span>${u.banned ? ' 🚫' : ''}</td>
            <td>${u.role}</td>
            <td>
              <input type="color" value="${u.nameColor || '#222222'}"
                onchange="ownerSetColor('${escAttr(u.username)}', this.value)"
                style="border:none;width:32px;height:24px;cursor:pointer;border-radius:4px">
            </td>
            <td style="display:flex;gap:4px;flex-wrap:wrap">
              <button class="btn-xs blue"   onclick="ownerSetRole('${escAttr(u.username)}','moderator')">⭐ مشرف</button>
              <button class="btn-xs purple" onclick="ownerSetRole('${escAttr(u.username)}','host')">🎖️ هوست</button>
              <button class="btn-xs gold"   onclick="ownerSetRole('${escAttr(u.username)}','vip')">✨ VIP</button>
              <button class="btn-xs gray"   onclick="ownerSetRole('${escAttr(u.username)}','member')">عادي</button>
              ${u.banned
                ? `<button class="btn-xs green" onclick="ownerUnban('${escAttr(u.username)}')">✅ رفع حظر</button>`
                : `<button class="btn-xs red"   onclick="ownerBan('${escAttr(u.username)}')">🚫 حظر</button>`
              }
            </td>
          </tr>`).join('')}
        </table>`;
    });
  }

  else if (tab === 'private') {
    content.innerHTML = `
      <div style="display:flex;height:460px;gap:0;border:1px solid var(--border);border-radius:12px;overflow:hidden">

        <!-- قائمة المحادثات -->
        <div style="width:200px;min-width:160px;border-left:1px solid var(--border);display:flex;flex-direction:column;background:var(--bg)">
          <div style="padding:10px 10px 6px;font-weight:700;font-size:0.82rem;color:#888;letter-spacing:0.04em;border-bottom:1px solid var(--border)">
            💬 المحادثات الخاصة
          </div>
          <input id="pm-search" type="text" placeholder="🔍 بحث..." oninput="filterPrivateList()"
            style="margin:8px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;font-size:0.82rem;outline:none;background:#fff">
          <div id="pm-list" style="overflow-y:auto;flex:1;padding:4px 0"></div>
          <div style="padding:8px;border-top:1px solid var(--border)">
            <button onclick="loadOwnerTab('private')"
              style="width:100%;padding:5px;font-size:0.75rem;border:none;border-radius:7px;background:#f0f4ff;color:#4f8ef7;cursor:pointer">
              🔄 تحديث
            </button>
          </div>
        </div>

        <!-- منطقة المحادثة -->
        <div style="flex:1;display:flex;flex-direction:column;background:#fff">
          <div id="pm-header" style="padding:12px 16px;font-weight:700;font-size:0.9rem;color:#4f8ef7;border-bottom:1px solid var(--border);background:var(--bg);display:flex;align-items:center;gap:8px">
            <span>اختر محادثة من القائمة</span>
          </div>
          <div id="pm-messages" style="flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:8px">
            <div style="margin:auto;text-align:center;color:#ccc;font-size:2rem;padding-top:40px">💬</div>
          </div>
        </div>

      </div>`;

    // جلب البيانات وتخزينها
    ownerFetch('/api/owner/private-chats').then(r => {
      if (!r.ok) return;
      window._pmChats = r.chats;
      renderPrivateList(r.chats);
    });
  }

  else if (tab === 'broadcast') {
    content.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;padding:4px 0">
        <label style="font-weight:600;font-size:0.9rem">إعلان للجميع</label>
        <textarea id="bc-text" rows="4" class="input" placeholder="اكتب الإعلان هنا..."></textarea>
        <button class="btn-primary" onclick="doBroadcast()">📢 إرسال للجميع</button>
      </div>`;
  }

  else if (tab === 'settings') {
    content.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px;padding:4px 0">
        <label style="font-weight:600;font-size:0.9rem">تغيير كلمة مرور المالك</label>
        <input id="new-owner-pass" type="password" class="input" placeholder="كلمة المرور الجديدة (6 أحرف على الأقل)">
        <button class="btn-primary" onclick="doChangeOwnerPass()">🔒 تغيير كلمة المرور</button>
        <hr style="border:none;border-top:1px solid var(--border)">
        <label style="font-weight:600;font-size:0.9rem;color:var(--danger)">منطقة الخطر</label>
        <button class="btn-primary" style="background:var(--danger)" onclick="doReset()">🔄 حذف كل الرسائل والغرف الخاصة</button>
      </div>`;
  }


  else if (tab === 'voice') {
    ownerFetch('/api/owner/voice/settings').then(r => {
      if (!r.ok) return;
      const allowed = r.allowedUsers || [];
      const enabledColor = r.enabled ? '#27ae60' : '#e74c3c';
      const enabledLabel = r.enabled ? '✅ مفعّل' : '🚫 معطّل';
      const listHTML = allowed.length === 0
        ? '<p style="color:#aaa;font-size:0.85rem;text-align:center;padding:16px">لا يوجد أعضاء مضافون</p>'
        : allowed.map(u => '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#fff;border-radius:10px;border:1px solid #eee;margin-bottom:6px"><span style="font-weight:600">' + escHtml(u) + '</span><button class="btn-xs red" onclick="ownerVoiceRemove(\'' + escAttr(u) + '\')">❌ إزالة</button></div>').join('');
      content.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:16px;padding:4px 0">
          <div style="background:#f8faff;border-radius:12px;padding:14px;display:flex;align-items:center;justify-content:space-between;gap:12px">
            <div>
              <div style="font-weight:700;font-size:0.9rem">🎙️ ميزة الفويس نوت</div>
              <div style="font-size:0.78rem;color:#888;margin-top:3px">تفعّل أو توقف الميزة لكل الشات</div>
            </div>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="voice-toggle" ${r.enabled ? 'checked' : ''}
                onchange="toggleVoiceFeature(this.checked)"
                style="width:18px;height:18px;cursor:pointer;accent-color:#4f8ef7">
              <span id="voice-status" style="font-weight:700;font-size:0.85rem;color:${enabledColor}">${enabledLabel}</span>
            </label>
          </div>
          <div style="background:#f8faff;border-radius:12px;padding:14px">
            <div style="font-weight:700;font-size:0.9rem;margin-bottom:10px">➕ إضافة عضو للفويس</div>
            <div style="display:flex;gap:8px">
              <input type="text" id="voice-add-user" placeholder="اسم المستخدم" class="input" style="flex:1">
              <button class="btn-primary" style="white-space:nowrap" onclick="ownerVoiceAllow()">✅ إضافة</button>
            </div>
          </div>
          <div>
            <div style="font-weight:700;font-size:0.9rem;margin-bottom:10px">👥 المسموح لهم بالفويس (${allowed.length})</div>
            <div id="voice-allowed-list">${listHTML}</div>
          </div>
        </div>`;
    });
  }
  else if (tab === 'filter') {
    ownerFetch('/api/owner/filter').then(r => {
      if (!r.ok) return;
      const wordsVal = (r.words || []).join('\n');
      content.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:16px;padding:4px 0">

          <!-- مانع الروابط -->
          <div style="background:var(--bg);border-radius:12px;padding:14px;display:flex;align-items:center;justify-content:space-between;gap:12px">
            <div>
              <div style="font-weight:700;font-size:0.9rem">🔗 مانع الروابط</div>
              <div style="font-size:0.78rem;color:var(--text-light);margin-top:3px">يمنع إرسال أي رابط (عدا المالك والادمن)</div>
            </div>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none">
              <input type="checkbox" id="links-toggle" ${r.linksBlocked ? 'checked' : ''}
                onchange="toggleLinksBlock(this.checked)"
                style="width:18px;height:18px;cursor:pointer;accent-color:var(--primary)">
              <span id="links-status" style="font-weight:700;font-size:0.85rem;color:${r.linksBlocked ? 'var(--danger)' : 'var(--green)'}">
                ${r.linksBlocked ? '🚫 مفعّل' : '✅ معطّل'}
              </span>
            </label>
          </div>

          <!-- فلتر الكلمات -->
          <div>
            <label style="font-weight:700;font-size:0.9rem;display:block;margin-bottom:8px">🤬 كلمات محظورة</label>
            <div style="font-size:0.78rem;color:var(--text-light);margin-bottom:8px">كل كلمة في سطر — بتتحول لنجوم *** تلقائياً (عدا المالك والادمن)</div>
            <textarea id="filter-words" rows="8" class="input" placeholder="كلمة1&#10;كلمة2&#10;كلمة3">${escHtml(wordsVal)}</textarea>
            <button class="btn-primary" style="margin-top:10px;width:100%" onclick="saveFilterWords()">💾 حفظ الكلمات</button>
          </div>

        </div>`;
    });
  }
}

// ===================== لوحة تحكم — المحادثات الخاصة =====================
function renderPrivateList(chats) {
  const list = document.getElementById('pm-list');
  if (!list) return;
  const keys = Object.keys(chats);
  if (!keys.length) {
    list.innerHTML = '<p style="color:#aaa;font-size:0.78rem;padding:16px;text-align:center">لا توجد محادثات</p>';
    return;
  }
  list.innerHTML = keys.map(k => {
    const msgs   = chats[k];
    const last   = msgs[msgs.length - 1];
    const users  = k.split('__');
    const label  = users.join(' ↔ ');
    const preview = last ? escHtml(last.text.slice(0, 28)) + (last.text.length > 28 ? '…' : '') : '';
    return `<div class="pm-list-item" data-key="${escAttr(k)}" onclick="openPrivateChat('${escAttr(k)}')"
      style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #f0f2f5;transition:background .15s">
      <div style="font-weight:600;font-size:0.82rem;color:#222;margin-bottom:2px">${escHtml(label)}</div>
      <div style="font-size:0.74rem;color:#aaa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${preview}</div>
      <div style="font-size:0.7rem;color:#c0c0c0;margin-top:2px">${msgs.length} رسالة</div>
    </div>`;
  }).join('');
}

function filterPrivateList() {
  const q    = (document.getElementById('pm-search')?.value || '').toLowerCase();
  const chats = window._pmChats || {};
  const filtered = {};
  Object.keys(chats).forEach(k => {
    if (!q || k.toLowerCase().includes(q)) filtered[k] = chats[k];
  });
  renderPrivateList(filtered);
}

function openPrivateChat(key) {
  // تمييز المحادثة المختارة
  document.querySelectorAll('.pm-list-item').forEach(el => {
    el.style.background = el.dataset.key === key ? '#eef3ff' : '';
  });

  const chats = window._pmChats || {};
  const msgs  = chats[key] || [];
  const users = key.split('__');

  const header = document.getElementById('pm-header');
  const area   = document.getElementById('pm-messages');
  if (!header || !area) return;

  header.innerHTML = `
    <span style="font-size:1.1rem">💬</span>
    <span>${escHtml(users[0])}</span>
    <span style="color:#bbb;font-weight:400;font-size:0.85rem">↔</span>
    <span>${escHtml(users[1])}</span>
    <span style="margin-right:auto;font-size:0.75rem;color:#aaa;font-weight:400">${msgs.length} رسالة</span>`;

  if (!msgs.length) {
    area.innerHTML = '<p style="color:#ccc;text-align:center;padding-top:40px">لا توجد رسائل</p>';
    return;
  }

  area.innerHTML = msgs.map(m => {
    const isFirst = m.from === users[0];
    const align   = isFirst ? 'flex-end' : 'flex-start';
    const bg      = isFirst ? '#4f8ef7' : '#f0f2f5';
    const color   = isFirst ? '#fff' : '#222';
    return `<div style="display:flex;flex-direction:column;align-items:${align};max-width:80%;align-self:${align}">
      <div style="font-size:0.7rem;color:#aaa;margin-bottom:2px;padding:0 4px">${escHtml(m.from)} · ${formatTime(m.time)}</div>
      <div style="background:${bg};color:${color};padding:8px 12px;border-radius:14px;font-size:0.85rem;word-break:break-word;max-width:100%">
        ${escHtml(m.text)}
      </div>
    </div>`;
  }).join('');

  // scroll لآخر رسالة
  area.scrollTop = area.scrollHeight;
}


function ownerFetch(url) {
  return fetch(url, {
    headers: { 'x-owner-token': state.ownerToken || '' }
  }).then(r => r.json());
}

function ownerPost(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-owner-token': state.ownerToken || '' },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

function ownerSetRole(username, role) {
  ownerPost('/api/owner/set-role', { username, role }).then(r => {
    if (r.ok) loadOwnerTab('users');
    else alert(r.error || 'فشل');
  });
}

function ownerSetColor(username, color) {
  ownerPost('/api/owner/set-color', { username, color });
}

function ownerBan(username) {
  if (!confirm(`حظر ${username}؟`)) return;
  ownerPost('/api/owner/ban', { username }).then(r => {
    if (r.ok) loadOwnerTab('users');
  });
}

function ownerBanIP(ip, username) {
  if (!confirm(`حظر IP: ${ip}؟`)) return;
  ownerPost("/api/owner/ban-ip", { ip, reason: `محظور مع ${username}` }).then(r => {
    if (r.ok) { alert("✅ تم حظر الـ IP"); loadOwnerTab("online"); }
    else alert(r.error || "فشل");
  });
}

function ownerUnbanIP(ip) {
  ownerPost("/api/owner/unban-ip", { ip }).then(r => {
    if (r.ok) loadOwnerTab("banned-ips");
  });
}

function ownerUnbanSerial(serial) {
  ownerPost("/api/owner/unban-serial", { serial }).then(r => {
    if (r.ok) loadOwnerTab("banned-serials");
  });
}

function ownerBanSerialManual() {
  const serial = (document.getElementById('manual-serial-input')?.value || '').trim();
  if (!serial) { alert('أدخل serial أولاً'); return; }
  if (!confirm(`حظر Serial: ${serial}؟`)) return;
  ownerPost("/api/owner/ban-serial", { serial, reason: 'محظور يدوياً' }).then(r => {
    if (r.ok) { alert('✅ تم حظر الـ Serial'); loadOwnerTab('banned-serials'); }
    else alert(r.error || 'فشل');
  });
}

function ownerBanWithIP(username) {
  if (!confirm(`حظر ${username} مع الـ IP؟`)) return;
  ownerPost("/api/owner/ban", { username, banIP: true }).then(r => {
    if (r.ok) loadOwnerTab("online");
  });
}

function ownerUnban(username) {
  ownerPost('/api/owner/unban', { username }).then(r => {
    if (r.ok) loadOwnerTab('users');
  });
}

function doBroadcast() {
  const text = (document.getElementById('bc-text')?.value || '').trim();
  if (!text) return;
  ownerPost('/api/owner/broadcast', { text }).then(r => {
    if (r.ok) {
      document.getElementById('bc-text').value = '';
      alert('✅ تم الإرسال');
    }
  });
}

function doChangeOwnerPass() {
  const newPassword = (document.getElementById('new-owner-pass')?.value || '').trim();
  if (!newPassword) return;
  ownerPost('/api/owner/change-password', { newPassword }).then(r => {
    if (r.ok) {
      alert('✅ تم تغيير كلمة المرور — سيُطلب منك الدخول مجدداً');
      logout();
    } else alert(r.error || 'فشل');
  });
}

function doReset() {
  if (!confirm('هتحذف كل الرسائل والغرف الخاصة؟ هذا لا يمكن التراجع عنه!')) return;
  ownerPost('/api/owner/reset', {}).then(r => {
    if (r.ok) closeOwnerPanel();
  });
}

function toggleLinksBlock(blocked) {
  ownerPost('/api/owner/filter/links', { blocked }).then(r => {
    if (!r.ok) return;
    const status = document.getElementById('links-status');
    if (status) {
      status.textContent = blocked ? '🚫 مفعّل' : '✅ معطّل';
      status.style.color = blocked ? 'var(--danger)' : 'var(--green)';
    }
  });
}

function saveFilterWords() {
  const raw = document.getElementById('filter-words')?.value || '';
  const words = raw.split('\n').map(w => w.trim()).filter(Boolean);
  ownerPost('/api/owner/filter/words', { words }).then(r => {
    if (r.ok) showAnno(`✅ تم حفظ ${r.words.length} كلمة محظورة`);
    else showAnno('❌ فشل الحفظ');
  });
}

// ===================== إعلان =====================
function showAnno(text) {
  const bar = document.getElementById('announcement-bar');
  bar.textContent = text;
  bar.classList.remove('hidden');
  clearTimeout(bar._timer);
  bar._timer = setTimeout(() => bar.classList.add('hidden'), 5000);
}

// ===================== إيموجي بيكر =====================
const EMOJI_CATS = [
  { label: '😀', name: 'وجوه', emojis: ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','😗','😙','😚','🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','🥱','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','☹️','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱','🥵','🥶','😳','🤪','😵','🥴','😠','😡','🤬','😷','🤒','🤕','🤢','🤮','🤧','😇','🥳','🥸','🤠','🤡','🤫','🤭','🧐','🤓'] },
  { label: '👍', name: 'أيدي', emojis: ['👍','👎','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','☝️','👇','👋','🤚','🖐️','✋','🖖','👏','🙌','🤲','🤝','🙏','✍️','💪','🦾','🖕','💅','🤳'] },
  { label: '❤️', name: 'قلوب', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','❤️‍🔥','❤️‍🩹'] },
  { label: '🎉', name: 'احتفال', emojis: ['🎉','🎊','🎈','🎁','🎀','🎗️','🎟️','🎫','🎖️','🏆','🥇','🥈','🥉','🎯','🎲','🎮','🕹️','🎰','🃏','🀄','🎴','🎭','🎨','🎪','🎠','🎡','🎢','🎶','🎵','🎤','🎧','🎸','🎹','🥁','🎷','🎺','🎻'] },
  { label: '🔥', name: 'رموز', emojis: ['🔥','💯','✨','⭐','🌟','💫','⚡','🌈','☀️','🌙','❄️','💥','🎆','🎇','🌊','💧','🌸','🌺','🌹','🌻','🌼','🍀','🌴','🌵','🍁','🍂','🍃'] },
  { label: '😸', name: 'حيوانات', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🦋','🐛','🐌','🐞','🐜','🦟','🦗','🕷️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🐓','🦃','🦤','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️','🦔'] },
  { label: '🍕', name: 'طعام', emojis: ['🍕','🍔','🌮','🌯','🥪','🥗','🍜','🍝','🍛','🍲','🥘','🍱','🍣','🍤','🍙','🍚','🍘','🍥','🧆','🧇','🥞','🧈','🍳','🥚','🧀','🥩','🍗','🍖','🌭','🥓','🥫','🍿','🧂','🥡','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯','🍷','🥂','🍸','🍹','🧋','🥤','☕','🍵','🧃','🥛','🍺','🍻','🍾'] },
  { label: '⚽', name: 'رياضة', emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🎣','🤿','🎽','🎿','🛷','🥌','⛸️','🪂','🏋️','🤼','🤸','⛹️','🤺','🏇','🧘','🏄','🏊','🚴','🏆','🥇'] },
];

let _emojiCatIdx = 0;

function initEmojiPicker() {
  const catsEl = document.getElementById('emoji-cats');
  if (!catsEl || catsEl.children.length) return; // مبنيش تاني
  EMOJI_CATS.forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.textContent = cat.label;
    btn.title = cat.name;
    btn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:1.15rem;padding:3px 5px;border-radius:7px;flex-shrink:0;transition:background .15s';
    btn.onclick = () => { _emojiCatIdx = i; renderEmojiGrid(i); highlightCat(i); };
    catsEl.appendChild(btn);
  });
  renderEmojiGrid(0);
  highlightCat(0);
}

function highlightCat(idx) {
  const catsEl = document.getElementById('emoji-cats');
  if (!catsEl) return;
  [...catsEl.children].forEach((b, i) => {
    b.style.background = i === idx ? '#eef3ff' : 'none';
  });
}

function renderEmojiGrid(idx) {
  const grid = document.getElementById('emoji-grid');
  if (!grid) return;
  grid.innerHTML = EMOJI_CATS[idx].emojis.map(e =>
    `<button onclick="insertEmoji('${e}')" style="background:none;border:none;cursor:pointer;font-size:1.3rem;padding:4px;border-radius:7px;transition:background .12s" onmouseover="this.style.background='#f0f2f5'" onmouseout="this.style.background='none'">${e}</button>`
  ).join('');
}

function insertEmoji(emoji) {
  const inp = document.getElementById('msg-input');
  if (!inp) return;
  const start = inp.selectionStart;
  const end   = inp.selectionEnd;
  inp.value   = inp.value.slice(0, start) + emoji + inp.value.slice(end);
  inp.selectionStart = inp.selectionEnd = start + emoji.length;
  inp.focus();
}

function toggleEmojiPicker(e) {
  e.stopPropagation();
  const picker = document.getElementById('emoji-picker');
  if (!picker) return;
  const isHidden = picker.style.display === 'none';
  picker.style.display = isHidden ? 'block' : 'none';
  if (isHidden) initEmojiPicker();
}

// إغلاق البيكر بالضغط خارجه
document.addEventListener('click', (e) => {
  const picker = document.getElementById('emoji-picker');
  if (picker && !picker.contains(e.target) && e.target.id !== 'emoji-picker') {
    picker.style.display = 'none';
  }
});



// ===================== فويس نوت =====================
function updateVoiceBtn() {
  const btn = document.getElementById('voice-btn');
  if (!btn) return;
  const show = state.voiceEnabled && state.voiceAllowed;
  btn.style.display = show ? 'inline-flex' : 'none';
  if (state.isRecording) {
    btn.title = 'إيقاف التسجيل';
    btn.style.background = '#ff4757';
    btn.style.color = '#fff';
  } else {
    btn.title = 'إرسال فويس نوت';
    btn.style.background = '';
    btn.style.color = '';
  }
}

function toggleRecording() {
  if (state.isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

async function startRecording() {
  if (!state.voiceEnabled) { showAnno('🎙️ الفويس نوت غير مفعّل حالياً'); return; }
  if (!state.voiceAllowed) { showAnno('🎙️ لا تملك إذن إرسال فويس'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioChunks = [];
    state.recordStartTime = Date.now();
    state.mediaRecorder = new MediaRecorder(stream);
    state.mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) state.audioChunks.push(e.data);
    };
    state.mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      finalizeRecording();
    };
    state.mediaRecorder.start(250);
    state.isRecording = true;
    updateVoiceBtn();
    startRecordTimer();
  } catch (err) {
    showAnno('❌ تعذّر الوصول للميكروفون. تأكد من إعطاء الإذن.');
  }
}

function stopRecording() {
  if (state.mediaRecorder && state.isRecording) {
    state.mediaRecorder.stop();
    state.isRecording = false;
    updateVoiceBtn();
    stopRecordTimer();
  }
}

function finalizeRecording() {
  const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
  const duration = Math.round((Date.now() - state.recordStartTime) / 1000);

  if (duration < 1) { showAnno('⚠️ التسجيل قصير جداً'); return; }
  if (blob.size > 2 * 1024 * 1024) { showAnno('⚠️ الفويس كبير جداً (الحد 2MB ≈ دقيقتين)'); return; }

  // عرض مودال الإرسال
  showVoiceSendModal(blob, duration);
}

let _recordTimerInterval = null;
function startRecordTimer() {
  let secs = 0;
  const btn = document.getElementById('voice-btn');
  _recordTimerInterval = setInterval(() => {
    secs++;
    if (btn) btn.textContent = `⏹ ${secs}ث`;
    if (secs >= 120) stopRecording(); // حد 2 دقيقة
  }, 1000);
}
function stopRecordTimer() {
  clearInterval(_recordTimerInterval);
  const btn = document.getElementById('voice-btn');
  if (btn) btn.textContent = '🎙️';
}

function showVoiceSendModal(blob, duration) {
  // احذف المودال القديم لو موجود
  document.getElementById('voice-send-modal')?.remove();

  const audioURL = URL.createObjectURL(blob);
  const modal = document.createElement('div');
  modal.id = 'voice-send-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:18px;padding:24px 20px;width:320px;max-width:94vw;box-shadow:0 8px 40px rgba(0,0,0,0.18);text-align:center;font-family:Tajawal,sans-serif">
      <div style="font-size:1.1rem;font-weight:700;margin-bottom:16px;color:#222">🎙️ فويس نوت (⏱ ${duration}ث)</div>
      <audio src="${audioURL}" controls style="width:100%;margin-bottom:18px;border-radius:8px"></audio>
      <div style="margin-bottom:18px">
        <div style="font-weight:600;font-size:0.9rem;margin-bottom:8px;color:#444">إرسال إلى:</div>
        <div style="display:flex;gap:10px;justify-content:center">
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:0.9rem;padding:7px 14px;border-radius:10px;border:2px solid #4f8ef7;color:#4f8ef7;font-weight:600" id="voice-public-label">
            <input type="radio" name="voice-target" value="public" checked onchange="updateVoiceTargetUI()"> 🌐 عام
          </label>
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:0.9rem;padding:7px 14px;border-radius:10px;border:2px solid #dde3f0;color:#888;font-weight:600" id="voice-private-label">
            <input type="radio" name="voice-target" value="private" onchange="updateVoiceTargetUI()"> 🔒 خاص
          </label>
        </div>
        <div id="voice-private-user" style="display:none;margin-top:10px">
          <input type="text" id="voice-to-user" placeholder="اسم المستخدم" style="width:100%;padding:8px 12px;border:1px solid #dde3f0;border-radius:10px;font-size:0.9rem;font-family:Tajawal,sans-serif;outline:none;text-align:center"
            value="${state.privateWith || ''}">
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button onclick="sendVoiceNote()" style="flex:1;padding:10px;background:#4f8ef7;color:#fff;border:none;border-radius:12px;font-size:0.95rem;font-weight:700;cursor:pointer;font-family:Tajawal,sans-serif">✅ إرسال</button>
        <button onclick="cancelVoiceSend()" style="flex:1;padding:10px;background:#f0f2f5;color:#555;border:none;border-radius:12px;font-size:0.95rem;font-weight:700;cursor:pointer;font-family:Tajawal,sans-serif">❌ إلغاء</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  window._voiceBlob = blob;
  window._voiceDuration = duration;
}

function updateVoiceTargetUI() {
  const isPrivate = document.querySelector('input[name="voice-target"]:checked')?.value === 'private';
  document.getElementById('voice-private-user').style.display = isPrivate ? 'block' : 'none';
  document.getElementById('voice-public-label').style.cssText += isPrivate
    ? ';border-color:#dde3f0;color:#888' : ';border-color:#4f8ef7;color:#4f8ef7';
  document.getElementById('voice-private-label').style.cssText += isPrivate
    ? ';border-color:#4f8ef7;color:#4f8ef7' : ';border-color:#dde3f0;color:#888';
}

function cancelVoiceSend() {
  document.getElementById('voice-send-modal')?.remove();
  window._voiceBlob = null;
}

async function sendVoiceNote() {
  const blob = window._voiceBlob;
  const duration = window._voiceDuration;
  if (!blob) return;

  const isPrivate = document.querySelector('input[name="voice-target"]:checked')?.value === 'private';
  const toUser = isPrivate ? (document.getElementById('voice-to-user')?.value || '').trim() : null;

  if (isPrivate && !toUser) {
    showAnno('❌ اكتب اسم المستخدم اللي تبعتله الفويس');
    return;
  }

  // تحويل blob لـ base64
  const reader = new FileReader();
  reader.onloadend = () => {
    const base64 = reader.result; // data:audio/webm;base64,...
    state.socket.emit('send_voice', {
      audioData: base64,
      duration,
      isPrivate,
      toUser: isPrivate ? toUser : null,
    });
    document.getElementById('voice-send-modal')?.remove();
    window._voiceBlob = null;
    showAnno(isPrivate ? `✅ تم إرسال الفويس لـ ${toUser}` : '✅ تم إرسال الفويس نوت');
  };
  reader.readAsDataURL(blob);
}

function appendVoiceMessage(msg, isPrivateChat) {
  const area = document.getElementById('messages-area');
  if (!area) return;
  const isOwn = msg.username === state.me?.username;
  const el = document.createElement('div');
  el.className = `msg ${isOwn ? 'own' : 'other'}`;
  el.id = `msg-${msg.id}`;

  const badge = roleBadge(msg.role);
  const colorAttr = msg.nameColor ? `style="color:${msg.nameColor}"` : '';
  const canDelete = ['owner', 'admin', 'moderator'].includes(state.me?.role);
  const privateBadge = isPrivateChat ? '<span style="font-size:0.72rem;color:#4f8ef7;background:#eef3ff;padding:2px 6px;border-radius:6px;margin-right:4px">🔒 خاص</span>' : '';

  el.innerHTML = `
    <div class="msg-meta">
      ${badge ? `<span class="badge badge-${msg.role}">${badge}</span>` : ''}
      <span class="msg-name" ${colorAttr}>${escHtml(msg.username)}</span>
      ${privateBadge}
      ${canDelete ? `<button class="msg-delete-btn" onclick="deleteMsg('${msg.id}')" title="حذف">🗑️</button>` : ''}
    </div>
    <div class="msg-bubble voice-bubble" style="${isPrivateChat ? 'border:1.5px dashed #4f8ef7;' : ''}padding:10px 14px;min-width:220px">
      🎙️ فويس نوت · <span style="font-size:0.8rem;color:#888">${msg.duration}ث</span>
      <br>
      <audio src="${msg.audioData}" controls style="width:100%;margin-top:6px;border-radius:8px;height:36px"></audio>
    </div>
    <div class="msg-time">${formatTime(msg.time)}</div>`;
  area.appendChild(el);
  scrollBottom();
}

function logout() {
  if (state.socket) state.socket.disconnect();
  state.me = null; state.socket = null; state.ownerToken = null;
  sessionStorage.removeItem('livechat_auth');
  window.location.replace('login.html');
}

// ===================== مساعدات =====================
function roleBadge(role) {
  if (role === 'owner')     return '👑 تاج';
  if (role === 'admin')     return '🛡️ ادمن';
  if (role === 'moderator') return '👑 أونر';
  if (role === 'host')      return '🎖️ هوست';
  if (role === 'vip')       return '⭐ نجمة';
  if (role === 'member')    return '👤 عضو';
  return '';
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function scrollBottom() {
  const a = document.getElementById('messages-area');
  if (a) a.scrollTop = a.scrollHeight;
}

// ===================== لوحة التحكم — فويس نوت =====================
function toggleVoiceFeature(enabled) {
  ownerPost('/api/owner/voice/toggle', { enabled }).then(r => {
    if (!r.ok) return;
    const status = document.getElementById('voice-status');
    if (status) {
      status.textContent = enabled ? '✅ مفعّل' : '🚫 معطّل';
      status.style.color = enabled ? '#27ae60' : '#e74c3c';
    }
  });
}

function ownerVoiceAllow() {
  const username = (document.getElementById('voice-add-user')?.value || '').trim();
  if (!username) { showAnno('❌ اكتب اسم المستخدم'); return; }
  ownerPost('/api/owner/voice/allow', { username, allow: true }).then(r => {
    if (r.ok) {
      showAnno(`✅ تم إضافة ${username} للفويس`);
      loadOwnerTab('voice');
    } else {
      showAnno('❌ فشل الإضافة');
    }
  });
}

function ownerVoiceRemove(username) {
  ownerPost('/api/owner/voice/allow', { username, allow: false }).then(r => {
    if (r.ok) {
      showAnno(`✅ تم إزالة ${username} من الفويس`);
      loadOwnerTab('voice');
    }
  });
}
