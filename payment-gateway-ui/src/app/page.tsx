'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import { Toast } from '../components/ui/Toast';
import { Loader2, Eye, EyeOff } from 'lucide-react';

interface AuthResponse {
  success: boolean;
  data: {
    token: string;
    user: { id: string; name: string; email: string };
  };
}

export default function AuthPage() {
  const { authState, login } = useAuth();
  const router = useRouter();

  const [isRegister, setIsRegister] = useState(false);
  const [name,       setName]       = useState('');
  const [email,      setEmail]      = useState('');
  const [password,   setPassword]   = useState('');
  const [isLoading,  setIsLoading]  = useState(false);
  const [toastMsg,   setToastMsg]   = useState<string | null>(null);
  const [toastType,  setToastType]  = useState<'success' | 'error'>('error');

  useEffect(() => {
    if (authState.token) router.replace('/dashboard');
  }, [authState.token, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
    const body     = isRegister ? { name, email, password } : { email, password };

    try {
      const res = await apiFetch<AuthResponse>(endpoint, { method: 'POST', body });
      login(res.data.token, res.data.user);
      router.replace('/dashboard');
    } catch (err) {
      const message = (err as { message?: string }).message ?? 'Something went wrong.';
      setToastMsg(message);
      setToastType('error');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#08090a] px-4">
      <div className="w-full max-w-md">
        <div className="mb-10 text-center">
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-[#f0f2f5]">
            payment<span className="text-[#3ecf8e]">.</span>engine
          </h1>
          <p className="mt-2 text-sm text-[#6b7280]">Event-sourced ledger platform</p>
        </div>

        <div className="rounded-2xl border border-t-white/[0.12] border-white/[0.06] bg-white/[0.04] p-8 backdrop-blur-2xl">
          <div className="mb-8 flex rounded-xl bg-white/[0.04] p-1">
            {(['Login', 'Register'] as const).map((label) => (
              <button
                key={label}
                onClick={() => setIsRegister(label === 'Register')}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
                  (label === 'Register') === isRegister
                    ? 'bg-white/[0.08] text-[#f0f2f5]'
                    : 'text-[#6b7280] hover:text-[#f0f2f5]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <Field
                label="Full name"
                type="text"
                value={name}
                onChange={setName}
                placeholder="Ananya Patel"
              />
            )}
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="ananya@example.com"
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
            />

            <button
              type="submit"
              disabled={isLoading}
              className="mt-2 w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3.5
                         font-semibold text-white transition-opacity hover:opacity-90
                         disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? (
                <Loader2 className="mx-auto animate-spin" size={20} />
              ) : isRegister ? (
                'Create Account'
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>
      </div>

      {toastMsg && (
        <Toast
          message={toastMsg}
          type={toastType}
          onDismiss={() => setToastMsg(null)}
        />
      )}
    </main>
  );
}

function Field({
  label, type, value, onChange, placeholder,
}: {
  label:       string;
  type:        string;
  value:       string;
  onChange:    (v: string) => void;
  placeholder: string;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const isPasswordField = type === 'password';
  const inputType = isPasswordField && showPassword ? 'text' : type;

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-[#6b7280]">{label}</label>
      <div className="relative">
        <input
          required
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] px-4 py-3
                     text-[#f0f2f5] placeholder-[#6b7280]/60 outline-none transition-colors
                     focus:border-[#3ecf8e]/40 focus:ring-1 focus:ring-[#3ecf8e]/20"
        />
        {isPasswordField && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-[#6b7280] hover:text-[#f0f2f5] transition-colors"
          >
            {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>
        )}
      </div>
    </div>
  );
}