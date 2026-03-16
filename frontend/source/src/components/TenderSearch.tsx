import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Search,
  Filter,
  Star,
  Download,
  Calendar,
  ChevronDown,
  Bookmark,
  RotateCcw,
} from 'lucide-react';
import { Collapsible, CollapsibleContent } from './ui/collapsible';
import {
  formatCurrency,
  formatDate,
  getStatusInfo,
  decodeHtmlEntities,
  getTenderDisplayTitle,
  type Tender,
} from '../types/tender';
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
  const [regionFilter, setRegionFilter] = useState('');
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
      if (tender.etap_zakupki) uniqueStatuses.add(tender.etap_zakupki);
    });
    return Array.from(uniqueStatuses);
  }, [results]);

  const purchaseMethods = useMemo(() => {
    const uniqueMethods = new Set<string>();
    uniqueMethods.add('Все способы');
    results.forEach((tender) => {
      if (tender.placingway_name) uniqueMethods.add(tender.placingway_name);
    });
    return Array.from(uniqueMethods);
  }, [results]);

  const laws = ['Все законы', '44-ФЗ', '223-ФЗ'];

  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    if (searchInput === '' && searchQuery !== '') setSearchQuery('');
  }, [searchInput, searchQuery]);

  useEffect(() => {
    const raw = window.localStorage.getItem('saved_search_run');
    if (!raw) return;
    try {
      const payload = normalizeSavedSearchFilters(JSON.parse(raw));
      setSearchInput(payload.search);
      setSearchQuery(payload.search);
      setLawFilter(payload.law || 'Все законы');
      setRegionFilter(payload.region || '');
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
      if (searchFeedbackTimeout.current) window.clearTimeout(searchFeedbackTimeout.current);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadFavorites = async () => {
      try {
        const data = await apiRequest<{ object_number: string }[]>('favorites');
        if (isMounted) setFavorites(new Set((data || []).map((row) => row.object_number)));
      } catch (err) {
        console.warn('Failed to load favorites', err);
      } finally {
        if (isMounted) setFavoritesLoaded(true);
      }
    };
    void loadFavorites();
    return () => {
      isMounted = false;
    };
  }, []);

  const runSearch = useCallback(() => {
    if (searchFeedbackTimeout.current) window.clearTimeout(searchFeedbackTimeout.current);
    setSearchAnimating(true);
    searchFeedbackTimeout.current = window.setTimeout(() => setSearchAnimating(false), 200);
    setSearchQuery(searchInput.trim());
  }, [searchInput]);

  const resetFilters = useCallback(() => {
    setSearchInput('');
    setSearchQuery('');
    setLawFilter('Все законы');
    setRegionFilter('');
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
    [runSearch],
  );

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
      region: regionFilter,
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
    regionFilter,
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

    for (let i = 2; i <= Math.min(10, totalPages - 1); i += 1) pages.add(i);

    if (totalPages > 10) {
      const pivot = Math.max(15, Math.floor((currentPage - 1) / 5) * 5 + 5);
      for (let p = pivot; p <= Math.min(totalPages - 1, pivot + 20); p += 5) {
        pages.add(p);
      }
    }

    pages.add(currentPage);

    const sorted = Array.from(pages)
      .filter((page) => page >= 1 && page <= totalPages)
      .sort((a, b) => a - b);

    const tokens: Array<number | 'ellipsis'> = [];
    for (let i = 0; i < sorted.length; i += 1) {
      const page = sorted[i];
      const prev = sorted[i - 1];
      if (prev !== undefined && page - prev > 1) tokens.push('ellipsis');
      tokens.push(page);
    }
    return tokens;
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchQuery,
    lawFilter,
    regionFilter,
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
    if (currentPage > totalPages) setCurrentPage(totalPages);
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
        if (regionFilter.trim()) params.set('region', regionFilter.trim());
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
      } catch {
        if (!isMounted) return;
        setResultsError('Не удалось загрузить тендеры.');
        setResults([]);
        setResultsTotal(0);
      } finally {
        if (isMounted) setResultsLoading(false);
      }
    };
    void loadResults();
    return () => {
      isMounted = false;
    };
  }, [
    currentPage,
    searchQuery,
    lawFilter,
    regionFilter,
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
    <div className="space-y-4">
      <section className="surface-card p-4 md:p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-[20px] leading-6 font-extrabold text-[#111827]">Параметры поиска</h2>
          <button
            type="button"
            onClick={() => setIsFilterOpen((prev) => !prev)}
            className="inline-flex items-center gap-2 text-[14px] font-semibold text-[#1f2937]"
          >
            <Filter className="h-4 w-4" />
            Фильтры
            <ChevronDown className={`h-4 w-4 transition-transform ${isFilterOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>

        <form className="mb-4" onSubmit={handleSearchSubmit}>
          <div className="flex flex-wrap items-center gap-2 border-b border-[#e5e7eb] pb-4">
            <div className="min-w-[320px] flex-1 basis-[420px]">
              <Input
                placeholder="Поиск по ключевым словам..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-9 rounded-[10px] border-[#d9dee7] bg-white px-4 text-[14px] placeholder:text-[#a0a8b5]"
                enterKeyHint="search"
              />
            </div>
            <Button
              type="button"
              className={`h-9 rounded-[10px] bg-[#2da36b] px-5 text-[14px] font-semibold text-white hover:bg-[#248e5c] ${searchAnimating ? 'scale-[0.99]' : ''}`}
              onClick={runSearch}
            >
              <Search className="mr-2 h-4 w-4" />
              Найти
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-[10px] border-[#d9dee7] bg-white px-4 text-[14px] font-medium text-[#2f3542]"
              onClick={saveSearch}
            >
              <Bookmark className="mr-2 h-4 w-4" />
              Сохранить поиск
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-[10px] border-[#d9dee7] bg-white px-4 text-[14px] font-medium text-[#2f3542]"
              onClick={resetFilters}
            >
              <Bookmark className="mr-2 h-4 w-4" />
              Сбросить поиск
            </Button>
          </div>

          <Collapsible open={isFilterOpen}>
            <CollapsibleContent>
              <div className="grid grid-cols-1 gap-x-6 gap-y-3 pt-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1.5">
                  <Label className="text-[15px] font-medium text-[#2f3542]">Закон</Label>
                  <Select value={lawFilter} onValueChange={setLawFilter}>
                    <SelectTrigger className="h-9 rounded-[10px] border-[#d9dee7] bg-white px-4 text-[14px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {laws.map((law) => (
                        <SelectItem key={law} value={law}>{law}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[15px] font-medium text-[#2f3542]">Регион</Label>
                  <Input
                    value={regionFilter}
                    onChange={(e) => setRegionFilter(e.target.value)}
                    className="h-9 rounded-[10px] border-[#d9dee7] bg-white px-4 text-[14px]"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[15px] font-medium text-[#2f3542]">Способ закупки</Label>
                  <Select value={methodFilter} onValueChange={setMethodFilter}>
                    <SelectTrigger className="h-9 rounded-[10px] border-[#d9dee7] bg-white px-4 text-[14px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {purchaseMethods.map((method) => (
                        <SelectItem key={method} value={method}>{method}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[15px] font-medium text-[#2f3542]">Дата публикации от</Label>
                  <Input type="date" value={startDateFrom} onChange={(e) => setStartDateFrom(e.target.value)} className="h-9 rounded-[10px] border-[#d9dee7] bg-white px-4 text-[14px]" />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[15px] font-medium text-[#2f3542]">Цена от (₽)</Label>
                  <Input type="number" placeholder="0" value={priceFrom} onChange={(e) => setPriceFrom(e.target.value)} className="h-9 rounded-[10px] border-[#d9dee7] bg-white px-4 text-[14px]" />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[15px] font-medium text-[#2f3542]">Цена до (₽)</Label>
                  <Input type="number" placeholder="0" value={priceTo} onChange={(e) => setPriceTo(e.target.value)} className="h-9 rounded-[10px] border-[#d9dee7] bg-white px-4 text-[14px]" />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[15px] font-medium text-[#2f3542]">ОКПД</Label>
                  <Input placeholder="" value={okpd2Filter} onChange={(e) => setOkpd2Filter(e.target.value)} className="h-9 rounded-[10px] border-[#d9dee7] bg-white px-4 text-[14px]" />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[15px] font-medium text-[#2f3542]">Номер закупки</Label>
                  <Input placeholder="" value={objectNumberFilter} onChange={(e) => setObjectNumberFilter(e.target.value)} className="h-9 rounded-[10px] border-[#d9dee7] bg-white px-4 text-[14px]" />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[15px] font-medium text-[#2f3542]">ИНН заказчика</Label>
                  <Input placeholder="0" value={innFilter} onChange={(e) => setInnFilter(e.target.value)} className="h-9 rounded-[10px] border-[#d9dee7] bg-white px-4 text-[14px]" />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[15px] font-medium text-[#2f3542]">ИКЗ</Label>
                  <Input placeholder="0" value={ikzFilter} onChange={(e) => setIkzFilter(e.target.value)} className="h-9 rounded-[10px] border-[#d9dee7] bg-white px-4 text-[14px]" />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </form>
      </section>

      <section className="surface-card p-4 md:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[24px] leading-7 font-extrabold text-[#303744]">Результаты поиска</h2>
          <div className="flex items-center gap-4 text-[14px] text-[#6f7783]">
            <span>
              Найдено: <span className="font-bold text-[#232a37]">{resultsTotal}</span> тендеров
            </span>
            <Button type="button" variant="outline" className="h-10 rounded-[10px] border-[#d8dee6] px-4 text-[14px]" onClick={handleExportResults}>
              <Download className="mr-2 h-4 w-4" />
              Экспорт
            </Button>
          </div>
        </div>

        {resultsError ? <div className="mb-2 rounded-[10px] bg-[#fff4eb] px-3 py-2 text-[14px] text-[#bb5a2c]">{resultsError}</div> : null}
        {resultsLoading ? <div className="mb-2 rounded-[10px] bg-[#f5f7fb] px-3 py-2 text-[14px] text-[#7a8390]">Загружаем данные...</div> : null}

        <div className="space-y-2">
          {paginatedTenders.map((tender) => {
            const statusInfo = getStatusInfo(tender.etap_zakupki);
            const organization = decodeHtmlEntities(tender.shortname || tender.fullname || '—');
            const region = decodeHtmlEntities(((tender as any).region_name || (tender as any).region || '').toString());
            return (
              <article
                key={tender.object_number}
                className="rounded-[12px] border border-[#dde2ea] bg-white p-3 transition hover:bg-[#f8fbff]"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onNavigate('details', tender.object_number)}>
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <Badge className="rounded-[5px] bg-[#3e4556] px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-[#3e4556]">
                        {tender.zakon || '—'}
                      </Badge>
                      <span className="rounded-[5px] bg-[#d7f2e2] px-2 py-0.5 text-[12px] font-bold text-[#20814f]">{statusInfo.label}</span>
                      <span className="text-[16px] text-[#9aa0ab]">{decodeHtmlEntities(tender.etp_name || '').replace(/^АО /, '').replace(/^ООО /, '') || '—'}</span>
                    </div>
                    <h3 className="line-clamp-2 text-[16px] leading-5 text-[#2d3442]">{getTenderDisplayTitle(tender)}</h3>
                    <div className="mt-1 text-[14px] text-[#7f8794]">{decodeHtmlEntities(tender.placingway_name || '—')}</div>
                    <div className="mt-1 text-[24px] font-extrabold leading-7 text-[#2da36b]">
                      {formatCurrency(tender.maxprice, tender.currency_code).replace(' RUB', '')}
                    </div>
                  </div>

                  <div className="flex min-w-0 flex-row items-end justify-between gap-3 sm:min-w-[230px] lg:block">
                    <button
                      type="button"
                      className="rounded-[8px] border border-[#d9dee7] p-1.5 text-[#7f8895] hover:bg-[#f4f7fb]"
                      disabled={!favoritesLoaded}
                      onClick={() => toggleFavorite(tender.object_number)}
                    >
                      <Star className={`h-4 w-4 ${favorites.has(tender.object_number) ? 'fill-[#2da36b] text-[#2da36b]' : ''}`} />
                    </button>
                    <div className="mt-2 text-right lg:text-left">
                      <div className="line-clamp-1 text-[14px] text-[#2f3643]">{organization}</div>
                      <div className="line-clamp-1 text-[14px] text-[#9aa0ab]">{region || '—'}</div>
                      <div className="mt-1 inline-flex items-center gap-1 text-[12px] text-[#2f3643]">
                        <Calendar className="h-3.5 w-3.5 text-[#8c94a1]" />
                        {formatDate(tender.enddt)} г.
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}

          {!resultsLoading && paginatedTenders.length === 0 ? (
            <div className="rounded-[10px] border border-[#e1e6ee] bg-[#f7f9fc] px-3 py-4 text-[14px] text-[#7f8794]">
              Ничего не найдено. Измените параметры поиска.
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#e1e6ee] pt-3 text-[14px] text-[#6f7783]">
          <span>
            Показано {paginatedTenders.length} из {resultsTotal} • по {PAGE_SIZE} на странице
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-full border-[#d5dbe5] px-4"
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              Назад
            </Button>
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {paginationTokens.map((token, index) => {
                if (token === 'ellipsis') {
                  return (
                    <span key={`ellipsis-${index}`} className="px-1 text-[14px] text-[#8f96a2]">
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
                        ? 'h-10 w-10 rounded-full bg-[#c7d6ef] text-[14px] font-bold text-[#1e4fa2]'
                        : 'h-10 w-10 rounded-full text-[14px] font-medium text-[#6e7888] hover:bg-[#e8edf5]'
                    }
                    onClick={() => setCurrentPage(page)}
                    disabled={isActive}
                  >
                    {page}
                  </button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-full border-[#d5dbe5] px-4"
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
            >
              Вперёд
            </Button>
            <span className="whitespace-nowrap text-[14px] text-[#2f3643]">
              Стр. {currentPage} из {totalPages}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
