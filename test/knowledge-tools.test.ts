import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { MemoryVectorStore, PgVectorStore } from '../src/lib/vector-store';
import { SourceRecord } from '../src/types';
import * as ask from '../src/lib/ask-service';
import { inventoryRequest } from '../src/lib/knowledge-tools';

// Execute real store queries in PostgreSQL; substitute only pgvector distance.
async function fixture(kind: 'memory' | 'postgres') {
  const db = kind === 'postgres' ? new PGlite() : undefined;
  const store = db ? new PgVectorStore('postgres://fixture') : new MemoryVectorStore();
  if (db) (store as any).pool = { query: (sql: string, params?: unknown[]) => {
    if (sql.includes('CREATE EXTENSION')) return Promise.resolve({ rows: [] });
    return db.query(sql.replace(/vector\(1536\)/g, 'text')
      .replace(/1 - \(embedding <=> \$1::vector\)/g, 'CASE WHEN $1::text IS NOT NULL THEN 0.1 END')
      .replace(/embedding <=> \$1::vector/g, 'length(content) * 0.0')
      .replace(/::vector/g, '::text'), params as any[]);
  } };
  const add = async (id: string, title: string, content: string, overrides: Partial<SourceRecord> = {}, withChunk = true) => {
    const source: SourceRecord = { id, sourceTitle: title, sourcePath: `Google Drive/${title}`, sourceUrl: `https://drive.google.com/file/d/${id}/view`, sourceType: 'document', status: 'active', updatedAt: '2026-09-16T00:00:00Z', metadata: { source: 'google-drive', syncComplete: true }, ...overrides };
    await store.addSource(source);
    if (withChunk) await store.addChunk({ id: `${id}-0`, content, sourceId: id, sourceTitle: title, sourcePath: source.sourcePath, sourceType: source.sourceType, chunkIndex: 0 });
  };
  return { store, add, close: async () => db?.close() };
}

test('Ask counts and lists the entire indexed inventory without an embedding or generation request', async () => {
  assert.equal(typeof ask.answerFromKnowledgeTools, 'function', 'Ask must dispatch inventory questions to database tools');
  const { store, add, close } = await fixture('memory');
  const sdk = require('@google/generative-ai');
  const oldModel = sdk.GoogleGenerativeAI.prototype.getGenerativeModel;
  const oldKey = process.env.GEMINI_API_KEY;
  try {
    for (let i = 1; i <= 52; i++) await add(`gdrive-${i}`, `Project ${String(i).padStart(2, '0')}.pdf`, 'React', { metadata: { source: 'google-drive', syncComplete: true, folderPath: 'Docs/Case Studies', category: 'case-study' } });
    process.env.GEMINI_API_KEY = 'fixture-key';
    sdk.GoogleGenerativeAI.prototype.getGenerativeModel = () => { throw new Error('inventory must not call Gemini'); };
    const count = await ask.answerFromKnowledgeTools('How many case studies are in Google Drive?', store);
    assert.match(count.answer, /52/);
    assert.match(count.answer, /folder/i);
    assert.match(count.answer, /indexed/i);
    assert.equal(count.usedGemini, false);
    const history = [{ role: 'user' as const, content: 'How many case studies are in Google Drive?' }, { role: 'assistant' as const, content: count.answer }];
    const list = await ask.answerFromKnowledgeTools('List them', store, undefined, history);
    assert.equal(list.sources.length, 20);
    assert.match(list.answer, /Page 1 of 3/);
    const next = await ask.answerFromKnowledgeTools('List case studies in Google Drive, page 2', store);
    assert.equal(next.sources.length, 20);
    assert.equal(new Set([...list.sources, ...next.sources].map((source) => source.url)).size, 40);
    const final = await ask.answerFromKnowledgeTools('List case studies in Google Drive, page 3', store);
    assert.equal(final.sources.length, 12);
    assert.match(final.answer, /Page 3 of 3/);
    const beyond = await ask.answerFromKnowledgeTools('List case studies in Google Drive, page 4', store);
    assert.equal(beyond.sources.length, 0);
    assert.match(beyond.answer, /52/);
    assert.match(beyond.answer, /out of range/i);
  } finally {
    sdk.GoogleGenerativeAI.prototype.getGenerativeModel = oldModel;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
    await close();
  }
});

test('Ask retrieves only the named document and keeps an unrelated earlier inventory question out of the evidence', async () => {
  assert.equal(typeof ask.answerFromKnowledgeTools, 'function');
  const { store, add, close } = await fixture('memory');
  try {
    await add('gdrive-dream', 'Dream.pdf', 'Technology stack: React, Node.js, PostgreSQL.');
    await add('gdrive-brevidee', 'Brevidee Case Study.pdf', 'Technology stack: Vue, Redis.');
    const answer = await ask.answerFromKnowledgeTools('What tech stack is used in Dream?', store, undefined,
      [{ role: 'user', content: 'How many case studies are in Google Drive?' }]);
    assert.deepEqual(answer.sources.map((source) => source.title), ['Dream.pdf']);
    assert.match(answer.answer, /React/);
    assert.doesNotMatch(answer.answer, /public materials/i);
    const missing = await ask.answerFromKnowledgeTools('What tech stack is used in UnknownProject?', store);
    assert.equal(missing.sources.length, 0);
    assert.match(missing.answer, /matching.*title|title.*match/i);
    assert.doesNotMatch(missing.answer, /does not exist|don't have|do not have/i);
  } finally { await close(); }
});

test('listing technologies inside a case study is not routed to document inventory', async () => {
  assert.equal(typeof ask.answerFromKnowledgeTools, 'function');
  const { store, add, close } = await fixture('memory');
  try {
    await add('gdrive-dream', 'Case Study - Dream.pdf', 'Technology stack: React, Node.js, PostgreSQL.');
    const answer = await ask.answerFromKnowledgeTools('List the technologies used in Dream case study', store);
    assert.match(answer.answer, /React/);
    assert.doesNotMatch(answer.answer, /Page 1|filename/i);
    const count = await ask.answerFromKnowledgeTools('How many technologies are mentioned in Dream case study?', store);
    assert.deepEqual(count.sources.map((source) => source.title), ['Case Study - Dream.pdf']);
    assert.doesNotMatch(count.answer, /filename|fully indexed case studies/i);
  } finally { await close(); }
});

test('inventory follow-ups retain scope and advance the list page rather than repeating page one', () => {
  const history = [
    { role: 'user' as const, content: 'List case studies in Google Drive, page 2' },
    { role: 'assistant' as const, content: 'There are 52 case studies. Page 2 of 3:' },
  ];
  const next = inventoryRequest('Next page', history);
  assert.equal(next?.page, 3);
  assert.equal(next?.filter.scope, 'drive');
  assert.equal(next?.filter.caseStudies, true);
  const explicit = inventoryRequest('List them, page 1', history);
  assert.equal(explicit?.page, 1);
  assert.equal(inventoryRequest('List them', [{ role: 'user', content: 'What stack does Dream use?' }]), undefined);
});

test('content-filtered inventory questions do not claim an unfiltered total', async () => {
  const { store, add, close } = await fixture('memory');
  try {
    await add('gdrive-dream', 'Dream Case Study.pdf', 'React');
    await add('gdrive-other', 'Other Case Study.pdf', 'Vue');
    const answer = await ask.answerFromKnowledgeTools('How many case studies mention React?', store);
    assert.equal(answer.sources.length, 0);
    assert.match(answer.answer, /filter|content/i);
    assert.doesNotMatch(answer.answer, /There are 2/);
  } finally { await close(); }
});

test('spreadsheets are counted separately from other documents', async () => {
  const { store, add, close } = await fixture('memory');
  try {
    await add('gdrive-dream', 'Dream.pdf', 'React');
    await add('gdrive-leads', 'Leads.xlsx', 'Emails', { sourceType: 'sheet' });
    const answer = await ask.answerFromKnowledgeTools('How many spreadsheets are in Google Drive?', store);
    assert.match(answer.answer, /There are 1 spreadsheet/);
    assert.doesNotMatch(answer.answer, /There are 2/);
  } finally { await close(); }
});

test('industry, team and folder inventory restrictions are refused rather than silently discarded', () => {
  for (const question of ['How many case studies are in healthcare?', 'In healthcare, how many case studies are there?', 'List documents from the sales team', 'List documents in the Dream folder']) {
    assert.equal(inventoryRequest(question)?.unsupportedFilter, true, question);
  }
  assert.equal(inventoryRequest('How many documents are stored in our Google Drive knowledge base?')?.unsupportedFilter, false);
  assert.equal(inventoryRequest('List documents, page -1')?.page, -1);
});

test('malformed list pages are rejected without a database error or silently showing page one', async () => {
  const { store, close } = await fixture('memory');
  try {
    for (const page of ['-1', '0', '1.5', 'blue', '999999999999999999999']) {
      const answer = await ask.answerFromKnowledgeTools(`List documents, page ${page}`, store);
      assert.match(answer.answer, /page between/i);
      assert.equal(answer.sources.length, 0);
    }
  } finally { await close(); }
});

test('broad content and quoted concept questions still retrieve knowledge instead of claiming a missing title', async () => {
  const { store, add, close } = await fixture('memory');
  try {
    await add('gdrive-guide', 'Writing Guide.pdf', 'A good case study states the client objective, implementation and measurable outcomes. Staff augmentation means supplying specialist engineers.');
    for (const question of ['What makes a good case study?', 'What does "staff augmentation" mean?']) {
      const answer = await ask.answerFromKnowledgeTools(question, store);
      assert.equal(answer.sources[0]?.title, 'Writing Guide.pdf');
      assert.doesNotMatch(answer.answer, /matching.*document title/i);
    }
  } finally { await close(); }
});

test('a generic Services filename does not exclude other sources from a broad capability question', async () => {
  const { store, add, close } = await fixture('memory');
  try {
    await add('gdrive-services', 'Services.pdf', 'SprintX services include web development.');
    await add('gdrive-mobile', 'Mobile Delivery.pdf', 'SprintX services include mobile application engineering.');
    const answer = await ask.answerFromKnowledgeTools('What services does SprintX offer?', store);
    assert.equal(answer.sources.length, 2);
    const explicit = await ask.answerFromKnowledgeTools('Summarize Services.pdf', store);
    assert.deepEqual(explicit.sources.map((source) => source.title), ['Services.pdf']);
  } finally { await close(); }
});

for (const kind of ['memory', 'postgres'] as const) {
  test(`${kind}: case-study category follows folder provenance, not misleading filenames`, async () => {
    const { store, add, close } = await fixture(kind);
    try {
      await add('gdrive-dream', 'Dream.pdf', 'React', { metadata: { source: 'google-drive', syncComplete: true, folderPath: 'Docs/Case Studies/Nested', category: 'case-study' } });
      await add('gdrive-outside', 'Case Study - Outside.pdf', 'Messaging', { metadata: { source: 'google-drive', syncComplete: true, folderPath: 'Docs/Approved Messaging', category: 'uncategorized' } });
      await add('gdrive-legacy', 'Legacy Case Study.pdf', 'Old');
      const cases = await store.listDocuments({ scope: 'drive', caseStudies: true });
      assert.equal(cases.total, 1);
      assert.equal(cases.documents[0].id, 'gdrive-dream');
    } finally { await close(); }
  });
  test(`${kind}: inventory counts documents, not chunks, excluding sites, pending and unindexed records`, async () => {
    const { store, add, close } = await fixture(kind);
    try {
      await add('gdrive-dream', 'Dream.pdf', 'React', { metadata: { source: 'google-drive', syncComplete: true, folderPath: 'Docs/Case Studies/Nested' } });
      await store.addChunk({ id: 'gdrive-dream-1', sourceId: 'gdrive-dream', sourceTitle: 'Dream.pdf', sourcePath: 'Google Drive/Dream.pdf', sourceType: 'document', chunkIndex: 1, content: 'PostgreSQL' });
      await add('gdrive-brevidee', 'Brevidee - Case Study (1).pdf', 'Node.js', { metadata: { source: 'google-drive', syncComplete: true, category: 'case-study' } });
      await add('gdrive-pioneer', 'Case Study - Pioneer Partners.docx', 'Next.js', { sourcePath: 'Google Drive/Docs/Case Studies/Pioneer.docx' });
      await add('gdrive-sheet', 'Leads.xlsx', 'Email', { sourceType: 'sheet' });
      await add('gdrive-pending', 'Pending Case Study.pdf', 'Partial', { metadata: { source: 'google-drive', syncComplete: false } });
      await add('gdrive-empty', 'Empty.pdf', '', {}, false);
      await add('gdrive-archived', 'Archived Case Study.pdf', 'Old', { status: 'archived' });
      await add('site-one', 'Case Study - Web', 'Web', { sourceType: 'site', metadata: {} });
      await add('source-local', 'Local.md', 'Local', { metadata: {} });
      assert.equal(typeof store.listDocuments, 'function', 'store must provide a grounded inventory');
      const page = await store.listDocuments({ scope: 'drive', limit: 2 });
      assert.equal(page.total, 4);
      assert.equal(page.documents.length, 2);
      assert.equal(page.hasMore, true);
      const next = await store.listDocuments({ scope: 'drive', offset: 2, limit: 2 });
      assert.equal(next.total, 4);
      assert.equal(next.hasMore, false);
      assert.equal(new Set([...page.documents, ...next.documents].map((source) => source.id)).size, 4);
      assert.equal((await store.listDocuments({ scope: 'all' })).total, 5);
      const cases = await store.listDocuments({ scope: 'drive', caseStudies: true });
      assert.equal(cases.total, 3, 'Dream.pdf is a case study because of its folder');
      assert.deepEqual(cases.documents.map((source) => source.id).sort(), ['gdrive-brevidee', 'gdrive-dream', 'gdrive-pioneer']);
    } finally { await close(); }
  });

  test(`${kind}: named lookup handles case-study wrappers and duplicate suffixes, then scopes search`, async () => {
    const { store, add, close } = await fixture(kind);
    try {
      await add('gdrive-dream', 'Case Study - Dream (1).pdf', 'Frontend: React. Database: PostgreSQL.');
      await add('gdrive-dreamscape', 'Dreamscape.pdf', 'Tech stack: Vue.');
      await add('site-one', 'SprintX', 'Dream tech stack React.', { sourceType: 'site', metadata: {} });
      assert.equal(typeof store.findDocuments, 'function', 'named lookup must precede chunk retrieval');
      const named = await store.findDocuments('What is the tech stack used in Dream?');
      assert.deepEqual(named.map((source) => source.id), ['gdrive-dream']);
      const results = await store.search('technology stack', 5, named.map((source) => source.id));
      assert.equal(results.length, 1);
      assert.equal(results[0].sourceId, 'gdrive-dream');
      assert.deepEqual(await store.search('Dream', 5, []), [], 'empty scope must not become whole-KB search');
      assert.deepEqual(await store.findDocuments('What stack was used in UnknownProject?'), []);
    } finally { await close(); }
  });
}
