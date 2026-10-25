/**
 * QuantumShield - Zero-Knowledge Push Notification & PWA Service
 * Manages Service Worker lifecycle, Web Push (VAPID) subscriptions,
 * and zero-knowledge background notifications.
 */
import { api } from './api';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

class PushNotificationService {
  private swRegistration: ServiceWorkerRegistration | null = null;
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private isSubscribed: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        this.deferredPrompt = e as BeforeInstallPromptEvent;
        window.dispatchEvent(new CustomEvent('qs-can-install-pwa', { detail: true }));
      });

      window.addEventListener('appinstalled', () => {
        this.deferredPrompt = null;
        window.dispatchEvent(new CustomEvent('qs-pwa-installed'));
      });
    }
  }

  /**
   * Registers the QuantumShield Service Worker (/sw.js)
   */
  public async registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      this.swRegistration = registration;

      // Check existing push subscription
      const existingSub = await registration.pushManager.getSubscription();
      this.isSubscribed = existingSub !== null;

      return registration;
    } catch (err) {
      console.warn('[PushService] ServiceWorker registration error:', err);
      return null;
    }
  }

  /**
   * Returns whether Web Push and Service Workers are supported by the browser.
   */
  public isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  /**
   * Returns whether the PWA is currently running in standalone display mode.
   */
  public isStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    );
  }

  /**
   * Returns whether the browser has captured a pending PWA install prompt.
   */
  public canInstallPwa(): boolean {
    return this.deferredPrompt !== null;
  }

  /**
   * Triggers the native browser PWA install prompt.
   */
  public async promptInstallPwa(): Promise<boolean> {
    if (!this.deferredPrompt) {
      return false;
    }
    await this.deferredPrompt.prompt();
    const { outcome } = await this.deferredPrompt.userChoice;
    this.deferredPrompt = null;
    return outcome === 'accepted';
  }

  /**
   * Returns the current Notification permission ('default' | 'granted' | 'denied').
   */
  public getPermission(): NotificationPermission {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'denied';
    }
    return Notification.permission;
  }

  /**
   * Requests Notification permission from the user.
   */
  public async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported()) return 'denied';
    return await Notification.requestPermission();
  }

  /**
   * Subscribes the current device to zero-knowledge wake-up push signals for a given room.
   */
  public async subscribeToRoom(roomId: string, participantId: string): Promise<boolean> {
    if (!this.isSupported()) return false;

    const permission = await this.requestPermission();
    if (permission !== 'granted') {
      return false;
    }

    if (!this.swRegistration) {
      await this.registerServiceWorker();
    }
    if (!this.swRegistration) {
      return false;
    }

    try {
      // 1. Fetch RFC 8292 VAPID public key from backend
      const { public_key } = await api.getVapidPublicKey();
      const applicationServerKey = this.urlBase64ToUint8Array(public_key);

      // 2. Subscribe with browser PushManager
      const subscription = await this.swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as BufferSource,
      });

      // 3. Register subscription with backend room
      await api.subscribePush(roomId, participantId, subscription.toJSON());
      this.isSubscribed = true;
      return true;
    } catch (err) {
      console.error('[PushService] Failed to subscribe to push notifications:', err);
      return false;
    }
  }

  /**
   * Unsubscribes from push notifications for a given room.
   */
  public async unsubscribeFromRoom(roomId: string, participantId: string): Promise<boolean> {
    try {
      if (this.swRegistration) {
        const subscription = await this.swRegistration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
        }
      }
      await api.unsubscribePush(roomId, participantId);
      this.isSubscribed = false;
      return true;
    } catch (err) {
      console.warn('[PushService] Error during unsubscribe:', err);
      return false;
    }
  }

  /**
   * Dispatches an immediate local notification if the tab is backgrounded.
   * Zero-Knowledge guarantee: only privacy-preserving generic text is shown.
   */
  public showLocalBackgroundNotification(
    title: string = 'QuantumShield',
    body: string = 'New encrypted signal received'
  ): void {
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      return; // Do not display if user is actively looking at the tab
    }

    if (this.getPermission() !== 'granted') {
      return;
    }

    if (this.swRegistration) {
      this.swRegistration.showNotification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/favicon.svg',
        tag: 'qs-message',
      });
    } else if (typeof Notification !== 'undefined') {
      new Notification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/favicon.svg',
        tag: 'qs-message',
      });
    }
  }

  /**
   * Utility to convert URL-safe base64 string to Uint8Array for Web Push API.
   */
  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
}

export const pushService = new PushNotificationService();
