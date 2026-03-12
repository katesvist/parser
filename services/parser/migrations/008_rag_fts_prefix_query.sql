-- Improve FTS recall by using prefix queries (:*) built from lexemes.
-- This helps match different word forms (e.g. "благоустроить" -> "благоустройство").
-- Strategy: try AND-prefix query first; if no rows, fall back to OR-prefix query.

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
  WITH terms AS (
    SELECT tsvector_to_array(to_tsvector('russian', coalesce(query_text, ''))) AS arr
  ),
  q AS (
    SELECT
      (SELECT string_agg(quote_literal(t) || ':*', ' & ') FROM unnest(arr) t) AS q_and,
      (SELECT string_agg(quote_literal(t) || ':*', ' | ') FROM unnest(arr) t) AS q_or
    FROM terms
    WHERE array_length(arr, 1) > 0
  ),
  strict AS (
    SELECT
      c.id,
      c.object_number,
      c.attachment_id,
      c.source_path,
      c.source_name,
      c.chunk_index,
      c.content,
      ts_rank_cd(c.content_tsv, to_tsquery('russian', q.q_and))::double precision AS similarity
    FROM public.rag_tender_chunks c
    JOIN q ON true
    WHERE c.object_number = match_object_number
      AND c.content_tsv @@ to_tsquery('russian', q.q_and)
    ORDER BY similarity DESC
    LIMIT GREATEST(1, LEAST(match_count, 30))
  ),
  loose AS (
    SELECT
      c.id,
      c.object_number,
      c.attachment_id,
      c.source_path,
      c.source_name,
      c.chunk_index,
      c.content,
      ts_rank_cd(c.content_tsv, to_tsquery('russian', q.q_or))::double precision AS similarity
    FROM public.rag_tender_chunks c
    JOIN q ON true
    WHERE c.object_number = match_object_number
      AND c.content_tsv @@ to_tsquery('russian', q.q_or)
    ORDER BY similarity DESC
    LIMIT GREATEST(1, LEAST(match_count, 30))
  )
  SELECT * FROM strict
  UNION ALL
  SELECT * FROM loose
  WHERE NOT EXISTS (SELECT 1 FROM strict);
$$;

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
  WITH terms AS (
    SELECT tsvector_to_array(to_tsvector('russian', coalesce(query_text, ''))) AS arr
  ),
  q AS (
    SELECT
      (SELECT string_agg(quote_literal(t) || ':*', ' & ') FROM unnest(arr) t) AS q_and,
      (SELECT string_agg(quote_literal(t) || ':*', ' | ') FROM unnest(arr) t) AS q_or
    FROM terms
    WHERE array_length(arr, 1) > 0
  ),
  strict AS (
    SELECT
      c.id,
      c.corpus,
      c.section,
      c.source_url,
      c.as_of_date,
      c.chunk_index,
      c.content,
      ts_rank_cd(c.content_tsv, to_tsquery('russian', q.q_and))::double precision AS similarity
    FROM public.rag_legal_chunks c
    JOIN q ON true
    WHERE c.corpus = match_corpus
      AND c.content_tsv @@ to_tsquery('russian', q.q_and)
    ORDER BY similarity DESC
    LIMIT GREATEST(1, LEAST(match_count, 30))
  ),
  loose AS (
    SELECT
      c.id,
      c.corpus,
      c.section,
      c.source_url,
      c.as_of_date,
      c.chunk_index,
      c.content,
      ts_rank_cd(c.content_tsv, to_tsquery('russian', q.q_or))::double precision AS similarity
    FROM public.rag_legal_chunks c
    JOIN q ON true
    WHERE c.corpus = match_corpus
      AND c.content_tsv @@ to_tsquery('russian', q.q_or)
    ORDER BY similarity DESC
    LIMIT GREATEST(1, LEAST(match_count, 30))
  )
  SELECT * FROM strict
  UNION ALL
  SELECT * FROM loose
  WHERE NOT EXISTS (SELECT 1 FROM strict);
$$;

