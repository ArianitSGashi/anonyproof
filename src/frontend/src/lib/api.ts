import type { ApiError } from "@repo/shared";

const AUTH_TOKEN_KEY = "anonyproof_admin_token";

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl = "/api") {
    this.baseUrl = baseUrl;
  }

  private getToken(): string | null {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }

  setToken(token: string): void {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  }

  clearToken(): void {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }

  hasToken(): boolean {
    return this.getToken() !== null;
  }

  async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) ?? {}),
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({
        message: res.statusText,
        code: "UNKNOWN",
      }))) as ApiError;
      throw new ApiRequestError(res.status, body.message, body.code);
    }

    return (await res.json()) as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PUT",
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }
}

export class ApiRequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

export const api = new ApiClient();
