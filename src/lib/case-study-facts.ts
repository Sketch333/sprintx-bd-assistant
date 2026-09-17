import { createHash } from 'crypto';

import { KnowledgeChunk, SourceRecord } from '../types';
import { generateGeminiText } from './gemini-models';
import { VectorStore } from './vector-store';
import { isCaseStudyDocument } from './document-inventory';

export const CASE_STUDY_FACTS_VERSION = '1';

export type CaseStudyTechnology = {
  name: string;
  evidenceQuote: string;
  chunkId: string;
};

export type CaseStudyFacts = {
  version: string;
  contentHash: string;
  status: 'current' | 'stale';
  caseStudyName: string;
  technologies: CaseStudyTechnology[];
  extractedAt: string;
};

export function sourceContentHash(chunks: KnowledgeChunk[]): string {
  return createHash('sha256')
    .update(chunks.map((chunk) => `${chunk.id}\n${chunk.content}`).join('\n---\n'))
    .digest('hex');
}

export function parseCachedFacts(value: unknown): CaseStudyFacts | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<CaseStudyFacts>;
    if (
      parsed.version !== CASE_STUDY_FACTS_VERSION ||
      (parsed.status !== 'current' && parsed.status !== 'stale') ||
      typeof parsed.contentHash !== 'string' ||
      typeof parsed.caseStudyName !== 'string' ||
      !Array.isArray(parsed.technologies)
    ) return undefined;
    return parsed as CaseStudyFacts;
  } catch {
    return undefined;
  }
}

export function validateFacts(
  facts: CaseStudyFacts,
  source: SourceRecord,
  chunks: KnowledgeChunk[],
): CaseStudyFacts {
  const chunkMap = new Map(chunks.map((chunk) => [chunk.id, chunk.content]));
  const technologies = facts.technologies.filter((technology) => {
    const content = chunkMap.get(technology.chunkId);
    return Boolean(
      technology.name.trim() &&
      technology.evidenceQuote.trim() &&
      content &&
      content.includes(technology.evidenceQuote),
    );
  });
  if (!facts.caseStudyName.trim() || facts.contentHash !== sourceContentHash(chunks)) {
    throw new Error(`Case-study facts are stale for ${source.sourceTitle}`);
  }
  return {
    ...facts,
    version: CASE_STUDY_FACTS_VERSION,
    status: 'current',
    technologies,
  };
}

export async function extractCaseStudyFacts(
  source: SourceRecord,
  chunks: KnowledgeChunk[],
  apiKey: string,
): Promise<CaseStudyFacts> {
  const contentHash = sourceContentHash(chunks);
  const context = chunks.map((chunk) => `CHUNK ${chunk.id}\n${chunk.content}`).join('\n\n');
  const prompt = `Extract only explicitly stated facts from this SprintX case study.
Return JSON only with this shape:
{"caseStudyName":"string","technologies":[{"name":"string","evidenceQuote":"exact quote","chunkId":"existing chunk id"}]}
Do not infer technologies. Every evidenceQuote must be copied exactly from a chunk.

Document title: ${source.sourceTitle}
${context}`;
  const response = await generateGeminiText(prompt, undefined, apiKey);
  const parsed = JSON.parse(response) as { caseStudyName?: string; technologies?: CaseStudyTechnology[] };
  return validateFacts({
    version: CASE_STUDY_FACTS_VERSION,
    contentHash,
    status: 'current',
    caseStudyName: parsed.caseStudyName ?? source.sourceTitle,
    technologies: Array.isArray(parsed.technologies) ? parsed.technologies : [],
    extractedAt: new Date().toISOString(),
  }, source, chunks);
}

export async function refreshCaseStudyFacts(
  store: VectorStore,
  apiKey: string,
  requestedLimit = 10,
): Promise<{ processed: number; refreshed: number; unchanged: number; failed: number; failures: string[] }> {
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 25) {
    throw new Error('Facts refresh limit must be between 1 and 25');
  }
  const page = await store.listDocuments({ scope: 'drive', caseStudies: true, limit: requestedLimit, offset: 0 });
  const result = { processed: 0, refreshed: 0, unchanged: 0, failed: 0, failures: [] as string[] };
  for (const source of page.documents.filter(isCaseStudyDocument)) {
    result.processed += 1;
    const chunks = await store.getSourceChunks(source.id);
    const hash = sourceContentHash(chunks);
    const cached = parseCachedFacts(source.metadata?.caseStudyFacts);
    if (cached?.status === 'current' && cached.contentHash === hash) {
      result.unchanged += 1;
      continue;
    }
    await store.patchSourceMetadata(source.id, {
      caseStudyFacts: JSON.stringify({
        ...(cached ?? {}),
        version: CASE_STUDY_FACTS_VERSION,
        contentHash: hash,
        status: 'stale',
      }),
    });
    try {
      const facts = await extractCaseStudyFacts(source, chunks, apiKey);
      await store.patchSourceMetadata(source.id, { caseStudyFacts: JSON.stringify(facts) });
      result.refreshed += 1;
    } catch (error) {
      result.failed += 1;
      result.failures.push(`${source.sourceTitle}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}
