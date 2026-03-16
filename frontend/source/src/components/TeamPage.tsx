import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { clearSession, isSessionValid, loadSession } from '../lib/auth';

type TeamPayload = {
  staff_specialists?: string[];
  staff_lawyers?: string[];
};

export function TeamPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamPayload>({});

  const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

  useEffect(() => {
    let isMounted = true;

    const fetchProfile = async () => {
      try {
        const session = loadSession();
        if (!session || !isSessionValid(session)) {
          if (session) clearSession();
          throw new Error('Нет активной сессии.');
        }

        const apiUrl = new URL(`${apiBase.replace(/\/+$/, '')}/profile`, window.location.origin);
        const response = await fetch(apiUrl.toString(), {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          const message = typeof payload?.error === 'string' ? payload.error : 'Не удалось загрузить команду.';
          throw new Error(message);
        }

        if (isMounted) {
          setTeam({
            staff_specialists: Array.isArray(payload?.staff_specialists) ? payload.staff_specialists : [],
            staff_lawyers: Array.isArray(payload?.staff_lawyers) ? payload.staff_lawyers : [],
          });
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(error instanceof Error ? error.message : 'Ошибка загрузки команды.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void fetchProfile();
    return () => {
      isMounted = false;
    };
  }, [apiBase]);

  const updateListField = (field: keyof TeamPayload, value: string) => {
    const items = value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
    setTeam((prev) => ({ ...prev, [field]: items }));
  };

  const handleSave = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setSaveMessage(null);
    setErrorMessage(null);
    setIsSaving(true);

    try {
      const session = loadSession();
      if (!session || !isSessionValid(session)) {
        if (session) clearSession();
        throw new Error('Нет активной сессии.');
      }

      const apiUrl = new URL(`${apiBase.replace(/\/+$/, '')}/profile`, window.location.origin);
      const response = await fetch(apiUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(team),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : 'Не удалось сохранить команду.';
        throw new Error(message);
      }

      setTeam({
        staff_specialists: Array.isArray(payload?.staff_specialists) ? payload.staff_specialists : [],
        staff_lawyers: Array.isArray(payload?.staff_lawyers) ? payload.staff_lawyers : [],
      });
      setSaveMessage('Команда сохранена.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Ошибка сохранения команды.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1>Команда</h1>
        <p className="mt-1 text-muted-foreground">
          Управление юристами и менеджерами, доступными для назначения в тендерах
        </p>
      </div>

      <Card className="border-border/70 bg-white/80">
        <CardHeader>
          <CardTitle>Сотрудники</CardTitle>
          <CardDescription>
            Один сотрудник в строке. Эти списки используются в карточке тендера и на дашборде.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={handleSave}>
            {isLoading ? <p className="text-sm text-muted-foreground">Загружаем команду...</p> : null}
            {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="team_specialists">Менеджеры</Label>
                <Textarea
                  id="team_specialists"
                  placeholder="Иванов Иван&#10;Петров Петр"
                  value={(team.staff_specialists || []).join('\n')}
                  onChange={(e) => updateListField('staff_specialists', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="team_lawyers">Юристы</Label>
                <Textarea
                  id="team_lawyers"
                  placeholder="Сидорова Анна&#10;Кузнецов Дмитрий"
                  value={(team.staff_lawyers || []).join('\n')}
                  onChange={(e) => updateListField('staff_lawyers', e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Сохраняем...' : 'Сохранить'}
              </Button>
              {saveMessage ? <span className="text-sm text-muted-foreground">{saveMessage}</span> : null}
              {errorMessage ? <span className="text-sm text-red-600">{errorMessage}</span> : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
