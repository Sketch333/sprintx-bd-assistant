import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { PgVectorStore } from '../src/lib/vector-store';

test('real PostgreSQL title parsing retrieves Case Study - Dream.pdf', async () => {
  const db = new PGlite();
  try {
    const parsed = await db.query<{ matched: boolean }>(`SELECT to_tsvector('simple', 'Case Study - Dream.pdf') @@ plainto_tsquery('simple', 'dream') AS matched`);
    // PostgreSQL treats Dream.pdf as a single file/host token, not "dream".
    assert.equal(parsed.rows[0].matched, false);
    await db.exec(`CREATE TABLE kb_chunks (id text, content text, source_id text, source_path text, source_type text, source_title text, source_url text, chunk_index int);
      INSERT INTO kb_chunks VALUES ('dream', 'Technology: React and PostgreSQL.', 'gdrive-dream', 'Google Drive/Dream', 'document', 'Case Study - Dream.pdf', NULL, 0);`);
    const store = new PgVectorStore('postgres://fixture');
    let calls = 0;
    (store as any).pool = { query: async (sql: string, params: unknown[]) => {
      if (++calls === 1) return { rows: [{ id: 'other', score: .9, content: 'Tech stack used: React', sourceId: 'gdrive-other', sourcePath: 'other', sourceType: 'document', sourceTitle: 'Brevidee Case Study.pdf', chunkIndex: 0 }] };
      // PGlite supplies the PostgreSQL full-text engine; only pgvector distance
      // is substituted, since this fixture specifically tests filename parsing.
      const lexicalSql = sql.replace(/1 - \(embedding <=> \$1::vector\)/g, "CASE WHEN $1::text IS NOT NULL THEN 0.1 END")
        .replace(/embedding <=> \$1::vector/g, 'length(content) * 0.0');
      return db.query(lexicalSql, params as any[]);
    } };
    const results = await store.search('What is the tech Stack Used in Dream', 5);
    assert.equal(results[0]?.sourceId, 'gdrive-dream');
  } finally { await db.close(); }
});
