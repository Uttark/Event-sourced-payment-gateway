'use client';

import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
} from 'react';
import { AuthState, User } from '../types';
import { apiFetch, setAuthToken, setLogoutHandler } from '../lib/api';

type AuthAction =
  | { type: 'LOGIN'; payload: { token: string; user: User } }
  | { type: 'LOGOUT' };

interface AuthContextValue {
  authState: AuthState;
  login:     (token: string, user: User) => void;
  logout:    () => Promise<void>;
}

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'LOGIN':  return { user: action.payload.user, token: action.payload.token };
    case 'LOGOUT': return { user: null, token: null };
  }
}

const initialState: AuthState = { user: null, token: null };

function readSessionStorage(): AuthState {
  if (typeof window === 'undefined') return initialState;
  try {
    const raw = sessionStorage.getItem('auth');
    return raw ? (JSON.parse(raw) as AuthState) : initialState;
  } catch {
    return initialState;
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, dispatch] = useReducer(authReducer, initialState, readSessionStorage);

  setAuthToken(authState.token);

  const clearLocalState = useCallback(() => {
    dispatch({ type: 'LOGOUT' });
    sessionStorage.removeItem('auth');
  }, []);

  const logout = useCallback(async () => {

    if (authState.token) {
      try {
        await apiFetch('/api/auth/logout', { method: 'POST' });
      } catch {

      }
    }
    clearLocalState();
  }, [authState.token, clearLocalState]);

  const login = useCallback((token: string, user: User) => {
    dispatch({ type: 'LOGIN', payload: { token, user } });
    sessionStorage.setItem('auth', JSON.stringify({ token, user }));
  }, []);

  useEffect(() => {
    setLogoutHandler(clearLocalState);
  }, [clearLocalState]);

  return (
    <AuthContext.Provider value={{ authState, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be called inside an <AuthProvider>');
  return ctx;
}