import * as SecureStore from "expo-secure-store";
import { API_URL } from "./config";
import { errorMessage, tr } from "./i18n";
import type { ChatMessage, Housekeeper, HousekeeperRequest, Meta, Profile, SeekerRequest, User } from "./types";

const TOKEN_KEY = "session-token";
let token: string | null = null;

export const loadToken = async () => { token = await SecureStore.getItemAsync(TOKEN_KEY); };
const saveToken = async (t: string | null) => {
  token = t;
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
};

// The free hosting plan puts the server to sleep when nobody has used it for a while, and the first request afterwards
// can take about a minute. Wait long enough for that, but never forever.
const REQUEST_TIMEOUT_MS = 90_000;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      signal: controller.signal,
      headers: {
        "X-Client": "mobile",
        "Accept-Language": tr.lang, // the language shown in the app: errors and emails come back in it
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error(tr("net.timeout"));
    }
    throw new Error(tr("net.offline"));
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const body = data as { error?: string; code?: string; params?: Record<string, number> };
    // 502/503/504 with no message from our app = the host is starting the server up (or restarting it after an update)
    if (!body.error && res.status >= 502 && res.status <= 504) {
      throw new Error(tr("net.starting"));
    }
    throw new Error(body.error || body.code ? errorMessage(body) : tr("net.failed", { status: res.status }));
  }
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
  seekerRequests: () => call<SeekerRequest[]>("GET", "/api/requests?as=sent"),
  housekeeperRequests: () => call<HousekeeperRequest[]>("GET", "/api/requests?as=received"),
  answer: (id: number, status: "accepted" | "declined") => call("PATCH", `/api/requests/${id}`, { status }),
  messages: (requestId: number, after: number) =>
    call<{ with: string; messages: ChatMessage[] }>("GET", `/api/requests/${requestId}/messages?after=${after}`),
  sendMessage: (requestId: number, body: string) =>
    call<ChatMessage>("POST", `/api/requests/${requestId}/messages`, { body }),
  review: (id: number, rating: number) => call("POST", `/api/requests/${id}/review`, { rating }),
};
