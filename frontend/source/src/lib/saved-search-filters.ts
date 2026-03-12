export type SavedSearchFilters = {
  search: string;
  law: string;
  region: string;
  status: string;
  method: string;
  okpd2: string;
  inn: string;
  objectNumber: string;
  ikz: string;
  priceFrom: string;
  priceTo: string;
  startDateFrom: string;
  startDateTo: string;
  endDateFrom: string;
  endDateTo: string;
};

const DEFAULT_FILTERS: SavedSearchFilters = {
  search: '',
  law: '',
  region: '',
  status: '',
  method: '',
  okpd2: '',
  inn: '',
  objectNumber: '',
  ikz: '',
  priceFrom: '',
  priceTo: '',
  startDateFrom: '',
  startDateTo: '',
  endDateFrom: '',
  endDateTo: '',
};

function asObject(input: unknown): Record<string, unknown> {
  if (!input) return {};
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return '';
}

function normalizeLaw(value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  if (raw === '44') return '44-ФЗ';
  if (raw === '223') return '223-ФЗ';
  if (/^44\b/i.test(raw)) return '44-ФЗ';
  if (/^223\b/i.test(raw)) return '223-ФЗ';
  return raw;
}

export function normalizeSavedSearchFilters(input: unknown): SavedSearchFilters {
  const obj = asObject(input);

  return {
    ...DEFAULT_FILTERS,
    search: pickString(obj, ['search', 'query', 'searchString', 'keyword']),
    law: normalizeLaw(pickString(obj, ['law', 'fz', 'zakon'])),
    region: pickString(obj, ['region', 'deliveryplace']),
    status: pickString(obj, ['status', 'stage', 'etap_zakupki']),
    method: pickString(obj, ['method', 'procedure_type', 'placingway_name']),
    okpd2: pickString(obj, ['okpd2', 'okpd']),
    inn: pickString(obj, ['inn']),
    objectNumber: pickString(obj, ['objectNumber', 'object_number', 'regNumber', 'reg_number']),
    ikz: pickString(obj, ['ikz', 'ikz_number', 'ikz_code']),
    priceFrom: pickString(obj, ['priceFrom', 'min_price', 'minPrice']),
    priceTo: pickString(obj, ['priceTo', 'max_price', 'maxPrice']),
    startDateFrom: pickString(obj, ['startDateFrom', 'start_date_from', 'publishDateFrom']),
    startDateTo: pickString(obj, ['startDateTo', 'start_date_to', 'publishDateTo']),
    endDateFrom: pickString(obj, ['endDateFrom', 'end_date_from']),
    endDateTo: pickString(obj, ['endDateTo', 'end_date_to']),
  };
}
