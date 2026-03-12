ALTER TABLE public.tenders_gov
  ADD COLUMN IF NOT EXISTS industry_keyword text,
  ADD COLUMN IF NOT EXISTS industry_okpd2 text;
