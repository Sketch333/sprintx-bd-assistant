export type SourceType = 'document' | 'site' | 'sheet';

export type SourceRecord = {
  id: string;
  sourceType: SourceType;
  sourceTitle: string;
  sourcePath: string;
  sourceUrl?: string;
  status: 'active' | 'archived';
  updatedAt: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type KnowledgeChunk = {
  id: string;
  content: string;
  sourceId: string;
  sourcePath: string;
  sourceType: SourceType;
  sourceTitle: string;
  sourceUrl?: string;
  chunkIndex: number;
  metadata?: Record<string, string | number | boolean | null>;
};

export type SearchResult = {
  id: string;
  score: number;
  content: string;
  sourceId: string;
  sourcePath: string;
  sourceType: SourceType;
  sourceTitle: string;
  sourceUrl?: string;
  chunkIndex: number;
};
