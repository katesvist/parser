-- Guard against empty tsquery so FTS RPC doesn't emit NOTICE and behaves predictably.
-- Also helps assistant distinguish "no matches" vs "corpus missing" in logs.

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
    WHERE length(btrim(coalesce(query_text, ''))) > 0
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
  FROM public.rag_tender_chunks c
  JOIN q ON true
  WHERE c.object_number = match_object_number
    AND c.content_tsv @@ q.tsq
  ORDER BY similarity DESC
  LIMIT GREATEST(1, LEAST(match_count, 30));
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
  WITH q AS (
    SELECT websearch_to_tsquery('russian', coalesce(query_text, '')) AS tsq
    WHERE length(btrim(coalesce(query_text, ''))) > 0
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
  FROM public.rag_legal_chunks c
  JOIN q ON true
  WHERE c.corpus = match_corpus
    AND c.content_tsv @@ q.tsq
  ORDER BY similarity DESC
  LIMIT GREATEST(1, LEAST(match_count, 30));
$$;

