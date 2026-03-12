import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Badge } from './ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { 
  Search, 
  Filter, 
  Star, 
  Download, 
  Eye,
  Calendar,
  ChevronDown,
  Bookmark,
  Globe,
  RotateCcw,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { formatCurrency, formatDate, getStatusInfo, decodeHtmlEntities, getTenderDisplayTitle, type Tender } from '../types/tender';
import { downloadJson } from '../utils/download';
import { apiRequest } from '../lib/api';
import { normalizeSavedSearchFilters } from '../lib/saved-search-filters';

interface TenderSearchProps {
  onNavigate: (page: 'details', tenderId: string) => void;
}

export function TenderSearch({ onNavigate }: TenderSearchProps) {
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isFilterOpen, setIsFilterOpen] = useState(true);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  const [lawFilter, setLawFilter] = useState('Все законы');
  const [statusFilter, setStatusFilter] = useState('Все статусы');
  const [methodFilter, setMethodFilter] = useState('Все способы');
  const [okpd2Filter, setOkpd2Filter] = useState('');
  const [innFilter, setInnFilter] = useState('');
  const [priceFrom, setPriceFrom] = useState('');
  const [priceTo, setPriceTo] = useState('');
  const [startDateFrom, setStartDateFrom] = useState('');
  const [endDateTo, setEndDateTo] = useState('');
  const [objectNumberFilter, setObjectNumberFilter] = useState('');
  const [ikzFilter, setIkzFilter] = useState('');
  const [searchAnimating, setSearchAnimating] = useState(false);
  const searchFeedbackTimeout = useRef<number | null>(null);
  const PAGE_SIZE = 50;
  const [currentPage, setCurrentPage] = useState(1);
  const [results, setResults] = useState<Tender[]>([]);
  const [resultsTotal, setResultsTotal] = useState(0);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);

  const statuses = useMemo(() => {
    const uniqueStatuses = new Set<string>();
    uniqueStatuses.add('Все статусы');
    results.forEach((tender) => {
      if (tender.etap_zakupki) {
        uniqueStatuses.add(tender.etap_zakupki);
      }
    });
    return Array.from(uniqueStatuses);
  }, [results]);

  const purchaseMethods = useMemo(() => {
    const uniqueMethods = new Set<string>();
    uniqueMethods.add('Все способы');
    results.forEach((tender) => {
      if (tender.placingway_name) {
        uniqueMethods.add(tender.placingway_name);
      }
    });
    return Array.from(uniqueMethods);
  }, [results]);

  const laws = [
    'Все законы',
    '44-ФЗ',
    '223-ФЗ',
  ];

  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    if (searchInput === '' && searchQuery !== '') {
      setSearchQuery('');
    }
  }, [searchInput, searchQuery]);

  useEffect(() => {
    const raw = window.localStorage.getItem('saved_search_run');
    if (!raw) return;
    try {
      const payload = normalizeSavedSearchFilters(JSON.parse(raw));
      setSearchInput(payload.search);
      setSearchQuery(payload.search);
      setLawFilter(payload.law || 'Все законы');
      setStatusFilter(payload.status || 'Все статусы');
      setMethodFilter(payload.method || 'Все способы');
      setOkpd2Filter(payload.okpd2);
      setInnFilter(payload.inn);
      setObjectNumberFilter(payload.objectNumber);
      setIkzFilter(payload.ikz);
      setPriceFrom(payload.priceFrom);
      setPriceTo(payload.priceTo);
      setStartDateFrom(payload.startDateFrom);
      setEndDateTo(payload.endDateTo);
    } catch (err) {
      console.warn('Failed to load saved search', err);
    } finally {
      window.localStorage.removeItem('saved_search_run');
    }
  }, []);

  useEffect(() => {
    return () => {
      if (searchFeedbackTimeout.current) {
        window.clearTimeout(searchFeedbackTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadFavorites = async () => {
      try {
        const data = await apiRequest<{ object_number: string }[]>('favorites');
        if (isMounted) {
          setFavorites(new Set((data || []).map((row) => row.object_number)));
        }
      } catch (err) {
        console.warn('Failed to load favorites', err);
      } finally {
        if (isMounted) {
          setFavoritesLoaded(true);
        }
      }
    };
    loadFavorites();
    return () => {
      isMounted = false;
    };
  }, []);

  const runSearch = useCallback(() => {
    if (searchFeedbackTimeout.current) {
      window.clearTimeout(searchFeedbackTimeout.current);
    }
    setSearchAnimating(true);
    searchFeedbackTimeout.current = window.setTimeout(() => {
      setSearchAnimating(false);
    }, 200);

    setSearchQuery(searchInput.trim());
  }, [searchInput]);

  const resetFilters = useCallback(() => {
    setSearchInput('');
    setSearchQuery('');
    setLawFilter('Все законы');
    setStatusFilter('Все статусы');
    setMethodFilter('Все способы');
    setOkpd2Filter('');
    setInnFilter('');
    setObjectNumberFilter('');
    setIkzFilter('');
    setPriceFrom('');
    setPriceTo('');
    setStartDateFrom('');
    setEndDateTo('');
    setCurrentPage(1);
    if (searchFeedbackTimeout.current) {
      window.clearTimeout(searchFeedbackTimeout.current);
      searchFeedbackTimeout.current = null;
    }
    setSearchAnimating(false);
  }, []);

  const handleSearchSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      runSearch();
    },
    [runSearch]
  );

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
    } catch (err) {
      console.error(err);
      setFavorites(favorites);
      window.alert('Не удалось обновить избранное. Попробуйте ещё раз.');
    }
  };

  const saveSearch = useCallback(async () => {
    const name = window.prompt('Название для сохраненного поиска');
    if (!name) return;

    const filters = {
      search: searchQuery,
      law: lawFilter,
      status: statusFilter,
      method: methodFilter,
      okpd2: okpd2Filter,
      inn: innFilter,
      objectNumber: objectNumberFilter,
      ikz: ikzFilter,
      priceFrom,
      priceTo,
      startDateFrom,
      endDateTo,
    };

    try {
      await apiRequest('saved-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, filters }),
      });
      window.alert('Поиск сохранён.');
    } catch (err) {
      console.error(err);
      window.alert('Не удалось сохранить поиск.');
    }
  }, [
    searchQuery,
    lawFilter,
    statusFilter,
    methodFilter,
    okpd2Filter,
    innFilter,
    objectNumberFilter,
    ikzFilter,
    priceFrom,
    priceTo,
    startDateFrom,
    endDateTo,
  ]);

  const totalPages = Math.max(1, Math.ceil(resultsTotal / PAGE_SIZE));
  const paginatedTenders = results;
  const paginationTokens = useMemo(() => {
    if (totalPages <= 1) return [1] as Array<number | 'ellipsis'>;

    const pages = new Set<number>();
    pages.add(1);
    pages.add(totalPages);

    let start = Math.max(2, currentPage - 1);
    let end = Math.min(totalPages - 1, currentPage + 1);

    if (currentPage <= 2) {
      start = 2;
      end = Math.min(totalPages - 1, 3);
    } else if (currentPage >= totalPages - 1) {
      start = Math.max(2, totalPages - 2);
      end = totalPages - 1;
    }

    for (let p = start; p <= end; p += 1) {
      pages.add(p);
    }

    const sorted = Array.from(pages).sort((a, b) => a - b);
    const tokens: Array<number | 'ellipsis'> = [];
    for (let i = 0; i < sorted.length; i += 1) {
      const page = sorted[i];
      const prev = sorted[i - 1];
      if (prev !== undefined && page - prev > 1) {
        tokens.push('ellipsis');
      }
      tokens.push(page);
    }
    return tokens;
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchQuery,
    lawFilter,
    statusFilter,
    methodFilter,
    okpd2Filter,
    innFilter,
    objectNumberFilter,
    ikzFilter,
    priceFrom,
    priceTo,
    startDateFrom,
    endDateTo,
  ]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    let isMounted = true;
    const loadResults = async () => {
      setResultsLoading(true);
      setResultsError(null);
      try {
        const params = new URLSearchParams();
        params.set('page', String(currentPage));
        params.set('limit', String(PAGE_SIZE));
        if (searchQuery) params.set('search', searchQuery);
        if (lawFilter !== 'Все законы') params.set('fz', lawFilter);
        if (statusFilter !== 'Все статусы') params.set('stage', statusFilter);
        if (methodFilter !== 'Все способы') params.set('procedure_type', methodFilter);
        if (okpd2Filter.trim()) params.set('okpd2', okpd2Filter.trim());
        if (innFilter.trim()) params.set('inn', innFilter.trim());
        if (objectNumberFilter.trim()) params.set('object_number', objectNumberFilter.trim());
        if (ikzFilter.trim()) params.set('ikz', ikzFilter.trim());
        if (priceFrom.trim()) params.set('min_price', priceFrom.trim());
        if (priceTo.trim()) params.set('max_price', priceTo.trim());
        if (startDateFrom) params.set('start_date_from', startDateFrom);
        if (endDateTo) params.set('end_date_to', endDateTo);

        const data = await apiRequest<{ tenders?: Tender[]; total?: number }>(`tenders?${params.toString()}`);
        if (!isMounted) return;
        const items = Array.isArray(data?.tenders) ? data.tenders : [];
        setResults(items);
        const totalValue = typeof data?.total === 'number' ? data.total : items.length;
        setResultsTotal(totalValue);
      } catch (err) {
        if (!isMounted) return;
        setResultsError('Не удалось загрузить тендеры.');
        setResults([]);
        setResultsTotal(0);
      } finally {
        if (isMounted) setResultsLoading(false);
      }
    };
    loadResults();
    return () => {
      isMounted = false;
    };
  }, [
    currentPage,
    searchQuery,
    lawFilter,
    statusFilter,
    methodFilter,
    okpd2Filter,
    innFilter,
    objectNumberFilter,
    ikzFilter,
    priceFrom,
    priceTo,
    startDateFrom,
    endDateTo,
  ]);

  const handleExportResults = useCallback(() => {
    if (results.length === 0) {
      window.alert('Нет данных для экспорта. Уточните параметры поиска.');
      return;
    }

    downloadJson('tenders.json', results);
  }, [results]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1>Поиск тендеров</h1>
        <p className="text-muted-foreground">
          Поиск и фильтрация тендеров с zakupki.gov.ru
        </p>
      </div>

      <Card className="bg-white/80 border-border/70">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium">Параметры поиска</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              className="h-8 gap-2"
            >
              <Filter className="w-4 h-4" />
              Фильтры
              <ChevronDown className={`w-4 h-4 transition-transform ${isFilterOpen ? 'rotate-180' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <form className="flex flex-wrap gap-2" onSubmit={handleSearchSubmit}>
              <div className="flex-1 min-w-[220px]">
                <div className="relative">
                  <Input
                    placeholder="Поиск по ключевым словам или номеру закупки..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="pl-3 text-sm"
                    enterKeyHint="search"
                  />
                </div>
              </div>
              <Button
                type="button"
                className={`h-10 gap-2 px-5 transform transition-transform duration-200 ease-out active:scale-95 ${searchAnimating ? 'scale-95' : ''}`}
                onClick={runSearch}
              >
                <Search className="w-4 h-4" />
                Найти
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 gap-2 px-4"
                onClick={saveSearch}
              >
                <Bookmark className="w-4 h-4" />
                Сохранить поиск
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 gap-2 px-4"
                onClick={resetFilters}
              >
                <RotateCcw className="w-4 h-4" />
                Сбросить
              </Button>
            </form>

            <Collapsible open={isFilterOpen}>
              <CollapsibleContent>
                <div className="mt-4 rounded-2xl border border-border/70 bg-muted/60 p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Закон</Label>
                    <Select value={lawFilter} onValueChange={setLawFilter}>
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Выберите закон" />
                      </SelectTrigger>
                      <SelectContent>
                        {laws.map((law) => (
                          <SelectItem key={law} value={law}>
                            {law}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Способ закупки</Label>
                    <Select value={methodFilter} onValueChange={setMethodFilter}>
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Выберите способ" />
                      </SelectTrigger>
                      <SelectContent>
                        {purchaseMethods.map((method) => (
                          <SelectItem key={method} value={method}>
                            {method}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Дата публикации от</Label>
                    <Input 
                      type="date" 
                      value={startDateFrom} 
                      onChange={(e) => setStartDateFrom(e.target.value)} 
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Цена от (₽)</Label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={priceFrom}
                      onChange={(e) => setPriceFrom(e.target.value)}
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Цена до (₽)</Label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={priceTo}
                      onChange={(e) => setPriceTo(e.target.value)}
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">ОКПД</Label>
                    <Input
                      placeholder="Например, 20.41 или Наименование ОКПД"
                      value={okpd2Filter}
                      onChange={(e) => setOkpd2Filter(e.target.value)}
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Номер закупки</Label>
                    <Input
                      placeholder="Например, 0123200000326000116"
                      value={objectNumberFilter}
                      onChange={(e) => setObjectNumberFilter(e.target.value)}
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">ИНН заказчика</Label>
                    <Input
                      placeholder="Например, 7701234567"
                      value={innFilter}
                      onChange={(e) => setInnFilter(e.target.value)}
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">ИКЗ</Label>
                    <Input
                      placeholder="Идентификационный код закупки"
                      value={ikzFilter}
                      onChange={(e) => setIkzFilter(e.target.value)}
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Финальная дата подачи заявок</Label>
                    <Input 
                      type="date" 
                      value={endDateTo} 
                      onChange={(e) => setEndDateTo(e.target.value)} 
                      className="h-10"
                    />
                  </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white/80 border-border/70">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium">Результаты поиска</CardTitle>
            <div className="flex items-center gap-4">
              <span className="text-base text-muted-foreground">
                Найдено: <span className="text-foreground">{resultsTotal}</span> тендеров
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-2"
                type="button"
                onClick={handleExportResults}
              >
                <Download className="w-4 h-4" />
                Экспорт
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-hidden rounded-b-[20px]">
            {resultsError && (
              <div className="border-b border-border/70 px-4 py-3 text-sm text-red-600">
                {resultsError}
              </div>
            )}
            {resultsLoading && (
              <div className="border-b border-border/70 px-4 py-3 text-sm text-muted-foreground">
                Загружаем данные...
              </div>
            )}
            <div className="overflow-x-auto">
              <Table className="w-full border-collapse table-fixed">
                <TableHeader>
                  <TableRow className="border-b border-border/70 bg-muted/60 hover:bg-muted/60">
                    <TableHead className="w-[430px] px-3 py-3">Наименование</TableHead>
                    <TableHead className="w-[180px] px-3 py-3">Заказчик</TableHead>
                    <TableHead className="w-[120px] px-3 py-3">Площадка</TableHead>
                    <TableHead className="w-[80px] px-3 py-3">Цена</TableHead>
                    <TableHead className="w-[160px] px-3 py-3">Статус</TableHead>
                    <TableHead className="w-[110px] px-3 py-3">Срок подачи</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedTenders.map((tender) => {
                    const statusInfo = getStatusInfo(tender.etap_zakupki);
                    return (
                      <TableRow
                        key={tender.object_number}
                        className="border-b border-border/60 last:border-0 cursor-pointer hover:bg-accent/60 transition-colors"
                        onClick={() => onNavigate('details', tender.object_number)}
                      >
                        <TableCell className="w-[430px] py-4 px-3 align-top whitespace-normal">
                          <div className="space-y-2">
                            <p className="text-sm font-normal text-neutral-950 leading-5 line-clamp-3 break-words">
                              {getTenderDisplayTitle(tender)}
                            </p>
                            <div className="flex items-center gap-2">
                              <div className="border border-border/70 rounded-full px-[10px] py-[3px] inline-flex items-center justify-center bg-white/80">
                                <span className="text-[11px] font-semibold text-foreground leading-4 whitespace-nowrap">
                                  {tender.zakon || '—'}
                                </span>
                              </div>
                              {tender.placingway_name && (
                                <span className="text-sm text-muted-foreground">
                                  {decodeHtmlEntities(tender.placingway_name)}
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-4 px-3 align-middle whitespace-normal">
                          <div className="space-y-1">
                            <p className="text-sm text-neutral-950 leading-5 line-clamp-3 break-words">
                              {decodeHtmlEntities(tender.shortname || tender.fullname) || '—'}
                            </p>
                            {tender.inn && (
                            <p className="text-sm text-muted-foreground leading-5">
                              ИНН: {tender.inn}
                            </p>
                          )}
                        </div>
                      </TableCell>
                        <TableCell className="py-4 px-3 align-middle whitespace-normal">
                          {tender.etp_name ? (
                            <div className="flex items-center gap-1 h-full">
                              <Globe className="w-3 h-3 text-muted-foreground shrink-0" />
                              <span className="text-xs text-foreground line-clamp-3 break-words" title={tender.etp_name}>
                                {tender.etp_name.replace(/^АО /, '').replace(/^ООО /, '')}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-4 px-3 align-middle">
                          <div className="text-sm font-semibold text-emerald-600 whitespace-nowrap text-right">
                            {formatCurrency(tender.maxprice, tender.currency_code).replace(' ₽', '').replace(' RUB', '')}
                          </div>
                        </TableCell>
                        <TableCell className="py-4 px-3 align-middle">
                          <div
                            className={`inline-flex max-w-full rounded-full px-[10px] py-[4px] items-center justify-center ${statusInfo.color.replace('border', '')}`}
                          >
                            <span className="text-[11px] font-semibold leading-4 text-center whitespace-normal break-words [overflow-wrap:anywhere]">
                              {statusInfo.label}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="py-4 px-3 align-middle">
                          {tender.enddt ? (
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-muted-foreground shrink-0" />
                              <span className="text-sm text-foreground whitespace-nowrap">
                                {formatDate(tender.enddt)} г.
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between border-t border-border/70 px-4 py-3 text-sm text-muted-foreground">
              <span>Показано {paginatedTenders.length} из {resultsTotal} • по {PAGE_SIZE} на странице</span>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                >
                  Назад
                </Button>
                <div className="flex items-center gap-1">
                  {paginationTokens.map((token, index) => {
                    if (token === 'ellipsis') {
                      return (
                        <span key={`ellipsis-${index}`} className="px-1 text-base text-muted-foreground">
                          …
                        </span>
                      );
                    }

                    const page = token;
                    const isActive = page === currentPage;
                    return (
                      <button
                        key={page}
                        type="button"
                        className={
                          isActive
                            ? 'h-10 w-10 rounded-full bg-slate-200 text-primary text-lg font-semibold'
                            : 'h-10 w-10 rounded-full text-muted-foreground text-lg font-medium hover:bg-muted/60'
                        }
                        onClick={() => setCurrentPage(page)}
                        disabled={isActive}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        {page}
                      </button>
                    );
                  })}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                >
                  Вперёд
                </Button>
                <span className="text-sm text-foreground whitespace-nowrap">
                  Стр. {currentPage} из {totalPages}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
