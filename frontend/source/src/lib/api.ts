import { clearSession, isSessionValid, loadSession } from './auth';

type RequestOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
};

const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export function buildApiUrl(path: string) {
  const base = apiBase.replace(/\/+$/, '');
  const cleaned = path.replace(/^\/+/, '');
  return new URL(`${base}/${cleaned}`, window.location.origin).toString();
}

export function getAuthHeaders() {
  const session = loadSession();
  if (session && !isSessionValid(session)) {
    clearSession();
    return {};
  }
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = buildApiUrl(path);
  const response = await fetch(url, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    if (response.status === 401) {
      // Session expired or invalid JWT.
      clearSession();
      throw new Error('Сессия истекла. Войдите снова.');
    }
    const message = data && typeof data.error === 'string' ? data.error : response.statusText;
    throw new Error(message || 'Request failed.');
  }

  return data as T;
}
