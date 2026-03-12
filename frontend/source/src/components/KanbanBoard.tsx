import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { cn } from './ui/utils';
import { useTenders } from '../context/TendersContext';
import { apiRequest } from '../lib/api';
import { loadTenderDetailsMap } from '../lib/tender-details';
import { formatCurrency, formatDate, getTenderDisplayTitle, type Tender } from '../types/tender';

interface KanbanBoardProps {
  onNavigate: (page: 'details', tenderId?: string) => void;
}

type KanbanColumn = {
  id: string;
  label: string;
  accent: string;
};

const KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'backlog', label: 'Анализ', accent: '#6f7787' },
  { id: 'in_progress', label: 'Подготовка', accent: '#4c7fdf' },
  { id: 'docs', label: 'Подано', accent: '#dd7d39' },
  { id: 'review', label: 'Проверка', accent: '#9d6dde' },
  { id: 'done', label: 'Результат', accent: '#4fb37e' },
];

function getInitials(value?: string | null) {
  const source = (value || '').trim();
  if (!source) return 'Т';
  const parts = source.split(/\s+/).filter(Boolean).slice(0, 2);
  if (!parts.length) return source.slice(0, 1).toUpperCase();
  return parts.map((part) => part[0].toUpperCase()).join('');
}

export function KanbanBoard({ onNavigate }: KanbanBoardProps) {
  const { tenders, loading, error } = useTenders();
  const [kanbanMap, setKanbanMap] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kanbanDetails, setKanbanDetails] = useState<Record<string, Tender>>({});
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const unresolvedDetailsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        const data = await apiRequest<Array<{ object_number: string; status: string }>>('kanban');
        if (!isMounted) return;
        const next: Record<string, string> = {};
        (data || []).forEach((row) => {
          if (row?.object_number && row?.status) next[row.object_number] = row.status;
        });
        setKanbanMap(next);
      } catch {
        if (!isMounted) return;
        setLoadError('Не удалось загрузить канбан-статусы.');
      }
    };
    void load();
    return () => {
      isMounted = false;
    };
  }, []);

  const tendersByObjectNumber = useMemo(() => {
    const map: Record<string, Tender> = {};
    tenders.forEach((tender) => {
      map[tender.object_number] = tender;
    });
    return map;
  }, [tenders]);

  useEffect(() => {
    const activeIds = new Set(Object.keys(kanbanMap));
    unresolvedDetailsRef.current = new Set(
      Array.from(unresolvedDetailsRef.current).filter((id) => activeIds.has(id)),
    );

    setKanbanDetails((prev) => {
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
  }, [kanbanMap]);

  const missingDetailIds = useMemo(() => {
    return Object.keys(kanbanMap).filter(
      (objectNumber) =>
        !tendersByObjectNumber[objectNumber] &&
        !kanbanDetails[objectNumber] &&
        !unresolvedDetailsRef.current.has(objectNumber),
    );
  }, [kanbanMap, tendersByObjectNumber, kanbanDetails]);

  useEffect(() => {
    if (!missingDetailIds.length) {
      setDetailsLoading(false);
      return;
    }

    let active = true;
    setDetailsLoading(true);

    (async () => {
      const loaded = await loadTenderDetailsMap(missingDetailIds);
      if (!active) return;

      const loadedIds = new Set(Object.keys(loaded));
      for (const id of missingDetailIds) {
        if (!loadedIds.has(id)) unresolvedDetailsRef.current.add(id);
      }

      if (loadedIds.size > 0) {
        setKanbanDetails((prev) => ({ ...prev, ...loaded }));
      }
      setDetailsLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [missingDetailIds]);

  const handleStatusChange = useCallback(async (objectNumber: string, status: string) => {
    setSaving(objectNumber);
    try {
      await apiRequest('kanban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ object_number: objectNumber, status }),
      });
      setKanbanMap((prev) => ({ ...prev, [objectNumber]: status }));
    } catch {
      window.alert('Не удалось обновить статус.');
    } finally {
      setSaving(null);
    }
  }, []);

  const grouped = useMemo(() => {
    const byStatus: Record<string, Tender[]> = {};
    KANBAN_COLUMNS.forEach((column) => {
      byStatus[column.id] = [];
    });

    Object.entries(kanbanMap).forEach(([objectNumber, status]) => {
      if (!byStatus[status]) byStatus[status] = [];
      const tender = tendersByObjectNumber[objectNumber] ?? kanbanDetails[objectNumber];
      if (tender) {
        byStatus[status].push(tender);
        return;
      }
      byStatus[status].push({
        id: Number(objectNumber) || 0,
        object_number: objectNumber,
        object_info: `Тендер ${objectNumber}`,
      });
    });

    Object.keys(byStatus).forEach((status) => {
      byStatus[status].sort((a, b) => {
        const aTs = Date.parse(a.startdt || '') || 0;
        const bTs = Date.parse(b.startdt || '') || 0;
        return bTs - aTs;
      });
    });

    return byStatus;
  }, [kanbanMap, tendersByObjectNumber, kanbanDetails]);

  const totalCards = useMemo(
    () => Object.values(grouped).reduce((sum, entries) => sum + entries.length, 0),
    [grouped],
  );

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < maxScrollLeft - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => updateScrollState();
    el.addEventListener('scroll', onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => updateScrollState());
    resizeObserver.observe(el);
    window.addEventListener('resize', updateScrollState);
    requestAnimationFrame(updateScrollState);

    return () => {
      el.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateScrollState);
    };
  }, [updateScrollState]);

  useEffect(() => {
    requestAnimationFrame(updateScrollState);
  }, [grouped, updateScrollState]);

  const scrollColumns = useCallback((direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = Math.max(280, Math.floor(el.clientWidth * 0.5));
    el.scrollBy({ left: direction === 'left' ? -distance : distance, behavior: 'smooth' });
  }, []);

  return (
    <div className="space-y-4">
      <section className="surface-card p-4 md:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[24px] leading-7 font-extrabold text-[#303744]">Канбан-доска тендеров</h2>
          <div className="text-[14px] text-[#6f7783]">
            Показано <span className="font-bold text-[#2f3643]">{totalCards}</span> карточек
          </div>
        </div>

        {loadError ? (
          <div className="mb-3 rounded-[10px] border border-[#f4b08a] bg-[#fff4eb] px-3 py-2 text-[14px] text-[#b35b2b]">
            {loadError}
          </div>
        ) : null}
        {error ? (
          <div className="mb-3 rounded-[10px] border border-[#f4b08a] bg-[#fff4eb] px-3 py-2 text-[14px] text-[#b35b2b]">
            {error}
          </div>
        ) : null}

        <div className="relative">
          {canScrollLeft ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="absolute left-2 top-1/2 z-[3] h-8 w-8 -translate-y-1/2 rounded-full border-[#d4dce7] bg-white"
              onClick={() => scrollColumns('left')}
              aria-label="Прокрутить канбан влево"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          ) : null}
          {canScrollRight ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="absolute right-2 top-1/2 z-[3] h-8 w-8 -translate-y-1/2 rounded-full border-[#d4dce7] bg-white"
              onClick={() => scrollColumns('right')}
              aria-label="Прокрутить канбан вправо"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : null}

          <div ref={scrollRef} className="kanban-scroll flex gap-3 overflow-x-auto pb-2">
            {KANBAN_COLUMNS.map((column) => (
              <section
                key={column.id}
                className={cn(
                  'min-w-[280px] max-w-[280px] rounded-[12px] border border-[#dbe1ea] bg-[#f4f7fb] p-2',
                  dragOver === column.id && 'ring-2 ring-[#6f97e6]/40',
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(column.id);
                }}
                onDragEnter={() => setDragOver(column.id)}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  const objectNumber = e.dataTransfer.getData('text/plain');
                  if (objectNumber) void handleStatusChange(objectNumber, column.id);
                }}
              >
                <header className="mb-2 flex items-center justify-between">
                  <div className="text-[10px] font-extrabold uppercase tracking-[0.04em]" style={{ color: column.accent }}>
                    {column.label}
                  </div>
                  <span className="rounded-full bg-[#dfe4eb] px-2 py-0.5 text-[10px] font-semibold text-[#596171]">
                    {(grouped[column.id] || []).length}
                  </span>
                </header>

                <div className="space-y-2">
                  {loading || detailsLoading ? (
                    <div className="rounded-[10px] border border-[#e1e5ec] bg-white px-2 py-3 text-[12px] text-[#9096a2]">
                      Загрузка...
                    </div>
                  ) : (grouped[column.id] || []).length === 0 ? (
                    <div className="rounded-[10px] border border-[#e1e5ec] bg-white px-2 py-3 text-[12px] text-[#9096a2]">
                      Нет карточек
                    </div>
                  ) : (
                    (grouped[column.id] || []).map((tender) => (
                      <article
                        key={tender.object_number}
                        className="rounded-[10px] border border-[#dde3eb] bg-white p-2"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', tender.object_number);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => setDragOver(null)}
                      >
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <Badge className="rounded-[5px] bg-[#444b5b] px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-[#444b5b]">
                            {tender.zakon || '—'}
                          </Badge>
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#dbe3ef] text-[10px] font-bold text-[#5f6d85]">
                            {getInitials(tender.shortname || tender.fullname)}
                          </div>
                        </div>

                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() => onNavigate('details', tender.object_number)}
                        >
                          <div className="line-clamp-2 text-[12px] leading-4 text-[#2f3542]">
                            {getTenderDisplayTitle(tender)}
                          </div>
                        </button>

                        <div className="mt-2 flex items-center justify-between gap-2 text-[12px]">
                          <div className="font-bold text-[#2f3643]">
                            {formatCurrency(tender.maxprice, tender.currency_code).replace(' RUB', '')}
                          </div>
                          <div className="text-[#8f96a2]">{formatDate(tender.enddt)}</div>
                        </div>

                        <div className="mt-2">
                          <Select
                            value={kanbanMap[tender.object_number] || 'backlog'}
                            onValueChange={(value) => handleStatusChange(tender.object_number, value)}
                            disabled={saving === tender.object_number}
                          >
                            <SelectTrigger className="h-8 rounded-[8px] border-[#d8dee6] text-[12px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {KANBAN_COLUMNS.map((item) => (
                                <SelectItem key={item.id} value={item.id}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-[#97a0ae]">
                          <GripVertical className="h-3 w-3" />
                          Перетащите карточку в другую колонку
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
