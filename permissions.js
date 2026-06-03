// ===================== نظام الصلاحيات =====================
// الأدوار بالترتيب: owner > admin > moderator > host > vip > member > guest

const ROLE_RANK = {
  owner:     0,
  admin:     1,
  moderator: 2,
  host:      3,
  vip:       4,
  member:    5,
  guest:     6,
};

// صلاحيات كل دور
const PERMISSIONS = {
  owner: {
    canSendPublic:      true,
    canDeleteMsg:       true,
    canMuteUsers:       true,
    canKickUsers:       true,
    canCreateRoom:      true,
    canJoinPrivateRoom: true,
    canSendPrivate:     true,
    canReceivePrivate:  true,
    canManageRoles:     true,   // يرفع/يخفض للـ admin فقط
    canBanUsers:        true,
    canBroadcast:       true,
  },

  admin: {
    canSendPublic:      true,
    canDeleteMsg:       true,
    canMuteUsers:       true,
    canKickUsers:       true,
    canCreateRoom:      true,
    canJoinPrivateRoom: true,
    canSendPrivate:     true,
    canReceivePrivate:  true,
    canManageRoles:     true,   // يرفع/يخفض للـ moderator فقط
    canBanUsers:        true,
    canBroadcast:       true,
  },

  moderator: {
    canSendPublic:      true,
    canDeleteMsg:       true,
    canMuteUsers:       true,
    canKickUsers:       true,
    canCreateRoom:      true,
    canJoinPrivateRoom: true,
    canSendPrivate:     true,
    canReceivePrivate:  true,
    canManageRoles:     true,   // يرفع/يخفض للـ host فقط
    canBanUsers:        false,
    canBroadcast:       false,
  },

  host: {
    canSendPublic:      true,
    canDeleteMsg:       false,
    canMuteUsers:       true,
    canKickUsers:       false,
    canCreateRoom:      true,
    canJoinPrivateRoom: true,
    canSendPrivate:     true,
    canReceivePrivate:  true,
    canManageRoles:     true,   // يرفع/يخفض للـ vip فقط
    canBanUsers:        false,
    canBroadcast:       false,
  },

  vip: {
    canSendPublic:      true,
    canDeleteMsg:       false,
    canMuteUsers:       false,
    canKickUsers:       false,
    canCreateRoom:      true,
    canJoinPrivateRoom: true,
    canSendPrivate:     true,
    canReceivePrivate:  true,
    canManageRoles:     true,   // يرفع/يخفض للـ member فقط
    canBanUsers:        false,
    canBroadcast:       false,
  },

  member: {
    canSendPublic:      true,
    canDeleteMsg:       false,
    canMuteUsers:       false,
    canKickUsers:       false,
    canCreateRoom:      false,
    canJoinPrivateRoom: true,
    canSendPrivate:     true,
    canReceivePrivate:  true,
    canManageRoles:     false,
    canBanUsers:        false,
    canBroadcast:       false,
  },

  guest: {
    canSendPublic:      true,
    canDeleteMsg:       false,
    canMuteUsers:       false,
    canKickUsers:       false,
    canCreateRoom:      false,
    canJoinPrivateRoom: false,
    canSendPrivate:     true,
    canReceivePrivate:  true,
    canManageRoles:     false,
    canBanUsers:        false,
    canBroadcast:       false,
  },
};

// هل المستخدم يقدر يعمل إجراء على مستخدم تاني؟
function canActOn(actorRole, targetRole) {
  return ROLE_RANK[actorRole] < ROLE_RANK[targetRole];
}

// كل رتبة تقدر ترفع/تخفض الرتبة اللي تحتها مباشرة بس
function canManageRole(actorRole, targetRole) {
  return ROLE_RANK[actorRole] + 1 === ROLE_RANK[targetRole];
}

function hasPermission(role, perm) {
  return !!(PERMISSIONS[role] && PERMISSIONS[role][perm]);
}

// قواعد الخاص
function canSendPrivateTo(senderRole, receiverRole) {
  if (!hasPermission(senderRole, 'canSendPrivate')) return false;
  if (!hasPermission(receiverRole, 'canReceivePrivate')) return false;
  if (senderRole === 'member') {
    return ROLE_RANK[receiverRole] <= ROLE_RANK['vip'];
  }
  // guest يقدر يبعت خاص لأي حد
  return true;
}

module.exports = { ROLE_RANK, PERMISSIONS, hasPermission, canActOn, canManageRole, canSendPrivateTo };
