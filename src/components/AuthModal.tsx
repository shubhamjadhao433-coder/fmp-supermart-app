import React, { useState } from 'react';
import {
  X,
  Phone,
  Lock,
  User as UserIcon,
  MapPin,
  ArrowRight,
  ShieldCheck,
  Truck,
  ShoppingBag,
  Store,
  Sparkles
} from 'lucide-react';
import { api, authStorage } from '../services/api.ts';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: any) => void;
  initialRole?: 'customer' | 'rider' | 'admin';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
}) => {
  const [customerMode, setCustomerMode] = useState<'login' | 'register'>('login');

  // Form Fields
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [landmark, setLandmark] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (customerMode === 'register') {
        const res = await api.register({
          phone: phone.trim(),
          password,
          name: name.trim(),
          address: address.trim(),
          landmark: landmark.trim(),
          role: 'customer',
          pincode: '444105'
        });
        authStorage.setToken(res.token);
        onAuthSuccess(res.user);
        onClose();
      } else {
        const res = await api.login(phone.trim(), password);
        authStorage.setToken(res.token);
        onAuthSuccess(res.user);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please verify your mobile number and password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-4 my-8 relative animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-emerald-100 text-emerald-700">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-extrabold text-gray-900 text-lg leading-tight">
                {customerMode === 'login' ? 'Customer Sign In' : 'Create Customer Account'}
              </h3>
              <p className="text-xs text-gray-500">FMP Supermart • Karanja Lad (444105)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-xl hover:bg-gray-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Customer Sub-Mode (Login vs Register) */}
        <div className="flex border-b border-gray-100 text-xs">
          <button
            type="button"
            onClick={() => {
              setCustomerMode('login');
              setError(null);
            }}
            className={`pb-2 flex-1 text-center font-bold border-b-2 transition cursor-pointer ${
              customerMode === 'login'
                ? 'border-emerald-600 text-emerald-800'
                : 'border-transparent text-gray-400 hover:text-gray-700'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setCustomerMode('register');
              setError(null);
            }}
            className={`pb-2 flex-1 text-center font-bold border-b-2 transition cursor-pointer ${
              customerMode === 'register'
                ? 'border-emerald-600 text-emerald-800'
                : 'border-transparent text-gray-400 hover:text-gray-700'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Auth Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          {customerMode === 'register' && (
            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">Full Name</label>
              <div className="relative">
                <UserIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rahul Deshmukh"
                  className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden font-medium text-gray-900"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold text-gray-700 mb-1">Registered Mobile Number</label>
            <div className="relative">
              <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="tel"
                required
                maxLength={10}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="10-digit mobile number"
                className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden font-medium text-gray-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-gray-700 mb-1">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden font-medium text-gray-900"
              />
            </div>
          </div>

          {customerMode === 'register' && (
            <>
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">
                  Delivery Address (Karanja Lad)
                </label>
                <div className="relative">
                  <MapPin className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
                  <textarea
                    rows={2}
                    required
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="House/Plot No., Street name, Karanja Lad (444105)"
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden text-xs text-gray-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Landmark / Locality</label>
                <input
                  type="text"
                  value={landmark}
                  onChange={(e) => setLandmark(e.target.value)}
                  placeholder="Near Guru Mandir / Shivaji Chowk / Bus Stand"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </>
          )}

          {error && (
            <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl font-medium border border-red-200 leading-snug">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 text-white rounded-xl font-extrabold text-xs shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 mt-3 bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200"
          >
            <span>
              {loading
                ? 'Authenticating...'
                : customerMode === 'login'
                ? 'Sign In to FMP Supermart'
                : 'Complete Registration & Save Details'}
            </span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
