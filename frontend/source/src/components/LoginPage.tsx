import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { FileText } from 'lucide-react';
import { saveSession } from '../lib/auth';

interface LoginPageProps {
  onLogin: () => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    try {
      const apiBase =
        (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
      const apiUrl = new URL(
        `${apiBase.replace(/\/+$/, '')}/login`,
        window.location.origin
      );

      const response = await fetch(apiUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginEmail.trim(),
          password: loginPassword,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : 'Неверный логин или пароль.';
        throw new Error(message);
      }

      const expiresIn =
        typeof payload?.expires_in === 'number' ? payload.expires_in : 3600;
      const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
      if (!payload?.access_token) {
        throw new Error('Сервер не вернул токен.');
      }
      saveSession({
        access_token: payload.access_token,
        expires_at: expiresAt,
      });
      onLogin();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Не удалось войти.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center shadow-[0_12px_24px_-16px_rgba(31,60,136,0.6)]">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div className="text-left">
              <h1 className="text-foreground">Тендер.Поиск</h1>
              <p className="text-xs text-muted-foreground">
                Внутренний стенд
              </p>
            </div>
          </div>
          <p className="text-muted-foreground">
            Парсер и поиск тендеров zakupki.gov.ru
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Вход в систему</CardTitle>
            <CardDescription>
              Введите email и пароль для входа
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="name@example.com"
                  autoComplete="username"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Пароль</Label>
                <Input
                  id="login-password"
                  type="password"
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                />
              </div>
              {formError ? (
                <div className="text-sm text-red-600">{formError}</div>
              ) : null}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Входим...' : 'Войти'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
