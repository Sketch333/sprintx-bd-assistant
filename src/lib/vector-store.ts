const { Pool } = require('pg');
import { randomUUID } from 'crypto';

import { config } from '../config';
import { KnowledgeChunk, SearchResult, SourceRecord } from '../types';
import { embeddingProfile, generateEmbedding } from './embeddings';
import { DocumentFilter, DocumentPage, documentPageBounds, isIndexedDocument, isDriveDocument, isCaseStudyDocument, matchesDocumentTitle, titleWords, titleNoise } from './document-inventory';

export interface VectorStore {
  listDocuments(filter?: DocumentFilter): Promise<DocumentPage>;
  findDocuments(query: string): Promise<SourceRecord[]>;
  getSource(id: string): Promise<SourceRecord | undefined>;
  getSourceChunks(sourceId: string): Promise<KnowledgeChunk[]>;
  patchSourceMetadata(id: string, patch: Record<string, string | number | boolean | null>): Promise<SourceRecord | undefined>;
  refreshSourceChunks(source: SourceRecord): Promise<void>;
  addSource(source: SourceRecord): Promise<void>;
  addChunk(chunk: KnowledgeChunk): Promise<boolean>;
  removeChunksExcept(sourceId: string, chunkIds: Set<string>): Promise<number>;
  removeSourcesExcept(prefix: string, sourceIds: Set<string>, ingestionRoot?: string): Promise<number>;
  search(query: string, limit?: number, sourceIds?: string[]): Promise<SearchResult[]>;
  getStats(): Promise<{ chunkCount: number; sourceCount: number }>;
}

export class MemoryVectorStore implements VectorStore {
  private sources = new Map<string, SourceRecord>();
  private chunks: KnowledgeChunk[] = [];
  private embeddings = new Map<string, number[]>();

  private indexedDocuments(): SourceRecord[] {
    const indexedIds = new Set(this.chunks.filter((chunk) => chunk.content.trim() && this.embeddings.has(chunk.id)).map((chunk) => chunk.sourceId));
    return [...this.sources.values()].filter((source) => isIndexedDocument(source) && indexedIds.has(source.id));
  }

  async listDocuments(filter: DocumentFilter = {}): Promise<DocumentPage> {
    const { offset, limit } = documentPageBounds(filter);
    const documents = this.indexedDocuments().filter((source) =>
      (filter.scope !== 'drive' || isDriveDocument(source)) && (!filter.sourceType || source.sourceType === filter.sourceType)
      && (!filter.caseStudies || isCaseStudyDocument(source)))
      .sort((a, b) => a.sourceTitle.toLowerCase().localeCompare(b.sourceTitle.toLowerCase()) || a.id.localeCompare(b.id));
    return { documents: documents.slice(offset, offset + limit), total: documents.length, hasMore: offset + limit < documents.length };
  }

  async findDocuments(query: string): Promise<SourceRecord[]> {
    return this.indexedDocuments().filter((source) => matchesDocumentTitle(query, source.sourceTitle))
      .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 21);
  }

  async getSource(id: string): Promise<SourceRecord | undefined> {
    const source = this.sources.get(id);
    return source ? { ...source, metadata: { ...source.metadata } } : undefined;
  }

  async getSourceChunks(sourceId: string): Promise<KnowledgeChunk[]> {
    return this.chunks.filter((chunk) => chunk.sourceId === sourceId).map((chunk) => ({ ...chunk, metadata: { ...chunk.metadata } }));
  }

  async patchSourceMetadata(id: string, patch: Record<string, string | number | boolean | null>): Promise<SourceRecord | undefined> {
    const source = this.sources.get(id);
    if (!source) return undefined;
    const updated = { ...source, metadata: { ...source.metadata, ...patch } };
    this.sources.set(id, updated);
    return { ...updated, metadata: { ...updated.metadata } };
  }

  async refreshSourceChunks(source: SourceRecord): Promise<void> {
    this.chunks = this.chunks.map((chunk) => chunk.sourceId === source.id ? {
      ...chunk, sourceTitle: source.sourceTitle, sourcePath: source.sourcePath,
      sourceUrl: source.sourceUrl, sourceType: source.sourceType,
    } : chunk);
  }

  async addSource(source: SourceRecord): Promise<void> {
    this.sources.set(source.id, source);
  }

  async addChunk(chunk: KnowledgeChunk): Promise<boolean> {
    const existingIndex = this.chunks.findIndex((existing) => existing.id === chunk.id);
    const existing = this.chunks[existingIndex];
    const profile = embeddingProfile();
    const reused = existing?.content === chunk.content && existing.metadata?.embeddingProfile === profile && this.embeddings.has(chunk.id);
    const embedding = reused
      ? this.embeddings.get(chunk.id)! : await generateEmbedding(chunk.content);
    chunk = { ...chunk, metadata: { ...chunk.metadata, embeddingProfile: profile } };
    if (existingIndex >= 0) {
      this.chunks[existingIndex] = chunk;
    } else {
      this.chunks.push(chunk);
    }
    this.embeddings.set(chunk.id, embedding);
    return !reused;
  }

  async removeChunksExcept(sourceId: string, chunkIds: Set<string>): Promise<number> {
    const staleChunks = this.chunks.filter((chunk) => chunk.sourceId === sourceId && !chunkIds.has(chunk.id));
    const staleIds = new Set(staleChunks.map((chunk) => chunk.id));
    this.chunks = this.chunks.filter((chunk) => !staleIds.has(chunk.id));
    staleIds.forEach((id) => this.embeddings.delete(id));
    return staleIds.size;
  }

  async removeSourcesExcept(prefix: string, sourceIds: Set<string>, ingestionRoot?: string): Promise<number> {
    const staleIds = [...this.sources.keys()].filter((id) => id.startsWith(prefix) && !sourceIds.has(id)
      && (!ingestionRoot || this.sources.get(id)?.metadata?.ingestionRoot === ingestionRoot));
    for (const sourceId of staleIds) {
      this.sources.delete(sourceId);
    }
    this.chunks = this.chunks.filter((chunk) => {
      if (!staleIds.includes(chunk.sourceId)) return true;
      this.embeddings.delete(chunk.id);
      return false;
    });
    return staleIds.length;
  }

  async search(query: string, limit = 5, sourceIds?: string[]): Promise<SearchResult[]> {
    if (sourceIds?.length === 0) return [];
    const queryEmbedding = await generateEmbedding(query);

    const results = this.chunks
      .filter((chunk) => !sourceIds || sourceIds.includes(chunk.sourceId))
      .map((chunk) => {
        const embedding = this.embeddings.get(chunk.id) ?? new Array(1536).fill(0);
        const vectorScore = cosineSimilarity(queryEmbedding, embedding);
        const lexicalScore = lexicalCoverage(query, `${chunk.sourceTitle} ${chunk.content}`);
        const score = Math.max(vectorScore, lexicalScore) + namedTitleScore(query, chunk.sourceTitle);

        return {
          id: chunk.id,
          score,
          content: chunk.content,
          sourceId: chunk.sourceId,
          sourcePath: chunk.sourcePath,
          sourceType: chunk.sourceType,
          sourceTitle: chunk.sourceTitle,
          sourceUrl: chunk.sourceUrl,
          chunkIndex: chunk.chunkIndex,
        } satisfies SearchResult;
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    return results;
  }

  async getStats(): Promise<{ chunkCount: number; sourceCount: number }> {
    return {
      chunkCount: this.chunks.length,
      sourceCount: this.sources.size,
    };
  }
}

export class PgVectorStore implements VectorStore {
  private readonly pool: any;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, connectionTimeoutMillis: 10000, query_timeout: 15000 });
  }

  async listDocuments(filter: DocumentFilter = {}): Promise<DocumentPage> {
    const { offset, limit } = documentPageBounds(filter);
    // One statement gives the total and page from the same database snapshot,
    // including an accurate total for pages beyond the last document.
    const { rows } = await this.pool.query(`WITH matched AS (
      SELECT s.id, s.source_type AS "sourceType", s.source_title AS "sourceTitle",
        s.source_path AS "sourcePath", s.source_url AS "sourceUrl", s.status,
        s.updated_at AS "updatedAt", s.metadata FROM kb_sources s
      WHERE ${indexedDocumentSql}
        AND (NOT $1::boolean OR s.id LIKE 'gdrive-%' OR s.metadata->>'source'='google-drive')
        AND (NOT $2::boolean OR CASE WHEN s.metadata->>'category' IS NOT NULL
          THEN s.metadata->>'category'='case-study'
          ELSE lower(COALESCE(s.metadata->>'folderPath', regexp_replace(translate(s.source_path, chr(92), '/'), '/[^/]*$', '')))
            ~ '(^|/) *case studies *(/|$)' END)
        AND ($5::text IS NULL OR s.source_type=$5)
    ), page AS (SELECT * FROM matched ORDER BY lower("sourceTitle"), id OFFSET $3 LIMIT $4)
    SELECT (SELECT count(*) FROM matched)::int AS total,
      COALESCE((SELECT jsonb_agg(page) FROM page), '[]'::jsonb) AS documents`,
    [filter.scope === 'drive', Boolean(filter.caseStudies), offset, limit, filter.sourceType ?? null]);
    const total = Number(rows[0].total);
    return { documents: rows[0].documents, total, hasMore: offset + limit < total };
  }

  async findDocuments(query: string): Promise<SourceRecord[]> {
    const words = titleWords(query);
    if (!words.length) return [];
    const { rows } = await this.pool.query(`SELECT s.id, s.source_type AS "sourceType", s.source_title AS "sourceTitle",
      s.source_path AS "sourcePath", s.source_url AS "sourceUrl", s.status,
      s.updated_at AS "updatedAt", s.metadata FROM kb_sources s
      CROSS JOIN LATERAL (SELECT array_agg(word) AS words FROM unnest(regexp_split_to_array(
        regexp_replace(lower(s.source_title), '[^a-z0-9]+', ' ', 'g'), ' +')) word
        WHERE word <> '' AND word !~ '^[0-9]+$' AND NOT (word=ANY($2::text[]))) title
      WHERE ${indexedDocumentSql} AND cardinality(title.words)>0 AND title.words <@ $1::text[]
      ORDER BY s.id LIMIT 21`, [words, titleNoise]);
    return rows;
  }

  async getSource(id: string): Promise<SourceRecord | undefined> {
    try {
      const { rows } = await this.pool.query(`SELECT id, source_type AS "sourceType", source_title AS "sourceTitle", source_path AS "sourcePath", source_url AS "sourceUrl", status, updated_at AS "updatedAt", metadata FROM kb_sources WHERE id = $1`, [id]);
      return rows[0];
    } catch (error) {
      if ((error as { code?: string }).code === '42P01') return undefined;
      throw error;
    }
  }

  async getSourceChunks(sourceId: string): Promise<KnowledgeChunk[]> {
    const { rows } = await this.pool.query(`SELECT id, content, source_id AS "sourceId", source_path AS "sourcePath",
      source_type AS "sourceType", source_title AS "sourceTitle", source_url AS "sourceUrl",
      chunk_index AS "chunkIndex", metadata FROM kb_chunks WHERE source_id=$1 ORDER BY chunk_index`, [sourceId]);
    return rows;
  }

  async patchSourceMetadata(id: string, patch: Record<string, string | number | boolean | null>): Promise<SourceRecord | undefined> {
    const { rows } = await this.pool.query(`UPDATE kb_sources
      SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
      WHERE id=$1
      RETURNING id, source_type AS "sourceType", source_title AS "sourceTitle",
        source_path AS "sourcePath", source_url AS "sourceUrl", status,
        updated_at AS "updatedAt", metadata`, [id, JSON.stringify(patch)]);
    return rows[0];
  }

  async refreshSourceChunks(source: SourceRecord): Promise<void> {
    await this.pool.query(`UPDATE kb_chunks SET source_title=$2, source_path=$3, source_url=$4, source_type=$5 WHERE source_id=$1`,
      [source.id, source.sourceTitle, source.sourcePath, source.sourceUrl ?? null, source.sourceType]);
  }

  async addSource(source: SourceRecord): Promise<void> {
    await this.pool.query(
      `
        CREATE TABLE IF NOT EXISTS kb_sources (
          id TEXT PRIMARY KEY,
          source_type TEXT NOT NULL,
          source_title TEXT NOT NULL,
          source_path TEXT NOT NULL,
          source_url TEXT,
          status TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL,
          metadata JSONB
        );
      `,
    );

    await this.pool.query(
      `
        INSERT INTO kb_sources (id, source_type, source_title, source_path, source_url, status, updated_at, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          source_type = EXCLUDED.source_type,
          source_title = EXCLUDED.source_title,
          source_path = EXCLUDED.source_path,
          source_url = EXCLUDED.source_url,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at,
          metadata = EXCLUDED.metadata;
      `,
      [
        source.id,
        source.sourceType,
        source.sourceTitle,
        source.sourcePath,
        source.sourceUrl ?? null,
        source.status,
        source.updatedAt,
        JSON.stringify(source.metadata ?? {}),
      ],
    );
  }

  async addChunk(chunk: KnowledgeChunk): Promise<boolean> {
    await this.pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
    await this.pool.query(
      `
        CREATE TABLE IF NOT EXISTS kb_chunks (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          source_id TEXT NOT NULL,
          source_path TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_title TEXT NOT NULL,
          source_url TEXT,
          chunk_index INTEGER NOT NULL,
          embedding vector(1536),
          metadata JSONB
        );
      `,
    );

    const profile = embeddingProfile();
    // Reuse only vectors whose content and model provenance are known to match.
    // Untagged legacy rows are deliberately regenerated once.
    const { rows } = await this.pool.query(`SELECT embedding::text AS embedding FROM kb_chunks WHERE id=$1 AND content=$2 AND metadata->>'embeddingProfile'=$3 AND embedding IS NOT NULL`, [chunk.id, chunk.content, profile]);
    const embedding = rows[0]?.embedding ?? `[${(await generateEmbedding(chunk.content)).join(',')}]`;

    await this.pool.query(
      `
        INSERT INTO kb_chunks (id, content, source_id, source_path, source_type, source_title, source_url, chunk_index, embedding, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10)
        ON CONFLICT (id) DO UPDATE SET
          content = EXCLUDED.content,
          source_id = EXCLUDED.source_id,
          source_path = EXCLUDED.source_path,
          source_type = EXCLUDED.source_type,
          source_title = EXCLUDED.source_title,
          source_url = EXCLUDED.source_url,
          chunk_index = EXCLUDED.chunk_index,
          embedding = EXCLUDED.embedding,
          metadata = EXCLUDED.metadata;
      `,
      [
        chunk.id,
        chunk.content,
        chunk.sourceId,
        chunk.sourcePath,
        chunk.sourceType,
        chunk.sourceTitle,
        chunk.sourceUrl ?? null,
        chunk.chunkIndex,
        embedding,
        JSON.stringify({ ...chunk.metadata, embeddingProfile: profile }),
      ],
    );
    return !rows.length;
  }

  async removeChunksExcept(sourceId: string, chunkIds: Set<string>): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT id FROM kb_chunks WHERE source_id = $1 AND NOT (id = ANY($2::text[]));`,
      [sourceId, [...chunkIds]],
    );
    if (!rows.length) return 0;
    await this.pool.query(
      `DELETE FROM kb_chunks WHERE source_id = $1 AND NOT (id = ANY($2::text[]));`,
      [sourceId, [...chunkIds]],
    );
    return rows.length;
  }

  async removeSourcesExcept(prefix: string, sourceIds: Set<string>, ingestionRoot?: string): Promise<number> {
    const { rows } = await this.pool.query(
      `DELETE FROM kb_sources WHERE id LIKE $1 AND NOT (id = ANY($2::text[]))
       AND ($3::text IS NULL OR metadata->>'ingestionRoot' = $3) RETURNING id;`,
      [`${prefix}%`, [...sourceIds], ingestionRoot ?? null],
    );
    return rows.length;
  }

  async search(query: string, limit = 5, sourceIds?: string[]): Promise<SearchResult[]> {
    if (sourceIds?.length === 0) return [];
    const embedding = await generateEmbedding(query);
    const candidateLimit = Math.max(limit * 10, 50);

    const { rows } = await this.pool.query(
      `
        SELECT
          id,
          1 - (embedding <=> $1::vector) AS score,
          content,
          source_id AS "sourceId",
          source_path AS "sourcePath",
          source_type AS "sourceType",
          source_title AS "sourceTitle",
          source_url AS "sourceUrl",
          chunk_index AS "chunkIndex"
        FROM kb_chunks
        ${sourceIds ? 'WHERE source_id = ANY($3::text[])' : ''}
        ORDER BY embedding <=> $1::vector
        LIMIT $2;
      `,
      [`[${embedding.join(',')}]`, candidateLimit, ...(sourceIds ? [sourceIds] : [])],
    );

    // Lexical candidates come from the whole KB, not just the vector shortlist.
    // This recovers named files even when their embeddings rank below websites.
    const terms = searchTerms(query);
    const normalizedTitle = `regexp_replace(lower(source_title), '[^a-z0-9]+', ' ', 'g')`;
    const searchableText = `${normalizedTitle} || ' ' || content`;
    const lexicalRows = terms.length ? (await this.pool.query(
      `SELECT id, 1 - (embedding <=> $1::vector) AS score, content,
       source_id AS "sourceId", source_path AS "sourcePath", source_type AS "sourceType",
       source_title AS "sourceTitle", source_url AS "sourceUrl", chunk_index AS "chunkIndex"
       FROM kb_chunks
       WHERE to_tsvector('simple', ${searchableText}) @@ to_tsquery('simple', $3)
       ${sourceIds ? 'AND source_id = ANY($4::text[])' : ''}
       ORDER BY (to_tsvector('simple', ${normalizedTitle}) @@ to_tsquery('simple', $3)) DESC,
         ts_rank_cd(to_tsvector('simple', ${searchableText}), to_tsquery('simple', $3)) DESC,
         embedding <=> $1::vector
       LIMIT $2;`,
      [`[${embedding.join(',')}]`, candidateLimit, terms.map((term) => `'${term}'`).join(' | '), ...(sourceIds ? [sourceIds] : [])],
    )).rows : [];
    const candidates = [...new Map([...rows, ...lexicalRows].map((row: any) => [row.id, row])).values()];

    return candidates
      .map((row: any) => {
        const vectorScore = Number(row.score);
        const lexicalScore = lexicalCoverage(query, `${row.sourceTitle} ${row.content}`);
        return {
          id: row.id,
          score: Math.max(Number.isFinite(vectorScore) ? vectorScore : 0, lexicalScore) + namedTitleScore(query, row.sourceTitle),
          content: row.content,
          sourceId: row.sourceId,
          sourcePath: row.sourcePath,
          sourceType: row.sourceType,
          sourceTitle: row.sourceTitle,
          sourceUrl: row.sourceUrl ?? undefined,
          chunkIndex: Number(row.chunkIndex),
        };
      })
      .sort((left: SearchResult, right: SearchResult) => right.score - left.score)
      .slice(0, limit);
  }

  async getStats(): Promise<{ chunkCount: number; sourceCount: number }> {
    const [{ rows: chunkRows }, { rows: sourceRows }] = await Promise.all([
      this.pool.query('SELECT COUNT(*) AS count FROM kb_chunks;'),
      this.pool.query('SELECT COUNT(*) AS count FROM kb_sources;'),
    ]);

    return {
      chunkCount: Number(chunkRows[0]?.count ?? 0),
      sourceCount: Number(sourceRows[0]?.count ?? 0),
    };
  }
}

export async function createVectorStore(): Promise<VectorStore> {
  if (config.databaseUrl) {
    return new PgVectorStore(config.databaseUrl);
  }

  return new MemoryVectorStore();
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || !right.length || left.length !== right.length) {
    return 0;
  }

  let numerator = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    numerator += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return numerator / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function lexicalSimilarity(left: string, right: string): number {
  const leftTerms = normalizeTerms(left);
  const rightTerms = normalizeTerms(right);
  if (!leftTerms.length || !rightTerms.length) {
    return 0;
  }

  const leftSet = new Set(leftTerms);
  const overlap = rightTerms.filter((term) => leftSet.has(term));
  const count = overlap.length;
  const denominator = Math.max(leftTerms.length, rightTerms.length);
  if (!denominator) {
    return 0;
  }

  return count / denominator;
}

function lexicalCoverage(query: string, content: string): number {
  const queryTerms = new Set(searchTerms(query));
  if (!queryTerms.size) return 0;
  const contentTerms = new Set(normalizeTerms(content));
  const matchedTerms = [...queryTerms].filter((term) => contentTerms.has(term)).length;
  return matchedTerms / queryTerms.size;
}

const indexedDocumentSql = `s.status='active' AND s.source_type IN ('document', 'sheet')
  AND COALESCE(s.metadata->>'syncComplete', 'true') <> 'false'
  AND EXISTS (SELECT 1 FROM kb_chunks c WHERE c.source_id=s.id AND btrim(c.content)<>'' AND c.embedding IS NOT NULL)`;

const retrievalStopWords = new Set(['what', 'which', 'when', 'where', 'why', 'who', 'how', 'the', 'and', 'for', 'are', 'does', 'with', 'mentioned', 'please', 'about', 'case', 'study', 'studies', 'tech', 'technology', 'stack', 'stacked', 'pdf', 'docx', 'xlsx']);

function searchTerms(query: string): string[] {
  return [...new Set(normalizeTerms(query).filter((term) => term.length > 2 && !retrievalStopWords.has(term)))].slice(0, 32);
}

function namedTitleScore(query: string, title: string): number {
  const queryTerms = new Set(searchTerms(query));
  const titleTerms = searchTerms(title);
  // A complete distinctive title match outranks a generic semantic neighbor.
  return titleTerms.length && titleTerms.every((term) => queryTerms.has(term)) ? 2 : 0;
}

function normalizeTerms(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

export function makeSourceId(kind: 'document' | 'site' | 'sheet', name: string): string {
  return `${kind}-${randomUUID()}-${name.replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 48)}`;
}
