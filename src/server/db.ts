import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Google Cloud Firestore Persistence Layer for Sami Full-Stack Application
 * Targeting project: majestic-interface-ksmzh
 * Database ID: ai-studio-c1d1b606-9578-42a6-b7b2-17faaec47f72
 */

export const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID || 'majestic-interface-ksmzh';
export const databaseId = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-c1d1b606-9578-42a6-b7b2-17faaec47f72';

// 1. Initialize Google Cloud Firestore Server Client (with graceful local fallback)
let firestoreClient: any = null;
let firestoreInitError: string | null = null;

try {
  let FirestoreClass: any = null;
  try {
    // Dynamic require/import to prevent crash if @google-cloud/firestore is absent
    const gcf = (await import('@google-cloud/firestore' as any).catch(() => null)) as any;
    FirestoreClass = gcf?.Firestore || null;
  } catch {}

  if (FirestoreClass) {
    const options: Record<string, unknown> = {
      projectId,
      databaseId: databaseId === '(default)' ? undefined : databaseId,
    };

    if (process.env.GCP_SERVICE_ACCOUNT_KEY) {
      try {
        const raw = process.env.GCP_SERVICE_ACCOUNT_KEY.trim();
        const jsonStr = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
        options.credentials = JSON.parse(jsonStr);
      } catch (e: any) {
        console.warn('[Sami DB] Failed to parse GCP_SERVICE_ACCOUNT_KEY:', e.message);
      }
    }

    firestoreClient = new FirestoreClass(options);
    console.log(`[Sami DB] Google Cloud Firestore client initialized for project: ${projectId}, database: ${databaseId}`);
  } else {
    console.log('[Sami DB] Running with local persistent disk store (persistent_store.json)');
  }
} catch (err: any) {
  firestoreInitError = err?.message || String(err);
  console.warn('[Sami DB] Firestore client notice:', firestoreInitError);
}

export { firestoreClient };

// Persistent local disk store file for data survival across container restarts if cloud ADC is pending
const DATA_DIR = path.resolve('data');
const LOCAL_STORE_FILE = path.join(DATA_DIR, 'persistent_store.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

interface LocalDiskStore {
  users: Record<string, any>;
  channels: Record<string, any>;
  channelMessages: Record<string, any[]>;
  privateMessages: Record<string, any[]>;
  challenges: Record<string, any>;
  trades: Record<string, any[]>;
}

function loadLocalDiskStore(): LocalDiskStore {
  try {
    if (fs.existsSync(LOCAL_STORE_FILE)) {
      const content = fs.readFileSync(LOCAL_STORE_FILE, 'utf8');
      return JSON.parse(content);
    }
  } catch (e) {
    console.warn('[Sami DB] Notice reading persistent store file, initializing clean store');
  }
  return {
    users: {},
    channels: {},
    channelMessages: {},
    privateMessages: {},
    challenges: {},
    trades: {},
  };
}

function saveLocalDiskStore(store: LocalDiskStore): void {
  try {
    fs.writeFileSync(LOCAL_STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    console.error('[Sami DB] Error persisting store to disk:', e);
  }
}

const diskStore = loadLocalDiskStore();

// Dynamic secure PBKDF2 Password Hashing with per-user salt
export function hashPasswordWithSalt(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 10000, 32, 'sha512').toString('hex');
}

export function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function verifyUserPassword(password: string, hash: string, salt: string): boolean {
  try {
    const calculated = hashPasswordWithSalt(password, salt);
    return crypto.timingSafeEqual(Buffer.from(calculated, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

// ============================================================================
// FIRESTORE TEST & VERIFICATION
// ============================================================================

export async function testFirestoreConnection(): Promise<{
  connected: boolean;
  projectId: string;
  databaseId: string;
  error?: string;
  errorType?: 'PERMISSION_DENIED' | 'NOT_FOUND' | 'UNAVAILABLE' | 'QUOTA_EXCEEDED' | 'OTHER';
}> {
  if (!firestoreClient) {
    return {
      connected: false,
      projectId,
      databaseId,
      error: firestoreInitError || 'Firestore client was not initialized',
      errorType: 'UNAVAILABLE',
    };
  }

  try {
    // Attempt a live read from health ping collection
    const pingRef = firestoreClient.collection('_system_health').doc('ping');
    await pingRef.get();
    return {
      connected: true,
      projectId,
      databaseId,
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    let errorType: 'PERMISSION_DENIED' | 'NOT_FOUND' | 'UNAVAILABLE' | 'QUOTA_EXCEEDED' | 'OTHER' = 'OTHER';

    if (msg.includes('PERMISSION_DENIED') || msg.includes('7 PERMISSION_DENIED')) {
      errorType = 'PERMISSION_DENIED';
    } else if (msg.includes('NOT_FOUND') || msg.includes('5 NOT_FOUND')) {
      errorType = 'NOT_FOUND';
    } else if (msg.includes('Quota') || msg.includes('8 RESOURCE_EXHAUSTED')) {
      errorType = 'QUOTA_EXCEEDED';
    } else if (msg.includes('UNAVAILABLE') || msg.includes('14 UNAVAILABLE')) {
      errorType = 'UNAVAILABLE';
    }

    return {
      connected: false,
      projectId,
      databaseId,
      error: msg,
      errorType,
    };
  }
}

// ============================================================================
// USER PERSISTENCE (FIRESTORE PRIMARY WITH LOCAL DISK SURVIVAL)
// ============================================================================

export interface UserRecord {
  id: number;
  username: string;
  displayName: string;
  passwordHash: string;
  salt: string;
  role: 'owner' | 'moderator' | 'user' | 'guest';
  avatarUrl?: string | null;
  warningsCount?: number;
  createdAt: number;
  updatedAt: number;
}

export async function getUserById(userId: number): Promise<UserRecord | null> {
  // 1. Try Google Cloud Firestore
  if (firestoreClient) {
    try {
      const snap = await firestoreClient.collection('users').doc(String(userId)).get();
      if (snap.exists) {
        return snap.data() as UserRecord;
      }
    } catch (err: any) {
      console.warn(`[Sami DB] Firestore read notice for user ${userId}:`, err.message);
    }
  }

  // 2. Persistent disk fallback
  return diskStore.users[String(userId)] || null;
}

export async function getUserByUsername(username: string): Promise<UserRecord | null> {
  const clean = username.trim().toLowerCase();

  // 1. Try Google Cloud Firestore
  if (firestoreClient) {
    try {
      const snap = await firestoreClient
        .collection('users')
        .where('usernameLower', '==', clean)
        .limit(1)
        .get();

      if (!snap.empty) {
        return snap.docs[0].data() as UserRecord;
      }
    } catch (err: any) {
      console.warn(`[Sami DB] Firestore read notice for username ${username}:`, err.message);
    }
  }

  // 2. Persistent disk fallback
  for (const u of Object.values(diskStore.users)) {
    if (u.username && u.username.toLowerCase() === clean) {
      return u as UserRecord;
    }
  }

  return null;
}

export async function getUsersCount(): Promise<number> {
  if (firestoreClient) {
    try {
      const snap = await firestoreClient.collection('users').count().get();
      return snap.data().count;
    } catch {
      // Ignore and fallback
    }
  }
  return Object.keys(diskStore.users).length;
}

export async function createUserRecord(user: {
  username: string;
  displayName: string;
  password: string;
  role?: 'owner' | 'moderator' | 'user' | 'guest';
  avatarUrl?: string | null;
}): Promise<UserRecord> {
  const existingCount = await getUsersCount();
  // Self-bootstrap: If zero users exist, first user is automatically Owner
  const role = user.role || (existingCount === 0 ? 'owner' : 'user');
  const now = Date.now();
  const salt = generateSalt();
  const passwordHash = hashPasswordWithSalt(user.password, salt);
  const nextId = existingCount === 0 ? 1 : Math.max(1, ...Object.keys(diskStore.users).map(Number)) + 1;

  const record: UserRecord = {
    id: nextId,
    username: user.username.trim(),
    displayName: user.displayName.trim() || user.username.trim(),
    passwordHash,
    salt,
    role,
    avatarUrl: user.avatarUrl || null,
    warningsCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  // 1. Try Google Cloud Firestore
  if (firestoreClient) {
    try {
      await firestoreClient.collection('users').doc(String(record.id)).set({
        ...record,
        usernameLower: record.username.toLowerCase(),
      });
      console.log(`[Sami DB] User ${record.username} (ID: ${record.id}) saved to Firestore.`);
    } catch (err: any) {
      console.warn(`[Sami DB] Firestore write notice for user ${record.id}:`, err.message);
    }
  }

  // 2. Save to persistent disk store
  diskStore.users[String(record.id)] = record;
  saveLocalDiskStore(diskStore);

  return record;
}

export async function getAllUsersList(): Promise<Omit<UserRecord, 'passwordHash' | 'salt'>[]> {
  const results: Record<string, Omit<UserRecord, 'passwordHash' | 'salt'>> = {};

  if (firestoreClient) {
    try {
      const snap = await firestoreClient.collection('users').get();
      snap.forEach((doc: any) => {
        const d = doc.data();
        results[doc.id] = {
          id: d.id,
          username: d.username,
          displayName: d.displayName,
          role: d.role,
          avatarUrl: d.avatarUrl,
          warningsCount: d.warningsCount,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        };
      });
    } catch (err: any) {
      console.warn('[Sami DB] Firestore getUsers notice:', err.message);
    }
  }

  for (const [id, d] of Object.entries(diskStore.users)) {
    if (!results[id]) {
      results[id] = {
        id: d.id,
        username: d.username,
        displayName: d.displayName,
        role: d.role,
        avatarUrl: d.avatarUrl,
        warningsCount: d.warningsCount,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      };
    }
  }

  return Object.values(results);
}

// ============================================================================
// CHANNELS PERSISTENCE
// ============================================================================

export interface ChannelRecord {
  id: string;
  name: string;
  description: string;
  isPrivate: boolean;
  visibility: 'public' | 'hidden';
  allowedMemberIds: number[];
  memberIds: number[];
  createdAt: number;
}

export const INITIAL_CHANNELS_CONFIG: ChannelRecord[] = [
  {
    id: 'general_trading',
    name: '💬 دردشة عامة - دفعة 3000$',
    description: 'القناة العامة لتبادل الأفكار والنقاشات بين جميع المشتركين.',
    isPrivate: false,
    visibility: 'public',
    allowedMemberIds: [],
    memberIds: [1],
    createdAt: 1735689600000,
  },
  {
    id: 'signals_vip',
    name: '👑 قناة Sami VIP الخاصة',
    description: 'قناة التوصيات والصفقات المتقدمة الخاصة بالأعضاء المصرح لهم فقط.',
    isPrivate: true,
    visibility: 'hidden',
    allowedMemberIds: [1],
    memberIds: [1],
    createdAt: 1735689600000,
  },
];

// Seed initial channels to persistent disk if missing
for (const c of INITIAL_CHANNELS_CONFIG) {
  if (!diskStore.channels[c.id]) {
    diskStore.channels[c.id] = c;
  }
}
saveLocalDiskStore(diskStore);

export async function getChannelsForUser(userId: number, role: string): Promise<ChannelRecord[]> {
  const channelMap: Record<string, ChannelRecord> = {};

  if (firestoreClient) {
    try {
      const snap = await firestoreClient.collection('channels').get();
      snap.forEach((doc: any) => {
        channelMap[doc.id] = doc.data() as ChannelRecord;
      });
    } catch (err: any) {
      console.warn('[Sami DB] Firestore channels read notice:', err.message);
    }
  }

  // Merge with disk store
  for (const [id, c] of Object.entries(diskStore.channels)) {
    if (!channelMap[id]) {
      channelMap[id] = c;
    }
  }

  // Filter based on Zero-Trust RBAC permissions
  return Object.values(channelMap).filter((channel) => {
    // Owner sees all channels
    if (role === 'owner') return true;

    // Hidden channels are strictly invisible to unauthorized users
    if (channel.visibility === 'hidden') {
      return channel.allowedMemberIds?.includes(userId) || channel.memberIds?.includes(userId);
    }

    // Private channels require explicit membership
    if (channel.isPrivate) {
      return channel.allowedMemberIds?.includes(userId) || channel.memberIds?.includes(userId);
    }

    // Public channels visible to all
    return true;
  });
}

export async function getChannelById(channelId: string): Promise<ChannelRecord | null> {
  if (firestoreClient) {
    try {
      const doc = await firestoreClient.collection('channels').doc(channelId).get();
      if (doc.exists) {
        return doc.data() as ChannelRecord;
      }
    } catch {}
  }
  return diskStore.channels[channelId] || null;
}

export async function saveChannelRecord(channel: ChannelRecord): Promise<void> {
  diskStore.channels[channel.id] = channel;
  saveLocalDiskStore(diskStore);

  if (firestoreClient) {
    try {
      await firestoreClient.collection('channels').doc(channel.id).set(channel);
    } catch (err: any) {
      console.warn('[Sami DB] Firestore save channel note:', err?.message);
    }
  }
}

export async function updateChannelMembers(channelId: string, memberIds: number[]): Promise<ChannelRecord | null> {
  const channel = await getChannelById(channelId);
  if (!channel) return null;

  channel.allowedMemberIds = Array.from(new Set([...memberIds, 1])); // Owner always included
  channel.memberIds = channel.allowedMemberIds;

  await saveChannelRecord(channel);
  return channel;
}

// ============================================================================
// MESSAGES PERSISTENCE
// ============================================================================

export interface ChannelMessage {
  id: string;
  channelId: string;
  senderId: number;
  senderName: string;
  senderRole: string;
  senderAvatarUrl?: string | null;
  text?: string;
  imageUrl?: string;
  storagePath?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  fileUrl?: string;
  audioUrl?: string;
  audioDuration?: number;
  replyToId?: string | null;
  replyToText?: string | null;
  replyToSenderName?: string | null;
  isDeleted?: boolean;
  timestamp: number;
}

export async function getChannelMessages(channelId: string, limitCount = 80): Promise<ChannelMessage[]> {
  if (firestoreClient) {
    try {
      const snap = await firestoreClient
        .collection('channels')
        .doc(channelId)
        .collection('messages')
        .orderBy('timestamp', 'asc')
        .limitToLast(limitCount)
        .get();

      if (!snap.empty) {
        return snap.docs.map((d: any) => d.data() as ChannelMessage);
      }
    } catch (err: any) {
      console.warn(`[Sami DB] Firestore messages read notice for ${channelId}:`, err.message);
    }
  }

  // Fallback to persistent disk store
  const list = diskStore.channelMessages[channelId] || [];
  return list.slice(-limitCount);
}

export async function saveChannelMessage(message: ChannelMessage): Promise<void> {
  if (firestoreClient) {
    try {
      await firestoreClient
        .collection('channels')
        .doc(message.channelId)
        .collection('messages')
        .doc(message.id)
        .set(message);
    } catch (err: any) {
      console.warn('[Sami DB] Firestore message write notice:', err.message);
    }
  }

  if (!diskStore.channelMessages[message.channelId]) {
    diskStore.channelMessages[message.channelId] = [];
  }
  diskStore.channelMessages[message.channelId].push(message);
  saveLocalDiskStore(diskStore);
}

// ============================================================================
// CHALLENGE & TRADES PERSISTENCE (150 MILESTONES)
// ============================================================================

export interface ChallengeRecord {
  id: string;
  userId: number;
  userName: string;
  initialCapitalCents: number;
  currentBalanceCents: number;
  targetBalanceCents: number;
  tradeCount: number;
  challengeStarted: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TradeRecord {
  id: string;
  challengeId: string;
  userId: number;
  tradeNumber: number;
  resultCents: number;
  oldBalanceCents: number;
  newBalanceCents: number;
  type: 'WIN' | 'LOSS';
  attachmentPath?: string | null;
  timestamp: number;
}

export async function getUserChallenge(userId: number, userName = ''): Promise<ChallengeRecord> {
  const challengeId = `challenge_${userId}`;

  if (firestoreClient) {
    try {
      const doc = await firestoreClient.collection('challenges').doc(challengeId).get();
      if (doc.exists) {
        return doc.data() as ChallengeRecord;
      }
    } catch {}
  }

  if (diskStore.challenges[String(userId)]) {
    return diskStore.challenges[String(userId)];
  }

  const defaultChallenge: ChallengeRecord = {
    id: challengeId,
    userId,
    userName: userName || `متداول #${userId}`,
    initialCapitalCents: 10000, // $100.00
    currentBalanceCents: 10000,
    targetBalanceCents: 300000, // $3,000.00
    tradeCount: 0,
    challengeStarted: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await saveUserChallenge(defaultChallenge);
  return defaultChallenge;
}

export async function saveUserChallenge(challenge: ChallengeRecord): Promise<void> {
  challenge.updatedAt = Date.now();

  if (firestoreClient) {
    try {
      await firestoreClient.collection('challenges').doc(challenge.id).set(challenge);
    } catch (err: any) {
      console.warn('[Sami DB] Firestore challenge save notice:', err.message);
    }
  }

  diskStore.challenges[String(challenge.userId)] = challenge;
  saveLocalDiskStore(diskStore);
}

export async function getUserTrades(userId: number): Promise<TradeRecord[]> {
  if (firestoreClient) {
    try {
      const snap = await firestoreClient
        .collection('challenges')
        .doc(`challenge_${userId}`)
        .collection('trades')
        .orderBy('tradeNumber', 'asc')
        .get();

      if (!snap.empty) {
        return snap.docs.map((d: any) => d.data() as TradeRecord);
      }
    } catch {}
  }

  return diskStore.trades[String(userId)] || [];
}

export async function addTradeRecord(userId: number, trade: TradeRecord, updatedChallenge: ChallengeRecord): Promise<void> {
  if (firestoreClient) {
    try {
      const batch = firestoreClient.batch();
      const chalRef = firestoreClient.collection('challenges').doc(updatedChallenge.id);
      const tradeRef = chalRef.collection('trades').doc(trade.id);

      batch.set(chalRef, updatedChallenge);
      batch.set(tradeRef, trade);
      await batch.commit();
    } catch (err: any) {
      console.warn('[Sami DB] Firestore addTrade notice:', err.message);
    }
  }

  if (!diskStore.trades[String(userId)]) {
    diskStore.trades[String(userId)] = [];
  }
  diskStore.trades[String(userId)].push(trade);
  diskStore.challenges[String(userId)] = updatedChallenge;
  saveLocalDiskStore(diskStore);
}

// ============================================================================
// PRIVATE MESSAGES PERSISTENCE
// ============================================================================

export interface PrivateMessageRecord {
  id: string;
  senderId: number;
  receiverId: number;
  senderName: string;
  senderRole: string;
  text?: string;
  imageUrl?: string;
  storagePath?: string;
  audioUrl?: string;
  fileUrl?: string;
  fileName?: string;
  timestamp: number;
}

export async function getPrivateMessagesList(userId1: number, userId2: number, limitCount = 80): Promise<PrivateMessageRecord[]> {
  const pairKey = [userId1, userId2].sort((a, b) => a - b).join('_');

  if (firestoreClient) {
    try {
      const snap = await firestoreClient
        .collection('private_conversations')
        .doc(pairKey)
        .collection('messages')
        .orderBy('timestamp', 'asc')
        .limitToLast(limitCount)
        .get();

      if (!snap.empty) {
        return snap.docs.map((d: any) => d.data() as PrivateMessageRecord);
      }
    } catch (err: any) {
      console.warn('[Sami DB] Firestore private messages notice:', err.message);
    }
  }

  const list = diskStore.privateMessages[pairKey] || [];
  return list.slice(-limitCount);
}

export async function getUserConversationsList(userId: number, userRole: string): Promise<{
  conversationId: string;
  partnerId: number;
  partnerName: string;
  partnerRole: string;
  partnerAvatarUrl?: string | null;
  lastMessageText?: string;
  lastMessageTimestamp: number;
  isGuest: boolean;
}[]> {
  const map = new Map<number, {
    conversationId: string;
    partnerId: number;
    partnerName: string;
    partnerRole: string;
    partnerAvatarUrl?: string | null;
    lastMessageText?: string;
    lastMessageTimestamp: number;
    isGuest: boolean;
  }>();

  // If moderator, ensure Sami (ID: 1) is always available as a primary conversation option
  if (userRole === 'moderator' && userId !== 1) {
    const samiUser = await getUserById(1);
    map.set(1, {
      conversationId: `1_${userId}`,
      partnerId: 1,
      partnerName: samiUser?.displayName || 'القائد Sami',
      partnerRole: 'owner',
      partnerAvatarUrl: samiUser?.avatarUrl || null,
      lastMessageText: 'محادثة خاصة ومباشرة مع القائد Sami',
      lastMessageTimestamp: samiUser?.createdAt || Date.now(),
      isGuest: false,
    });
  }

  // Iterate over persistent disk privateMessages
  for (const [pairKey, msgs] of Object.entries(diskStore.privateMessages)) {
    if (!Array.isArray(msgs) || msgs.length === 0) continue;
    const parts = pairKey.split('_').map(Number);
    if (parts.length !== 2 || !parts.includes(userId)) continue;

    const partnerId = parts[0] === userId ? parts[1] : parts[0];
    const lastMsg = msgs[msgs.length - 1];
    const isGuest = partnerId > 9000000;
    const partnerUser = await getUserById(partnerId);

    // If moderator: only list conversations with Sami or users, never other moderators
    if (userRole === 'moderator' && partnerUser?.role === 'moderator' && partnerId !== 1) {
      continue;
    }

    map.set(partnerId, {
      conversationId: pairKey,
      partnerId,
      partnerName: partnerUser?.displayName || (isGuest ? `ضيف رقم ${partnerId - 9000000}` : `مستخدم #${partnerId}`),
      partnerRole: partnerUser?.role || (isGuest ? 'guest' : 'user'),
      partnerAvatarUrl: partnerUser?.avatarUrl || null,
      lastMessageText: lastMsg?.text || (lastMsg?.imageUrl ? '📷 صورة مرفقة' : (lastMsg?.fileName ? `📎 ملف: ${lastMsg.fileName}` : 'رسالة جديدة')),
      lastMessageTimestamp: lastMsg?.timestamp || Date.now(),
      isGuest,
    });
  }

  return Array.from(map.values()).sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
}

export async function savePrivateMessageRecord(msg: PrivateMessageRecord): Promise<void> {
  const pairKey = [msg.senderId, msg.receiverId].sort((a, b) => a - b).join('_');

  if (firestoreClient) {
    try {
      await firestoreClient
        .collection('private_conversations')
        .doc(pairKey)
        .collection('messages')
        .doc(msg.id)
        .set(msg);

      await firestoreClient
        .collection('private_messages')
        .doc(msg.id)
        .set({
          ...msg,
          conversationId: pairKey,
          participantIds: [msg.senderId, msg.receiverId],
          participantId: msg.senderId === 1 ? msg.receiverId : msg.senderId,
        });
    } catch (err: any) {
      console.warn('[Sami DB] Firestore savePrivateMessage notice:', err.message);
    }
  }

  if (!diskStore.privateMessages[pairKey]) {
    diskStore.privateMessages[pairKey] = [];
  }
  diskStore.privateMessages[pairKey].push(msg);
  saveLocalDiskStore(diskStore);
}

export async function saveFullChallengeAndTrades(userId: number, challenge: ChallengeRecord, trades: TradeRecord[]): Promise<void> {
  if (firestoreClient) {
    try {
      const batch = firestoreClient.batch();
      const chalRef = firestoreClient.collection('challenges').doc(`challenge_${userId}`);
      batch.set(chalRef, challenge);

      for (const t of trades) {
        const tradeRef = chalRef.collection('trades').doc(t.id);
        batch.set(tradeRef, t);
      }
      await batch.commit();
    } catch (err: any) {
      console.warn('[Sami DB] Firestore saveFullChallengeAndTrades notice:', err.message);
    }
  }

  diskStore.challenges[String(userId)] = challenge;
  diskStore.trades[String(userId)] = trades;
  saveLocalDiskStore(diskStore);
}

