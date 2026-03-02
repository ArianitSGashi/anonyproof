import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { AdminLoginResponse } from "@repo/shared";
import { api } from "./api";

interface AdminInfo {
  id: string;
  username: string;
  role: "moderator" | "admin" | "superadmin";
}

interface AuthState {
  admin: AdminInfo | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminInfo | null>(() => {
    // Restore session synchronously from localStorage
    try {
      const token = localStorage.getItem("anonyproof_admin_token");
      if (token) {
        const payload = JSON.parse(atob(token.split(".")[1]!)) as {
          sub: string;
          username: string;
          role: "moderator" | "admin" | "superadmin";
          exp: number;
        };
        if (payload.exp * 1000 > Date.now()) {
          return {
            id: payload.sub,
            username: payload.username,
            role: payload.role,
          };
        }
        api.clearToken();
      }
    } catch {
      api.clearToken();
    }
    return null;
  });
  const isLoading = false;

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post<AdminLoginResponse>("/admin/login", {
      username,
      password,
    });
    api.setToken(res.token);
    setAdmin(res.admin);
  }, []);

  const logout = useCallback(() => {
    api.clearToken();
    setAdmin(null);
  }, []);

  return (
    <AuthContext.Provider value={{ admin, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
