import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { mockTenders } from '../data/mockTenders';
import type { Tender, TenderAttachment, TenderItem } from '../types/tender';
import { clearSession, isSessionValid, loadSession } from '../lib/auth';

interface TendersContextValue {
  tenders: Tender[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const TendersContext = createContext<TendersContextValue | undefined>(undefined);

type RawTender = Omit<Tender, 'items' | 'attachments'> & {
  items?: unknown;
  attachments?: unknown;
  attachments_summary?: unknown;
  analytics?: unknown;
  maxprice?: unknown;
  finance_total?: unknown;
  part?: unknown;
};

type RawPayload =
  | RawTender[]
  | {
      tenders?: RawTender[];
      tender_items?: TenderItem[];
      tender_attachments?: TenderAttachment[];
      items?: TenderItem[];
      attachments?: TenderAttachment[];
      data?: RawTender[];
      tenders_gov?: RawTender[];
    }
  | Array<{
      filename?: string;
      content?: string;
    }>;

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/\s+/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const getStoredSupabaseToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  const keys = Object.keys(localStorage);
  const tokenKey = keys.find((key) => key.startsWith('sb-') && key.endsWith('-auth-token'));
  if (!tokenKey) return null;
  const raw = localStorage.getItem(tokenKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { access_token?: string } | null;
    return parsed?.access_token ?? null;
  } catch {
    return null;
  }
};

const normalizeTenders = (payload: RawPayload): Tender[] => {
  // Обработка новой структуры с filename и content
  if (Array.isArray(payload) && payload.length > 0 && payload[0] && typeof payload[0] === 'object' && 'content' in payload[0]) {
    // Новая структура: массив объектов с filename и content
    const allTenders: RawTender[] = [];
    
    for (const wrapper of payload) {
      if (!wrapper || typeof wrapper !== 'object' || !('content' in wrapper)) continue;
      
      const content = wrapper.content;
      if (typeof content !== 'string') continue;
      
      try {
        const parsedContent = JSON.parse(content) as RawTender[];
        if (Array.isArray(parsedContent)) {
          allTenders.push(...parsedContent);
        }
      } catch (e) {
        console.warn('Не удалось распарсить content:', e);
      }
    }
    
    if (allTenders.length === 0) {
      return [];
    }
    
    // Обрабатываем тендеры с вложенными items и attachments
    return allTenders.map((raw, index) => {
      const objectNumber = raw.object_number ?? `${raw.id ?? index + 1}`;
      
      // Извлекаем items и attachments из самого тендера
      const tenderItems: TenderItem[] = Array.isArray(raw.items)
        ? (raw.items as unknown[]).map((item: unknown, itemIndex: number) => {
            const typedItem = item as TenderItem;
            const itemId = typeof typedItem.id === 'string'
              ? (toNumber(typedItem.id) ?? itemIndex + 1)
              : (typeof typedItem.id === 'number' ? typedItem.id : itemIndex + 1);
            return {
              ...typedItem,
              id: itemId,
              object_number: typedItem.object_number ?? objectNumber,
              price_for_one: toNumber(typedItem.price_for_one),
              quantity_value: toNumber(typedItem.quantity_value),
              total_sum: toNumber(typedItem.total_sum),
            };
          })
        : [];
      
      const attachmentsSummary = Array.isArray(raw.attachments_summary) 
        ? (raw.attachments_summary as any[]) 
        : [];

      const tenderAttachments: TenderAttachment[] = Array.isArray(raw.attachments)
        ? (raw.attachments as unknown[]).map((attachment: unknown, attachIndex: number) => {
            const typedAttachment = attachment as TenderAttachment;
            const attachId = typeof typedAttachment.id === 'string'
              ? (toNumber(typedAttachment.id) ?? attachIndex + 1)
              : (typeof typedAttachment.id === 'number' ? typedAttachment.id : attachIndex + 1);
            
            // Find matching summary
            const summaryData = attachmentsSummary.find(s => 
              String(s.attachment_id) === String(typedAttachment.id) || 
              String(s.id) === String(typedAttachment.id)
            );

            return {
              ...typedAttachment,
              id: attachId,
              object_number: typedAttachment.object_number ?? objectNumber,
              file_size: toNumber(typedAttachment.file_size),
              // Merge summary fields
              summary: summaryData?.summary,
              key_requirements: summaryData?.key_requirements,
              key_terms: summaryData?.key_terms,
              risk_flags: summaryData?.risk_flags || summaryData?.risks,
            };
          })
        : [];
      
      // Обрабатываем id - может быть строкой или числом
      const tenderId = typeof raw.id === 'string' 
        ? (toNumber(raw.id) ?? index + 1)
        : (typeof raw.id === 'number' ? raw.id : index + 1);
      
      const analytics = (raw as any).analytics || {};

      return {
        ...raw,
        id: tenderId,
        object_number: objectNumber,
        maxprice: toNumber(raw.maxprice),
        finance_total: toNumber(raw.finance_total),
        part: toNumber(raw.part),
        items: tenderItems,
        attachments: tenderAttachments,

        // Маппинг полей аналитики из content или вложенного объекта analytics
        analytics: analytics,
        items_analysis: analytics.items_analysis ?? (raw as any).items_analysis,
        risk_score: toNumber(analytics.risk_score) ?? (raw as any).risk_score,
        risk_reasons: analytics.risk_reasons ?? (raw as any).risk_reasons,
        estimated_complexity: analytics.estimated_complexity ?? (raw as any).estimated_complexity,
        estimated_winner_type: analytics.estimated_winner_type ?? (raw as any).estimated_winner_type,
        key_requirements: analytics.key_requirements ?? (raw as any).key_requirements,
        key_terms: analytics.key_terms ?? (raw as any).key_terms,
        positions_with_foreign_ban: analytics.positions_with_foreign_ban ?? (raw as any).positions_with_foreign_ban,
        positions_with_subcontractor_req: analytics.positions_with_subcontractor_req ?? (raw as any).positions_with_subcontractor_req,
        guarantee_percent: toNumber(analytics.guarantee_percent) ?? toNumber((raw as any).guarantee_percent),
        delivery_days: toNumber(analytics.delivery_days) ?? toNumber((raw as any).delivery_days),
        warranty_months: toNumber(analytics.warranty_months) ?? toNumber((raw as any).warranty_months),
        is_subcontractors_req: analytics.is_subcontractors_req ?? (raw as any).is_subcontractors_req,
        has_impossible_deadlines: analytics.has_impossible_deadlines ?? (raw as any).has_impossible_deadlines,
        has_payment_guarantees_req: analytics.has_payment_guarantees_req ?? (raw as any).has_payment_guarantees_req,
        has_strict_quality_requirements: analytics.has_strict_quality_requirements ?? (raw as any).has_strict_quality_requirements,
        has_technical_audit_req: analytics.has_technical_audit_req ?? (raw as any).has_technical_audit_req,
        recommendation_text: analytics.recommendation_text ?? (raw as any).recommendation_text,
        summary: analytics.summary ?? (raw as any).summary,
      };
    });
  }

  // Старая структура данных (для обратной совместимости)
  let rawTenders: RawTender[] | undefined;
  
  if (Array.isArray(payload)) {
    // Check if it's the new structure (array of content objects)
    if (payload.length > 0 && 'content' in payload[0]) {
      // Already handled above, so rawTenders stays undefined here to skip the block
      rawTenders = undefined;
    } else {
      // Standard array of tenders
      rawTenders = payload as RawTender[];
    }
  } else {
    rawTenders = payload?.tenders ??
      payload?.tenders_gov ??
      payload?.data ??
      (Array.isArray((payload as { results?: RawTender[] }).results)
        ? (payload as { results: RawTender[] }).results
        : undefined);
  }

  if (!rawTenders || rawTenders.length === 0) {
    return [];
  }

  const itemsSource =
    (!Array.isArray(payload) && (payload.tender_items || payload.items)) || [];
  const attachmentsSource =
    (!Array.isArray(payload) && (payload.tender_attachments || payload.attachments)) || [];

  const itemsByTender = new Map<string, TenderItem[]>();
  const attachmentsByTender = new Map<string, TenderAttachment[]>();

  if (Array.isArray(itemsSource)) {
    for (const item of itemsSource) {
      if (!item?.object_number) continue;
      const itemId = typeof item.id === 'string'
        ? (toNumber(item.id) ?? 0)
        : (typeof item.id === 'number' ? item.id : 0);
      const nextItem: TenderItem = {
        ...item,
        id: itemId,
        price_for_one: toNumber(item.price_for_one),
        quantity_value: toNumber(item.quantity_value),
        total_sum: toNumber(item.total_sum),
      };
      const list = itemsByTender.get(item.object_number) ?? [];
      list.push(nextItem);
      itemsByTender.set(item.object_number, list);
    }
  }

  if (Array.isArray(attachmentsSource)) {
    for (const attachment of attachmentsSource) {
      if (!attachment?.object_number) continue;
      const attachId = typeof attachment.id === 'string'
        ? (toNumber(attachment.id) ?? 0)
        : (typeof attachment.id === 'number' ? attachment.id : 0);
      const nextAttachment: TenderAttachment = {
        ...attachment,
        id: attachId,
        file_size: toNumber(attachment.file_size),
      };
      const list = attachmentsByTender.get(attachment.object_number) ?? [];
      list.push(nextAttachment);
      attachmentsByTender.set(attachment.object_number, list);
    }
  }

  return rawTenders.map((raw, index) => {
    const objectNumber = raw.object_number ?? `${raw.id ?? index + 1}`;
    const tenderId = typeof raw.id === 'string' 
      ? (toNumber(raw.id) ?? index + 1)
      : (typeof raw.id === 'number' ? raw.id : index + 1);
    
    // Helper to safely get nested properties with multiple casing options
    const analytics: any = (raw as any).analytics || {};
    
    const getField = (keySnake: string, keyCamel: string) => {
      return analytics[keySnake] ?? analytics[keyCamel] ?? 
             (raw as any)[keySnake] ?? (raw as any)[keyCamel];
    };

    const riskScoreVal = getField('risk_score', 'riskScore');
    const riskReasonsVal = getField('risk_reasons', 'riskReasons');
    const estimatedComplexityVal = getField('estimated_complexity', 'estimatedComplexity');
    const estimatedWinnerTypeVal = getField('estimated_winner_type', 'estimatedWinnerType');
    const keyRequirementsVal = getField('key_requirements', 'keyRequirements');
    const keyTermsVal = getField('key_terms', 'keyTerms');
    const positionsForeignBanVal = getField('positions_with_foreign_ban', 'positionsWithForeignBan');
    const positionsSubcontractorReqVal = getField('positions_with_subcontractor_req', 'positionsWithSubcontractorReq');
    const guaranteePercentVal = getField('guarantee_percent', 'guaranteePercent');
    const deliveryDaysVal = getField('delivery_days', 'deliveryDays');
    const warrantyMonthsVal = getField('warranty_months', 'warrantyMonths');
    const isSubcontractorsReqVal = getField('is_subcontractors_req', 'isSubcontractorsReq');
    const hasImpossibleDeadlinesVal = getField('has_impossible_deadlines', 'hasImpossibleDeadlines');
    const hasPaymentGuaranteesReqVal = getField('has_payment_guarantees_req', 'hasPaymentGuaranteesReq');
    const hasStrictQualityRequirementsVal = getField('has_strict_quality_requirements', 'hasStrictQualityRequirements');
    const hasTechnicalAuditReqVal = getField('has_technical_audit_req', 'hasTechnicalAuditReq');
    const recommendationTextVal = getField('recommendation_text', 'recommendationText');
    const itemsAnalysisVal = getField('items_analysis', 'itemsAnalysis');
    const summaryVal = getField('summary', 'summary');

    const attachmentsSummary = Array.isArray((raw as any).attachments_summary) 
      ? ((raw as any).attachments_summary as any[]) 
      : [];

    const rawAttachments = attachmentsByTender.get(objectNumber) ??
      (Array.isArray(raw.attachments) ? (raw.attachments as TenderAttachment[]) : undefined) ??
      [];

    const attachments = rawAttachments.map((attachment, attachIndex) => {
      const typedAttachment = attachment;
      const attachId = typeof typedAttachment.id === 'string'
        ? (toNumber(typedAttachment.id) ?? attachIndex + 1)
        : (typeof typedAttachment.id === 'number' ? typedAttachment.id : attachIndex + 1);
      
      // Find matching summary
      const summaryData = attachmentsSummary.find(s => 
        String(s.attachment_id) === String(typedAttachment.id) || 
        String(s.id) === String(typedAttachment.id)
      );

      return {
        ...typedAttachment,
        id: attachId,
        object_number: typedAttachment.object_number ?? objectNumber,
        file_size: toNumber(typedAttachment.file_size),
        // Merge summary fields
        summary: summaryData?.summary,
        key_requirements: summaryData?.key_requirements,
        key_terms: summaryData?.key_terms,
        risk_flags: summaryData?.risk_flags || summaryData?.risks,
      };
    });

    return {
      ...raw,
      id: tenderId,
      object_number: objectNumber,
      maxprice: toNumber(raw.maxprice),
      finance_total: toNumber(raw.finance_total),
      part: toNumber(raw.part),
      items:
        itemsByTender.get(objectNumber) ??
        (Array.isArray(raw.items) ? (raw.items as TenderItem[]) : undefined) ??
        [],
      attachments: attachments,
      
      analytics: analytics,
      items_analysis: itemsAnalysisVal,
      risk_score: toNumber(riskScoreVal),
      risk_reasons: riskReasonsVal,
      estimated_complexity: estimatedComplexityVal,
      estimated_winner_type: estimatedWinnerTypeVal,
      key_requirements: keyRequirementsVal,
      key_terms: keyTermsVal,
      positions_with_foreign_ban: positionsForeignBanVal,
      positions_with_subcontractor_req: positionsSubcontractorReqVal,
      guarantee_percent: toNumber(guaranteePercentVal),
      delivery_days: toNumber(deliveryDaysVal),
      warranty_months: toNumber(warrantyMonthsVal),
      is_subcontractors_req: isSubcontractorsReqVal,
      has_impossible_deadlines: hasImpossibleDeadlinesVal,
      has_payment_guarantees_req: hasPaymentGuaranteesReqVal,
      has_strict_quality_requirements: hasStrictQualityRequirementsVal,
      has_technical_audit_req: hasTechnicalAuditReqVal,
      recommendation_text: recommendationTextVal,
      summary: summaryVal,
    };
  });
};

export function TendersProvider({ children }: { children: React.ReactNode }) {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authTick, setAuthTick] = useState(0);

  const fetchTenders = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
      const limitRaw = import.meta.env.VITE_TENDERS_LIMIT as string | undefined;
      const limit = limitRaw ? Number(limitRaw) : 200;
      const apiKey = import.meta.env.VITE_API_KEY as string | undefined;
      const session = loadSession();
      let accessToken: string | null = null;
      if (session && isSessionValid(session)) {
        accessToken = session.access_token;
      } else {
        if (session) clearSession();
        accessToken = getStoredSupabaseToken();
      }
      if (!accessToken && !apiKey) {
        setTenders([]);
        setLoading(false);
        return;
      }

      const pageSize = Number.isFinite(limit) && limit > 0 ? limit : 200;
      const headers = {
        ...(accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : apiKey
            ? { 'X-Api-Key': apiKey }
            : {}),
      };

      const apiUrl = new URL(`${apiBase.replace(/\/+$/, '')}/tenders`, window.location.origin);
      apiUrl.searchParams.set('page', '1');
      apiUrl.searchParams.set('limit', String(pageSize));

      const response = await fetch(apiUrl.toString(), {
        cache: 'no-store',
        headers,
      });

      if (!response.ok) {
        throw new Error(`Ошибка загрузки: ${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as RawPayload;
      const normalized = normalizeTenders(payload);

      console.log(`Loaded ${normalized.length} tenders.`);
      if (normalized.length > 0) {
        console.log('Sample tender analytics:', normalized[0].analytics);
        console.log('Sample tender risk_score:', normalized[0].risk_score);
      }

      if (normalized.length === 0) {
        setTenders(mockTenders);
        setError('Получены пустые данные. Отображаются демонстрационные тендеры.');
      } else {
        setTenders(normalized);
      }
    } catch (err) {
      console.error('Data loading error:', err);
      setError(err instanceof Error ? err.message : 'Не удалось загрузить данные.');
      setTenders(mockTenders);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTenders();
  }, [fetchTenders, authTick]);

  useEffect(() => {
    const handleAuthChange = () => setAuthTick((tick) => tick + 1);
    window.addEventListener('parser-auth-changed', handleAuthChange);
    return () => window.removeEventListener('parser-auth-changed', handleAuthChange);
  }, []);

  const value = useMemo(
    () => ({
      tenders,
      loading,
      error,
      refresh: fetchTenders,
    }),
    [fetchTenders, loading, tenders, error]
  );

  return <TendersContext.Provider value={value}>{children}</TendersContext.Provider>;
}

export const useTenders = () => {
  const context = useContext(TendersContext);
  if (!context) {
    throw new Error('useTenders must be used within a TendersProvider');
  }
  return context;
};
