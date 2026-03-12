import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import {
  FileText,
  Clock,
  AlertCircle,
  DollarSign,
  ArrowUpRight,
  Sparkles,
  TrendingUp,
  BarChart3,
} from 'lucide-react';
import { useTenders } from '../context/TendersContext';
import { formatCurrency, decodeHtmlEntities } from '../types/tender';
import { apiRequest } from '../lib/api';

type DashboardPage =
  | 'dashboard'
  | 'search'
  | 'details'
  | 'profile'
  | 'saved-searches'
  | 'favorites';

interface DashboardProps {
  onNavigate: (page: DashboardPage, tenderId?: string) => void;
}

type IndustryStat = {
  code: string;
  name: string;
  count: number;
  amount: number;
  share: number;
};

const OKPD_PATTERN = /(\d{2}(?:\.\d{1,3}){1,3})/;

function normalizeOkpdGroup(codeRaw: string) {
  const parts = codeRaw
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0].padStart(2, '0')}.${parts[1].padStart(2, '0')}`;
}

function parseOkpdValue(value?: string | null) {
  if (!value) return null;
  const decoded = decodeHtmlEntities(String(value)).trim();
  if (!decoded) return null;

  const codeMatch = decoded.match(OKPD_PATTERN);
  if (!codeMatch) return null;

  const code = normalizeOkpdGroup(codeMatch[1]);
  if (!code) return null;

  const remainder = decoded.slice(codeMatch.index! + codeMatch[1].length).trim();
  const name = remainder
    .replace(/^[-–—:\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { code, name };
}

function resolveTenderOkpd(tender: Record<string, unknown>) {
  const directCandidates = [
    tender.okpd2info as string | undefined,
    tender.industry_okpd2 as string | undefined,
  ];

  for (const candidate of directCandidates) {
    const parsed = parseOkpdValue(candidate);
    if (parsed) return parsed;
  }

  const items = Array.isArray(tender.items) ? (tender.items as Array<Record<string, unknown>>) : [];
  for (const item of items) {
    const code = (item.okpdcode as string | undefined)?.trim();
    const name = (item.okpdname as string | undefined)?.trim();
    if (!code) continue;
    const normalized = normalizeOkpdGroup(code);
    if (!normalized) continue;
    return {
      code: normalized,
      name: decodeHtmlEntities(name || '').trim(),
    };
  }

  return null;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const { tenders, loading, error, refresh } = useTenders();
  const [favoritesCount, setFavoritesCount] = useState(0);
  const [kanbanCount, setKanbanCount] = useState(0);
  const [kanbanInWorkCount, setKanbanInWorkCount] = useState(0);
  const [kanbanDoneCount, setKanbanDoneCount] = useState(0);

  const activeCount = useMemo(
    () =>
      tenders.filter(
        (tender) =>
          tender.etap_zakupki &&
          ['прием заявок', 'подача заявок', 'принимаются заявки'].some((status) =>
            tender.etap_zakupki?.toLowerCase().includes(status)
          )
      ).length,
    [tenders]
  );

  const totalAmount = useMemo(
    () => tenders.reduce((sum, tender) => sum + (tender.maxprice ?? 0), 0),
    [tenders]
  );

  const expiringSoonCount = useMemo(() => {
    const now = Date.now();
    return tenders.filter((tender) => {
      if (!tender.enddt) return false;
      const daysLeft = Math.ceil((new Date(tender.enddt).getTime() - now) / (1000 * 60 * 60 * 24));
      return daysLeft >= 0 && daysLeft <= 5;
    }).length;
  }, [tenders]);

  const numberFormatter = useMemo(() => new Intl.NumberFormat('ru-RU'), []);

  useEffect(() => {
    let mounted = true;
    const loadUserStats = async () => {
      try {
        const [favoritesRows, kanbanRows] = await Promise.all([
          apiRequest<Array<{ object_number: string }>>('favorites'),
          apiRequest<Array<{ object_number: string; status: string }>>('kanban'),
        ]);
        if (!mounted) return;
        const favorites = Array.isArray(favoritesRows) ? favoritesRows : [];
        const kanban = Array.isArray(kanbanRows) ? kanbanRows : [];
        const inWorkStatuses = new Set(['in_progress', 'docs', 'review']);
        setFavoritesCount(favorites.length);
        setKanbanCount(kanban.length);
        setKanbanInWorkCount(
          kanban.filter((row) => inWorkStatuses.has((row.status || '').trim())).length
        );
        setKanbanDoneCount(
          kanban.filter((row) => (row.status || '').trim() === 'done').length
        );
      } catch {
        if (!mounted) return;
        setFavoritesCount(0);
        setKanbanCount(0);
        setKanbanInWorkCount(0);
        setKanbanDoneCount(0);
      }
    };
    loadUserStats();
    return () => {
      mounted = false;
    };
  }, []);

  const topIndustries = useMemo(() => {
    const map = new Map<string, IndustryStat>();
    for (const tender of tenders) {
      const parsed = resolveTenderOkpd(tender as unknown as Record<string, unknown>);
      if (!parsed) continue;
      const current = map.get(parsed.code) ?? {
        code: parsed.code,
        name: parsed.name,
        count: 0,
        amount: 0,
        share: 0,
      };
      current.count += 1;
      current.amount += tender.maxprice ?? 0;
      if (!current.name && parsed.name) {
        current.name = parsed.name;
      }
      map.set(parsed.code, current);
    }

    const sorted = Array.from(map.values()).sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return b.count - a.count;
    });

    const totalAmount = sorted.reduce((sum, item) => sum + item.amount, 0);
    const top = sorted.slice(0, 10).map((item) => ({
      ...item,
      share: totalAmount > 0 ? Number(((item.amount / totalAmount) * 100).toFixed(1)) : 0,
    }));

    return top;
  }, [tenders]);

  return (
    <div className="space-y-6">
      <Card className="rounded-[20px] border-border/80 bg-white shadow-[0_18px_40px_-28px_rgba(15,23,42,0.2)]">
        <CardContent className="p-6 md:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Личная статистика
              </div>
              <div>
                <h1>Дашборд тендеров</h1>
                <p className="text-muted-foreground mt-1">
                  Ваше текущее состояние по избранному, канбану и аналитике отраслей.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="rounded-2xl border border-border/70 bg-white px-4 py-2.5">
                  <p className="text-xs text-muted-foreground">В избранном</p>
                  <p className="text-base font-semibold">{numberFormatter.format(favoritesCount)}</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-white px-4 py-2.5">
                  <p className="text-xs text-muted-foreground">В канбане</p>
                  <p className="text-base font-semibold">{numberFormatter.format(kanbanCount)}</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-white px-4 py-2.5">
                  <p className="text-xs text-muted-foreground">В работе</p>
                  <p className="text-base font-semibold">{numberFormatter.format(kanbanInWorkCount)}</p>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Button onClick={() => onNavigate('search')} className="gap-2">
                <ArrowUpRight className="w-4 h-4" />
                Перейти к поиску
              </Button>
              <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-white px-4 py-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-50 text-orange-600">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-medium">Завершено в канбане</p>
                  <p className="text-xs text-muted-foreground">
                    {kanbanDoneCount > 0
                      ? `${kanbanDoneCount} тендеров в статусе «Завершено»`
                      : 'Пока нет завершенных тендеров'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert className="grid-cols-[auto_1fr] items-start border-orange-300 bg-orange-50 text-orange-700">
          <AlertCircle />
          <div>
            <AlertTitle>Не удалось обновить данные</AlertTitle>
            <AlertDescription>
              {error}{' '}
              <Button variant="link" size="sm" className="px-0 align-baseline" onClick={() => refresh()}>
                Повторить загрузку
              </Button>
            </AlertDescription>
          </div>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-border/70 bg-white/80">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Статистика по отраслям
                </CardTitle>
                <CardDescription>Крупнейшие отрасли по ОКПД и их доля по сумме НМЦК</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Загрузка статистики...</p>
            ) : topIndustries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет данных по отраслям.</p>
            ) : (
              <div className="space-y-3">
                {topIndustries.map((item) => {
                  const width = item.share;
                  return (
                    <div key={item.code} className="rounded-xl border border-border/70 bg-white p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium leading-snug">ОКПД {item.code}</p>
                          <p className="text-xs text-muted-foreground leading-snug">
                            {item.name || 'Расшифровка не указана'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">{item.share.toFixed(1)}%</p>
                        </div>
                      </div>
                      <div className="h-2.5 rounded-full bg-slate-200/80 overflow-hidden">
                        <div
                          className="h-2.5 rounded-full bg-blue-600 transition-all duration-300"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Сумма: {formatCurrency(item.amount, 'RUB')}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-border/70 bg-white/80">
            <CardHeader>
              <CardTitle>Быстрые действия</CardTitle>
              <CardDescription>Основные сценарии для старта</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => onNavigate('search')}>
                <FileText className="h-4 w-4" />
                Открыть поиск тендеров
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => onNavigate('favorites')}>
                <TrendingUp className="h-4 w-4" />
                Посмотреть избранное
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => onNavigate('profile')}>
                <DollarSign className="h-4 w-4" />
                Профиль и организация
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
