import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Star, Trash2, Calendar, Download, CircleDot } from 'lucide-react';
import { useTenders } from '../context/TendersContext';
import { downloadJson } from '../utils/download';
import {
  formatCurrency,
  formatDate,
  getStatusInfo,
  getTenderDisplayTitle,
  decodeHtmlEntities,
  type Tender,
} from '../types/tender';
import { apiRequest } from '../lib/api';
import { loadTenderDetailsMap } from '../lib/tender-details';

interface FavoritesProps {
  onNavigate: (page: 'details' | 'search', tenderId?: string) => void;
}

function kanbanHint(status?: string) {
  const value = (status || '').toLowerCase();
  if (!value) return { text: 'Не в работе', color: '#e29a57' };
  if (value.includes('done') || value.includes('заверш')) return { text: 'Завершено', color: '#5f88d2' };
  if (value.includes('in_progress') || value.includes('docs') || value.includes('review')) {
    return { text: 'В канбане', color: '#31b06b' };
  }
  return { text: 'В канбане', color: '#31b06b' };
}

export function Favorites({ onNavigate }: FavoritesProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('Все статусы');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const [favoritesError, setFavoritesError] = useState<string | null>(null);
  const [favoriteDetails, setFavoriteDetails] = useState<Record<string, Tender>>({});
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [kanbanMap, setKanbanMap] = useState<Record<string, string>>({});

  const { tenders, loading, error } = useTenders();

  const loadFavorites = useCallback(async () => {
    try {
      const data = await apiRequest<{ object_number: string }[]>('favorites');
      setFavorites(new Set((data || []).map((row) => row.object_number)));
      setFavoritesError(null);
    } catch {
      setFavoritesError('Не удалось загрузить избранное.');
    } finally {
      setFavoritesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

  useEffect(() => {
    let mounted = true;
    const loadKanban = async () => {
      try {
        const data = await apiRequest<Array<{ object_number: string; status: string }>>('kanban');
        if (!mounted) return;
        const next: Record<string, string> = {};
        (data || []).forEach((row) => {
          if (row?.object_number && row?.status) next[row.object_number] = row.status;
        });
        setKanbanMap(next);
      } catch {
        if (!mounted) return;
        setKanbanMap({});
      }
    };
    void loadKanban();
    return () => {
      mounted = false;
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
    const favoriteIds = Array.from(favorites);
    const missing = favoriteIds.filter((id) => !tendersByObjectNumber[id] && !favoriteDetails[id]);

    setFavoriteDetails((prev) => {
      const next: Record<string, Tender> = {};
      for (const id of favoriteIds) {
        if (prev[id]) next[id] = prev[id];
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
        setFavoriteDetails((prev) => ({ ...prev, ...loaded }));
      }
      setDetailsLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [favorites, tendersByObjectNumber, favoriteDetails]);

  const toggleFavorite = async (id: string) => {
    const next = new Set(favorites);
    const wasFavorite = next.has(id);
    if (wasFavorite) next.delete(id);
    else next.add(id);
    setFavorites(next);

    try {
      if (wasFavorite) {
        await apiRequest(`favorites/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } else {
        await apiRequest('favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ object_number: id }),
        });
      }
      await loadFavorites();
    } catch (err) {
      console.error(err);
      setFavorites(favorites);
      window.alert('Не удалось обновить избранное.');
    }
  };

  const statuses = ['Все статусы', 'Прием заявок', 'Работа комиссии', 'Определен победитель', 'Отменен'];

  const favoriteTenders = useMemo(() => {
    const resolved = Array.from(favorites)
      .map((id) => tendersByObjectNumber[id] ?? favoriteDetails[id])
      .filter((value): value is Tender => Boolean(value));
    resolved.sort((a, b) => {
      const aTs = Date.parse(a.startdt || '') || 0;
      const bTs = Date.parse(b.startdt || '') || 0;
      return bTs - aTs;
    });
    return resolved;
  }, [favorites, tendersByObjectNumber, favoriteDetails]);

  const filteredFavorites = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return favoriteTenders.filter((tender) => {
      if (statusFilter !== 'Все статусы') {
        const currentStatus = tender.etap_zakupki?.toLowerCase() ?? '';
        if (!currentStatus.includes(statusFilter.toLowerCase())) return false;
      }

      if (!query) return true;

      const haystack = [
        tender.object_number,
        tender.object_info,
        tender.object_description,
        tender.kvr_info,
        tender.shortname,
        tender.fullname,
        tender.inn,
        tender.okpd2info,
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());

      return haystack.some((value) => value.includes(query));
    });
  }, [favoriteTenders, searchQuery, statusFilter]);

  const handleExportFavorites = useCallback(() => {
    if (filteredFavorites.length === 0) {
      window.alert('Нет данных для экспорта. Уточните фильтры.');
      return;
    }
    downloadJson('favorite-tenders.json', filteredFavorites);
  }, [filteredFavorites]);

  return (
    <div className="space-y-4">
      <section className="surface-card p-4 md:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[24px] leading-7 font-extrabold text-[#303744]">Избранные тендеры</h2>
          <div className="text-[14px] text-[#6f7783]">
            Всего: <span className="font-bold text-[#2f3643]">{favoriteTenders.length}</span> тендеров
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            placeholder="Поиск в избранном..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-11 min-w-[240px] max-w-[460px] rounded-[10px] border-[#d8dee6] bg-white text-[14px]"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-11 w-[240px] rounded-[10px] border-[#d8dee6] bg-white text-[14px]">
              <SelectValue placeholder="Все статусы" />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((status) => (
                <SelectItem key={status} value={status}>{status}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" className="h-11 rounded-[10px] border-[#d8dee6] px-4 text-[14px]" onClick={handleExportFavorites}>
            <Download className="mr-2 h-4 w-4" />
            Экспорт
          </Button>
        </div>

        {(error || favoritesError) && (
          <div className="mb-3 rounded-[10px] border border-[#f4b08a] bg-[#fff4eb] px-3 py-2 text-[14px] text-[#b35b2b]">
            {favoritesError || error}
          </div>
        )}

        {loading || favoritesLoading || detailsLoading ? (
          <div className="rounded-[10px] border border-[#e1e6ee] bg-[#f7f9fc] px-3 py-4 text-[14px] text-[#7f8794]">
            Загружаем ваши избранные тендеры…
          </div>
        ) : filteredFavorites.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredFavorites.map((tender) => {
              const statusInfo = getStatusInfo(tender.etap_zakupki);
              const workState = kanbanHint(kanbanMap[tender.object_number]);
              return (
                <article
                  key={tender.object_number}
                  className="rounded-[12px] border border-[#dde2ea] bg-white p-3 transition hover:bg-[#f8fbff]"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-1 text-[12px] text-[#7a8390]">
                      <CircleDot className="h-3.5 w-3.5" style={{ color: workState.color }} />
                      {workState.text}
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleFavorite(tender.object_number)}
                      className="rounded-[8px] p-1 text-[#ea6f76] hover:bg-[#fff1f3]"
                      aria-label="Удалить из избранного"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge className="rounded-[5px] bg-[#3e4556] px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-[#3e4556]">
                      {tender.zakon || '—'}
                    </Badge>
                    <span className="rounded-[5px] bg-[#d7f2e2] px-2 py-0.5 text-[12px] font-bold text-[#20814f]">{statusInfo.label}</span>
                    <span className="text-[16px] text-[#9aa0ab]">{decodeHtmlEntities(tender.etp_name || '').replace(/^АО /, '').replace(/^ООО /, '') || '—'}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => onNavigate('details', tender.object_number)}
                    className="w-full text-left"
                  >
                    <h3 className="line-clamp-2 text-[14px] font-semibold leading-5 text-[#2d3442]">{getTenderDisplayTitle(tender)}</h3>
                  </button>

                  <div className="mt-1 text-[14px] text-[#2f3643]">{decodeHtmlEntities(tender.shortname || tender.fullname || '—')}</div>
                  <div className="line-clamp-1 text-[14px] text-[#9aa0ab]">{decodeHtmlEntities(((tender as any).region_name || (tender as any).region || '').toString()) || '—'}</div>

                  <div className="mt-2 flex items-center justify-between">
                    <div className="text-[24px] font-extrabold leading-7 text-[#2da36b]">
                      {formatCurrency(tender.maxprice, tender.currency_code).replace(' RUB', '')}
                    </div>
                    <div className="inline-flex items-center gap-1 text-[12px] text-[#2f3643]">
                      <Calendar className="h-3.5 w-3.5 text-[#8c94a1]" />
                      {formatDate(tender.enddt)} г.
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => onNavigate('details', tender.object_number)}
                      className="text-[12px] font-semibold text-[#3b6fc8] hover:text-[#2e5ca7]"
                    >
                      Открыть
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleFavorite(tender.object_number)}
                      className="rounded-[8px] border border-[#d9dee7] p-1.5 text-[#7f8895] hover:bg-[#f4f7fb]"
                    >
                      <Star className={`h-4 w-4 ${favorites.has(tender.object_number) ? 'fill-[#2da36b] text-[#2da36b]' : ''}`} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[10px] border border-[#e1e6ee] bg-[#f7f9fc] px-3 py-4 text-center">
            <Star className="mx-auto mb-2 h-9 w-9 text-[#8f96a2]" />
            <h3 className="text-[20px] font-bold text-[#303744]">Нет избранных тендеров</h3>
            <p className="mt-1 text-[14px] text-[#7f8794]">Добавляйте интересующие тендеры в избранное для быстрого доступа</p>
            <Button type="button" className="mt-3 h-11 rounded-full bg-[#2da36b] px-6 text-[14px] font-bold text-white hover:bg-[#248e5c]" onClick={() => onNavigate('search')}>
              Найти тендеры
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
