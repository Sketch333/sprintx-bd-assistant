import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { MemoryVectorStore, PgVectorStore } from '../src/lib/vector-store';
import { ingestGoogleDriveFolder } from '../src/lib/ingest';

const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const options = { folderId: 'root', serviceAccountJson: JSON.stringify({ client_email: 'fixture@example.com', private_key: privateKey }) };

for (const kind of ['memory', 'postgres'] as const) {
  test(`${kind}: incremental Drive sync skips unchanged files, refreshes renames and resumes saved chunks`, async () => {
    const db = kind === 'postgres' ? new PGlite() : undefined;
    let store = kind === 'postgres' ? new PgVectorStore('postgres://fixture') : new MemoryVectorStore();
    if (db) (store as any).pool = { query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('CREATE EXTENSION')) return { rows: [] };
      return db.query(sql.replace(/vector\(1536\)/g, 'text').replace(/::vector/g, '::text'), params as any[]);
    } };
    const oldGet = axios.get, oldPost = axios.post;
    const oldModel = GoogleGenerativeAI.prototype.getGenerativeModel;
    const oldKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'fixture-key';
    let embeds = 0, downloads = 0, fail = false, listingFails = false;
    let simulatedTime: number | undefined;
    const realNow = Date.now;
    Date.now = () => simulatedTime ?? realNow();
    let emptyFolder = false;
    let content = 'React PostgreSQL';
    let file = { id: 'dream', name: 'Case Study - Dream.txt', mimeType: 'text/plain', modifiedTime: '2026-09-16T00:00:00Z', webViewLink: 'https://drive.google.com/file/d/dream/view' };
    axios.post = async () => ({ data: { access_token: 'fixture-token' } });
    axios.get = async (url: string) => {
      if (url.endsWith('/files')) {
        if (listingFails) throw new Error('fixture listing unavailable');
        return { data: { files: emptyFolder ? [] : [file] } };
      }
      downloads++;
      return { data: Buffer.from(content) };
    };
    GoogleGenerativeAI.prototype.getGenerativeModel = () => ({ embedContent: async () => {
      embeds++;
      if (simulatedTime !== undefined) simulatedTime += 121000;
      if (fail) throw Object.assign(new Error('fixture denied'), { status: 403 });
      return { embedding: { values: new Array(1536).fill(1) } };
    } });
    try {
      await ingestGoogleDriveFolder(store, options);
      assert.equal(embeds, 1);
      if (db) {
        const restarted = new PgVectorStore('postgres://fixture');
        (restarted as any).pool = (store as any).pool;
        store = restarted;
      }
      const repeated = await ingestGoogleDriveFolder(store, options);
      assert.equal(repeated.skippedFiles, 1);
      assert.equal(embeds, 1);
      assert.equal(downloads, 1);
      file = { ...file, name: 'Dream.txt' };
      await ingestGoogleDriveFolder(store, options);
      assert.equal(downloads, 1);
      const renamed = await (store as any).getSource('gdrive-dream');
      assert.equal(renamed.sourceTitle, 'Dream.txt');
      if (db) assert.equal((await db.query<any>('SELECT source_title FROM kb_chunks')).rows[0].source_title, 'Dream.txt');
      else assert.equal((store as any).chunks[0].sourceTitle, 'Dream.txt');
      file = { ...file, modifiedTime: '2026-09-16T01:00:00Z' };
      // A timestamp-only change should not spend embedding quota.
      await ingestGoogleDriveFolder(store, options);
      assert.equal(embeds, 1);
      content = 'React PostgreSQL '.repeat(80);
      file = { ...file, modifiedTime: '2026-09-16T02:00:00Z' };
      const originalAdd = store.addChunk.bind(store);
      let chunks = 0;
      store.addChunk = async (chunk) => { if (++chunks === 2) fail = true; return originalAdd(chunk); };
      await assert.rejects(ingestGoogleDriveFolder(store, options), /HTTP 403/);
      const afterFailure = embeds;
      fail = false;
      store.addChunk = originalAdd;
      await ingestGoogleDriveFolder(store, options);
      assert.equal(embeds, afterFailure + 1, 'resume only embeds the unsaved second chunk');
      assert.equal((await store.getStats()).chunkCount, 2);
      const final = await ingestGoogleDriveFolder(store, options);
      assert.equal(final.skippedFiles, 1);
      assert.equal(embeds, afterFailure + 1);
      process.env.GEMINI_API_KEY = 'replacement-fixture-key';
      assert.equal((await ingestGoogleDriveFolder(store, options)).skippedFiles, 1);
      assert.equal(embeds, afterFailure + 1, 'key rotation must not invalidate the model profile');
      const checkpoint = await store.getSource('gdrive-dream');
      assert.ok(checkpoint);
      await store.addSource({ ...checkpoint, metadata: { ...checkpoint.metadata, syncComplete: false } });
      if (db) await db.exec(`UPDATE kb_chunks SET metadata=metadata-'embeddingProfile' WHERE chunk_index=0`);
      else delete (store as any).chunks[0].metadata.embeddingProfile;
      await ingestGoogleDriveFolder(store, options);
      assert.equal(embeds, afterFailure + 2, 'untagged chunk must be regenerated, tagged chunk reused');
      content = 'New Dream technology '.repeat(65);
      file = { ...file, modifiedTime: '2026-09-16T02:30:00Z' };
      const beforeBatch = embeds;
      const partial = await ingestGoogleDriveFolder(store, { ...options, maxNewChunks: 1 });
      assert.equal(partial.complete, false);
      assert.equal(partial.removed, 0);
      assert.equal(embeds, beforeBatch + 1);
      assert.equal((await store.getSource('gdrive-dream'))?.metadata?.syncComplete, false);
      const continued = await ingestGoogleDriveFolder(store, { ...options, maxNewChunks: 1 });
      assert.equal(continued.complete, true);
      assert.equal(embeds, beforeBatch + 2, 'saved chunks do not consume the next batch budget');
      content = 'Time budget Dream '.repeat(75);
      file = { ...file, modifiedTime: '2026-09-16T02:40:00Z' };
      simulatedTime = realNow();
      const deadlinePause = await ingestGoogleDriveFolder(store, options);
      assert.equal(deadlinePause.complete, false);
      assert.equal(deadlinePause.newEmbeddings, 1);
      assert.equal(deadlinePause.removed, 0);
      simulatedTime = undefined;
      assert.equal((await ingestGoogleDriveFolder(store, options)).complete, true);
      const completed = await store.getSource('gdrive-dream');
      assert.ok(completed);
      await store.addSource({ ...completed, id: 'gdrive-stale' });
      await store.addSource({ ...completed, id: 'gdrive-other-root', metadata: { ingestionRoot: 'google-drive:other-root' } });
      await store.addSource({ ...completed, id: 'site-preserved', metadata: {} });
      content = '';
      file = { ...file, modifiedTime: '2026-09-16T03:00:00Z' };
      const emptyText = await ingestGoogleDriveFolder(store, options);
      assert.equal(emptyText.failedFiles.length, 1);
      assert.ok(await store.getSource('gdrive-stale'), 'empty extraction must not trigger deletion');
      listingFails = true;
      await assert.rejects(ingestGoogleDriveFolder(store, options), /listing unavailable/);
      assert.ok(await store.getSource('gdrive-stale'));
      listingFails = false;
      emptyFolder = true;
      const deleted = await ingestGoogleDriveFolder(store, options);
      assert.equal(deleted.removed, 2);
      assert.ok(await store.getSource('gdrive-other-root'));
      assert.ok(await store.getSource('site-preserved'));
    } finally {
      axios.get = oldGet; axios.post = oldPost;
      GoogleGenerativeAI.prototype.getGenerativeModel = oldModel;
      Date.now = realNow;
      if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
      await db?.close();
    }
  });
}
