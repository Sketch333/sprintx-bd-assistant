import { SourceRecord } from '../types';

export type DocumentFilter = { scope?: 'all' | 'drive'; caseStudies?: boolean; sourceType?: 'sheet'; offset?: number; limit?: number };
export type DocumentPage = { documents: SourceRecord[]; total: number; hasMore: boolean };

export function documentPageBounds(filter: DocumentFilter): { offset: number; limit: number } {
  const offset = filter.offset ?? 0, limit = filter.limit ?? 20;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 20000
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid document pagination');
  return { offset, limit };
}

export function isIndexedDocument(source: SourceRecord): boolean {
  return source.status === 'active' && source.sourceType !== 'site' && source.metadata?.syncComplete !== false;
}

export function isDriveDocument(source: SourceRecord): boolean {
  return source.id.startsWith('gdrive-') || source.metadata?.source === 'google-drive';
}

export function isCaseStudyTitle(title: string): boolean {
  return /\bcase\s+stud(?:y|ies)\b/.test(title.toLowerCase().replace(/[^a-z0-9]+/g, ' '));
}

// Filename wrappers/extensions/copy suffixes are not project names. Do not
// substring-match Dream to Dreamscape or infer categories from file format.
export const titleNoise = ['case', 'study', 'studies', 'copy', 'pdf', 'docx', 'doc', 'txt', 'md', 'xlsx', 'xls', 'csv'];
export function titleWords(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/)
    .filter((word) => word && !/^\d+$/.test(word) && !titleNoise.includes(word));
}

export function matchesDocumentTitle(query: string, title: string): boolean {
  const words = titleWords(title), queryWords = new Set(titleWords(query));
  return words.length > 0 && words.every((word) => queryWords.has(word));
}
