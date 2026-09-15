export type Citation = {
  title: string;
  path: string;
  url?: string;
  snippet: string;
};

export type AskResponse = {
  ok: true;
  question: string;
  answer: string;
  sources: Citation[];
  usedGemini: boolean;
  userId: string | null;
};

export type DraftInput = {
  type: 'cold-email' | 'follow-up' | 'linkedin' | 'proposal';
  audience: string;
  objective: string;
  tone: 'professional' | 'friendly' | 'persuasive' | 'concise';
  length: 'short' | 'medium' | 'long';
  context?: string;
};

export type DraftResponse = {
  ok: true;
  draft: string;
  sources: Citation[];
  usedGemini: boolean;
};
