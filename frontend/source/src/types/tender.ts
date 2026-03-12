// Типы для работы с тендерами из zakupki.gov.ru

export interface Tender {
  // Ключи/идентификаторы
  id: number;
  object_number: string;
  href?: string;
  zakon?: string;
  kotirovki?: string;
  url_223_xml?: string;
  etap_zakupki?: string;

  // Общее
  object_info?: string;
  object_description?: string;
  placingway_code?: string;
  placingway_name?: string;

  // Площадка
  etp_code?: string;
  etp_name?: string;
  etp_url?: string;
  onst83ch2?: string;

  // Даты/этапы/цены
  startdt?: string;
  enddt?: string;
  biddingdt?: string;
  summarizingdt?: string;

  maxprice?: number;
  currency_code?: string;
  currency_name?: string;

  // Обеспечение закупки
  bik?: string;
  settlementaccount?: string;
  personalaccount?: string;
  creditorgname?: string;
  corraccountnumber?: string;
  procedureinfo?: string;
  part?: number;

  publicdiscussion?: string;
  ikz_code?: string;
  ikz_customercode?: string;
  ikz_number?: string;
  ikz_ordernumber?: string;

  okpd2info?: string;
  industry_keyword?: string;
  industry_okpd2?: string;
  kvr_code?: string;
  kvr_info?: string;

  contract_enddate?: string;
  finance_total?: number;

  countrycode?: string;
  countryfullname?: string;
  garaddress?: string;
  deliveryplace?: string;
  onesiderejectionst95?: string;

  servicerequirement?: string;
  manufacturerequirement?: string;
  warrantytermdt?: string;
  addinfo?: string;

  preferense_code?: string;
  preferense_name?: string;
  requirement_1?: string;
  requirement_2?: string;
  objectsch9st37?: string;

  // Организация-заказчик
  regnum?: string;
  consregistrynum?: string;
  fullname?: string;
  shortname?: string;
  postaddress?: string;
  factaddress?: string;
  inn?: string;
  kpp?: string;
  responsiblerole?: string;

  // Контакты
  orgpostaddress?: string;
  orgfactaddress?: string;
  person_lastname?: string;
  person_firstname?: string;
  person_middlename?: string;
  contactemail?: string;
  contactphone?: string;
  contactfax?: string;

  // Связанные данные
  items?: TenderItem[];
  attachments?: TenderAttachment[];

  // Аналитика
  analytics?: unknown;
  risk_score?: number;
  risk_reasons?: string[];
  estimated_complexity?: string | number;
  estimated_winner_type?: string;
  key_requirements?: string[];
  key_terms?: string[] | Record<string, unknown>;
  positions_with_foreign_ban?: string[];
  positions_with_subcontractor_req?: string[];
  guarantee_percent?: number;
  delivery_days?: number;
  warranty_months?: number;
  is_subcontractors_req?: boolean;
  has_impossible_deadlines?: boolean;
  has_payment_guarantees_req?: boolean;
  has_strict_quality_requirements?: boolean;
  has_technical_audit_req?: boolean;
  recommendation_text?: string;
  summary?: string;
  items_analysis?: string;
}

export interface TenderItem {
  id: number;
  object_number: string;
  item_name?: string;
  item_code?: string;
  okpdcode?: string;
  okpdname?: string;
  quantity_name?: string;
  price_for_one?: number;
  quantity_value?: number;
  total_sum?: number;
}

export interface TenderAttachment {
  id: number;
  object_number: string;
  published_content_id?: string;
  file_name?: string;
  doc_kind_code?: string;
  doc_kind_name?: string;
  file_size?: number;
  doc_date?: string;
  url?: string;
  // Fields from attachments_summary
  summary?: string;
  key_requirements?: string[];
  key_terms?: {
    payment_type?: string;
    delivery_days?: string | number;
    warranty_months?: number;
    quality_standard?: string;
    guarantee_percent?: number;
    archive_documents?: ArchiveDocumentAnalysis[];
    archive_total_files?: number;
    archive_processed_files?: number;
    archive_failed_files?: number;
    archive_skipped_files?: number;
    archive_skipped_by_limit?: number;
  } | null;
  risk_flags?: string[];
}

export interface ArchiveDocumentAnalysis {
  file_name?: string;
  file_size?: number;
  status?: 'done' | 'failed' | string;
  summary?: string;
  key_terms?: {
    payment_type?: string;
    delivery_days?: string | number;
    warranty_months?: number;
    quality_standard?: string;
    guarantee_percent?: number;
  } | null;
  key_requirements?: string[];
  risk_flags?: string[];
  llm_model?: string | null;
  llm_used_tokens?: number | null;
}

// Утилиты для отображения

/**
 * Декодирует HTML-сущности в тексте
 */
export const decodeHtmlEntities = (text?: string): string => {
  if (!text) return '';
  
  let decoded = text
    .replace(/&quot;/g, '"')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8230;/g, '…');
  
  // Декодирование числовых HTML-сущностей
  decoded = decoded.replace(/&#(\d+);/g, (match, dec) => {
    return String.fromCharCode(parseInt(dec, 10));
  });
  
  // Декодирование шестнадцатеричных HTML-сущностей
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
  
  return decoded.trim();
};

const firstNonEmptyText = (...values: Array<string | null | undefined>) => {
  const isPlaceholder = (value: string) => {
    const normalized = value.trim().toLowerCase();
    return normalized === 'null' || normalized === 'undefined' || normalized === 'none' || normalized === 'n/a';
  };

  for (const value of values) {
    if (typeof value === 'string' && value.trim() && !isPlaceholder(value)) {
      return value;
    }
  }
  return null;
};

export const getTenderDisplayTitle = (tender?: Partial<Tender> | null) => {
  if (!tender) return '—';
  const firstItemName = tender.items?.find((item) => item?.item_name?.trim())?.item_name;
  const firstItemOkpdCode = tender.items?.find((item) => item?.okpdcode?.trim())?.okpdcode;
  const firstItemOkpdName = tender.items?.find((item) => item?.okpdname?.trim())?.okpdname;
  const firstItemOkpd = firstNonEmptyText(
    firstItemOkpdCode && firstItemOkpdName ? `${firstItemOkpdCode} - ${firstItemOkpdName}` : null,
    firstItemOkpdName,
    firstItemOkpdCode,
  );
  const okpdTitle = firstNonEmptyText(
    tender.okpd2info,
    tender.industry_okpd2,
    firstItemOkpd,
  );
  const title = firstNonEmptyText(
    tender.object_info,
    tender.object_description,
    tender.kvr_info,
    tender.kotirovki,
    firstItemName,
    okpdTitle,
    tender.placingway_name,
  );
  return title ? decodeHtmlEntities(title) : '—';
};

export const formatCurrency = (amount?: number, currency?: string) => {
  if (amount === undefined || amount === null || Number.isNaN(amount)) {
    return '—';
  }
  const formatted = new Intl.NumberFormat('ru-RU').format(amount);
  return `${formatted} ${currency || '₽'}`;
};

const sanitizeDateString = (value: string) => value.trim().replace(/^['"]+|['"]+$/g, '');
const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const tryParsePatterns = (value: string) => {
  const trimmed = sanitizeDateString(value);
  if (!trimmed) return null;

  const direct = Date.parse(trimmed);
  if (!Number.isNaN(direct)) {
    return new Date(direct);
  }

  const isoCandidate = trimmed.replace(/\./g, '-').replace(/\//g, '-');
  const isoTimestamp = Date.parse(isoCandidate);
  if (!Number.isNaN(isoTimestamp)) {
    return new Date(isoTimestamp);
  }

  const datePart = trimmed.split(/[T\s]/)[0];
  if (datePart) {
    const cleaned = datePart.replace(/[^\d]/g, '');
    if (cleaned.length === 8) {
      const day = cleaned.slice(0, 2);
      const month = cleaned.slice(2, 4);
      const year = cleaned.slice(4);
      const parsed = Date.parse(`${year}-${month}-${day}T00:00:00`);
      if (!Number.isNaN(parsed)) {
        return new Date(parsed);
      }
    }
    if (cleaned.length === 14) {
      const day = cleaned.slice(0, 2);
      const month = cleaned.slice(2, 4);
      const year = cleaned.slice(4, 8);
      const hours = cleaned.slice(8, 10);
      const minutes = cleaned.slice(10, 12);
      const seconds = cleaned.slice(12, 14);
      const parsed = Date.parse(`${year}-${month}-${day}T${hours}:${minutes}:${seconds}`);
      if (!Number.isNaN(parsed)) {
        return new Date(parsed);
      }
    }
  }

  return null;
};

export const parseDate = (value?: string) => {
  if (!value) return null;
  const parsed = tryParsePatterns(value);
  if (parsed) return parsed;
  return null;
};

export const formatDate = (date?: string) => {
  if (!date) return '—';
  const parsed = parseDate(date);
  if (parsed) {
    return dateFormatter.format(parsed);
  }
  return sanitizeDateString(date);
};

export const pluralizeDays = (value: number) => {
  const abs = Math.abs(value) % 100;
  const lastDigit = abs % 10;
  if (abs > 10 && abs < 20) {
    return 'дней';
  }
  if (lastDigit > 1 && lastDigit < 5) {
    return 'дня';
  }
  if (lastDigit === 1) {
    return 'день';
  }
  return 'дней';
};

export const formatFileSize = (bytes?: number) => {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
  return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
};

export const getStatusInfo = (etap?: string) => {
  const statuses: Record<string, { label: string; color: string }> = {
    'Прием заявок': { label: 'Подача заявок', color: 'bg-green-100 text-green-700 border-green-300' },
    'Подача заявок': { label: 'Подача заявок', color: 'bg-green-100 text-green-700 border-green-300' },
    'Работа комиссии': { label: 'Работа комиссии', color: 'bg-blue-100 text-blue-700 border-blue-300' },
    'Определен победитель': { label: 'Победитель определен', color: 'bg-purple-100 text-purple-700 border-purple-300' },
    'Отменен': { label: 'Отменено', color: 'bg-red-50 text-red-600 border-red-200' },
    'Завершена': { label: 'Завершено', color: 'bg-slate-100 text-slate-700 border-slate-300' },
  };
  
  return (
    statuses[etap || ''] || {
      label: etap || 'Не указан',
      color: 'bg-gray-100 text-gray-700 border-gray-300',
    }
  );
};
