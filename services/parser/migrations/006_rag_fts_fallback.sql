-- FTS fallback for RAG when embeddings provider is unavailable.
-- OpenRouter may not provide embedding models for some accounts; this keeps assistant functional.

-- Make embeddings optional.
ALTER TABLE public.rag_tender_chunks
  ALTER COLUMN embedding DROP NOT NULL;

ALTER TABLE public.rag_legal_chunks
  ALTER COLUMN embedding DROP NOT NULL;

-- Add generated tsvector columns for Russian full-text search.
ALTER TABLE public.rag_tender_chunks
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('russian', coalesce(content, ''))) STORED;

ALTER TABLE public.rag_legal_chunks
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('russian', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS rag_tender_chunks_content_tsv_gin
  ON public.rag_tender_chunks
  USING gin (content_tsv);

CREATE INDEX IF NOT EXISTS rag_legal_chunks_content_tsv_gin
  ON public.rag_legal_chunks
  USING gin (content_tsv);

-- RPC: FTS search for tender chunks.
CREATE OR REPLACE FUNCTION public.match_rag_tender_chunks_fts(
  match_object_number text,
  query_text text,
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
  WITH q AS (
    SELECT websearch_to_tsquery('russian', coalesce(query_text, '')) AS tsq
  )
  SELECT
    c.id,
    c.object_number,
    c.attachment_id,
    c.source_path,
    c.source_name,
    c.chunk_index,
    c.content,
    ts_rank_cd(c.content_tsv, q.tsq)::double precision AS similarity
  FROM public.rag_tender_chunks c, q
  WHERE c.object_number = match_object_number
    AND q.tsq <> ''::tsquery
    AND c.content_tsv @@ q.tsq
  ORDER BY similarity DESC
  LIMIT GREATEST(1, LEAST(match_count, 30));
$$;

-- RPC: FTS search for legal chunks.
CREATE OR REPLACE FUNCTION public.match_rag_legal_chunks_fts(
  match_corpus text,
  query_text text,
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
  WITH q AS (
    SELECT websearch_to_tsquery('russian', coalesce(query_text, '')) AS tsq
  )
  SELECT
    c.id,
    c.corpus,
    c.section,
    c.source_url,
    c.as_of_date,
    c.chunk_index,
    c.content,
    ts_rank_cd(c.content_tsv, q.tsq)::double precision AS similarity
  FROM public.rag_legal_chunks c, q
  WHERE c.corpus = match_corpus
    AND q.tsq <> ''::tsquery
    AND c.content_tsv @@ q.tsq
  ORDER BY similarity DESC
  LIMIT GREATEST(1, LEAST(match_count, 30));
$$;

