import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Avatar, AvatarFallback } from './ui/avatar';
import { clearSession, isSessionValid, loadSession } from '../lib/auth';

type ProfilePayload = {
  email?: string;
  role?: string;
  user_name?: string;
  user_phone?: string;
  company_name?: string;
  company_inn?: string;
  company_kpp?: string;
  company_ogrn?: string;
  industry?: string;
  region?: string;
  okved?: string;
  keywords?: string;
  company_description?: string;
  staff_specialists?: string[];
  staff_lawyers?: string[];
};

export function ProfilePage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfilePayload>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
        const token = session.access_token;
        const apiUrl = new URL(`${apiBase.replace(/\/+$/, '')}/profile`, window.location.origin);
        const response = await fetch(apiUrl.toString(), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = typeof payload?.error === 'string' ? payload.error : 'Не удалось загрузить профиль.';
          throw new Error(message);
        }
        if (isMounted) {
          setProfile(payload as ProfilePayload);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(error instanceof Error ? error.message : 'Ошибка загрузки профиля.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchProfile();
    return () => {
      isMounted = false;
    };
  }, [apiBase]);

  const updateField = (field: keyof ProfilePayload, value: string) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
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
      const token = session.access_token;
      const apiUrl = new URL(`${apiBase.replace(/\/+$/, '')}/profile`, window.location.origin);
      const response = await fetch(apiUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(profile),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : 'Не удалось сохранить профиль.';
        throw new Error(message);
      }
      setProfile(payload as ProfilePayload);
      setSaveMessage('Данные сохранены.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Ошибка сохранения.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1>Профиль</h1>
        <p className="text-muted-foreground mt-1">
          Минимальные данные аккаунта и организации для персонализации поиска
        </p>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="w-full max-w-md">
          <TabsTrigger value="profile">
            Профиль
          </TabsTrigger>
          <TabsTrigger value="company">
            Организация
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <Card className="bg-white/80 border-border/70">
            <CardHeader>
              <CardTitle>Аккаунт</CardTitle>
              <CardDescription>Базовые данные пользователя</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <form className="space-y-6" onSubmit={handleSave}>
                <div className="flex items-center gap-4">
                  <Avatar className="w-16 h-16">
                    <AvatarFallback className="text-xl">ИИ</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-base font-medium text-foreground">
                      {profile.user_name || 'Пользователь'}
                    </p>
                    <p className="text-sm text-muted-foreground">Роль: {profile.role || 'user'}</p>
                  </div>
                </div>

              {isLoading ? (
                <p className="text-sm text-muted-foreground">Загружаем профиль...</p>
              ) : null}
                {errorMessage ? (
                  <p className="text-sm text-red-600">{errorMessage}</p>
                ) : null}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" value={profile.email || ''} readOnly />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Телефон</Label>
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="+7 (___) ___-__-__"
                      value={profile.user_phone || ''}
                      onChange={(e) => updateField('user_phone', e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={isSaving}>
                    {isSaving ? 'Сохраняем...' : 'Сохранить'}
                  </Button>
                  {saveMessage ? (
                    <span className="text-sm text-muted-foreground">{saveMessage}</span>
                  ) : null}
                  {errorMessage ? (
                    <span className="text-sm text-red-600">{errorMessage}</span>
                  ) : null}
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="company" className="space-y-6">
          <Card className="bg-white/80 border-border/70">
            <CardHeader>
              <CardTitle>Информация об организации</CardTitle>
              <CardDescription>
                Используем для персонализации поиска и рекомендаций
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-5" onSubmit={handleSave}>
                <div className="space-y-2">
                  <Label htmlFor="companyName">Наименование организации</Label>
                  <Input
                    id="companyName"
                    placeholder="ООО «Торговый Дом»"
                    value={profile.company_name || ''}
                    onChange={(e) => updateField('company_name', e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="inn">ИНН</Label>
                    <Input
                      id="inn"
                      placeholder="7701234567"
                      value={profile.company_inn || ''}
                      onChange={(e) => updateField('company_inn', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="kpp">КПП</Label>
                    <Input
                      id="kpp"
                      placeholder="770101001"
                      value={profile.company_kpp || ''}
                      onChange={(e) => updateField('company_kpp', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ogrn">ОГРН</Label>
                    <Input
                      id="ogrn"
                      placeholder="1027700123456"
                      value={profile.company_ogrn || ''}
                      onChange={(e) => updateField('company_ogrn', e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="industry">Отрасль</Label>
                    <Input
                      id="industry"
                      placeholder="Строительство, ИТ, медицина…"
                      value={profile.industry || ''}
                      onChange={(e) => updateField('industry', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="region">Регион работы</Label>
                    <Input
                      id="region"
                      placeholder="Москва, ЦФО, вся РФ"
                      value={profile.region || ''}
                      onChange={(e) => updateField('region', e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="okved">ОКВЭД / специализация</Label>
                  <Input
                    id="okved"
                    placeholder="42.11, 62.01…"
                    value={profile.okved || ''}
                    onChange={(e) => updateField('okved', e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="keywords">Ключевые направления (для поиска)</Label>
                  <Textarea
                    id="keywords"
                    placeholder="Например: вентиляция, медоборудование, ПО, обслуживание"
                    value={profile.keywords || ''}
                    onChange={(e) => updateField('keywords', e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="companyDescription">Описание компании</Label>
                  <Textarea
                    id="companyDescription"
                    placeholder="Коротко о деятельности компании"
                    value={profile.company_description || ''}
                    onChange={(e) => updateField('company_description', e.target.value)}
                  />
                </div>

                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={isSaving}>
                    {isSaving ? 'Сохраняем...' : 'Сохранить'}
                  </Button>
                  {saveMessage ? (
                    <span className="text-sm text-muted-foreground">{saveMessage}</span>
                  ) : null}
                  {errorMessage ? (
                    <span className="text-sm text-red-600">{errorMessage}</span>
                  ) : null}
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
