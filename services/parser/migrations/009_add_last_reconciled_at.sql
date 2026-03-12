ALTER TABLE public.tenders_gov
  ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz;

ALTER TABLE public.tenders_gov_archive
  ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz;

UPDATE public.tenders_gov
SET last_reconciled_at = COALESCE(rss_updated_at, last_full_parsed_at, updated_at, created_at)
WHERE last_reconciled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tenders_gov_last_reconciled_at
  ON public.tenders_gov (last_reconciled_at ASC NULLS FIRST);
