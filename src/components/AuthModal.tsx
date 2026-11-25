import React, { useState, useEffect } from 'react';
import {
  X,
  Phone,
  Lock,
  User as UserIcon,
  MapPin,
  ArrowRight,
  ShieldCheck,
  HelpCircle,
  ShoppingBag,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Store as StoreIcon,
  Clock,
  Camera,
  Trash2
} from 'lucide-react';
import { api, authStorage } from '../services/api.ts';
import { StoreServiceType, User } from '../types.ts';
import { OsmMapPicker } from './OsmMapPicker.tsx';
import { compressImageFileToDataUrl } from '../utils/imageUpload.ts';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: User) => void;
  initialMode?: 'login' | 'register' | 'store_register';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
  initialMode = 'login',
}) => {
  const [mode, setMode] = useState<'login' | 'register' | 'store_register' | 'forgot'>(initialMode);

  // Common Form Fields - explicitly reset whenever modal opens or mode changes
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  const [forgotNotes, setForgotNotes] = useState('');

  // Store Self-Registration Fields
  const [storeName, setStoreName] = useState('');
  const [storeDescription, setStoreDescription] = useState('');
  const [openingHours, setOpeningHours] = useState('08:00 AM - 09:30 PM');
  const [serviceType, setServiceType] = useState<StoreServiceType>('both');
  const [deliveryRadiusKm, setDeliveryRadiusKm] = useState('5');
  const [deliveryFee, setDeliveryFee] = useState('0');
  const [minOrderAmount, setMinOrderAmount] = useState('0');
  const [storeLat, setStoreLat] = useState(20.4839);
  const [storeLng, setStoreLng] = useState(77.4877);
  const [hasStorePin, setHasStorePin] = useState(false);
  const [storePhotos, setStorePhotos] = useState<string[]>([]);
  const [photoLoading, setPhotoLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);

  const resetAllFields = () => {
    setName('');
    setPhone('');
    setPassword('');
    setShowPassword(false);
    setAddress('');
    setLandmark('');
    setForgotNotes('');
    setStoreName('');
    setStoreDescription('');
    setOpeningHours('08:00 AM - 09:30 PM');
    setServiceType('both');
    setDeliveryRadiusKm('5');
    setDeliveryFee('0');
    setMinOrderAmount('0');
    setStoreLat(20.4839);
    setStoreLng(77.4877);
    setHasStorePin(false);
    setStorePhotos([]);
    setError(null);
    setResetSuccessMessage(null);
  };

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      resetAllFields();
    }
  }, [isOpen, initialMode]);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    let digits = raw.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) {
      digits = digits.slice(2);
    } else if (digits.length === 11 && digits.startsWith('0')) {
      digits = digits.slice(1);
    } else if (digits.length > 10 && digits.startsWith('91')) {
      digits = digits.slice(digits.length - 10);
    }
    if (digits.length > 10) {
      digits = digits.slice(0, 10);
    }
    setPhone(digits);
  };

  const handleSwitchToRegister = () => {
    setMode('register');
    resetAllFields();
  };

  const handleSwitchToStoreRegister = () => {
    setMode('store_register');
    resetAllFields();
  };

  const handleSwitchToLogin = () => {
    setMode('login');
    setPassword('');
    setShowPassword(false);
    setError(null);
    setResetSuccessMessage(null);
  };

  const handleModalClose = () => {
    resetAllFields();
    onClose();
  };

  if (!isOpen) return null;

  const extractCleanPhone = (raw: string) => {
    let clean = raw.trim().replace(/\D/g, '');
    if (clean.length === 12 && clean.startsWith('91')) {
      clean = clean.slice(2);
    } else if (clean.length === 11 && clean.startsWith('0')) {
      clean = clean.slice(1);
    } else if (clean.length > 10 && clean.startsWith('91')) {
      clean = clean.slice(clean.length - 10);
    }
    return clean;
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const cleanPhone = extractCleanPhone(phone);
    if (cleanPhone.length < 10) {
      setError('Please enter a valid 10-digit mobile number.');
      setLoading(false);
      return;
    }

    const cleanPassword = password.trim();
    if (!cleanPassword) {
      setError('Password is required.');
      setLoading(false);
      return;
    }

    try {
      const res = await api.login(cleanPhone, cleanPassword);
      authStorage.setToken(res.token);
      resetAllFields();
      onAuthSuccess(res.user);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please verify your mobile number and password.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const cleanPhone = extractCleanPhone(phone);
    if (cleanPhone.length < 10) {
      setError('Please enter a valid 10-digit mobile number.');
      setLoading(false);
      return;
    }

    const cleanPassword = password.trim();
    if (cleanPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      setLoading(false);
      return;
    }

    if (!name.trim()) {
      setError('Full name is required.');
      setLoading(false);
      return;
    }

    try {
      const res = await api.register({
        phone: cleanPhone,
        password: cleanPassword,
        name: name.trim(),
        address: address.trim(),
        landmark: landmark.trim(),
        role: 'customer',
        pincode: '444105'
      });
      authStorage.setToken(res.token);
      resetAllFields();
      onAuthSuccess(res.user);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleStorePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setPhotoLoading(true);
    setError(null);
    try {
      const remainingSlots = Math.max(0, 4 - storePhotos.length);
      const selected = Array.from(files).slice(0, remainingSlots);
      const encoded: string[] = [];
      for (const f of selected) {
        const dataUrl = await compressImageFileToDataUrl(f, 800, 180_000);
        encoded.push(dataUrl);
      }
      setStorePhotos(prev => [...prev, ...encoded].slice(0, 4));
    } catch (err: any) {
      setError(err?.message || 'Could not process store photo.');
    } finally {
      setPhotoLoading(false);
      e.target.value = '';
    }
  };

  const handleStoreRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const cleanPhone = extractCleanPhone(phone);
    if (cleanPhone.length < 10) {
      setError('Please enter a valid 10-digit owner mobile number.');
      setLoading(false);
      return;
    }

    const cleanPassword = password.trim();
    if (cleanPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      setLoading(false);
      return;
    }

    if (!name.trim() || !storeName.trim() || !address.trim()) {
      setError('Owner name, store name, and store address are required.');
      setLoading(false);
      return;
    }

    if (!hasStorePin) {
      setError('Please pin your exact grocery shop location on the map (or tap Use My Current Location).');
      setLoading(false);
      return;
    }

    try {
      const res = await api.registerStore({
        owner_name: name.trim(),
        phone: cleanPhone,
        password: cleanPassword,
        store_name: storeName.trim(),
        description: storeDescription.trim() || undefined,
        address: address.trim(),
        landmark: landmark.trim() || undefined,
        pincode: '444105',
        lat: storeLat,
        lng: storeLng,
        photos: storePhotos,
        opening_hours: openingHours.trim() || '08:00 AM - 09:30 PM',
        service_type: serviceType,
        delivery_radius_km: Number(deliveryRadiusKm) || 5,
        delivery_fee: Math.max(0, Number(deliveryFee) || 0),
        min_order_amount: Math.max(0, Number(minOrderAmount) || 0)
      });
      authStorage.setToken(res.token);
      resetAllFields();
      onAuthSuccess(res.user);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Store registration failed. Please check all details.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResetSuccessMessage(null);

    const cleanPhone = phone.trim().replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      setError('Please enter a valid 10-digit registered mobile number.');
      setLoading(false);
      return;
    }

    try {
      const res = await api.requestPasswordReset(cleanPhone, forgotNotes);
      setResetSuccessMessage(res.message);
    } catch (err: any) {
      setError(err.message || 'Could not submit password reset request. Please check the mobile number.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div
        className={`bg-white rounded-3xl w-full p-5 sm:p-7 shadow-2xl border border-gray-100 space-y-4 my-4 sm:my-8 relative animate-in fade-in zoom-in-95 duration-200 ${
          mode === 'store_register' ? 'max-w-xl' : 'max-w-md'
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`p-2.5 rounded-2xl shrink-0 ${
              mode === 'store_register' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
            }`}>
              {mode === 'forgot' ? (
                <HelpCircle className="w-6 h-6" />
              ) : mode === 'store_register' ? (
                <StoreIcon className="w-6 h-6" />
              ) : (
                <ShoppingBag className="w-6 h-6" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="font-extrabold text-gray-900 text-base sm:text-lg leading-tight">
                {mode === 'login' && 'Sign In to FMP Supermart'}
                {mode === 'register' && 'Create Customer Account'}
                {mode === 'store_register' && 'Register Your Grocery Store'}
                {mode === 'forgot' && 'Password Assistance'}
              </h3>
              <p className="text-[11px] sm:text-xs text-gray-500">
                {mode === 'login' && 'Login for Customers, Store Owners, Riders & Admin'}
                {mode === 'register' && 'Order from nearby grocery & kirana stores'}
                {mode === 'store_register' && 'Free Store Onboarding • Admin Verified Marketplace'}
                {mode === 'forgot' && 'Store-Assisted Password Recovery'}
              </p>
            </div>
          </div>
          <button
            onClick={handleModalClose}
            aria-label="Close dialog"
            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-xl hover:bg-gray-100 transition cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher Pills (Login / Customer / Store Owner) */}
        {mode !== 'forgot' && (
          <div className="grid grid-cols-3 gap-1.5 bg-gray-100 p-1 rounded-2xl text-[11px] font-bold">
            <button
              type="button"
              onClick={handleSwitchToLogin}
              className={`py-2 px-2 rounded-xl transition cursor-pointer ${
                mode === 'login' ? 'bg-white text-emerald-700 shadow-xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={handleSwitchToRegister}
              className={`py-2 px-2 rounded-xl transition cursor-pointer ${
                mode === 'register' ? 'bg-white text-emerald-700 shadow-xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Customer
            </button>
            <button
              type="button"
              onClick={handleSwitchToStoreRegister}
              className={`py-2 px-2 rounded-xl transition cursor-pointer ${
                mode === 'store_register' ? 'bg-white text-amber-700 shadow-xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Register Store
            </button>
          </div>
        )}

        {/* ======================================================== */}
        {/* 1. SINGLE LOGIN VIEW */}
        {/* ======================================================== */}
        {mode === 'login' && (
          <form onSubmit={handleLoginSubmit} className="space-y-3.5 text-xs">
            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">
                Registered Mobile Number
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="tel"
                  required
                  maxLength={15}
                  value={phone}
                  onChange={handlePhoneChange}
                  placeholder="10-digit mobile number"
                  className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden font-medium text-gray-900"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold text-gray-700">Password</label>
                <button
                  type="button"
                  onClick={() => {
                    setMode('forgot');
                    setError(null);
                  }}
                  className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
                >
                  Forgot Password?
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full pl-9 pr-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden font-medium text-gray-900"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl font-medium border border-red-200 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span>{error}</span>
                  {error.includes('No account found') && (
                    <button
                      type="button"
                      onClick={handleSwitchToRegister}
                      className="block mt-1 font-bold text-emerald-700 hover:underline cursor-pointer"
                    >
                      Click here to create a new customer account →
                    </button>
                  )}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 text-white rounded-xl font-extrabold text-xs shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 mt-2 bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200"
            >
              <span>{loading ? 'Verifying Credentials...' : 'Sign In'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <div className="pt-3 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-center">
              <button
                type="button"
                onClick={handleSwitchToRegister}
                className="text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer"
              >
                New Customer? Create Account
              </button>
              <button
                type="button"
                onClick={handleSwitchToStoreRegister}
                className="text-[11px] font-bold text-amber-700 hover:underline cursor-pointer"
              >
                Own a Kirana Store? Register Free →
              </button>
            </div>
          </form>
        )}

        {/* ======================================================== */}
        {/* 2. CUSTOMER REGISTRATION VIEW */}
        {/* ======================================================== */}
        {mode === 'register' && (
          <form onSubmit={handleRegisterSubmit} className="space-y-3 text-xs" autoComplete="off">
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
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden font-medium text-gray-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">Mobile Number</label>
              <div className="relative">
                <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="tel"
                  required
                  maxLength={15}
                  value={phone}
                  onChange={handlePhoneChange}
                  placeholder="10-digit mobile number"
                  autoComplete="off"
                  className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden font-medium text-gray-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">Set Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  autoComplete="new-password"
                  className="w-full pl-9 pr-10 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden font-medium text-gray-900"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">
                Delivery Address in Karanja Lad
              </label>
              <div className="relative">
                <MapPin className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
                <textarea
                  rows={2}
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="House/Plot No., Street name, Karanja Lad (444105)"
                  autoComplete="off"
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
                placeholder="e.g. Landmark or Area, Karanja Lad"
                autoComplete="off"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl font-medium border border-red-200 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span>{error}</span>
                  {error.includes('already exists') && (
                    <button
                      type="button"
                      onClick={handleSwitchToLogin}
                      className="block mt-1 font-bold text-emerald-700 hover:underline cursor-pointer"
                    >
                      Already registered? Click here to Sign In →
                    </button>
                  )}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 text-white rounded-xl font-extrabold text-xs shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 mt-2 bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200"
            >
              <span>{loading ? 'Creating Customer Account...' : 'Complete Registration'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        {/* ======================================================== */}
        {/* 3. STORE SELF-REGISTRATION VIEW (FREE MARKETPLACE) */}
        {/* ======================================================== */}
        {mode === 'store_register' && (
          <form onSubmit={handleStoreRegisterSubmit} className="space-y-3 text-xs" autoComplete="off">
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-emerald-900 text-[11px] leading-relaxed">
              <span className="font-extrabold block text-emerald-800">Free Grocery & Kirana Store Listing</span>
              No registration fees or commission. Register your shop below; your store goes live to nearby customers as soon as Admin approves it.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Owner Full Name *</label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Suresh Agrawal"
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-amber-500 outline-hidden font-medium text-gray-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Owner Mobile Number *</label>
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="tel"
                    required
                    maxLength={15}
                    value={phone}
                    onChange={handlePhoneChange}
                    placeholder="10-digit mobile number"
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-amber-500 outline-hidden font-medium text-gray-900"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Store / Kirana Name *</label>
                <div className="relative">
                  <StoreIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    required
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder="e.g. Shree Ganesh Kirana Store"
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-amber-500 outline-hidden font-medium text-gray-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Create Password *</label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    autoComplete="new-password"
                    className="w-full pl-9 pr-10 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-amber-500 outline-hidden font-medium text-gray-900"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Opening Hours *</label>
                <div className="relative">
                  <Clock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    required
                    value={openingHours}
                    onChange={(e) => setOpeningHours(e.target.value)}
                    placeholder="e.g. 08:00 AM - 09:30 PM"
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-amber-500 outline-hidden font-medium text-gray-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Order Fulfillment Options *</label>
                <select
                  value={serviceType}
                  onChange={(e) => setServiceType(e.target.value as StoreServiceType)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-amber-500 outline-hidden font-semibold text-gray-900"
                >
                  <option value="both">Home Delivery & Store Pickup</option>
                  <option value="delivery">Home Delivery Only (Store-Managed)</option>
                  <option value="pickup">Store Pickup Only</option>
                </select>
              </div>
            </div>

            {serviceType !== 'pickup' && (
              <div className="grid grid-cols-3 gap-2 bg-gray-50 p-2.5 rounded-2xl border border-gray-200">
                <div>
                  <label className="block text-[10px] font-bold text-gray-600 mb-1">Delivery Radius (km)</label>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={deliveryRadiusKm}
                    onChange={(e) => setDeliveryRadiusKm(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-600 mb-1">Delivery Fee (₹)</label>
                  <input
                    type="number"
                    min="0"
                    value={deliveryFee}
                    onChange={(e) => setDeliveryFee(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-600 mb-1">Min Order (₹)</label>
                  <input
                    type="number"
                    min="0"
                    value={minOrderAmount}
                    onChange={(e) => setMinOrderAmount(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold"
                  />
                </div>
              </div>
            )}

            {/* Store Photos */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-gray-700">Store Photos (Optional, up to 4)</label>
                <label className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer">
                  <Camera className="w-3.5 h-3.5" />
                  <span>{photoLoading ? 'Uploading...' : 'Add Photo'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={photoLoading || storePhotos.length >= 4}
                    onChange={handleStorePhotoUpload}
                    className="hidden"
                  />
                </label>
              </div>
              {storePhotos.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {storePhotos.map((src, idx) => (
                    <div key={idx} className="relative w-16 h-16 rounded-xl overflow-hidden border border-gray-200">
                      <img src={src} alt={`Store ${idx + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setStorePhotos(prev => prev.filter((_, i) => i !== idx))}
                        className="absolute top-0.5 right-0.5 bg-black/70 text-white p-0.5 rounded-md cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Store Map Location */}
            <div className="space-y-2 bg-gray-50 p-3 rounded-2xl border border-gray-200">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] font-bold text-gray-800">Pin Exact Store Location on Map *</label>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  hasStorePin ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}>
                  {hasStorePin ? 'Store Location Pinned' : 'Pin Required'}
                </span>
              </div>
              <OsmMapPicker
                lat={storeLat}
                lng={storeLng}
                pinLabel="Your Store"
                pinColor="purple"
                heightClass="h-44"
                isLocationConfirmed={hasStorePin}
                onChange={(newLat, newLng, displayAddr, meta) => {
                  setStoreLat(newLat);
                  setStoreLng(newLng);
                  setHasStorePin(true);
                  if (displayAddr && !address.trim()) {
                    setAddress(displayAddr);
                  }
                  if (meta?.landmark && !landmark.trim()) {
                    setLandmark(meta.landmark);
                  }
                }}
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">Full Store Address *</label>
              <textarea
                rows={2}
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Shop No., Main Road / Chowk, Karanja Lad (444105)"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-amber-500 outline-hidden text-xs text-gray-900"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Nearby Landmark</label>
                <input
                  type="text"
                  value={landmark}
                  onChange={(e) => setLandmark(e.target.value)}
                  placeholder="e.g. Near Shivaji Chowk"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-900 outline-hidden focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Short Description (Optional)</label>
                <input
                  type="text"
                  value={storeDescription}
                  onChange={(e) => setStoreDescription(e.target.value)}
                  placeholder="Fresh staples, dairy, pulses & daily needs"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-900 outline-hidden focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl font-medium border border-red-200 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-extrabold text-xs shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <span>{loading ? 'Submitting Store Registration...' : 'Submit Store for Free Approval'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        {/* ======================================================== */}
        {/* 4. ADMIN-ASSISTED FORGOT PASSWORD WORKFLOW */}
        {/* ======================================================== */}
        {mode === 'forgot' && (
          <div className="space-y-3.5 text-xs">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 text-amber-900 space-y-1.5">
              <div className="font-extrabold flex items-center gap-1.5 text-xs text-amber-800">
                <ShieldCheck className="w-4 h-4 text-amber-700" />
                <span>Zero-Spam Store Policy</span>
              </div>
              <p className="text-[11px] leading-relaxed text-amber-800">
                FMP Supermart does not use paid third-party SMS gateways. Enter your registered mobile number below to create a direct reset ticket for our Store Administrator.
              </p>
            </div>

            {resetSuccessMessage ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                <h4 className="font-bold text-emerald-900 text-sm">Request Submitted</h4>
                <p className="text-xs text-emerald-700">{resetSuccessMessage}</p>
                <div className="pt-2 text-[11px] text-gray-600 bg-white p-2.5 rounded-xl border border-emerald-100">
                  <span className="font-semibold block text-gray-800">Direct Helpline:</span>
                  <span>+91 9699925206 (FMP Supermart Support)</span>
                  <span className="block text-gray-500 mt-0.5">Karanja Lad, Maharashtra</span>
                </div>
                <button
                  type="button"
                  onClick={handleSwitchToLogin}
                  className="mt-2 px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-xs hover:bg-emerald-700 cursor-pointer"
                >
                  Return to Sign In
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotSubmit} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">
                    Registered Mobile Number
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="tel"
                      required
                      maxLength={10}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                      placeholder="Enter 10-digit registered number"
                      className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden font-medium text-gray-900"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">
                    Additional Notes / Request Reason (Optional)
                  </label>
                  <input
                    type="text"
                    value={forgotNotes}
                    onChange={(e) => setForgotNotes(e.target.value)}
                    placeholder="e.g. Forgot password, please assist"
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-900 outline-hidden focus:ring-2 focus:ring-emerald-500 text-xs"
                  />
                </div>

                {error && (
                  <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl font-medium border border-red-200 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <span>{loading ? 'Submitting Request...' : 'Send Reset Request to Store Admin'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={handleSwitchToLogin}
                    className="text-xs font-semibold text-gray-600 hover:text-gray-900 cursor-pointer"
                  >
                    ← Back to Sign In
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
