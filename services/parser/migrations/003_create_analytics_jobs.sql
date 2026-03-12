CREATE TABLE IF NOT EXISTS public.analytics_jobs (
  id bigserial primary key,
  object_number text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error text
);

CREATE UNIQUE INDEX IF NOT EXISTS analytics_jobs_object_number_active
  ON public.analytics_jobs (object_number)
  WHERE status IN ('pending','in_progress');

CREATE INDEX IF NOT EXISTS analytics_jobs_status_created
  ON public.analytics_jobs (status, created_at);
