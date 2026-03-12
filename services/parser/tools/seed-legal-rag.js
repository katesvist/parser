/* eslint-disable no-console */
/**
 * Seeds RAG legal corpus into Postgres (rag_legal_chunks).
 *
 * Input files are expected at:
 * - config/legal/44fz.txt
 * - config/legal/223fz.txt
 *
 * This script is designed to run inside the parser container (it already has DB + API keys in env).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

function envBool(name, def) {
  const raw = process.env[name];
  if (raw === undefined) return def;
  return String(raw).toLowerCase() === 'true';
}

function getDbConfig() {
  // Matches libs/db defaults.
  return {
    connectionString: process.env.DATABASE_URL,
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    max: 3,
  };
}

function getEmbeddingsConfig() {
  const apiKey =
    process.env.EMBEDDINGS_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    '';
  const baseUrl = (
    process.env.EMBEDDINGS_BASE_URL ||
    process.env.OPENROUTER_BASE_URL ||
    'https://openrouter.ai/api/v1'
  ).replace(/\/$/, '');
  const model = process.env.EMBEDDINGS_MODEL || 'text-embedding-3-small';
  const dim = Number(process.env.EMBEDDINGS_DIM || 1536);
  if (!apiKey) {
    throw new Error(
      'Missing EMBEDDINGS_API_KEY/OPENAI_API_KEY/OPENROUTER_API_KEY for embeddings.'
    );
  }
  return { apiKey, baseUrl, model, dim };
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function chunkText(text, maxChars, overlapChars, maxChunks) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const parts = normalized
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks = [];
  let current = '';
  for (const part of parts) {
    const next = current ? `${current}\n\n${part}` : part;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    const overlap = overlapChars > 0 ? current.slice(Math.max(0, current.length - overlapChars)) : '';
    current = overlap ? `${overlap}\n\n${part}` : part;
    if (chunks.length >= maxChunks) return chunks;
  }
  if (current && chunks.length < maxChunks) chunks.push(current);
  return chunks.slice(0, maxChunks);
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function formatVector(values, expectedDim) {
  if (!Array.isArray(values) || values.length !== expectedDim) {
    throw new Error(
      `Embedding dimension mismatch: got ${values?.length}, expected ${expectedDim}`
    );
  }
  return `[${values
    .map((v) => (Number.isFinite(v) ? Number(v).toFixed(8) : '0'))
    .join(',')}]`;
}

async function embedTexts(texts) {
  const { apiKey, baseUrl, model } = getEmbeddingsConfig();
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: texts }),
  });
  const t = await res.text();
  let json = null;
  try {
    json = t ? JSON.parse(t) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(`Embeddings HTTP ${res.status} ${res.statusText}: ${t}`);
  }
  if (json?.error) {
    throw new Error(`Embeddings provider error: ${JSON.stringify(json.error)}`);
  }
  const data = Array.isArray(json?.data) ? json.data : [];
  const embeddings = data.map((row) => row?.embedding).filter((x) => Array.isArray(x));
  if (embeddings.length !== texts.length) {
    throw new Error(`Embeddings result mismatch: got ${embeddings.length} for ${texts.length} inputs`);
  }
  return embeddings;
}

async function seedCorpus(client, corpus, filePath) {
  const enabled = envBool('RAG_LEGAL_SEED_ENABLED', true);
  if (!enabled) {
    console.log('RAG_LEGAL_SEED_ENABLED=false, skip.');
    return;
  }

  const abs = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Missing legal text file: ${abs}`);
  }
  const raw = fs.readFileSync(abs, 'utf8');
  const text = normalizeText(raw);
  if (!text || text.length < 2000) {
    throw new Error(`Legal corpus file too small (or empty): ${abs}`);
  }

  const maxText = Number(process.env.RAG_LEGAL_TEXT_LIMIT || 600000);
  const maxChars = Number(process.env.RAG_LEGAL_CHUNK_MAX_CHARS || 2200);
  const overlap = Number(process.env.RAG_LEGAL_CHUNK_OVERLAP_CHARS || 200);
  const maxChunks = Number(process.env.RAG_LEGAL_MAX_CHUNKS || 3000);
  const minChars = Number(process.env.RAG_LEGAL_MIN_CHUNK_CHARS || 400);
  const batchSize = Number(process.env.RAG_EMBED_BATCH_SIZE || 24);
  const { dim } = getEmbeddingsConfig();

  const sliced = text.slice(0, maxText);
  const chunks = chunkText(sliced, maxChars, overlap, maxChunks).filter((c) => c.length >= minChars);
  console.log(`${corpus}: prepared ${chunks.length} chunks from ${abs}`);

  const sourceUrl =
    corpus === '44fz'
      ? process.env.LEGAL_44FZ_SOURCE_URL || null
      : process.env.LEGAL_223FZ_SOURCE_URL || null;
  const asOfDate = process.env.LEGAL_AS_OF_DATE || null;

  await client.query('BEGIN');
  try {
    await client.query(`DELETE FROM public.rag_legal_chunks WHERE corpus = $1;`, [corpus]);
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      let embeddings = null;
      const mode = String(process.env.RAG_SEARCH_MODE || 'auto').toLowerCase();
      if (mode !== 'fts') {
        try {
          embeddings = await embedTexts(batch);
        } catch (e) {
          console.log(`${corpus}: embeddings unavailable, seeding via FTS only (${String(e)})`);
          embeddings = null;
        }
      }
      for (let j = 0; j < batch.length; j += 1) {
        const content = batch[j];
        const hash = sha256(content);
        const vector = embeddings ? formatVector(embeddings[j], dim) : null;
        await client.query(
          `INSERT INTO public.rag_legal_chunks
            (corpus, section, source_url, as_of_date, chunk_index, content, content_hash, embedding)
           VALUES ($1, NULL, $2, $3, $4, $5, $6, $7::vector)
           ON CONFLICT (corpus, content_hash) DO NOTHING;`,
          [corpus, sourceUrl, asOfDate, i + j, content, hash, vector]
        );
      }
      process.stdout.write('.');
    }
    process.stdout.write('\n');
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function main() {
  const pool = new Pool(getDbConfig());
  const client = await pool.connect();
  try {
    await seedCorpus(client, '44fz', 'config/legal/44fz.txt');
    await seedCorpus(client, '223fz', 'config/legal/223fz.txt');
    console.log('Done.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
