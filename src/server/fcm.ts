import { firestoreClient } from './db';
import fs from 'fs';
import path from 'path';

export interface DeviceTokenRecord {
  id: string;
  token: string;
  userId: number;
  username: string;
  deviceId?: string;
  platform?: string;
  deviceModel?: string;
  createdAt: number;
  updatedAt: number;
}

const TOKENS_FILE = path.resolve('data/fcm_tokens.json');

function loadLocalTokens(): Record<string, DeviceTokenRecord> {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      const data = fs.readFileSync(TOKENS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('[FCM Server] Warning reading fcm_tokens.json:', err);
  }
  return {};
}

function saveLocalTokens(tokens: Record<string, DeviceTokenRecord>): void {
  try {
    const dir = path.dirname(TOKENS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf8');
  } catch (err) {
    console.error('[FCM Server] Error saving fcm_tokens.json:', err);
  }
}

const memoryTokens = loadLocalTokens();

export async function registerDeviceToken(params: {
  token: string;
  userId: number;
  username: string;
  deviceId?: string;
  platform?: string;
  deviceModel?: string;
}): Promise<DeviceTokenRecord> {
  const { token, userId, username, deviceId, platform, deviceModel } = params;
  const now = Date.now();
  const docId = `token_${userId}_${deviceId || token.substring(0, 16)}`;

  const record: DeviceTokenRecord = {
    id: docId,
    token,
    userId,
    username,
    deviceId: deviceId || 'android_device',
    platform: platform || 'android',
    deviceModel: deviceModel || 'Android Device',
    createdAt: memoryTokens[docId]?.createdAt || now,
    updatedAt: now,
  };

  memoryTokens[docId] = record;
  saveLocalTokens(memoryTokens);

  if (firestoreClient) {
    try {
      await firestoreClient.collection('user_fcm_tokens').doc(docId).set(record);
      console.log(`[FCM Server] Registered token for user ${userId} (${username}) in Firestore`);
    } catch (err: any) {
      console.warn('[FCM Server] Firestore token registration note:', err?.message);
    }
  }

  return record;
}

export async function unregisterDeviceToken(userId: number, token?: string): Promise<void> {
  let changed = false;
  for (const [key, record] of Object.entries(memoryTokens)) {
    if (record.userId === userId && (!token || record.token === token)) {
      delete memoryTokens[key];
      changed = true;
      if (firestoreClient) {
        try {
          await firestoreClient.collection('user_fcm_tokens').doc(key).delete();
        } catch {}
      }
    }
  }

  if (changed) {
    saveLocalTokens(memoryTokens);
    console.log(`[FCM Server] Unregistered token for user ${userId}`);
  }
}

export async function getTokensForUsers(userIds: number[]): Promise<string[]> {
  const tokensSet = new Set<string>();

  // 1. Search memory tokens
  for (const record of Object.values(memoryTokens)) {
    if (userIds.includes(record.userId) && record.token) {
      tokensSet.add(record.token);
    }
  }

  // 2. Search Firestore tokens if client is connected
  if (firestoreClient) {
    try {
      for (const uid of userIds) {
        const snap = await firestoreClient
          .collection('user_fcm_tokens')
          .where('userId', '==', uid)
          .get();
        snap.forEach((doc: any) => {
          const data = doc.data() as DeviceTokenRecord;
          if (data.token) {
            tokensSet.add(data.token);
          }
        });
      }
    } catch {}
  }

  return Array.from(tokensSet);
}

export interface NotificationPayload {
  title: string;
  body: string;
  chatType: 'channel' | 'private';
  channelId?: string;
  partnerId?: number;
  messageId?: string;
  senderName?: string;
  senderId?: number;
}

export async function sendNotificationToUsers(
  recipientUserIds: number[],
  payload: NotificationPayload
): Promise<{ sentCount: number; failedCount: number }> {
  // Exclude the sender themselves
  const filteredUserIds = recipientUserIds.filter((id) => id !== payload.senderId);
  if (filteredUserIds.length === 0) {
    return { sentCount: 0, failedCount: 0 };
  }

  const tokens = await getTokensForUsers(filteredUserIds);
  if (tokens.length === 0) {
    console.log(`[FCM Server] No device tokens found for users: ${filteredUserIds.join(', ')}`);
    return { sentCount: 0, failedCount: 0 };
  }

  console.log(
    `[FCM Server] Dispatching notification to ${tokens.length} tokens for users [${filteredUserIds.join(', ')}]: "${payload.title}"`
  );

  let sentCount = 0;
  let failedCount = 0;

  // If Firebase Admin SDK or Google Access Token is configured, dispatch HTTP v1 notification:
  const serverKey = process.env.FCM_SERVER_KEY || process.env.FIREBASE_SERVER_KEY;

  if (serverKey) {
    for (const token of tokens) {
      try {
        const resp = await fetch('https://fcm.googleapis.com/fcm/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `key=${serverKey}`,
          },
          body: JSON.stringify({
            to: token,
            priority: 'high',
            notification: {
              title: payload.title,
              body: payload.body,
              sound: 'default',
              click_action: 'FLUTTER_NOTIFICATION_CLICK',
            },
            data: {
              title: payload.title,
              body: payload.body,
              chatType: payload.chatType,
              channelId: payload.channelId || '',
              partnerId: payload.partnerId ? String(payload.partnerId) : '',
              messageId: payload.messageId || '',
              senderName: payload.senderName || '',
            },
          }),
        });

        if (resp.ok) {
          sentCount++;
        } else {
          failedCount++;
        }
      } catch (e) {
        failedCount++;
      }
    }
  } else {
    // In local / development environment without cloud FCM credentials, log the simulated push event
    console.log(
      `[FCM Server] Simulated Push Notification delivered to ${tokens.length} device tokens:`,
      payload
    );
    sentCount = tokens.length;
  }

  return { sentCount, failedCount };
}
