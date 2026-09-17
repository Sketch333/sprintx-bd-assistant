import type { Citation, Conversation, ConversationMessage, DraftInput } from '../../src/types';
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
const now = '2026-09-16T12:00:00Z';
let conversations: Conversation[] = [{ id: 'preview-research', userId: 'synthetic-admin', title: 'SaaS founder outreach', createdAt: now, updatedAt: now }, { id: 'preview-empty', userId: 'synthetic-admin', title: 'New conversation', createdAt: now, updatedAt: now }];
const sources: Citation[] = [
  { title: 'SprintX services overview', path: 'synthetic/services.md', url: 'https://example.invalid/services', snippet: 'Synthetic excerpt: product discovery, delivery, and practical AI integration.' },
  { title: 'SaaS delivery example', path: 'synthetic/case-study.md', snippet: 'Synthetic excerpt: a focused discovery engagement clarified the product roadmap.' },
  { title: 'SprintX services overview', path: 'synthetic/services.md', url: 'https://example.invalid/services', snippet: 'Synthetic excerpt: scope the first outcome with the client before promising a timeline.' },
];
const answer = 'Start with the founder’s immediate product challenge, not a list of capabilities.\n\nSprintX can frame an initial conversation around product discovery, delivery, and practical AI integration [1], [3]. Pair that positioning with a relevant delivery example [2].\n\nBefore outreach, verify the prospect’s current priorities and the case study details. Avoid promising outcomes that the evidence does not support.';
const messages = new Map<string, ConversationMessage[]>([['preview-research', [
  { id: 'user-1', conversationId: 'preview-research', role: 'user', content: 'How should we position SprintX for a SaaS founder?', citations: [], createdAt: now },
  { id: 'assistant-1', conversationId: 'preview-research', role: 'assistant', content: answer, citations: sources, createdAt: now },
]]]);
const pause = () => new Promise((resolve) => setTimeout(resolve, 450));
export const listConversations = async () => ({ conversations: [...conversations] });
export const getConversationMessages = async (_token: string, id: string) => ({ messages: [...(messages.get(id) ?? [])] });
export async function createConversation(_token: string, title: string) { const conversation = { id: `preview-${Date.now()}`, title, userId: 'synthetic-admin', createdAt: now, updatedAt: now }; conversations.unshift(conversation); return { conversation }; }
export async function renameConversation(_token: string, id: string, title: string) { const conversation = conversations.find((item) => item.id === id)!; conversation.title = title; return { conversation }; }
export async function deleteConversation(_token: string, id: string) { conversations = conversations.filter((item) => item.id !== id); messages.delete(id); return { ok: true }; }
export async function askAssistant(question: string, _token: string, conversationId: string) { await pause(); if (question.toLowerCase().includes('fail')) throw new ApiError('Synthetic request failed. Your question is preserved.', 503); const result = { ok: true as const, question, answer, sources, conversationId, userId: 'synthetic-admin', usedGemini: false }; const previous = messages.get(conversationId) ?? []; messages.set(conversationId, [...previous, { id: `u-${Date.now()}`, role: 'user', content: question, citations: [], conversationId, createdAt: now }, { id: `a-${Date.now()}`, role: 'assistant', content: answer, citations: sources, conversationId, createdAt: now }]); return result; }
export async function draftMessage(input: DraftInput, _token: string, conversationId: string) { await pause(); const draft = `Hi ${input.audience},\n\nI noticed your team is exploring its next product chapter. SprintX helps teams clarify the roadmap and deliver a focused first outcome.\n\nWould you be open to a short conversation to ${input.objective.toLowerCase()}?\n\nBest,\nSprintX\n\n[Synthetic preview draft — not for sending]`; const previous = messages.get(conversationId) ?? []; messages.set(conversationId, [...previous, { id: `d-${Date.now()}`, role: 'assistant', content: draft, citations: sources, conversationId, createdAt: now }]); return { ok: true as const, draft, sources, usedGemini: false, conversationId }; }
let configured = false;
export const getProfile = async () => ({ ok: true, geminiKeyConfigured: configured, user: { id: 'synthetic-admin', role: 'admin', name: 'Preview Admin', email: 'preview@example.invalid' } });
export const setGeminiKey = async () => { configured = true; return { ok: true }; };
export const removeGeminiKey = async () => { configured = false; return { ok: true }; };
export const listUsers = async () => ({ users: [{ id: 'preview-user', name: 'Preview teammate', email: 'teammate@example.invalid', role: 'intern', createdAt: now, updatedAt: now }] });
export const createUser = async (_token: string, user: { name: string; email: string; role: string }) => ({ user: { ...user, id: `preview-user-${Date.now()}`, createdAt: now, updatedAt: now } });
export const syncGoogleDrive = async () => { await pause(); return { result: { discovered: 3, chunks: 8, sources: 3, removed: 0, failedFiles: [], skippedFiles: 2, newEmbeddings: 1, complete: true } }; };
export const crawlWebsites = async () => { await pause(); return { result: { synthetic: true, sources: 3 } }; };
