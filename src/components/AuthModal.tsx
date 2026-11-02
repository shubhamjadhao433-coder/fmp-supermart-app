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
  EyeOff
} from 'lucide-react';
import { api, authStorage } from '../services/api.ts';
import { User } from '../types.ts';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: User) => void;
  initialMode?: 'login' | 'register';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
  initialMode = 'login',
}) => {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(initialMode);

  // Form Fields - explicitly reset whenever modal opens or mode changes
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  const [forgotNotes, setForgotNotes] = useState('');

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
    setError(null);
    setResetSuccessMessage(null);
  };

  // Ensure fresh registration or login form has zero stale fields when opening
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

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    let cleanPhone = phone.trim().replace(/\D/g, '');
    if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
      cleanPhone = cleanPhone.slice(2);
    } else if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) {
      cleanPhone = cleanPhone.slice(1);
    } else if (cleanPhone.length > 10 && cleanPhone.startsWith('91')) {
      cleanPhone = cleanPhone.slice(cleanPhone.length - 10);
    }

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

    let cleanPhone = phone.trim().replace(/\D/g, '');
    if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
      cleanPhone = cleanPhone.slice(2);
    } else if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) {
      cleanPhone = cleanPhone.slice(1);
    } else if (cleanPhone.length > 10 && cleanPhone.startsWith('91')) {
      cleanPhone = cleanPhone.slice(cleanPhone.length - 10);
    }

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
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-gray-100 space-y-4 my-8 relative animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-emerald-100 text-emerald-700">
              {mode === 'forgot' ? (
                <HelpCircle className="w-6 h-6" />
              ) : (
                <ShoppingBag className="w-6 h-6" />
              )}
            </div>
            <div>
              <h3 className="font-extrabold text-gray-900 text-lg leading-tight">
                {mode === 'login' && 'Sign In to FMP Supermart'}
                {mode === 'register' && 'Create Customer Account'}
                {mode === 'forgot' && 'Password Assistance'}
              </h3>
              <p className="text-xs text-gray-500">
                {mode === 'login' && 'Single Login for Customers, Riders & Admin'}
                {mode === 'register' && 'Fast grocery delivery in Karanja Lad (444105)'}
                {mode === 'forgot' && 'Store-Assisted Password Recovery'}
              </p>
            </div>
          </div>
          <button
            onClick={handleModalClose}
            aria-label="Close dialog"
            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-xl hover:bg-gray-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ======================================================== */}
        {/* 1. SINGLE LOGIN VIEW (COMMON FOR ALL 3 ROLES) */}
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

            <div className="pt-3 border-t border-gray-100 text-center">
              <span className="text-gray-500 text-[11px]">New to FMP Supermart? </span>
              <button
                type="button"
                onClick={handleSwitchToRegister}
                className="text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer"
              >
                Create Customer Account
              </button>
            </div>
          </form>
        )}

        {/* ======================================================== */}
        {/* 2. CUSTOMER REGISTRATION VIEW (ALWAYS EMPTY FOR FRESH USERS) */}
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
              <label className="block text-[11px] font-bold text-gray-700 mb-1">Registered Mobile Number</label>
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

            <div className="pt-3 border-t border-gray-100 text-center">
              <span className="text-gray-500 text-[11px]">Already have an account? </span>
              <button
                type="button"
                onClick={handleSwitchToLogin}
                className="text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer"
              >
                Sign In
              </button>
            </div>
          </form>
        )}

        {/* ======================================================== */}
        {/* 3. ADMIN-ASSISTED FORGOT PASSWORD WORKFLOW (NO FAKE SMS) */}
        {/* ======================================================== */}
        {mode === 'forgot' && (
          <div className="space-y-3.5 text-xs">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 text-amber-900 space-y-1.5">
              <div className="font-extrabold flex items-center gap-1.5 text-xs text-amber-800">
                <ShieldCheck className="w-4 h-4 text-amber-700" />
                <span>Zero-Spam Store Policy</span>
              </div>
              <p className="text-[11px] leading-relaxed text-amber-800">
                FMP Supermart does not use paid third-party SMS gateways. Enter your registered mobile number below to create a direct reset ticket for our Karanja Lad Store Administrator.
              </p>
            </div>

            {resetSuccessMessage ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                <h4 className="font-bold text-emerald-900 text-sm">Request Submitted</h4>
                <p className="text-xs text-emerald-700">{resetSuccessMessage}</p>
                <div className="pt-2 text-[11px] text-gray-600 bg-white p-2.5 rounded-xl border border-emerald-100">
                  <span className="font-semibold block text-gray-800">Direct Helpline:</span>
                  <span>📞 +91 9699925206 (FMP Supermart Support)</span>
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
