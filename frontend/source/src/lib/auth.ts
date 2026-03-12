export type AuthSession = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
};

const AUTH_STORAGE_KEY = 'parser_auth_session';

export const loadSession = (): AuthSession | null => {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthSession;
    return parsed?.access_token ? parsed : null;
  } catch {
    return null;
  }
};

export const saveSession = (session: AuthSession) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event('parser-auth-changed'));
};

export const clearSession = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  window.dispatchEvent(new Event('parser-auth-changed'));
};

export const isSessionValid = (session: AuthSession | null) => {
  if (!session?.access_token) return false;
  if (!session.expires_at) return true;
  const now = Math.floor(Date.now() / 1000);
  return session.expires_at - 30 > now;
};
