import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { 
  BookmarkCheck, 
  Play, 
  Pencil, 
  Trash2, 
  Bell,
  Filter
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { apiRequest } from '../lib/api';
import { normalizeSavedSearchFilters, type SavedSearchFilters } from '../lib/saved-search-filters';

interface SavedSearchesProps {
  onNavigate: (page: 'search') => void;
}

const formatRange = (from?: string, to?: string, prefix?: string) => {
  if (!from && !to) return null;
  if (from && to) return `${prefix || ''}${from} — ${to}`.trim();
  if (from) return `${prefix || ''}от ${from}`.trim();
  return `${prefix || ''}до ${to}`.trim();
};

export function SavedSearches({ onNavigate }: SavedSearchesProps) {
  const [savedSearches, setSavedSearches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  useEffect(() => {
    let isMounted = true;
    const loadSearches = async () => {
      try {
        const data = await apiRequest<any[]>('saved-searches');
        if (isMounted) {
          setSavedSearches(data || []);
        }
      } catch (err) {
        if (isMounted) {
          setError('Не удалось загрузить сохраненные поиски.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    loadSearches();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleRun = useCallback(
    (filters: SavedSearchFilters) => {
      window.localStorage.setItem('saved_search_run', JSON.stringify(filters || {}));
      onNavigate('search');
    },
    [onNavigate]
  );

  const handleDelete = useCallback(async (id: number) => {
    try {
      await apiRequest(`saved-searches/${id}`, { method: 'DELETE' });
      setSavedSearches((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      window.alert('Не удалось удалить поиск.');
    }
  }, []);

  const openEdit = useCallback((search: any) => {
    setEditTarget(search);
    setEditName(search?.name || '');
    setEditDescription(search?.description || '');
    setEditOpen(true);
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editTarget) return;
    const name = editName.trim();
    if (!name) {
      window.alert('Название поиска обязательно.');
      return;
    }
    setEditLoading(true);
    try {
      const updated = await apiRequest<any>(`saved-searches/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: editDescription.trim() }),
      });
      setSavedSearches((prev) =>
        prev.map((item) => (item.id === editTarget.id ? { ...item, ...updated } : item))
      );
      setEditOpen(false);
    } catch (err) {
      window.alert('Не удалось обновить поиск.');
    } finally {
      setEditLoading(false);
    }
  }, [editDescription, editName, editTarget]);

  const searches = useMemo(() => savedSearches || [], [savedSearches]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1>Сохраненные поиски</h1>
          <p className="text-muted-foreground mt-1">
            Управление автоматическими поисками тендеров
          </p>
        </div>
        <Button onClick={() => onNavigate('search')} className="gap-2">
          <Filter className="w-4 h-4" />
          Создать новый поиск
        </Button>
      </div>

      {error ? (
        <Card className="p-6 text-sm text-red-600">{error}</Card>
      ) : null}

      {loading ? (
        <Card className="p-12 text-center text-muted-foreground">Загрузка…</Card>
      ) : (
      <div className="grid grid-cols-1 gap-4">
        {searches.map((search) => {
          const filters = normalizeSavedSearchFilters(search.filters);
          const badges: string[] = [];
          const searchText = filters.search;
          const law = filters.law;
          const region = filters.region;
          const status = filters.status;
          const method = filters.method;
          const okpd2 = filters.okpd2;
          const inn = filters.inn;
          const objectNumber = filters.objectNumber;
          const ikz = filters.ikz;
          const priceFrom = filters.priceFrom;
          const priceTo = filters.priceTo;
          const startDateFrom = filters.startDateFrom;
          const startDateTo = filters.startDateTo;
          const endDateFrom = filters.endDateFrom;
          const endDateTo = filters.endDateTo;

          if (searchText) badges.push(searchText);
          if (law && law !== 'Все законы') badges.push(`Закон: ${law}`);
          if (region && region !== 'Все регионы') badges.push(`📍 ${region}`);
          if (status && status !== 'Все статусы') badges.push(`Статус: ${status}`);
          if (method && method !== 'Все способы') badges.push(`Способ: ${method}`);
          if (okpd2) badges.push(`ОКПД2: ${okpd2}`);
          if (inn) badges.push(`ИНН: ${inn}`);
          if (objectNumber) badges.push(`№: ${objectNumber}`);
          if (ikz) badges.push(`ИКЗ: ${ikz}`);

          const priceLabel =
            priceFrom || priceTo
              ? `${Number(priceFrom || 0).toLocaleString('ru-RU')} - ${Number(priceTo || 0).toLocaleString('ru-RU')} ₽`
              : null;
          if (priceLabel && (priceFrom !== '0' || priceTo !== '0')) {
            badges.push(priceLabel);
          }

          const startRange = formatRange(startDateFrom, startDateTo, 'Публ. ');
          if (startRange) badges.push(startRange);
          const endRange = formatRange(endDateFrom, endDateTo, 'Срок ');
          if (endRange) badges.push(endRange);

          return (
          <Card key={search.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <CardTitle>{search.name}</CardTitle>
                    {search.last_new_count > 0 && (
                      <Badge variant="default" className="bg-blue-600">
                        +{search.last_new_count} новых
                      </Badge>
                    )}
                    {search.notifications && (
                      <Badge variant="outline" className="gap-1">
                        <Bell className="w-3 h-3" />
                        Уведомления
                      </Badge>
                    )}
                  </div>
                  <CardDescription>{search.description || 'Без описания'}</CardDescription>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(search)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(search.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h4>Параметры поиска</h4>
                <div className="flex flex-wrap gap-2">
                  {badges.length > 0 ? (
                    badges.map((label, idx) => (
                      <Badge key={`${search.id}-filter-${idx}`} variant="secondary">
                        {label}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">Нет параметров</span>
                  )}
                </div>
              </div>

              <div className="flex justify-end">
                <Button className="gap-2" onClick={() => handleRun(filters)}>
                  <Play className="w-4 h-4" />
                  Запустить поиск
                </Button>
              </div>
            </CardContent>
          </Card>
        );
        })}
      </div>
      )}

      {!loading && searches.length === 0 && (
        <Card className="p-12">
          <div className="text-center">
            <BookmarkCheck className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="mb-2">Нет сохраненных поисков</h3>
            <p className="text-muted-foreground mb-4">
              Создайте автоматический поиск, чтобы отслеживать новые тендеры
            </p>
            <Button onClick={() => onNavigate('search')}>
              Создать первый поиск
            </Button>
          </div>
        </Card>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Редактировать поиск</DialogTitle>
            <DialogDescription>
              Обнови название и описание. Фильтры сохраняются без изменений.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Название</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Название поиска"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Описание</label>
              <Textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Короткое описание (необязательно)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleEditSave} disabled={editLoading}>
              {editLoading ? 'Сохраняем...' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
