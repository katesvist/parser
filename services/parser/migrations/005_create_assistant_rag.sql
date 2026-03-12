-- RAG + assistant persistence for tender chat.
-- Notes:
-- - We intentionally do NOT rely on tender_attachments_summary.extracted_text to avoid DB bloat.
-- - Worker indexes extracted text in-flight into rag_* tables (chunks + embeddings).

-- Some tables in state/custom_schema.sql reference this trigger function, but it may be missing.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

-- Vector search (pgvector).
CREATE EXTENSION IF NOT EXISTS vector;

-- Tracks whether tender knowledge index is ready for assistant.
CREATE TABLE IF NOT EXISTS public.rag_tender_index_status (
  object_number text PRIMARY KEY,
  status text NOT NULL DEFAULT 'pending', -- pending|in_progress|ready|failed|disabled
  chunk_count integer NOT NULL DEFAULT 0,
  embedding_model text,
  chunking_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Tender document chunks (per tender + attachment + optional archive path).
-- embedding dim: keep in sync with embedding model (default assumes 1536).
CREATE TABLE IF NOT EXISTS public.rag_tender_chunks (
  id bigserial PRIMARY KEY,
  object_number text NOT NULL,
  attachment_id bigint NOT NULL,
  source_path text NOT NULL,
  source_name text,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rag_tender_chunks_dedup
  ON public.rag_tender_chunks (object_number, attachment_id, source_path, content_hash);

CREATE INDEX IF NOT EXISTS rag_tender_chunks_object_number
  ON public.rag_tender_chunks (object_number);

CREATE INDEX IF NOT EXISTS rag_tender_chunks_attachment_id
  ON public.rag_tender_chunks (attachment_id);

-- Vector index (cosine). Works best after ANALYZE and with enough rows.
CREATE INDEX IF NOT EXISTS rag_tender_chunks_embedding_ivfflat
  ON public.rag_tender_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Legal corpus chunks (44-FZ / 223-FZ only for now).
CREATE TABLE IF NOT EXISTS public.rag_legal_chunks (
  id bigserial PRIMARY KEY,
  corpus text NOT NULL, -- '44fz' | '223fz'
  section text,
  source_url text,
  as_of_date date,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rag_legal_chunks_dedup
  ON public.rag_legal_chunks (corpus, content_hash);

CREATE INDEX IF NOT EXISTS rag_legal_chunks_corpus
  ON public.rag_legal_chunks (corpus);

CREATE INDEX IF NOT EXISTS rag_legal_chunks_embedding_ivfflat
  ON public.rag_legal_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Chat threads/messages stored in DB (for continuity + auditability).
CREATE TABLE IF NOT EXISTS public.assistant_threads (
  id bigserial PRIMARY KEY,
  object_number text NOT NULL,
  user_id bigint NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_threads_user_object
  ON public.assistant_threads (user_id, object_number, created_at DESC);

CREATE TABLE IF NOT EXISTS public.assistant_messages (
  id bigserial PRIMARY KEY,
  thread_id bigint NOT NULL REFERENCES public.assistant_threads(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('system','user','assistant')),
  content text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_messages_thread_created
  ON public.assistant_messages (thread_id, created_at ASC);

-- RPC: vector search for tender chunks.
CREATE OR REPLACE FUNCTION public.match_rag_tender_chunks(
  match_object_number text,
  query_embedding text,
  match_count integer DEFAULT 8
)
RETURNS TABLE (
  id bigint,
  object_number text,
  attachment_id bigint,
  source_path text,
  source_name text,
  chunk_index integer,
  content text,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.id,
    c.object_number,
    c.attachment_id,
    c.source_path,
    c.source_name,
    c.chunk_index,
    c.content,
    (1 - (c.embedding <=> (query_embedding::vector)))::double precision AS similarity
  FROM public.rag_tender_chunks c
  WHERE c.object_number = match_object_number
  ORDER BY c.embedding <=> (query_embedding::vector)
  LIMIT GREATEST(1, LEAST(match_count, 30));
$$;

-- RPC: vector search for legal chunks.
CREATE OR REPLACE FUNCTION public.match_rag_legal_chunks(
  match_corpus text,
  query_embedding text,
  match_count integer DEFAULT 6
)
RETURNS TABLE (
  id bigint,
  corpus text,
  section text,
  source_url text,
  as_of_date date,
  chunk_index integer,
  content text,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.id,
    c.corpus,
    c.section,
    c.source_url,
    c.as_of_date,
    c.chunk_index,
    c.content,
    (1 - (c.embedding <=> (query_embedding::vector)))::double precision AS similarity
  FROM public.rag_legal_chunks c
  WHERE c.corpus = match_corpus
  ORDER BY c.embedding <=> (query_embedding::vector)
  LIMIT GREATEST(1, LEAST(match_count, 30));
$$;

