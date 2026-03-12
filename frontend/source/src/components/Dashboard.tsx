import { useEffect, useMemo, useState } from 'react';
import { Button } from './ui/button';
import { AlertCircle, ArrowRight, Clock3, Sparkles } from 'lucide-react';
import { useTenders } from '../context/TendersContext';
import { formatCurrency, decodeHtmlEntities, getTenderDisplayTitle } from '../types/tender';
import { apiRequest } from '../lib/api';

type DashboardPage =
  | 'dashboard'
  | 'search'
  | 'details'
  | 'profile'
  | 'saved-searches'
  | 'favorites'
  | 'kanban';

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

type KanbanRow = { object_number: string; status: string };

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

function daysLeft(enddt?: string | null) {
  if (!enddt) return null;
  const now = Date.now();
  const diff = new Date(enddt).getTime() - now;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatPriceCompact(amount: number) {
  if (!Number.isFinite(amount)) return '0';
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  return `${Math.round(amount).toLocaleString('ru-RU')}`;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const { tenders, loading, error, refresh } = useTenders();
  const [favoritesCount, setFavoritesCount] = useState(0);
  const [kanbanRows, setKanbanRows] = useState<KanbanRow[]>([]);

  const activeCount = useMemo(
    () =>
      tenders.filter(
        (tender) =>
          tender.etap_zakupki &&
          ['прием заявок', 'подача заявок', 'принимаются заявки'].some((status) =>
            tender.etap_zakupki?.toLowerCase().includes(status),
          ),
      ).length,
    [tenders],
  );

  const totalAmount = useMemo(() => tenders.reduce((sum, tender) => sum + (tender.maxprice ?? 0), 0), [tenders]);

  const expiringSoon = useMemo(() => {
    return tenders
      .map((tender) => ({ tender, left: daysLeft(tender.enddt) }))
      .filter((item) => item.left !== null && item.left >= 0 && item.left <= 7)
      .sort((a, b) => (a.left ?? 0) - (b.left ?? 0))
      .slice(0, 8);
  }, [tenders]);

  useEffect(() => {
    let mounted = true;
    const loadUserStats = async () => {
      try {
        const [favoritesRows, kanban] = await Promise.all([
          apiRequest<Array<{ object_number: string }>>('favorites'),
          apiRequest<Array<{ object_number: string; status: string }>>('kanban'),
        ]);
        if (!mounted) return;
        setFavoritesCount((favoritesRows || []).length);
        setKanbanRows(Array.isArray(kanban) ? kanban : []);
      } catch {
        if (!mounted) return;
        setFavoritesCount(0);
        setKanbanRows([]);
      }
    };
    void loadUserStats();
    return () => {
      mounted = false;
    };
  }, []);

  const kanbanByStatus = useMemo(() => {
    const groups: Record<string, string[]> = {
      backlog: [],
      in_progress: [],
      docs: [],
      review: [],
      done: [],
    };

    for (const row of kanbanRows) {
      if (!row?.object_number || !row?.status) continue;
      if (!groups[row.status]) groups[row.status] = [];
      groups[row.status].push(row.object_number);
    }
    return groups;
  }, [kanbanRows]);

  const previewColumns = useMemo(
    () => [
      { id: 'backlog', label: 'АНАЛИЗ', accent: '#6f7787' },
      { id: 'in_progress', label: 'ПОДГОТОВКА', accent: '#4c7fdf' },
      { id: 'docs', label: 'ПОДАНО', accent: '#dd7d39' },
      { id: 'done', label: 'РЕЗУЛЬТАТ', accent: '#4fb37e' },
    ],
    [],
  );

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
      if (!current.name && parsed.name) current.name = parsed.name;
      map.set(parsed.code, current);
    }

    const sorted = Array.from(map.values()).sort((a, b) => b.amount - a.amount || b.count - a.count);
    const amountTotal = sorted.reduce((sum, item) => sum + item.amount, 0);

    return sorted.slice(0, 5).map((item) => ({
      ...item,
      share: amountTotal > 0 ? Number(((item.amount / amountTotal) * 100).toFixed(1)) : 0,
    }));
  }, [tenders]);

  return (
    <div className="space-y-5">
      {error ? (
        <div className="surface-card flex items-start gap-3 border-[#f4b08a] bg-[#fff4eb] px-4 py-3 text-[#b74f16]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="text-sm">
            <div className="font-semibold">Не удалось обновить данные</div>
            <button type="button" onClick={() => refresh()} className="mt-1 underline">
              Повторить загрузку
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="soft-card px-4 py-3">
          <div className="text-[14px] text-[#3d4350]">Новых за сегодня</div>
          <div className="mt-1 flex items-end justify-between">
            <div className="text-[24px] leading-7 font-extrabold text-[#1d202c]">{activeCount}</div>
            <div className="text-[12px] text-[#6b7280]">+11.7%</div>
          </div>
        </div>
        <div className="soft-card px-4 py-3">
          <div className="text-[14px] text-[#3d4350]">В избранном</div>
          <div className="mt-1 flex items-end justify-between">
            <div className="text-[24px] leading-7 font-extrabold text-[#1d202c]">{favoritesCount}</div>
            <div className="text-right text-[12px] leading-4 text-[#6b7280]">
              в канбане: {kanbanRows.length}
            </div>
          </div>
        </div>
        <div className="soft-card px-4 py-3">
          <div className="text-[14px] text-[#3d4350]">Срок подачи &lt;5 дней</div>
          <div className="mt-1 flex items-end justify-between">
            <div className="text-[24px] leading-7 font-extrabold text-[#1d202c]">{expiringSoon.filter((item) => (item.left ?? 10) <= 5).length}</div>
            <div className="text-right text-[12px] leading-4 text-[#ef4d1f]">требуют действий!</div>
          </div>
        </div>
        <div className="soft-card px-4 py-3">
          <div className="text-[14px] text-[#3d4350]">Сумма в работе</div>
          <div className="mt-1 flex items-end justify-between">
            <div className="text-[24px] leading-7 font-extrabold text-[#1d202c]">{formatPriceCompact(totalAmount)}</div>
            <div className="text-[12px] text-[#6b7280]">+8.01%</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <section className="surface-card p-3">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[24px] font-extrabold text-[#303744]">Канбан-доска тендеров</h2>
              <Button
                type="button"
                onClick={() => onNavigate('kanban')}
                className="h-10 rounded-full bg-[#2da36b] px-5 text-[14px] font-bold text-white hover:bg-[#248e5c]"
              >
                Канбан <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {previewColumns.map((column) => {
                const ids = (kanbanByStatus[column.id] || []).slice(0, 4);
                return (
                  <div key={column.id} className="rounded-[12px] border border-[#d8dee8] bg-[#f2f5fa] p-2">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-[10px] font-extrabold uppercase tracking-[0.04em]" style={{ color: column.accent }}>
                        {column.label}
                      </div>
                      <div className="rounded-full bg-[#dde3ea] px-2 py-0.5 text-[10px] font-semibold text-[#5f6773]">{(kanbanByStatus[column.id] || []).length}</div>
                    </div>
                    <div className="space-y-2">
                      {ids.length === 0 ? (
                        <div className="rounded-[10px] border border-[#e1e5ec] bg-white px-2 py-3 text-[12px] text-[#9096a2]">Нет карточек</div>
                      ) : (
                        ids.map((id) => {
                          const tender = tenders.find((item) => item.object_number === id);
                          return (
                            <div key={id} className="rounded-[10px] border border-[#dce1ea] bg-white px-2 py-2">
                              <div className="mb-1 inline-flex rounded-[5px] bg-[#444b5b] px-1.5 py-0.5 text-[10px] text-white">
                                {tender?.zakon || '—'}
                              </div>
                              <div className="line-clamp-2 text-[12px] leading-4 text-[#2e3340]">{tender ? getTenderDisplayTitle(tender) : `Тендер ${id}`}</div>
                              <div className="mt-1 flex items-center justify-between text-[12px]">
                                <span className="font-bold text-[#2e3340]">{tender ? formatCurrency(tender.maxprice, tender.currency_code).replace(' RUB', '') : '—'}</span>
                                <span className="text-[#9aa1ad]">{tender?.enddt ? new Date(tender.enddt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : ''}</span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="surface-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[24px] leading-7 font-extrabold text-[#303744]">Топ ОКПД-2 сегментов</h2>
              <Button type="button" onClick={() => onNavigate('search')} className="h-10 rounded-full bg-[#2da36b] px-5 text-[14px] font-bold text-white hover:bg-[#248e5c]">
                Все тендеры <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>

            {loading ? (
              <p className="text-[14px] text-[#8f959f]">Загрузка статистики...</p>
            ) : topIndustries.length === 0 ? (
              <p className="text-[14px] text-[#8f959f]">Нет данных по отраслям.</p>
            ) : (
              <div className="space-y-2">
                {topIndustries.map((item) => (
                  <div key={item.code} className="rounded-[10px] border border-[#dde2ea] bg-[#f7f9fc] px-3 py-2">
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[14px] font-bold text-[#2f3644]">ОКПД {item.code}</div>
                        <div className="truncate text-[12px] text-[#767d89]">{item.name || 'Расшифровка не указана'}</div>
                      </div>
                      <div className="text-[12px] font-semibold text-[#2f3644]">{item.share.toFixed(1)}%</div>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#e2e7ef]">
                      <div className="h-2 rounded-full bg-[#4a8fd6]" style={{ width: `${item.share}%` }} />
                    </div>
                    <div className="mt-1 text-[12px] text-[#5f6673]">Сумма: {formatCurrency(item.amount, 'RUB')}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-4">
          <section className="surface-card overflow-hidden bg-[#1d2234] p-4 text-white">
            <div className="mb-2 flex items-center gap-2 text-[16px] font-bold">
              <Sparkles className="h-4 w-4 text-[#2ebd78]" />
              ИИ-Ассистент
            </div>
            <p className="text-[12px] text-[#9ca5b8]">Анализ документов и консультации</p>
            <div className="mt-3 rounded-[10px] border border-[#323a51] bg-[#2a3147] px-3 py-2 text-[12px] text-[#a5aec2]">
              Документы тендера обработаны. Изучить требования?
            </div>
            <Button
              type="button"
              onClick={() => onNavigate('favorites')}
              className="mt-4 h-10 w-full rounded-full bg-[#2da36b] text-[14px] font-bold text-white hover:bg-[#248e5c]"
            >
              К избранным тендерам <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </section>

          <section className="surface-card p-3">
            <h2 className="mb-2 text-[24px] leading-7 font-extrabold text-[#303744]">Ближайшие дедлайны</h2>
            {expiringSoon.length === 0 ? (
              <p className="text-[14px] text-[#8f959f]">Пока нет тендеров с дедлайном в ближайшие 7 дней.</p>
            ) : (
              <div className="space-y-2">
                {expiringSoon.map(({ tender, left }) => {
                  const isCritical = (left ?? 100) <= 2;
                  const isWarning = (left ?? 100) <= 5 && !isCritical;
                  const color = isCritical ? '#f06565' : isWarning ? '#e39a58' : '#5b85d4';
                  return (
                    <button
                      key={tender.object_number}
                      type="button"
                      onClick={() => onNavigate('details', tender.object_number)}
                      className="w-full rounded-[10px] border bg-white px-2 py-2 text-left"
                      style={{ borderColor: color }}
                    >
                      <div className="line-clamp-1 text-[12px] font-semibold text-[#343b48]">{getTenderDisplayTitle(tender)}</div>
                      <div className="mt-1 flex items-center justify-between">
                        <div className="text-[14px] font-bold text-[#2da36b]">{formatCurrency(tender.maxprice, tender.currency_code).replace(' RUB', '')}</div>
                        <div className="flex items-center gap-1 text-[12px] text-[#7d8592]">
                          <Clock3 className="h-3.5 w-3.5" />
                          {left}д
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      
    </div>
  );
}
