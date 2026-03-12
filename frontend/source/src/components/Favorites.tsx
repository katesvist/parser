import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
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
import { Star, Trash2, Eye, Calendar, Download } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
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

export function Favorites({ onNavigate }: FavoritesProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('Все статусы');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const [favoritesError, setFavoritesError] = useState<string | null>(null);
  const [favoriteDetails, setFavoriteDetails] = useState<Record<string, Tender>>({});
  const [detailsLoading, setDetailsLoading] = useState(false);
  const { tenders, loading, error } = useTenders();

  const loadFavorites = useCallback(async () => {
    try {
      const data = await apiRequest<{ object_number: string }[]>('favorites');
      setFavorites(new Set((data || []).map((row) => row.object_number)));
      setFavoritesError(null);
    } catch (err) {
      setFavoritesError('Не удалось загрузить избранное.');
    } finally {
      setFavoritesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

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
  }, [favorites, tendersByObjectNumber]);

  const toggleFavorite = async (id: string) => {
    const next = new Set(favorites);
    const wasFavorite = next.has(id);
    if (wasFavorite) {
      next.delete(id);
    } else {
      next.add(id);
    }
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
        if (!currentStatus.includes(statusFilter.toLowerCase())) {
          return false;
        }
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
    <div className="space-y-6">
      <div>
        <h1>Избранные тендеры</h1>
        <p className="text-muted-foreground mt-1">
          Тендеры, которые вы добавили в избранное для отслеживания
        </p>
      </div>

      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Input
                placeholder="Поиск в избранном..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-md"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Все статусы" />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" className="gap-2" onClick={handleExportFavorites}>
              <Download className="w-4 h-4" />
              Экспорт
            </Button>
          </div>
        </CardContent>
      </Card>

      {(error || favoritesError) && (
        <Alert className="border-orange-300 bg-orange-50 text-orange-700">
          <AlertTitle>Показаны сохраненные данные</AlertTitle>
          <AlertDescription>{favoritesError || error}</AlertDescription>
        </Alert>
      )}

      {loading || favoritesLoading || detailsLoading ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            Загружаем ваши избранные тендеры…
          </CardContent>
        </Card>
      ) : filteredFavorites.length > 0 ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Всего тендеров: {favoriteTenders.length}</CardTitle>
              {favoriteTenders.length !== filteredFavorites.length && (
                <span className="text-sm text-muted-foreground">
                  Отфильтровано: {filteredFavorites.length}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredFavorites.map((tender) => {
                const statusInfo = getStatusInfo(tender.etap_zakupki);
                return (
                  <Card
                    key={tender.object_number}
                    className="group cursor-pointer border-border/70 bg-white/80 transition-all hover:shadow-[0_16px_40px_-32px_rgba(15,23,42,0.35)]"
                    onClick={() => onNavigate('details', tender.object_number)}
                  >
                    <CardContent className="p-5 space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">№ {tender.object_number}</div>
                          <div className="text-sm font-semibold leading-snug line-clamp-2">
                            {getTenderDisplayTitle(tender)}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(tender.object_number);
                          }}
                        >
                          <Star
                            className={`w-4 h-4 ${
                              favorites.has(tender.object_number)
                                ? 'fill-yellow-400 text-yellow-400'
                                : 'text-muted-foreground'
                            }`}
                          />
                        </Button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {tender.zakon && (
                          <Badge variant="outline" className="text-xs">
                            {tender.zakon}
                          </Badge>
                        )}
                        <Badge variant="secondary" className={statusInfo.color}>
                          {statusInfo.label}
                        </Badge>
                        {tender.okpd2info && (
                          <Badge variant="outline" className="text-xs">
                            {decodeHtmlEntities(tender.okpd2info.split(' - ')[0])}
                          </Badge>
                        )}
                      </div>

                      <div className="space-y-1 text-sm">
                        <div className="text-muted-foreground">
                          {decodeHtmlEntities(tender.shortname || tender.fullname || '—')}
                        </div>
                        {tender.inn && (
                          <div className="text-muted-foreground">ИНН: {tender.inn}</div>
                        )}
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="text-emerald-600 font-semibold">
                          {formatCurrency(tender.maxprice, tender.currency_code)}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          <span>{formatDate(tender.enddt)}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-border/70">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNavigate('details', tender.object_number);
                          }}
                        >
                          <Eye className="w-4 h-4" />
                          Открыть
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(tender.object_number);
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="p-12">
          <div className="text-center">
            <Star className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="mb-2">Нет избранных тендеров</h3>
            <p className="text-muted-foreground mb-4">
              Добавляйте интересующие вас тендеры в избранное для быстрого доступа
            </p>
            <Button onClick={() => onNavigate('search')}>
              Найти тендеры
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
