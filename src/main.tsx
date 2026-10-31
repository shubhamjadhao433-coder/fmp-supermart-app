import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Register PWA service worker with auto-update
const updateSW = registerSW({
  onNeedRefresh() {
    console.log('FMP Supermart update available. Auto-updating...');
    updateSW(true);
  },
  onOfflineReady() {
    console.log('FMP Supermart is ready to work offline.');
  },
  onRegistered(r) {
    console.log('FMP Supermart PWA Service Worker successfully registered:', r?.scope);
  },
  onRegisterError(error) {
    console.warn('PWA Service Worker registration warning:', error);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => console.log('Fallback SW registered at:', reg.scope))
        .catch(e => console.warn('Fallback SW registration error:', e));
    }
  }
});

// Always ensure SW registration in browsers for Android install prompt
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => console.log('Active PWA SW registered with scope:', reg.scope))
      .catch(err => console.debug('Direct SW registration note:', err));
  });
}

createRoot(document.getElementById('root')!).render(<App />);
