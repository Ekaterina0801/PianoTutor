"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { User, UserRole } from "@/lib/types";

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  hasRole: (...roles: UserRole[]) => boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.me().then(setUser).catch(() => {
      localStorage.removeItem("pt_token");
      setUser(null);
    }).finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthCtx>(() => ({
    user,
    loading,
    login: async (email, password) => {
      const res = await api.login(email, password);
      localStorage.removeItem("pt_token");
      setUser(res.user);
    },
    register: async (email, password, name) => {
      const res = await api.register(email, password, name);
      localStorage.removeItem("pt_token");
      setUser(res.user);
    },
    logout: () => {
      void api.logout();
      localStorage.removeItem("pt_token");
      setUser(null);
    },
    hasRole: (...roles) => {
      if (!user) return false;
      return user.role === "admin" || roles.includes(user.role);
    },
  }), [loading, user]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx;
}
