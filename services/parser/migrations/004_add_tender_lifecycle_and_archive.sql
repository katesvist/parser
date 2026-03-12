ALTER TABLE public.tenders_gov
  ADD COLUMN IF NOT EXISTS is_terminal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS terminal_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

UPDATE public.tenders_gov
SET is_terminal = true,
    terminal_at = COALESCE(terminal_at, now())
WHERE lower(COALESCE(etap_zakupki, '')) ~ '(определ[её]н поставщик|заверш[её]н|отмен[её]н|не состоял|несостоявш|договор заключ[её]н)';

CREATE INDEX IF NOT EXISTS idx_tenders_gov_is_terminal
  ON public.tenders_gov (is_terminal);

CREATE INDEX IF NOT EXISTS idx_tenders_gov_terminal_at
  ON public.tenders_gov (terminal_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_tenders_gov_archived_at
  ON public.tenders_gov (archived_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.tenders_gov_archive
  (LIKE public.tenders_gov INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY INCLUDING STORAGE INCLUDING COMMENTS);

ALTER TABLE public.tenders_gov_archive
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenders_gov_archive_object_number
  ON public.tenders_gov_archive (object_number);

