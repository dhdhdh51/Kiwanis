import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setUnauthorizedHandler } from './api';
import type { User } from './types';
import { dismissAll } from '../upload/engine';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: User | null) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      const { user } = await api<{ user: User }>('/api/auth/me', { silent401: true });
      setUser(user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Embedded players on other websites never need the viewer's session.
    if (window.location.pathname.startsWith('/embed/')) setLoading(false);
    else void refresh();
    setUnauthorizedHandler(() => {
      setUser(null);
      qc.clear();
    });
  }, [refresh, qc]);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      loading,
      setUser,
      refresh,
      login: async (email, password) => {
        const { user } = await api<{ user: User }>('/api/auth/login', { body: { email, password }, silent401: true });
        qc.clear();
        setUser(user);
      },
      register: async (name, email, password) => {
        const { user } = await api<{ user: User }>('/api/auth/register', { body: { name, email, password } });
        qc.clear();
        setUser(user);
      },
      logout: async () => {
        dismissAll();
        await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        qc.clear();
        setUser(null);
      },
    }),
    [user, loading, refresh, qc],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
