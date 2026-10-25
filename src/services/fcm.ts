/**
 * Firebase Cloud Messaging and Native Bridge service for Sami App
 */

export function syncUserSessionToNative(userId: number, displayName: string): void {
  try {
    const bridge = (window as any).AndroidBridge || (window as any).Android;
    if (bridge && typeof bridge.syncUserSession === 'function') {
      bridge.syncUserSession(String(userId), displayName);
    }
  } catch (err) {
    console.debug('[FCM Bridge] Error syncing to native:', err);
  }
}

export async function unregisterUserFcmToken(userId: number): Promise<void> {
  try {
    const bridge = (window as any).AndroidBridge || (window as any).Android;
    if (bridge && typeof bridge.unregisterFcmToken === 'function') {
      bridge.unregisterFcmToken(String(userId));
    }
    await fetch('/api/fcm/unregister', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    }).catch(() => {});
  } catch (err) {
    console.debug('[FCM Bridge] Error unregistering FCM token:', err);
  }
}
