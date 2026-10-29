import * as SecureStore from "expo-secure-store";
import { API_URL } from "./config";
import type { ChatMessage, Housekeeper, HousekeeperRequest, Meta, Profile, SeekerRequest, User } from "./types";

const TOKEN_KEY = "session-token";
let token: string | null = null;

export const loadToken = async () => { token = await SecureStore.getItemAsync(TOKEN_KEY); };
const saveToken = async (t: string | null) => {
  token = t;
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: {
        "X-Client": "mobile",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

type AuthResult = User & { token: string };

export const api = {
  async register(b: { role: string; name: string; email: string; password: string }) {
    const { token: t, ...user } = await call<AuthResult>("POST", "/api/register", b);
    await saveToken(t);
    return user as User;
  },
  async login(b: { email: string; password: string }) {
    const { token: t, ...user } = await call<AuthResult>("POST", "/api/login", b);
    await saveToken(t);
    return user as User;
  },
  async logout() {
    try { await call("POST", "/api/logout", {}); } finally { await saveToken(null); }
  },
  resendVerification: () => call<{ ok: boolean; alreadyVerified?: boolean }>("POST", "/api/email-verification/resend", {}),
  requestPasswordReset: (email: string) => call<{ message: string }>("POST", "/api/password-reset/request", { email }),
  async deleteAccount(password: string) {
    await call("POST", "/api/account/delete", { password });
    await saveToken(null);
  },
  me: () => call<{ user: User | null; profile: Profile | null; unreadMessages?: number }>("GET", "/api/me"),
  meta: () => call<Meta>("GET", "/api/meta"),
  housekeepers: (q: Record<string, string>) =>
    call<Housekeeper[]>("GET", "/api/housekeepers?" + new URLSearchParams(q)),
  saveProfile: (p: Profile) => call("PUT", "/api/profile", p),
  sendRequest: (b: { housekeeperId: number; phone: string; when: string; note: string }) =>
    call("POST", "/api/requests", b),
  seekerRequests: () => call<SeekerRequest[]>("GET", "/api/requests"),
  housekeeperRequests: () => call<HousekeeperRequest[]>("GET", "/api/requests"),
  answer: (id: number, status: "accepted" | "declined") => call("PATCH", `/api/requests/${id}`, { status }),
  messages: (requestId: number, after: number) =>
    call<{ with: string; messages: ChatMessage[] }>("GET", `/api/requests/${requestId}/messages?after=${after}`),
  sendMessage: (requestId: number, body: string) =>
    call<ChatMessage>("POST", `/api/requests/${requestId}/messages`, { body }),
  review: (id: number, rating: number) => call("POST", `/api/requests/${id}/review`, { rating }),
};
