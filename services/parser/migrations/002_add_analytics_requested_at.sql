ALTER TABLE public.tenders_gov
  ADD COLUMN IF NOT EXISTS analytics_requested_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tenders_gov_analytics_requested_at
  ON public.tenders_gov (analytics_requested_at DESC NULLS LAST);
