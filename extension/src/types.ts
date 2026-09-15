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
