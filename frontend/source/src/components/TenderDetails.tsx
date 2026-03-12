import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Label } from './ui/label';
import { Separator } from './ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import {
  ArrowLeft,
  Star,
  ExternalLink,
  Calendar,
  MapPin,
  Building2,
  FileText,
  User,
  Phone,
  Mail,
  Globe,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Box,
  FileCheck,
  Download,
  MessageCircle,
} from 'lucide-react';
import { useTenders } from '../context/TendersContext';
import { formatCurrency, formatDate, getStatusInfo, decodeHtmlEntities, getTenderDisplayTitle } from '../types/tender';
import { loadSession } from '../lib/auth';
import { apiRequest } from '../lib/api';
import { cn } from './ui/utils';
import { TenderAssistantDialog } from './TenderAssistantDialog';

interface TenderDetailsProps {
  tenderId: string;
  onNavigate: (page: 'search') => void;
}

interface AnalyticsStatus {
  object_number: string;
  requested_at: string | null;
  total_attachments: number;
  summarized_attachments: number;
  pending_attachments: number;
  done: boolean;
}

interface AssistantStatus {
  object_number: string;
  available: boolean;
  status: string;
  chunk_count: number;
  reason?: string | null;
}

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

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/\s+/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const mergeAnalytics = <T extends Record<string, unknown>>(tender: T) => {
  const analytics = (tender.analytics as Record<string, unknown> | undefined) ?? {};
  return {
    ...tender,
    items_analysis: analytics.items_analysis ?? tender.items_analysis,
    risk_score: toNumber(analytics.risk_score ?? tender.risk_score),
    risk_reasons: (analytics.risk_reasons as string[] | undefined) ?? tender.risk_reasons,
    estimated_complexity: analytics.estimated_complexity ?? tender.estimated_complexity,
    estimated_winner_type: analytics.estimated_winner_type ?? tender.estimated_winner_type,
    key_requirements: (analytics.key_requirements as string[] | undefined) ?? tender.key_requirements,
    key_terms: analytics.key_terms ?? tender.key_terms,
    positions_with_foreign_ban: analytics.positions_with_foreign_ban ?? tender.positions_with_foreign_ban,
    positions_with_subcontractor_req: analytics.positions_with_subcontractor_req ?? tender.positions_with_subcontractor_req,
    guarantee_percent: toNumber(analytics.guarantee_percent ?? tender.guarantee_percent),
    delivery_days: toNumber(analytics.delivery_days ?? tender.delivery_days),
    warranty_months: toNumber(analytics.warranty_months ?? tender.warranty_months),
    is_subcontractors_req: analytics.is_subcontractors_req ?? tender.is_subcontractors_req,
    has_impossible_deadlines: analytics.has_impossible_deadlines ?? tender.has_impossible_deadlines,
    has_payment_guarantees_req: analytics.has_payment_guarantees_req ?? tender.has_payment_guarantees_req,
    has_strict_quality_requirements: analytics.has_strict_quality_requirements ?? tender.has_strict_quality_requirements,
    has_technical_audit_req: analytics.has_technical_audit_req ?? tender.has_technical_audit_req,
    recommendation_text: analytics.recommendation_text ?? tender.recommendation_text,
    summary: analytics.summary ?? tender.summary,
  } as T;
};

export function TenderDetails({ tenderId, onNavigate }: TenderDetailsProps) {
  const { tenders, loading } = useTenders();
  const [isFavorite, setIsFavorite] = useState(false);
  const [detailTender, setDetailTender] = useState<typeof tenders[number] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isProcedureOpen, setIsProcedureOpen] = useState(false);
  const [kanbanStatus, setKanbanStatus] = useState<string | null>(null);
  const [kanbanSaving, setKanbanSaving] = useState(false);
  const [aiStatus, setAiStatus] = useState<AnalyticsStatus | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assignment, setAssignment] = useState<{ specialist_name?: string | null; lawyer_name?: string | null }>({});
  const [assignmentDraft, setAssignmentDraft] = useState<{ specialist_name?: string | null; lawyer_name?: string | null }>({});
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [profileSpecialists, setProfileSpecialists] = useState<string[]>([]);
  const [profileLawyers, setProfileLawyers] = useState<string[]>([]);

  const tender = useMemo(() =>
    tenders.find(t => t.id === Number(tenderId) || t.object_number === tenderId) || tenders.find(t => String(t.id) === tenderId),
    [tenders, tenderId]
  );
  const activeTender = detailTender ?? tender;
  const objectNumber = activeTender?.object_number || tenderId;

  useEffect(() => {
    let isMounted = true;
    const loadFavorite = async () => {
      try {
        const data = await apiRequest<{ object_number: string }[]>(
          `favorites?object_number=${encodeURIComponent(tenderId)}`
        );
        if (isMounted) {
          setIsFavorite((data || []).length > 0);
        }
      } catch (err) {
        console.warn('Failed to load favorite status', err);
      }
    };
    loadFavorite();
    return () => {
      isMounted = false;
    };
  }, [tenderId]);

  useEffect(() => {
    let isMounted = true;
    const loadProfileStaff = async () => {
      try {
        const data = await apiRequest<any>('profile');
        if (!isMounted) return;
        setProfileSpecialists(Array.isArray(data?.staff_specialists) ? data.staff_specialists : []);
        setProfileLawyers(Array.isArray(data?.staff_lawyers) ? data.staff_lawyers : []);
      } catch (err) {
        // ignore
      }
    };
    loadProfileStaff();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadKanban = async () => {
      const objectNumber = activeTender?.object_number || tenderId;
      if (!objectNumber) return;
      try {
        const data = await apiRequest<Array<{ object_number: string; status: string }>>('kanban');
        if (!isMounted) return;
        const found = (data || []).find((row) => row.object_number === objectNumber);
        setKanbanStatus(found?.status ?? null);
      } catch (err) {
        // ignore for now
      }
    };
    loadKanban();
    return () => {
      isMounted = false;
    };
  }, [activeTender?.object_number, tenderId]);

  useEffect(() => {
    let isMounted = true;
    const loadAssignment = async () => {
      const objectNumber = activeTender?.object_number || tenderId;
      if (!objectNumber) return;
      try {
        const data = await apiRequest<Array<{ object_number: string; specialist_name?: string | null; lawyer_name?: string | null }>>(
          `assignments?object_number=${encodeURIComponent(objectNumber)}`
        );
        if (!isMounted) return;
        const found = (data || [])[0];
        const next = {
          specialist_name: found?.specialist_name ?? null,
          lawyer_name: found?.lawyer_name ?? null,
        };
        setAssignment(next);
        setAssignmentDraft(next);
      } catch (err) {
        // ignore
      }
    };
    loadAssignment();
    return () => {
      isMounted = false;
    };
  }, [activeTender?.object_number, tenderId]);

  const loadAnalyticsStatus = useCallback(async () => {
    if (!objectNumber) return;
    try {
      const data = await apiRequest<AnalyticsStatus>(
        `analytics/status?object_number=${encodeURIComponent(objectNumber)}`
      );
      setAiStatus(data);
      if (data?.done) {
        setAiRunning(false);
        const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
        const apiKey = import.meta.env.VITE_API_KEY as string | undefined;
        const accessToken = loadSession()?.access_token ?? getStoredSupabaseToken();
        const apiUrl = new URL(
          `${apiBase.replace(/\/+$/, '')}/tenders/${encodeURIComponent(tenderId)}`,
          window.location.origin
        );
        const response = await fetch(apiUrl.toString(), {
          cache: 'no-store',
          headers: {
            ...(accessToken
              ? { Authorization: `Bearer ${accessToken}` }
              : apiKey
                ? { 'X-Api-Key': apiKey }
                : {}),
          },
        });
        if (response.ok) {
          const payload = (await response.json()) as typeof tender;
          const normalized = payload ? mergeAnalytics(payload as Record<string, unknown>) : null;
          const merged = normalized && tender ? { ...tender, ...normalized } : normalized;
          setDetailTender((merged as typeof tender) ?? null);
        }
      }
    } catch (err) {
      console.warn('Failed to load analytics status', err);
    }
  }, [activeTender?.object_number, tenderId]);

  const loadAssistantStatus = useCallback(async () => {
    if (!objectNumber) return;
    try {
      const data = await apiRequest<AssistantStatus>(
        `assistant/status?object_number=${encodeURIComponent(objectNumber)}`,
      );
      setAssistantStatus(data);
    } catch (err) {
      setAssistantStatus(null);
    }
  }, [objectNumber]);

  useEffect(() => {
    if (!objectNumber) return;
    if (!isFavorite || !aiStatus?.done) {
      setAssistantStatus(null);
      return;
    }
    void loadAssistantStatus();
  }, [objectNumber, isFavorite, aiStatus?.done, loadAssistantStatus]);

  useEffect(() => {
    if (!objectNumber) return;
    loadAnalyticsStatus();
  }, [objectNumber, loadAnalyticsStatus]);

  useEffect(() => {
    if (!aiRunning) return;
    const timer = window.setInterval(() => {
      loadAnalyticsStatus();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [aiRunning, loadAnalyticsStatus]);

  useEffect(() => {
    if (!tenderId) return;
    const itemsEmpty = !tender?.items || tender.items.length === 0;
    const attachmentsEmpty = !tender?.attachments || tender.attachments.length === 0;
    const needsFetch = !tender || itemsEmpty || attachmentsEmpty;
    if (!needsFetch) return;

    let isMounted = true;
    const fetchDetail = async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
        const apiKey = import.meta.env.VITE_API_KEY as string | undefined;
        const accessToken = loadSession()?.access_token ?? getStoredSupabaseToken();
        const apiUrl = new URL(
          `${apiBase.replace(/\/+$/, '')}/tenders/${encodeURIComponent(tenderId)}`,
          window.location.origin
        );

        const response = await fetch(apiUrl.toString(), {
          cache: 'no-store',
          headers: {
            ...(accessToken
              ? { Authorization: `Bearer ${accessToken}` }
              : apiKey
                ? { 'X-Api-Key': apiKey }
                : {}),
          },
        });

        if (!response.ok) {
          throw new Error(`Ошибка загрузки: ${response.status} ${response.statusText}`);
        }

        const payload = (await response.json()) as typeof tender;
        const normalized = payload ? mergeAnalytics(payload as Record<string, unknown>) : null;
        const merged = normalized && tender ? { ...tender, ...normalized } : normalized;
        if (isMounted) {
          setDetailTender((merged as typeof tender) ?? null);
        }
      } catch (error) {
        if (isMounted) {
          setDetailError(error instanceof Error ? error.message : 'Не удалось загрузить тендер.');
        }
      } finally {
        if (isMounted) {
          setDetailLoading(false);
        }
      }
    };

    fetchDetail();
    return () => {
      isMounted = false;
    };
  }, [tender, tenderId]);

  const saveAssignment = useCallback(
    async (next: { specialist_name?: string | null; lawyer_name?: string | null }) => {
      const objectNumber = activeTender?.object_number || tenderId;
      if (!objectNumber) return;
      setAssignmentSaving(true);
      try {
        await apiRequest('assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ object_number: objectNumber, ...next }),
        });
        setAssignment(next);
      } catch (err) {
        console.error(err);
        window.alert('Не удалось назначить ответственного.');
      } finally {
        setAssignmentSaving(false);
      }
    },
    [activeTender?.object_number, tenderId]
  );

  const addToKanban = useCallback(async () => {
    const objectNumber = activeTender?.object_number || tenderId;
    if (!objectNumber) return;
    setKanbanSaving(true);
    try {
      await apiRequest('kanban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ object_number: objectNumber, status: 'backlog' }),
      });
      setKanbanStatus('backlog');
    } catch (err) {
      console.error(err);
      window.alert('Не удалось добавить тендер в канбан.');
    } finally {
      setKanbanSaving(false);
    }
  }, [activeTender?.object_number, tenderId]);

  const toggleFavorite = useCallback(async () => {
    const objectNumber = activeTender?.object_number || tenderId;
    if (!objectNumber) return;
    const next = !isFavorite;
    setIsFavorite(next);
    try {
      if (next) {
        await apiRequest('favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ object_number: objectNumber }),
        });
      } else {
        await apiRequest(`favorites/${encodeURIComponent(objectNumber)}`, { method: 'DELETE' });
      }
    } catch (err) {
      console.error(err);
      setIsFavorite(!next);
      window.alert('Не удалось обновить избранное.');
    }
    if (!next) {
      setAiStatus(null);
      setAiRunning(false);
      setAiError(null);
    }
  }, [activeTender, isFavorite, tenderId]);

  const runAnalytics = useCallback(async () => {
    const objectNumber = activeTender?.object_number || tenderId;
    if (!objectNumber) return;
    setAiError(null);
    setAiRunning(true);
    try {
      const data = await apiRequest<AnalyticsStatus>('analytics/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ object_number: objectNumber }),
      });
      setAiStatus(data);
      if (data?.done) {
        setAiRunning(false);
      }
    } catch (err) {
      console.error(err);
      setAiRunning(false);
      setAiError('Не удалось запустить аналитику.');
    }
  }, [activeTender?.object_number, tenderId]);

  if (loading || detailLoading) {
    return <div className="p-8 text-center">Загрузка...</div>;
  }

  if (detailError) {
    return (
      <div className="p-8 text-center space-y-4">
        <p>{detailError}</p>
        <Button onClick={() => onNavigate('search')}>Вернуться к поиску</Button>
      </div>
    );
  }

  if (!activeTender) {
    return (
      <div className="p-8 text-center space-y-4">
        <p>Тендер не найден</p>
        <Button onClick={() => onNavigate('search')}>Вернуться к поиску</Button>
      </div>
    );
  }

  const statusInfo = getStatusInfo(activeTender.etap_zakupki);
  const procedureText = activeTender.procedureinfo || 'См. документацию';
  const isProcedureLong = procedureText.length > 140;

  const firstNonEmpty = (...values: Array<string | null | undefined>) => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value;
    }
    return undefined;
  };
  const firstItemField = <T extends keyof NonNullable<typeof activeTender.items>[number]>(
    field: T
  ) => {
    const items = activeTender.items ?? [];
    for (const item of items) {
      const value = item?.[field];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return undefined;
  };
  
  // Helper to format address
  const customerAddress = activeTender.postaddress || activeTender.factaddress || activeTender.orgpostaddress || activeTender.orgfactaddress || '—';
  const contactPerson = [activeTender.person_lastname, activeTender.person_firstname, activeTender.person_middlename].filter(Boolean).join(' ') || '—';
  const formatArchiveFileSize = (size?: number) => {
    if (typeof size !== 'number' || Number.isNaN(size) || size <= 0) return null;
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} МБ`;
    if (size >= 1024) return `${(size / 1024).toFixed(1)} КБ`;
    return `${size} Б`;
  };
  const isArchiveByName = (name?: string | null) => {
    if (!name) return false;
    return /\.(zip|rar|7z)(\b|$)/i.test(name);
  };
  
  // Prepare documents data from attachments
  const documents = (activeTender.attachments ?? []).map(att => ({
    rawTerms: att.key_terms && typeof att.key_terms === 'object' ? att.key_terms : null,
    id: att.id,
    title: att.doc_kind_name || att.file_name || 'Документ',
    fileName: att.file_name || 'unnamed',
    fileSize: att.file_size ? `${(att.file_size / 1024 / 1024).toFixed(2)} МБ` : '—',
    date: att.doc_date ? formatDate(att.doc_date) : '—',
    type: att.file_name?.split('.').pop()?.toLowerCase() || 'file',
    url: att.url,
    summary: att.summary,
    requirements: Array.isArray(att.key_requirements) ? att.key_requirements : [],
    risks: Array.isArray(att.risk_flags) ? att.risk_flags : []
  })).map((doc) => {
    const rawTerms = doc.rawTerms as Record<string, unknown> | null;
    const archiveDocuments = Array.isArray(rawTerms?.archive_documents)
      ? (rawTerms?.archive_documents as Array<Record<string, unknown>>)
      : [];

    const candidateTerms = rawTerms
      ? {
          payment_type:
            typeof rawTerms.payment_type === 'string' ? rawTerms.payment_type : undefined,
          delivery_days:
            typeof rawTerms.delivery_days === 'string' || typeof rawTerms.delivery_days === 'number'
              ? rawTerms.delivery_days
              : undefined,
          warranty_months:
            typeof rawTerms.warranty_months === 'number' ? rawTerms.warranty_months : undefined,
          quality_standard:
            typeof rawTerms.quality_standard === 'string' ? rawTerms.quality_standard : undefined,
          guarantee_percent:
            typeof rawTerms.guarantee_percent === 'number' ? rawTerms.guarantee_percent : undefined,
        }
      : null;
    const hasTerms =
      !!candidateTerms &&
      Object.values(candidateTerms).some((value) => value !== undefined && value !== null && String(value).trim() !== '');
    const terms = hasTerms ? candidateTerms : null;

    return {
      ...doc,
      isArchive: isArchiveByName(doc.fileName),
      terms,
      archiveDocuments,
      archiveStats: {
        total:
          typeof rawTerms?.archive_total_files === 'number'
            ? rawTerms.archive_total_files
            : archiveDocuments.length,
        processed:
          typeof rawTerms?.archive_processed_files === 'number'
            ? rawTerms.archive_processed_files
            : archiveDocuments.filter((entry) => entry?.status === 'done').length,
        failed:
          typeof rawTerms?.archive_failed_files === 'number'
            ? rawTerms.archive_failed_files
            : archiveDocuments.filter((entry) => entry?.status === 'failed').length,
        skipped:
          typeof rawTerms?.archive_skipped_files === 'number'
            ? rawTerms.archive_skipped_files
            : archiveDocuments.filter((entry) => entry?.status === 'skipped').length,
      },
    };
  });

  const daysLeft = activeTender.enddt ? Math.max(0, Math.ceil((new Date(activeTender.enddt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 0;
  const showAiBlocks = Boolean(isFavorite && aiStatus?.done);
  const hasDocumentAnalysisData = documents.some(
    (doc) =>
      Boolean(doc.summary) ||
      Boolean(doc.archiveDocuments && doc.archiveDocuments.length > 0) ||
      Boolean(doc.terms && Object.keys(doc.terms).length > 0) ||
      Boolean(doc.requirements && doc.requirements.length > 0)
  );
  const showDocumentSummaries = Boolean(aiStatus?.done || hasDocumentAnalysisData);
  const aiTotal = aiStatus?.total_attachments ?? 0;
  const aiPending = aiStatus?.pending_attachments ?? 0;
  const aiRequested = Boolean(aiStatus?.requested_at);
  const aiJobStatus = aiStatus?.job?.status as string | undefined;
  const aiJobError = aiStatus?.job?.error as string | undefined;
  const aiJobLabel =
    aiJobStatus === 'pending'
      ? 'В очереди'
      : aiJobStatus === 'in_progress'
        ? 'В обработке'
        : aiJobStatus === 'done'
          ? 'Готово'
          : aiJobStatus
            ? 'Ошибка'
            : null;
  const aiJobDetail =
    aiJobStatus === 'done' && aiJobError
      ? 'Нет документов для анализа'
      : aiJobStatus === 'error'
        ? 'Ошибка обработки'
        : null;
  const aiProcessed = Math.max(0, aiTotal - aiPending);
  const aiProgressPct = aiTotal > 0 ? Math.min(100, Math.round((aiProcessed / aiTotal) * 100)) : 0;
  const assistantAvailable = Boolean(assistantStatus?.available);
  const assistantHint = assistantAvailable
    ? null
    : assistantStatus?.reason || 'Ассистент доступен после завершения индекса знаний.';

  return (
    <div className="space-y-5 pb-16">
      <TenderAssistantDialog
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        objectNumber={objectNumber}
      />
      {/* Header Section */}
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => onNavigate('search')} className="h-9 gap-2">
            <ArrowLeft className="w-4 h-4" />
            Назад
          </Button>
          <div className="flex items-center gap-3">
            <span className="font-semibold text-lg">№ {activeTender.object_number}</span>
            <div className={`rounded-[8px] px-[7px] py-[2px] inline-flex items-center justify-center ${statusInfo.color.replace('border', '')}`}>
               <span className="text-xs font-medium leading-4 whitespace-nowrap">
              {statusInfo.label}
            </span>
          </div>
            <Badge variant="outline" className="text-foreground border-border/70">
              {activeTender.zakon || '—'}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={kanbanStatus ? 'outline' : 'default'}
            className="gap-2 h-9"
            onClick={addToKanban}
            disabled={kanbanSaving || Boolean(kanbanStatus)}
          >
            {kanbanStatus ? 'В канбане' : kanbanSaving ? 'Добавляем...' : 'Взять в работу'}
          </Button>
          <Button 
            variant="outline" 
            className="gap-2 h-9"
            onClick={toggleFavorite}
          >
            <Star className={`w-4 h-4 ${isFavorite ? 'fill-yellow-400 text-yellow-400' : ''}`} />
            {isFavorite ? 'В избранном' : 'В избранное'}
          </Button>
          <Button className="gap-2 h-9" asChild>
            <a href={activeTender.href || activeTender.url_223_xml || '#'} target="_blank" rel="noreferrer">
              <ExternalLink className="w-4 h-4" />
              Открыть на ЕИС
            </a>
          </Button>
        </div>
      </div>

      {detailLoading ? (
        <div className="rounded-[20px] border border-border/70 bg-white/80 px-4 py-3 text-sm text-muted-foreground shadow-[0_12px_40px_-32px_rgba(15,23,42,0.35)]">
          Загружаем полные данные по тендеру...
        </div>
      ) : null}

      <div className="flex gap-5 items-start">
        {/* Left Column - Main Info */}
        <div className="flex-1 space-y-6 min-w-0">
          {/* Main Info Card */}
          <Card>
            <CardContent className="p-6 space-y-6">
              <h1 className="text-lg font-semibold leading-snug text-neutral-950">
                {getTenderDisplayTitle(activeTender)}
              </h1>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <FileText className="w-4 h-4" />
                    <span className="text-sm">Способ закупки</span>
                  </div>
                  <p className="font-medium">
                    {decodeHtmlEntities(
                      firstNonEmpty(
                        activeTender.placingway_name,
                        activeTender.kotirovki,
                        (activeTender as { method?: string }).method
                      ) || '—'
                    )}
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="w-4 h-4 flex items-center justify-center font-serif font-bold">₽</span>
                    <span className="text-sm">Начальная (максимальная) цена</span>
                  </div>
                  <p className="font-medium text-emerald-600 text-lg">
                    {formatCurrency(activeTender.maxprice, activeTender.currency_code).replace(' ₽', '').replace(' RUB', '')} <span className="text-sm font-normal text-muted-foreground">{activeTender.currency_code || 'RUB'}</span>
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Box className="w-4 h-4" />
                    <span className="text-sm">Объект закупки</span>
                  </div>
                  <p className="font-medium">
                    {firstNonEmpty(
                      activeTender.kvr_info,
                      firstItemField('item_name'),
                      firstItemField('okpdname')
                    ) || '—'}
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <FileCheck className="w-4 h-4" />
                    <span className="text-sm">ОКПД2</span>
                  </div>
                  <p className="font-medium">
                    {firstNonEmpty(
                      activeTender.okpd2info,
                      firstItemField('okpdname'),
                      firstItemField('okpdcode')
                    ) || '—'}
                  </p>
                </div>
              </div>

              <div className="rounded-[20px] border border-border bg-muted/35 px-6 py-4 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Globe className="w-4 h-4" />
                    <span className="text-sm">Электронная площадка</span>
                  </div>
                  <div className="font-semibold text-base">{activeTender.etp_name || '—'}</div>
                </div>
                {activeTender.etp_url && (
                  <Button variant="outline" size="sm" className="h-8 px-4 text-xs" asChild>
                    <a href={activeTender.etp_url} target="_blank" rel="noreferrer">Перейти</a>
                  </Button>
                )}
              </div>

              {/* Customer Info */}
              <div className="rounded-[20px] border border-border bg-background px-6 py-5 space-y-4">
                <h3 className="font-semibold text-base">Заказчик</h3>
                <div className="flex flex-col gap-4">
                  {/* Name */}
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Наименование</p>
                    <p className="text-base font-semibold">
                      {decodeHtmlEntities(
                        firstNonEmpty(activeTender.fullname, activeTender.shortname, (activeTender as { customer?: string }).customer) || '—'
                      )}
                    </p>
                    {activeTender.shortname && (
                      <p className="text-sm text-muted-foreground mt-1">{decodeHtmlEntities(activeTender.shortname)}</p>
                    )}
                  </div>
                  
                  <div className="flex gap-6 items-start">
                    {/* Left Column: Address + IDs */}
                    <div className="flex-1 flex flex-col gap-3">
                      <div className="min-h-[44px]">
                        <p className="text-sm text-muted-foreground mb-1">Почтовый адрес</p>
                        <p className="text-sm">{customerAddress}</p>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="min-h-[48px]">
                          <p className="text-sm text-muted-foreground mb-1">ИНН</p>
                          <p className="text-base">{activeTender.inn || '—'}</p>
                        </div>
                        <div className="min-h-[48px]">
                          <p className="text-sm text-muted-foreground mb-1">КПП</p>
                          <p className="text-base">{activeTender.kpp || '—'}</p>
                        </div>
                        <div className="min-h-[48px]">
                          <p className="text-sm text-muted-foreground mb-1">Рег. номер</p>
                          <p className="text-base">{activeTender.regnum || '—'}</p>
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Contact Person */}
                    <div className="flex-1 min-h-[132px]">
                      <p className="text-sm text-muted-foreground mb-2">Контактное лицо</p>
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 h-5">
                          <User className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="text-sm truncate">{contactPerson}</span>
                        </div>
                        <div className="flex items-center gap-2 h-5">
                          <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="text-sm truncate">{activeTender.contactphone || '—'}</span>
                        </div>
                        <div className="flex items-center gap-2 h-5">
                          <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="text-sm truncate">{activeTender.contactemail || '—'}</span>
                        </div>
                        <div className="flex items-center gap-2 h-5">
                          <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="text-sm truncate">Факс: {activeTender.contactfax || '—'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Delivery & Security Row */}
          <div className="flex gap-6">
            <Card className="flex-1">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-muted-foreground" />
                  Место поставки
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                   <Building2 className="w-4 h-4 text-muted-foreground mt-1" />
                   <div>
                     <p className="text-base">
                       {firstNonEmpty(
                         activeTender.deliveryplace,
                         activeTender.delivery_place_indication,
                         activeTender.garaddress,
                         firstItemField('delivery_place_code')
                       ) || '—'}
                     </p>
                     <p className="text-sm text-muted-foreground mt-1">{activeTender.countryfullname}</p>
                   </div>
                </div>
              </CardContent>
            </Card>

            <Card className="w-[413px]">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="w-5 h-5 text-muted-foreground" />
                  Обеспечение заявки
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Размер обеспечения</p>
                  <p className="text-base">
                    {typeof activeTender.part === 'number'
                      ? `${activeTender.part}%`
                      : typeof activeTender.guarantee_percent === 'number'
                        ? `${activeTender.guarantee_percent}%`
                        : '—'}
                  </p>
                  {/* If we had amount calculated or provided, we'd show it here */}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Порядок внесения</p>
                  <p
                    className={cn(
                      'text-sm',
                      isProcedureLong && !isProcedureOpen ? 'line-clamp-3' : ''
                    )}
                  >
                    {procedureText}
                  </p>
                  {isProcedureLong ? (
                    <button
                      type="button"
                      className="mt-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                      onClick={() => setIsProcedureOpen((prev) => !prev)}
                    >
                      {isProcedureOpen ? 'Свернуть' : 'Показать полностью'}
                    </button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tabs Section */}
          <div className="space-y-4">
            <Tabs defaultValue="items" className="w-full">
              <TabsList className="w-full justify-start gap-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                <TabsTrigger value="items" className="shrink-0 whitespace-nowrap leading-none">
                  Позиции закупки
                </TabsTrigger>
                <TabsTrigger value="documents" className="shrink-0 whitespace-nowrap leading-none">
                  Документы
                </TabsTrigger>
                <TabsTrigger value="requirements" className="shrink-0 whitespace-nowrap leading-none">
                  Требования
                </TabsTrigger>
                <TabsTrigger value="additional" className="shrink-0 whitespace-nowrap leading-none">
                  Дополнительно
                </TabsTrigger>
              </TabsList>

              <TabsContent value="items" className="mt-6">
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">Позиции закупки</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="w-full overflow-hidden rounded-b-[20px]">
                      <table className="w-full border-collapse table-fixed">
                        <thead>
                          <tr className="border-b border-border/70 bg-muted/60">
                            <th className="w-[40px] py-3 px-2 text-center font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">№</th>
                            <th className="w-[40%] py-3 px-4 text-left font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">Наименование</th>
                            <th className="w-[80px] py-3 px-2 text-left font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">Кол-во</th>
                            <th className="w-[120px] py-3 px-2 text-left font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">Ед. изм.</th>
                            <th className="w-[110px] py-3 px-2 text-left font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">Цена за ед.</th>
                            <th className="w-[120px] py-3 px-4 text-right font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">Сумма</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeTender.items?.map((item, index) => (
                            <tr key={item.id || index} className="border-b border-border/60 last:border-0 hover:bg-muted/60 transition-colors">
                              <td className="py-4 px-2 text-center font-medium text-sm text-foreground align-top">
                                {index + 1}
                              </td>
                              <td className="py-4 px-4 align-top">
                                <div className="space-y-2">
                                  <p className="text-sm font-normal text-foreground leading-snug line-clamp-3">
                                    {item.item_name || item.name}
                                  </p>
                                  <p className="text-sm text-muted-foreground line-clamp-2">
                                    {item.okpdname || item.desc}
                                  </p>
                                  {(item.okpdcode || item.code) && (
                                    <div className="inline-flex">
                                      <Badge variant="outline" className="font-normal text-muted-foreground border-border/70 rounded-full">
                                        {item.okpdcode || item.code}
                                      </Badge>
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="py-4 px-2 align-top">
                                <p className="text-sm font-normal text-foreground">
                                  {item.quantity_value || item.qty}
                                </p>
                              </td>
                              <td className="py-4 px-2 align-top">
                                <p className="text-sm font-normal text-foreground">
                                  {item.quantity_name || item.unit}
                                </p>
                              </td>
                              <td className="py-4 px-2 align-top">
                                <p className="text-sm font-normal text-foreground whitespace-nowrap">
                                  {formatCurrency(item.price_for_one || item.price, activeTender.currency_code).replace(' RUB', '').replace(' ₽', '')}
                                </p>
                              </td>
                              <td className="py-4 px-4 align-top text-right">
                                <p className="text-sm font-medium text-emerald-600 whitespace-nowrap">
                                  {formatCurrency(item.total_sum || item.sum, activeTender.currency_code).replace(' RUB', '').replace(' ₽', '')}
                                </p>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="documents" className="mt-6">
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">Документация</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {documents.map((doc, index) => (
                      <div key={doc.id || index} className="border border-border/70 rounded-[20px] bg-white/80 p-[17px] space-y-3">
                        <div className="flex items-start gap-3">
                          <div className={`w-10 h-10 rounded flex items-center justify-center shrink-0 ${
                            doc.type === 'pdf' ? 'bg-red-100' : 
                            doc.type === 'docx' || doc.type === 'doc' ? 'bg-blue-100' : 'bg-green-100'
                          }`}>
                            <FileText className={`w-5 h-5 ${
                              doc.type === 'pdf' ? 'text-red-600' : 
                              doc.type === 'docx' || doc.type === 'doc' ? 'text-blue-600' : 'text-green-600'
                            }`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-normal text-neutral-950 mb-1">{doc.fileName}</p>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <span>{doc.title}</span>
                              <span>•</span>
                              <span>{doc.fileSize}</span>
                              <span>•</span>
                              <span>{doc.date}</span>
                            </div>
                            {(doc.isArchive || (doc.archiveDocuments && doc.archiveDocuments.length > 0)) && (
                              <div className="flex flex-wrap items-center gap-2 mt-2">
                                <Badge
                                  variant="outline"
                                  className="text-xs border-indigo-300 text-indigo-700 bg-indigo-50"
                                >
                                  Архив
                                </Badge>
                                {doc.archiveStats.total > 0 && (
                                  <Badge variant="outline" className="text-xs">
                                    Файлов: {doc.archiveStats.total}
                                  </Badge>
                                )}
                                {doc.archiveStats.processed > 0 && (
                                  <Badge
                                    variant="outline"
                                    className="text-xs border-emerald-300 text-emerald-700 bg-emerald-50"
                                  >
                                    Обработано: {doc.archiveStats.processed}
                                  </Badge>
                                )}
                                {doc.archiveStats.failed > 0 && (
                                  <Badge
                                    variant="outline"
                                    className="text-xs border-amber-300 text-amber-700 bg-amber-50"
                                  >
                                    Ошибок: {doc.archiveStats.failed}
                                  </Badge>
                                )}
                                {doc.archiveStats.skipped > 0 && (
                                  <Badge
                                    variant="outline"
                                    className="text-xs border-slate-300 text-slate-700 bg-slate-50"
                                  >
                                    Пропущено: {doc.archiveStats.skipped}
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                          {doc.url && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                              <a href={doc.url} target="_blank" rel="noreferrer">
                                <Download className="w-4 h-4" />
                              </a>
                            </Button>
                          )}
                        </div>

                        {showDocumentSummaries &&
                          (doc.summary ||
                            (doc.archiveDocuments && doc.archiveDocuments.length > 0) ||
                            (doc.terms && Object.keys(doc.terms).length > 0) ||
                            (doc.requirements && doc.requirements.length > 0)) && (
                            <div className="bg-muted/60 rounded-lg p-4 space-y-4">
                              {doc.summary && (
                                <div>
                                  <p className="text-sm text-muted-foreground mb-2">Краткое содержание</p>
                                  <p className="text-sm text-neutral-950 leading-relaxed">{doc.summary}</p>
                                </div>
                              )}

                              {doc.archiveDocuments && doc.archiveDocuments.length > 0 && (
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between">
                                    <p className="text-sm text-muted-foreground">Файлы внутри архива</p>
                                    <p className="text-xs text-muted-foreground">
                                      {doc.archiveStats.processed}/{doc.archiveStats.total}
                                      {doc.archiveStats.failed > 0 ? `, ошибок: ${doc.archiveStats.failed}` : ''}
                                      {doc.archiveStats.skipped > 0 ? `, пропущено: ${doc.archiveStats.skipped}` : ''}
                                    </p>
                                  </div>

                                  <div className="space-y-3">
                                    {doc.archiveDocuments.map((entry, idx) => {
                                      const fileName =
                                        typeof entry.file_name === 'string' && entry.file_name.trim()
                                          ? entry.file_name
                                          : `Файл ${idx + 1}`;
                                      const summary =
                                        typeof entry.summary === 'string' && entry.summary.trim()
                                          ? entry.summary
                                          : 'Не удалось извлечь текст из документа.';
                                      const status = typeof entry.status === 'string' ? entry.status : 'failed';
                                      const isDone = status === 'done';
                                      const isSkipped = status === 'skipped';
                                      const sizeLabel = formatArchiveFileSize(
                                        typeof entry.file_size === 'number' ? entry.file_size : undefined
                                      );
                                      const entryRequirements = Array.isArray(entry.key_requirements)
                                        ? (entry.key_requirements as string[])
                                        : [];
                                      const entryRisks = Array.isArray(entry.risk_flags)
                                        ? (entry.risk_flags as string[])
                                        : [];

                                          return (
                                        <div key={`${doc.id}-${idx}`} className="rounded-[12px] border border-border/70 bg-white/90 p-3 space-y-2">
                                          <div className="flex items-center justify-between gap-2">
                                            <p className="text-base font-semibold text-neutral-950 break-all">{fileName}</p>
                                            <div className="flex items-center gap-2 shrink-0">
                                              {sizeLabel ? (
                                                <span className="text-xs text-muted-foreground">{sizeLabel}</span>
                                              ) : null}
                                              <Badge
                                                variant="outline"
                                                className={cn(
                                                  'text-xs',
                                                  isDone
                                                    ? 'border-emerald-300 text-emerald-700 bg-emerald-50'
                                                    : isSkipped
                                                      ? 'border-slate-300 text-slate-700 bg-slate-50'
                                                      : 'border-amber-300 text-amber-700 bg-amber-50'
                                                )}
                                              >
                                                {isDone ? 'Готово' : isSkipped ? 'Пропущен' : 'Ошибка'}
                                              </Badge>
                                            </div>
                                          </div>

                                          <p className="text-base text-neutral-950 leading-relaxed">{summary}</p>

                                          {entryRequirements.length > 0 && (
                                            <div className="space-y-1">
                                              <p className="text-xs text-muted-foreground">Ключевые требования</p>
                                              <ul className="space-y-1">
                                                {entryRequirements.map((req, reqIdx) => (
                                                  <li key={reqIdx} className="flex items-start gap-2">
                                                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                                                    <span className="text-sm text-neutral-950">{req}</span>
                                                  </li>
                                                ))}
                                              </ul>
                                            </div>
                                          )}

                                          {entryRisks.length > 0 && (
                                            <div className="space-y-1">
                                              <p className="text-xs text-muted-foreground">Риски</p>
                                              <ul className="space-y-1">
                                                {entryRisks.map((risk, riskIdx) => (
                                                  <li key={riskIdx} className="flex items-start gap-2">
                                                    <AlertTriangle className="w-3.5 h-3.5 text-orange-500 shrink-0 mt-0.5" />
                                                    <span className="text-sm text-neutral-950">{risk}</span>
                                                  </li>
                                                ))}
                                              </ul>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {(!doc.archiveDocuments || doc.archiveDocuments.length === 0) &&
                                doc.terms &&
                                Object.keys(doc.terms).length > 0 && (
                                <div>
                                  <p className="text-sm text-muted-foreground mb-2">Ключевые условия</p>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-8">
                                    <div className="flex items-baseline gap-2">
                                      <span className="text-sm text-muted-foreground min-w-[85px]">Обеспечение:</span>
                                      <span className="text-sm text-neutral-950">{doc.terms.guarantee_percent ? `${doc.terms.guarantee_percent}%` : '—'}</span>
                                    </div>
                                    <div className="flex items-baseline gap-2">
                                      <span className="text-sm text-muted-foreground min-w-[60px]">Гарантия:</span>
                                      <span className="text-sm text-neutral-950">{doc.terms.warranty_months ? `${doc.terms.warranty_months} мес.` : '—'}</span>
                                    </div>
                                    <div className="flex items-baseline gap-2">
                                      <span className="text-sm text-muted-foreground min-w-[85px]">Срок:</span>
                                      <span className="text-sm text-neutral-950">{doc.terms.delivery_days || '—'}</span>
                                    </div>
                                    <div className="flex items-baseline gap-2">
                                      <span className="text-sm text-muted-foreground min-w-[60px]">Оплата:</span>
                                      <span className="text-sm text-neutral-950">{doc.terms.payment_type || '—'}</span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {(!doc.archiveDocuments || doc.archiveDocuments.length === 0) &&
                                doc.requirements &&
                                doc.requirements.length > 0 && (
                                <div>
                                  <p className="text-sm text-muted-foreground mb-2">Ключевые требования</p>
                                  <ul className="space-y-2">
                                    {doc.requirements.map((req, idx) => (
                                      <li key={idx} className="flex items-start gap-2">
                                        <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                                        <span className="text-sm text-neutral-950">{req}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                            </div>
                          )}
                      </div>
                    ))}
                    {documents.length === 0 && (
                       <div className="text-center text-muted-foreground py-8">Документы не найдены</div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="requirements">
                 <div className="p-8 text-center text-muted-foreground bg-white rounded-[20px] border">Раздел в разработке</div>
              </TabsContent>
              <TabsContent value="additional">
                 <div className="p-8 text-center text-muted-foreground bg-white rounded-[20px] border">Раздел в разработке</div>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Right Column - Sidebar */}
        <div className="w-[400px] shrink-0 space-y-6">
          {/* Days Remaining Card */}
          <div className="bg-amber-50 border border-amber-200 rounded-[20px] p-4 flex gap-4 items-start">
            <Calendar className="w-5 h-5 text-amber-600 shrink-0 mt-1" />
            <div>
              <p className="text-amber-800 text-base font-normal mb-1">
                До окончания приема заявок осталось {daysLeft} {daysLeft % 10 === 1 && daysLeft % 100 !== 11 ? 'день' : daysLeft % 10 >= 2 && daysLeft % 10 <= 4 && (daysLeft % 100 < 10 || daysLeft % 100 >= 20) ? 'дня' : 'дней'}
              </p>
              <p className="text-amber-600 text-base font-normal">
                Срок подачи: {activeTender.enddt ? formatDate(activeTender.enddt) : '—'}
              </p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ответственные по тендеру</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Специалист</Label>
                <select
                  className="h-10 w-full rounded-[16px] border border-border/70 bg-white px-3 text-sm text-foreground"
                  value={assignmentDraft.specialist_name || ''}
                  onChange={(e) => setAssignmentDraft({ ...assignmentDraft, specialist_name: e.target.value || null })}
                >
                  <option value="">Выберите специалиста</option>
                  {(profileSpecialists || []).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Юрист</Label>
                <select
                  className="h-10 w-full rounded-[16px] border border-border/70 bg-white px-3 text-sm text-foreground"
                  value={assignmentDraft.lawyer_name || ''}
                  onChange={(e) => setAssignmentDraft({ ...assignmentDraft, lawyer_name: e.target.value || null })}
                >
                  <option value="">Выберите юриста</option>
                  {(profileLawyers || []).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              <Button
                className="w-full"
                onClick={() => saveAssignment(assignmentDraft)}
                disabled={assignmentSaving}
              >
                {assignmentSaving ? 'Сохраняем...' : 'Сохранить'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">ИИ-анализ</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!isFavorite ? (
                <p className="text-sm text-muted-foreground">
                  Добавьте тендер в избранное, чтобы запустить ИИ-анализ.
                </p>
              ) : (
                <>
                  <div className="text-sm text-muted-foreground">
                    {aiTotal > 0 ? (
                      <>
                        Документов: {aiTotal}. Осталось: {aiPending}.
                      </>
                    ) : (
                      'Документы для анализа пока не найдены.'
                    )}
                  </div>
                  {aiJobLabel && (
                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground">
                        Статус: <span className="font-medium text-foreground">{aiJobLabel}</span>
                        {aiJobDetail ? (
                          <span className="ml-2 text-muted-foreground">({aiJobDetail})</span>
                        ) : null}
                      </div>
                      {(aiJobStatus === 'pending' || aiJobStatus === 'in_progress') && (
                        <div className="rounded-[16px] border border-border/70 bg-white/80 px-3 py-2">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="relative flex h-2 w-2">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
                            </span>
                            {aiJobStatus === 'pending' ? 'Ожидает в очереди' : 'Документы обрабатываются'}
                          </div>
                          {aiTotal > 0 && (
                            <div className="mt-2">
                              <div className="h-2 w-full rounded-full bg-muted">
                                <div
                                  className="h-2 rounded-full bg-[#1f3c88] transition-all duration-500"
                                  style={{ width: `${aiProgressPct}%` }}
                                />
                              </div>
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                Прогресс: {aiProcessed}/{aiTotal} ({aiProgressPct}%)
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {aiError && <div className="text-sm text-red-600">{aiError}</div>}
                  {!showAiBlocks && (
                    <>
                      <Button
                        className="w-full"
                        onClick={runAnalytics}
                        disabled={aiRunning}
                      >
                        {aiRunning ? 'Аналитика запущена...' : aiRequested ? 'Запустить повторно' : 'Запустить ИИ-аналитику'}
                      </Button>
                    </>
                  )}
                  {showAiBlocks && (
                    <div className="rounded-[16px] border border-border/70 bg-white px-3 py-2 text-sm text-emerald-700">
                      ИИ-анализ готов.
                    </div>
                  )}

                  <div className="space-y-2 pt-1">
                    <Button
                      variant="outline"
                      className="w-full gap-2"
                      onClick={() => setAssistantOpen(true)}
                      disabled={!showAiBlocks || !assistantAvailable}
                    >
                      <MessageCircle className="h-4 w-4" />
                      Вызов ассистента
                    </Button>
                    {!assistantAvailable && (
                      <p className="text-xs text-muted-foreground">
                        {showAiBlocks ? assistantHint : 'Ассистент доступен после завершения ИИ-аналитики.'}
                      </p>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
