import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase client
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app);

// Initial boot connection test
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, '_health', 'probe'));
    return true;
  } catch (err: any) {
    if (err?.message && err.message.includes('the client is offline')) {
      console.warn('[Firebase] Client is offline or unreachable.');
      return false;
    }
    // Document not existing is normal and means connection reached Firestore
    return true;
  }
}

export default app;
