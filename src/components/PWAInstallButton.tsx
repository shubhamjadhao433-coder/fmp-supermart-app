import React, { useState } from 'react';
import { usePWAInstall } from './usePWAInstall.ts';
import { Download, Smartphone, X, CheckCircle2 } from 'lucide-react';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'full' | 'banner';
  className?: string;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'compact',
  className = ''
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // If already installed as PWA or user dismissed the prompt for this session
  if (isInstalled || isDismissed) {
    return null;
  }

  // If not on iOS and install prompt is not yet ready, we still allow an informative click on Android/desktop
  const handleTrigger = async () => {
    if (isInstallable) {
      await install();
    } else if (isIOS) {
      setShowIOSGuide(true);
    } else {
      // Guide user on Chrome Android / Desktop how to install if browser hasn't fired beforeinstallprompt yet
      alert('To install FMP Supermart on your phone:\n1. Tap the three dots (⋮) in Chrome menu.\n2. Tap "Install app" or "Add to Home screen".');
    }
  };

  if (variant === 'banner') {
    return (
      <>
        <div className={`relative bg-emerald-700 text-white px-4 py-2.5 rounded-xl shadow-md flex items-center justify-between gap-3 ${className}`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0 border border-white/20">
              <Smartphone className="w-5 h-5 text-emerald-200" />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-bold leading-tight truncate">Install FMP Supermart App</h4>
              <p className="text-[10px] text-emerald-100 leading-tight truncate">Fast ordering & offline access in Karanja Lad</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleTrigger}
              className="bg-white text-emerald-800 text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm hover:bg-emerald-50 active:scale-95 transition flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install</span>
            </button>
            <button
              onClick={() => setIsDismissed(true)}
              className="text-white/70 hover:text-white p-1"
              aria-label="Dismiss banner"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl text-gray-900 border border-gray-100">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-3">
                <Smartphone className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold">Install FMP Supermart on iPhone / iPad</h3>
              <div className="mt-3 space-y-2 text-xs text-gray-600">
                <div className="flex items-start gap-2">
                  <span className="font-bold text-emerald-600 bg-emerald-50 w-5 h-5 rounded-full flex items-center justify-center shrink-0">1</span>
                  <p>Tap the <strong>Share</strong> button (box with upward arrow) in the Safari toolbar.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-bold text-emerald-600 bg-emerald-50 w-5 h-5 rounded-full flex items-center justify-center shrink-0">2</span>
                  <p>Scroll down in the share menu and tap <strong>Add to Home Screen</strong>.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-bold text-emerald-600 bg-emerald-50 w-5 h-5 rounded-full flex items-center justify-center shrink-0">3</span>
                  <p>Tap <strong>Add</strong> in the top right corner. The FMP icon will appear on your phone!</p>
                </div>
              </div>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 active:scale-98 transition shadow-sm"
              >
                Got It
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <button
        onClick={handleTrigger}
        className={`flex items-center gap-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 active:scale-95 transition font-medium px-2.5 py-1.5 text-xs ${className}`}
        title="Install FMP Supermart App"
      >
        <Download className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        <span className="font-semibold">Install App</span>
      </button>

      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl text-gray-900 border border-gray-100">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-3">
              <Smartphone className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold">Install FMP Supermart on iPhone / iPad</h3>
            <div className="mt-3 space-y-2 text-xs text-gray-600">
              <div className="flex items-start gap-2">
                <span className="font-bold text-emerald-600 bg-emerald-50 w-5 h-5 rounded-full flex items-center justify-center shrink-0">1</span>
                <p>Tap the <strong>Share</strong> button (box with upward arrow) in the Safari toolbar.</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-bold text-emerald-600 bg-emerald-50 w-5 h-5 rounded-full flex items-center justify-center shrink-0">2</span>
                <p>Scroll down in the share menu and tap <strong>Add to Home Screen</strong>.</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-bold text-emerald-600 bg-emerald-50 w-5 h-5 rounded-full flex items-center justify-center shrink-0">3</span>
                <p>Tap <strong>Add</strong> in the top right corner. The FMP icon will appear on your phone!</p>
              </div>
            </div>
            <button
              onClick={() => setShowIOSGuide(false)}
              className="mt-5 w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 active:scale-98 transition shadow-sm"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};
