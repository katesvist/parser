import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Clock3, Eye, MoveUpRight, Sparkles } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { useTenders } from '../context/TendersContext';
import { apiRequest } from '../lib/api';
import { loadTenderDetailsMap } from '../lib/tender-details';
import { decodeHtmlEntities, formatCurrency, formatDate, getTenderDisplayTitle, type Tender } from '../types/tender';

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

type KanbanRow = { object_number: string; status: string };
type FavoriteRow = { object_number: string };
type AssignmentRow = {
  object_number: string;
  specialist_name?: string | null;
  lawyer_name?: string | null;
};

type IndustryStat = {
  code: string;
  name: string;
  count: number;
  amount: number;
  share: number;
};

type TeamMember = {
  name: string;
  role: string;
  count: number;
};

type DeadlineGroup = {
  key: 'lt2' | 'lt5' | 'lt7';
  label: string;
  max: number;
  accent: string;
  border: string;
  bg: string;
};

const OKPD_PATTERN = /(\d{2}(?:\.\d{1,3}){1,3})/;

const DEADLINE_GROUPS: DeadlineGroup[] = [
  {
    key: 'lt2',
    label: 'Менее 2 дней',
    max: 2,
    accent: '#e54c4c',
    border: '#efb0b0',
    bg: '#fff8f8',
  },
  {
    key: 'lt5',
    label: 'Менее 5 дней',
    max: 5,
    accent: '#da8530',
    border: '#f0c28f',
    bg: '#fffbf5',
  },
  {
    key: 'lt7',
    label: 'Менее 7 дней',
    max: 7,
    accent: '#4c7fdf',
    border: '#b9ccf3',
    bg: '#f7faff',
  },
];

const INDUSTRY_COLORS = ['#101218', '#ef4d1f', '#4a93d8', '#9aa7c0', '#667da5'];
const TEAM_COLORS = ['#4a93d8', '#26b36a', '#7c4dff', '#e85b45', '#8f9aa8'];

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

function sameDay(dateRaw?: string | null) {
  if (!dateRaw) return false;
  const date = new Date(dateRaw);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function formatPriceCompact(amount: number) {
  if (!Number.isFinite(amount)) return '0';
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  return `${Math.round(amount).toLocaleString('ru-RU')}`;
}

function getInitials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) return 'П';
  return parts.map((part) => part[0]?.toUpperCase() || '').join('');
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const { tenders, loading, error, refresh } = useTenders();

  const [favoritesRows, setFavoritesRows] = useState<FavoriteRow[]>([]);
  const [kanbanRows, setKanbanRows] = useState<KanbanRow[]>([]);
  const [assignmentRows, setAssignmentRows] = useState<AssignmentRow[]>([]);
  const [profileStaff, setProfileStaff] = useState<{ specialists: string[]; lawyers: string[] }>({
    specialists: [],
    lawyers: [],
  });

  const [trackedDetails, setTrackedDetails] = useState<Record<string, Tender>>({});
  const [trackedDetailsLoading, setTrackedDetailsLoading] = useState(false);
  const unresolvedTrackedRef = useRef<Set<string>>(new Set());

  const tendersByObject = useMemo(() => {
    const map: Record<string, Tender> = {};
    tenders.forEach((tender) => {
      map[tender.object_number] = tender;
    });
    return map;
  }, [tenders]);

  useEffect(() => {
    let mounted = true;

    const loadUserData = async () => {
      try {
        const [favoritesRes, kanbanRes, assignmentsRes, profileRes] = await Promise.allSettled([
          apiRequest<FavoriteRow[]>('favorites'),
          apiRequest<KanbanRow[]>('kanban'),
          apiRequest<AssignmentRow[]>('assignments'),
          apiRequest<{
            staff_specialists?: string[];
            staff_lawyers?: string[];
          }>('profile'),
        ]);

        if (!mounted) return;

        setFavoritesRows(
          favoritesRes.status === 'fulfilled' && Array.isArray(favoritesRes.value)
            ? favoritesRes.value
            : [],
        );

        setKanbanRows(
          kanbanRes.status === 'fulfilled' && Array.isArray(kanbanRes.value)
            ? kanbanRes.value
            : [],
        );

        setAssignmentRows(
          assignmentsRes.status === 'fulfilled' && Array.isArray(assignmentsRes.value)
            ? assignmentsRes.value
            : [],
        );

        if (profileRes.status === 'fulfilled' && profileRes.value) {
          const specialists = Array.isArray(profileRes.value.staff_specialists)
            ? profileRes.value.staff_specialists.filter((v) => typeof v === 'string' && v.trim())
            : [];
          const lawyers = Array.isArray(profileRes.value.staff_lawyers)
            ? profileRes.value.staff_lawyers.filter((v) => typeof v === 'string' && v.trim())
            : [];
          setProfileStaff({ specialists, lawyers });
        } else {
          setProfileStaff({ specialists: [], lawyers: [] });
        }
      } catch {
        if (!mounted) return;
        setFavoritesRows([]);
        setKanbanRows([]);
        setAssignmentRows([]);
        setProfileStaff({ specialists: [], lawyers: [] });
      }
    };

    void loadUserData();
    return () => {
      mounted = false;
    };
  }, []);

  const trackedIds = useMemo(() => {
    const ids = new Set<string>();
    favoritesRows.forEach((row) => {
      if (row?.object_number) ids.add(row.object_number);
    });
    kanbanRows.forEach((row) => {
      if (row?.object_number) ids.add(row.object_number);
    });
    return Array.from(ids);
  }, [favoritesRows, kanbanRows]);

  useEffect(() => {
    const activeIds = new Set(trackedIds);
    unresolvedTrackedRef.current = new Set(
      Array.from(unresolvedTrackedRef.current).filter((id) => activeIds.has(id)),
    );

    setTrackedDetails((prev) => {
      let changed = false;
      const next: Record<string, Tender> = {};
      for (const [id, tender] of Object.entries(prev)) {
        if (activeIds.has(id)) {
          next[id] = tender;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [trackedIds]);

  const missingTrackedIds = useMemo(() => {
    return trackedIds.filter(
      (id) => !tendersByObject[id] && !trackedDetails[id] && !unresolvedTrackedRef.current.has(id),
    );
  }, [trackedIds, tendersByObject, trackedDetails]);

  useEffect(() => {
    if (!missingTrackedIds.length) {
      setTrackedDetailsLoading(false);
      return;
    }

    let active = true;
    setTrackedDetailsLoading(true);

    (async () => {
      const loaded = await loadTenderDetailsMap(missingTrackedIds);
      if (!active) return;

      const loadedIds = new Set(Object.keys(loaded));
      for (const id of missingTrackedIds) {
        if (!loadedIds.has(id)) unresolvedTrackedRef.current.add(id);
      }

      if (loadedIds.size > 0) {
        setTrackedDetails((prev) => ({ ...prev, ...loaded }));
      }
      setTrackedDetailsLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [missingTrackedIds]);

  const trackedTenders = useMemo(() => {
    return trackedIds
      .map((id) => tendersByObject[id] ?? trackedDetails[id])
      .filter((tender): tender is Tender => Boolean(tender));
  }, [trackedIds, tendersByObject, trackedDetails]);

  const kanbanByStatus = useMemo(() => {
    const groups: Record<string, string[]> = {
      backlog: [],
      in_progress: [],
      docs: [],
      review: [],
      done: [],
    };

    kanbanRows.forEach((row) => {
      if (!row?.object_number || !row?.status) return;
      if (!groups[row.status]) groups[row.status] = [];
      groups[row.status].push(row.object_number);
    });

    return groups;
  }, [kanbanRows]);

  const openStatusCount = useMemo(
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

  const newTodayCount = useMemo(() => {
    const today = tenders.filter((tender) => sameDay(tender.startdt)).length;
    return today > 0 ? today : openStatusCount;
  }, [tenders, openStatusCount]);

  const kanbanNotInWork = useMemo(
    () =>
      kanbanRows.filter((row) => !['in_progress', 'docs', 'review'].includes((row.status || '').toLowerCase()))
        .length,
    [kanbanRows],
  );

  const urgentCount = useMemo(
    () => trackedTenders.filter((tender) => {
      const left = daysLeft(tender.enddt);
      return left !== null && left >= 0 && left <= 5;
    }).length,
    [trackedTenders],
  );

  const inWorkAmount = useMemo(() => {
    const workStatuses = new Set(['in_progress', 'docs', 'review']);
    const inWorkIds = new Set(
      kanbanRows
        .filter((row) => workStatuses.has((row.status || '').toLowerCase()))
        .map((row) => row.object_number),
    );

    const byIds = Array.from(inWorkIds)
      .map((id) => tendersByObject[id] ?? trackedDetails[id])
      .filter((tender): tender is Tender => Boolean(tender));

    const source = byIds.length > 0 ? byIds : trackedTenders;
    return source.reduce((sum, tender) => sum + (tender.maxprice ?? 0), 0);
  }, [kanbanRows, tendersByObject, trackedDetails, trackedTenders]);

  const dashboardColumns = useMemo(
    () => [
      { id: 'backlog', label: 'АНАЛИЗ', accent: '#6f7787', statuses: ['backlog'] },
      { id: 'in_progress', label: 'ПОДГОТОВКА', accent: '#4c7fdf', statuses: ['in_progress'] },
      { id: 'docs', label: 'ПОДАНО', accent: '#dd7d39', statuses: ['docs', 'review'] },
      { id: 'done', label: 'РЕЗУЛЬТАТ', accent: '#4fb37e', statuses: ['done'] },
    ],
    [],
  );

  const miniKanbanData = useMemo(() => {
    return dashboardColumns.map((column) => {
      const ids = column.statuses.flatMap((status) => kanbanByStatus[status] || []);
      const tendersList = ids
        .map((id) => tendersByObject[id] ?? trackedDetails[id])
        .filter((tender): tender is Tender => Boolean(tender));

      return {
        ...column,
        count: ids.length,
        tenders: tendersList.slice(0, 4),
      };
    });
  }, [dashboardColumns, kanbanByStatus, tendersByObject, trackedDetails]);

  const deadlineSections = useMemo(() => {
    const candidates = trackedTenders
      .map((tender) => ({ tender, left: daysLeft(tender.enddt) }))
      .filter((entry) => entry.left !== null && entry.left >= 0 && entry.left <= 7)
      .sort((a, b) => (a.left ?? 0) - (b.left ?? 0));

    return DEADLINE_GROUPS.map((group, index) => {
      const previousMax = index === 0 ? 0 : DEADLINE_GROUPS[index - 1].max;
      const items = candidates.filter((entry) => {
        const left = entry.left ?? 99;
        return left <= group.max && left > previousMax;
      });
      return {
        ...group,
        items,
      };
    }).filter((group) => group.items.length > 0);
  }, [trackedTenders]);

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
    const total = sorted.reduce((sum, item) => sum + item.amount, 0);

    return sorted.slice(0, 5).map((item) => ({
      ...item,
      share: total > 0 ? Number(((item.amount / total) * 100).toFixed(1)) : 0,
    }));
  }, [tenders]);

  const topIndustryLegend = useMemo(() => {
    return topIndustries.map((item, index) => ({
      ...item,
      color: INDUSTRY_COLORS[index % INDUSTRY_COLORS.length],
      label: item.name || `ОКПД ${item.code}`,
    }));
  }, [topIndustries]);

  const donutBackground = useMemo(() => {
    if (!topIndustryLegend.length) return 'conic-gradient(#d8dee7 0deg 360deg)';

    let start = 0;
    const segments: string[] = [];

    topIndustryLegend.forEach((item) => {
      const sweep = Math.max(0, Math.min(100, item.share)) * 3.6;
      const end = Math.min(360, start + sweep);
      segments.push(`${item.color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`);
      start = end;
    });

    if (start < 360) {
      segments.push(`#d8dee7 ${start.toFixed(2)}deg 360deg`);
    }

    return `conic-gradient(${segments.join(',')})`;
  }, [topIndustryLegend]);

  const teamMembers = useMemo(() => {
    const members = new Map<string, TeamMember>();

    for (const name of profileStaff.specialists) {
      members.set(name, { name, role: 'Тендерный специалист', count: 0 });
    }
    for (const name of profileStaff.lawyers) {
      members.set(name, {
        name,
        role: members.get(name)?.role || 'Юрист',
        count: members.get(name)?.count || 0,
      });
    }

    for (const row of assignmentRows) {
      const specialist = (row.specialist_name || '').trim();
      const lawyer = (row.lawyer_name || '').trim();

      if (specialist) {
        const prev = members.get(specialist) || { name: specialist, role: 'Тендерный специалист', count: 0 };
        members.set(specialist, { ...prev, count: prev.count + 1 });
      }

      if (lawyer) {
        const prev = members.get(lawyer) || { name: lawyer, role: 'Юрист', count: 0 };
        members.set(lawyer, { ...prev, role: 'Юрист', count: prev.count + 1 });
      }
    }

    return Array.from(members.values())
      .filter((member) => member.name.trim())
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'))
      .slice(0, 5);
  }, [assignmentRows, profileStaff]);

  return (
    <div className="mx-auto w-full max-w-[1251px] space-y-5">
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

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,901px)_330px]">
        <div className="min-w-0 space-y-5">
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex min-h-[108px] flex-col justify-between rounded-[18px] bg-[#d8dee6] px-5 py-5">
              <div className="mb-[6px] text-[14px] font-semibold text-[#2f3542]">Новых за сегодня</div>
              <div className="flex items-center justify-between">
                <div className="text-[20px] leading-none font-medium tracking-[-0.02em] text-[#1d202c]">{newTodayCount}</div>
                <div className="flex max-w-[80px] items-center gap-1 text-[12px] text-[#2f3542]">
                  <span>+11.7%</span>
                  <MoveUpRight className="h-3 w-3" />
                </div>
              </div>
            </div>

            <div className="flex min-h-[108px] flex-col justify-between rounded-[18px] bg-[#d8dee6] px-5 py-5">
              <div className="mb-[6px] text-[14px] font-semibold text-[#2f3542]">Тендеры в канбане</div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[20px] leading-none font-medium tracking-[-0.02em] text-[#1d202c]">{kanbanRows.length}</div>
                <div className="max-w-[80px] text-right text-[12px] leading-[1.3] text-[#2f3542]">{kanbanNotInWork} из них не в работе</div>
              </div>
            </div>

            <div className="flex min-h-[108px] flex-col justify-between rounded-[18px] bg-[#d8dee6] px-5 py-5">
              <div className="mb-[6px] text-[14px] font-semibold text-[#2f3542]">Срок подачи &lt;5 дней</div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[20px] leading-none font-medium tracking-[-0.02em] text-[#1d202c]">{urgentCount}</div>
                <div className="max-w-[80px] text-right text-[12px] leading-[1.3] text-[#ef4d1f]">требуют действий!</div>
              </div>
            </div>

            <div className="flex min-h-[108px] flex-col justify-between rounded-[18px] bg-[#d8dee6] px-5 py-5">
              <div className="mb-[6px] text-[14px] font-semibold text-[#2f3542]">Сумма в работе</div>
              <div className="flex items-center justify-between">
                <div className="text-[20px] leading-none font-medium tracking-[-0.02em] text-[#1d202c]">{formatPriceCompact(inWorkAmount)}</div>
                <div className="flex max-w-[80px] items-center gap-1 text-[12px] text-[#2f3542]">
                  <span>+8.01%</span>
                  <MoveUpRight className="h-3 w-3" />
                </div>
              </div>
            </div>
          </section>

          <section className="surface-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[16px] font-extrabold text-[#303744]">Канбан-доска тендеров</h2>
              <Button
                type="button"
                onClick={() => onNavigate('kanban')}
                className="h-8 rounded-full bg-[#2da36b] px-6 text-[12px] font-bold text-white hover:bg-[#248e5c]"
              >
                Канбан <ArrowRight className="ml-2 h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
              {miniKanbanData.map((column) => (
                <div key={column.id} className="rounded-[12px] border border-[#dbe1ea] bg-[#f4f7fb] p-2">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[10px] font-extrabold uppercase tracking-[0.04em]" style={{ color: column.accent }}>
                      {column.label}
                    </div>
                    <span className="rounded-full bg-[#dfe4eb] px-2 py-0.5 text-[10px] font-semibold text-[#596171]">
                      {column.count}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {loading || trackedDetailsLoading ? (
                      <div className="rounded-[10px] border border-[#e1e5ec] bg-white px-2 py-3 text-[12px] text-[#9096a2]">
                        Загрузка...
                      </div>
                    ) : column.tenders.length === 0 ? (
                      <div className="rounded-[10px] border border-[#e1e5ec] bg-white px-2 py-3 text-[12px] text-[#9096a2]">
                        Нет карточек
                      </div>
                    ) : (
                      column.tenders.map((tender) => (
                        <button
                          key={`${column.id}-${tender.object_number}`}
                          type="button"
                          onClick={() => onNavigate('details', tender.object_number)}
                          className="w-full rounded-[10px] border border-[#dde3eb] bg-white p-2 text-left transition hover:bg-[#f8fbff]"
                        >
                          <Badge className="mb-1 rounded-[5px] bg-[#444b5b] px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-[#444b5b]">
                            {tender.zakon || '—'}
                          </Badge>
                          <div className="line-clamp-2 text-[12px] leading-4 text-[#2f3542]">{getTenderDisplayTitle(tender)}</div>
                          <div className="mt-2 flex items-center justify-between text-[12px]">
                            <span className="font-bold text-[#2f3643]">{formatCurrency(tender.maxprice, tender.currency_code).replace(' RUB', '')}</span>
                            <span className="text-[#8f96a2]">{formatDate(tender.enddt)}</span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-5 lg:grid-cols-[315px_minmax(0,1fr)]">
            <div className="surface-card p-4">
              <h3 className="mb-3 text-[16px] font-extrabold text-[#303744]">Команда</h3>

              {teamMembers.length === 0 ? (
                <p className="text-[12px] text-[#8f959f]">Список команды пока пуст.</p>
              ) : (
                <div className="space-y-3">
                  {teamMembers.map((member, index) => (
                    <div key={`${member.name}-${member.role}`} className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <div
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                          style={{ backgroundColor: TEAM_COLORS[index % TEAM_COLORS.length] }}
                        >
                          {getInitials(member.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-bold text-[#2f3643]">{member.name}</div>
                          <div className="truncate text-[10px] text-[#8f96a2]">{member.role}</div>
                        </div>
                      </div>
                      <span className="rounded-[8px] bg-[#dfe4eb] px-2 py-1 text-[10px] font-bold text-[#5f6773]">
                        {member.count} тенд.
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="surface-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-[16px] font-extrabold text-[#303744]">Топ ОКПД-2 сегментов</h3>
                <Button
                  type="button"
                  onClick={() => onNavigate('search')}
                  className="h-8 rounded-full bg-[#2da36b] px-4 text-[12px] font-bold text-white hover:bg-[#248e5c]"
                >
                  Все тендеры <ArrowRight className="ml-2 h-3.5 w-3.5" />
                </Button>
              </div>

              {topIndustryLegend.length === 0 ? (
                <p className="text-[12px] text-[#8f959f]">Нет данных по отраслям.</p>
              ) : (
                <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[190px_minmax(0,1fr)]">
                  <div className="mx-auto h-[150px] w-[150px] rounded-full" style={{ background: donutBackground }}>
                    <div className="m-[17px] h-[116px] w-[116px] rounded-full bg-white" />
                  </div>

                  <div className="space-y-1.5">
                    {topIndustryLegend.map((item) => (
                      <div key={item.code} className="flex items-center justify-between gap-2 text-[12px] text-[#2f3643]">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                          <span className="truncate">{item.label}</span>
                        </div>
                        <span className="shrink-0">{item.share.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="min-w-0 space-y-5">
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

          <section className="surface-card p-4">
            <h3 className="mb-3 text-[14px] font-extrabold text-[#303744]">Ближайшие дедлайны</h3>

            {deadlineSections.length === 0 ? (
              <p className="text-[12px] text-[#8f959f]">Нет дедлайнов в избранном и канбане.</p>
            ) : (
              <div className="space-y-3">
                {deadlineSections.map((group) => (
                  <div key={group.key}>
                    <div className="mb-2 text-[12px] font-bold" style={{ color: group.accent }}>
                      {group.label}
                    </div>
                    <div className="space-y-2">
                      {group.items.map(({ tender, left }) => (
                        <button
                          key={`${group.key}-${tender.object_number}`}
                          type="button"
                          onClick={() => onNavigate('details', tender.object_number)}
                          className="w-full rounded-[10px] border px-2 py-2 text-left transition hover:brightness-[0.99]"
                          style={{ borderColor: group.border, background: group.bg }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="line-clamp-1 text-[12px] text-[#2f3643]">{getTenderDisplayTitle(tender)}</div>
                            <span
                              className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                              style={{ color: group.accent, backgroundColor: '#ffffff' }}
                            >
                              {left}д
                            </span>
                          </div>

                          <div className="mt-1 flex items-center justify-between text-[12px]">
                            <div className="inline-flex items-center gap-1 font-bold" style={{ color: group.accent }}>
                              <Eye className="h-3.5 w-3.5" />
                              {formatCurrency(tender.maxprice, tender.currency_code).replace(' RUB', '')}
                            </div>
                            <div className="inline-flex items-center gap-1 text-[#8f96a2]">
                              <Clock3 className="h-3.5 w-3.5" />
                              {formatDate(tender.enddt)}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
