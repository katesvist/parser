import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useTenders } from '../context/TendersContext';
import { formatCurrency, formatDate, getStatusInfo, getTenderDisplayTitle, type Tender } from '../types/tender';
import { cn } from './ui/utils';
import { loadTenderDetailsMap } from '../lib/tender-details';

interface KanbanBoardProps {
  onNavigate: (page: 'details', tenderId?: string) => void;
}

type KanbanStatus = {
  id: string;
  label: string;
  hint?: string;
};

const KANBAN_COLUMNS: KanbanStatus[] = [
  { id: 'backlog', label: 'Входящие', hint: 'Новые' },
  { id: 'in_progress', label: 'В работе' },
  { id: 'docs', label: 'Документация' },
  { id: 'review', label: 'Рассмотрение' },
  { id: 'done', label: 'Завершено' },
];

export function KanbanBoard({ onNavigate }: KanbanBoardProps) {
  const { tenders, loading, error } = useTenders();
  const [kanbanMap, setKanbanMap] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [kanbanDetails, setKanbanDetails] = useState<Record<string, Tender>>({});
  const [detailsLoading, setDetailsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        const data = await apiRequest<Array<{ object_number: string; status: string }>>('kanban');
        if (!isMounted) return;
        const next: Record<string, string> = {};
        (data || []).forEach((row) => {
          if (row?.object_number && row?.status) {
            next[row.object_number] = row.status;
          }
        });
        setKanbanMap(next);
      } catch (err) {
        if (!isMounted) return;
        setLoadError('Не удалось загрузить статусы канбана.');
      }
    };
    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const tendersByObjectNumber = useMemo(() => {
    const map: Record<string, Tender> = {};
    for (const tender of tenders) {
      map[tender.object_number] = tender;
    }
    return map;
  }, [tenders]);

  useEffect(() => {
    let active = true;
    const objectNumbers = Object.keys(kanbanMap);
    const missing = objectNumbers.filter(
      (objectNumber) => !tendersByObjectNumber[objectNumber] && !kanbanDetails[objectNumber],
    );

    setKanbanDetails((prev) => {
      const next: Record<string, Tender> = {};
      for (const objectNumber of objectNumbers) {
        if (prev[objectNumber]) next[objectNumber] = prev[objectNumber];
      }
      return next;
    });

    if (!missing.length) {
      setDetailsLoading(false);
      return () => {
        active = false;
      };
    }

    setDetailsLoading(true);
    (async () => {
      const loaded = await loadTenderDetailsMap(missing);
      if (!active) return;
      if (Object.keys(loaded).length > 0) {
        setKanbanDetails((prev) => ({ ...prev, ...loaded }));
      }
      setDetailsLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [kanbanMap, tendersByObjectNumber]);

  const handleStatusChange = useCallback(async (objectNumber: string, status: string) => {
    setSaving(objectNumber);
    try {
      await apiRequest('kanban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ object_number: objectNumber, status }),
      });
      setKanbanMap((prev) => ({ ...prev, [objectNumber]: status }));
    } catch (err) {
      window.alert('Не удалось обновить статус.');
    } finally {
      setSaving(null);
    }
  }, []);

  const grouped = useMemo(() => {
    const byStatus: Record<string, Tender[]> = {};
    KANBAN_COLUMNS.forEach((col) => {
      byStatus[col.id] = [];
    });

    for (const [objectNumber, status] of Object.entries(kanbanMap)) {
      if (!byStatus[status]) byStatus[status] = [];
      const tender = tendersByObjectNumber[objectNumber] ?? kanbanDetails[objectNumber];
      if (tender) {
        byStatus[status].push(tender);
        continue;
      }
      const fallbackId = Number(objectNumber);
      byStatus[status].push({
        id: Number.isFinite(fallbackId) ? fallbackId : 0,
        object_number: objectNumber,
        object_info: `Тендер ${objectNumber}`,
      });
    }

    for (const column of Object.keys(byStatus)) {
      byStatus[column].sort((a, b) => {
        const aTs = Date.parse(a.startdt || '') || 0;
        const bTs = Date.parse(b.startdt || '') || 0;
        return bTs - aTs;
      });
    }

    return byStatus;
  }, [kanbanMap, tendersByObjectNumber, kanbanDetails]);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleDrop = useCallback(
    (columnId: string, objectNumber: string) => {
      handleStatusChange(objectNumber, columnId);
    },
    [handleStatusChange]
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
    const distance = Math.max(280, Math.floor(el.clientWidth * 0.55));
    el.scrollBy({ left: direction === 'left' ? -distance : distance, behavior: 'smooth' });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1>Канбан</h1>
        <p className="text-muted-foreground mt-1">
          Управляйте этапами работы по тендерам и отслеживайте прогресс.
        </p>
      </div>

      {loadError ? (
        <Card className="p-4 text-sm text-orange-600">{loadError}</Card>
      ) : null}
      {error ? (
        <Card className="p-4 text-sm text-orange-600">{error}</Card>
      ) : null}

      <div className="relative">
        {canScrollLeft && (
          <div className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-10 bg-gradient-to-r from-background to-transparent" />
        )}
        {canScrollRight && (
          <div className="pointer-events-none absolute inset-y-0 right-0 z-[1] w-10 bg-gradient-to-l from-background to-transparent" />
        )}

        {canScrollLeft && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="absolute left-2 top-1/2 z-[2] h-8 w-8 -translate-y-1/2 rounded-full bg-white/95 shadow"
            onClick={() => scrollColumns('left')}
            aria-label="Прокрутить канбан влево"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
        {canScrollRight && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="absolute right-2 top-1/2 z-[2] h-8 w-8 -translate-y-1/2 rounded-full bg-white/95 shadow"
            onClick={() => scrollColumns('right')}
            aria-label="Прокрутить канбан вправо"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}

        <div ref={scrollRef} className="kanban-scroll flex gap-4 overflow-x-auto pb-2 pr-1 scroll-smooth">
        {KANBAN_COLUMNS.map((column) => (
          <div
            key={column.id}
            className={cn(
              'min-w-[400px] flex-1',
              dragOver === column.id && 'ring-2 ring-primary/20 rounded-[22px]'
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
              if (objectNumber) {
                handleDrop(column.id, objectNumber);
              }
            }}
          >
            <Card className="bg-white">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{column.label}</CardTitle>
                  <Badge variant="secondary">{(grouped[column.id] || []).length}</Badge>
                </div>
                {column.hint ? (
                  <p className="text-xs text-muted-foreground">{column.hint}</p>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3">
                {loading || detailsLoading ? (
                  <div className="text-sm text-muted-foreground">Загрузка…</div>
                ) : (grouped[column.id] || []).length === 0 ? (
                  <div className="text-sm text-muted-foreground">Нет карточек</div>
                ) : (
                  (grouped[column.id] || []).map((tender) => {
                    const statusInfo = getStatusInfo(tender.etap_zakupki);
                    const isExpanded = expanded.has(tender.object_number);
                    const title = getTenderDisplayTitle(tender);
                    const hasLongTitle = title.length > 120;

                    return (
                      <div
                        key={tender.object_number}
                        className="rounded-[18px] border border-border/70 bg-white p-4 shadow-sm transition hover:shadow-md cursor-grab active:cursor-grabbing"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', tender.object_number);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDragEnd={() => setDragOver(null)}
                      >
                        <div className="flex items-start gap-2">
                          <div className="space-y-1 min-w-0 flex-1">
                            <p className="text-xs text-muted-foreground">№ {tender.object_number}</p>
                            <p className={cn('text-sm font-medium leading-snug', !isExpanded && 'line-clamp-3')}>
                              {title}
                            </p>
                            {hasLongTitle ? (
                              <button
                                type="button"
                                onClick={() => toggleExpanded(tender.object_number)}
                                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
                              >
                                {isExpanded ? 'Свернуть' : 'Показать полностью'}
                                <ChevronDown className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-180')} />
                              </button>
                            ) : null}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs shrink-0"
                            onClick={() => onNavigate('details', tender.object_number)}
                          >
                            Открыть
                          </Button>
                        </div>

                        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{statusInfo?.label || '—'}</span>
                          <span>{formatDate(tender.enddt)}</span>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-emerald-600">
                            {formatCurrency(tender.maxprice, tender.currency_code)}
                          </span>
                        </div>

                        <div className="mt-3">
                          <Select
                            value={kanbanMap[tender.object_number] || 'backlog'}
                            onValueChange={(value) => handleStatusChange(tender.object_number, value)}
                            disabled={saving === tender.object_number}
                          >
                            <SelectTrigger className="h-9 w-full text-sm">
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
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>
        ))}
        </div>

        {(canScrollLeft || canScrollRight) && (
          <p className="mt-2 text-xs text-muted-foreground">
            Прокрутите вбок, чтобы увидеть все этапы канбана.
          </p>
        )}
      </div>
    </div>
  );
}
