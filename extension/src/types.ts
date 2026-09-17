export type Citation = {
  title: string;
  path: string;
  url?: string;
  snippet: string;
};

export type AskMode = 'knowledge' | 'facts' | 'advice';

export type AskResponse = {
  ok: true;
  question: string;
  answer: string;
  sources: Citation[];
  usedGemini: boolean;
  userId: string | null;
  conversationId: string | null;
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
  conversationId: string | null;
};

export type Conversation = {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationMessage = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  createdAt: string;
};

export type ProfileResponse = {
  ok: true;
  user: { id: string; email: string; name: string; role: 'admin' | 'intern' };
  geminiKeyConfigured: boolean;
};

export type ProvisionedUser = {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'intern';
  createdAt: string;
  updatedAt: string;
};
