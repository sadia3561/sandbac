import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { authStorage } from "@/src/api/authStorage";
import { api } from "@/src/api/client";

type User = { id: string; name: string; email: string; role: "CUSTOMER" | "PROVIDER" | "ADMIN"; phone?: string | null };

type AuthCtx = {
  user: User | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string, phone?: string) => Promise<void>;
  signUpProvider: (body: any) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const cached = await authStorage.getUser();
      const token = await authStorage.getAccess();
      if (cached && token) {
        setUser(cached as User);
        try {
          const fresh = await api.me();
          setUser(fresh);
          await authStorage.setUser(fresh);
        } catch { /* stay with cached */ }
      }
      setReady(true);
    })();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const r = await api.login(email, password);
    await authStorage.setTokens(r.access_token, r.refresh_token);
    await authStorage.setUser(r.user);
    setUser(r.user);
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string, phone?: string) => {
    const r = await api.register(name, email, password, phone);
    await authStorage.setTokens(r.access_token, r.refresh_token);
    await authStorage.setUser(r.user);
    setUser(r.user);
  }, []);

  const signUpProvider = useCallback(async (body: any) => {
    const r = await api.registerProvider(body);
    await authStorage.setTokens(r.access_token, r.refresh_token);
    await authStorage.setUser(r.user);
    setUser(r.user);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, signIn, signUp, signUpProvider, signOut }), [user, ready, signIn, signUp, signUpProvider, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be inside AuthProvider");
  return c;
}
