import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { boundConversationContext, ContextMessage } from './conversation-context';

export class ConversationNotFoundError extends Error {
  constructor() { super('Conversation not found'); }
}

export async function getConversationContext(userId: string, conversationId: string): Promise<ContextMessage[]> {
  const client = requireStore();
  const { data: conversation, error: lookupError } = await client.from('conversations').select('id')
    .eq('id', conversationId).eq('user_id', userId).maybeSingle();
  if (lookupError) throw new Error('Conversation lookup failed');
  if (!conversation) throw new ConversationNotFoundError();
  const { data, error } = await client.from('conversation_messages').select('role,content')
    .eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(12);
  if (error) throw new Error('Conversation context lookup failed');
  return boundConversationContext((data ?? []).reverse());
}

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
  citations?: unknown[];
  createdAt: string;
};

const supabase: any = config.supabaseUrl && config.supabaseServiceRoleKey
  ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : undefined;

function requireStore(): any {
  if (!supabase) {
    throw new Error('Conversation storage requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  return supabase;
}

export async function listConversations(userId: string): Promise<Conversation[]> {
  const client = requireStore();
  const { data, error } = await client.from('conversations').select('*').eq('user_id', userId).order('updated_at', { ascending: false });
  if (error) throw new Error(`Conversation listing failed: ${error.message}`);
  return (data ?? []).map(fromConversation);
}

export async function createConversation(userId: string, title = 'New conversation'): Promise<Conversation> {
  const client = requireStore();
  const { data, error } = await client.from('conversations').insert({ id: crypto.randomUUID(), user_id: userId, title }).select('*').single();
  if (error) throw new Error(`Conversation creation failed: ${error.message}`);
  return fromConversation(data);
}

export async function updateConversation(userId: string, conversationId: string, title: string): Promise<Conversation> {
  const client = requireStore();
  const { data, error } = await client.from('conversations').update({ title: title.trim(), updated_at: new Date().toISOString() })
    .eq('id', conversationId).eq('user_id', userId).select('*').maybeSingle();
  if (error) throw new Error(`Conversation update failed: ${error.message}`);
  if (!data) throw new Error('Conversation not found');
  return fromConversation(data);
}

export async function deleteConversation(userId: string, conversationId: string): Promise<void> {
  const client = requireStore();
  const { data, error } = await client.from('conversations').delete().eq('id', conversationId).eq('user_id', userId).select('id').maybeSingle();
  if (error) throw new Error(`Conversation deletion failed: ${error.message}`);
  if (!data) throw new Error('Conversation not found');
}

export async function getConversationMessages(userId: string, conversationId: string): Promise<ConversationMessage[]> {
  const client = requireStore();
  const { data, error } = await client.from('conversation_messages').select('*, conversations!inner(user_id)')
    .eq('conversation_id', conversationId).eq('conversations.user_id', userId).order('created_at', { ascending: true });
  if (error) throw new Error(`Conversation messages failed: ${error.message}`);
  return (data ?? []).map(fromMessage);
}

export async function appendConversationMessages(
  userId: string,
  conversationId: string,
  messages: Array<{ role: ConversationMessage['role']; content: string; citations?: unknown[] }>,
): Promise<void> {
  const client = requireStore();
  const { data: conversation, error: lookupError } = await client.from('conversations').select('id').eq('id', conversationId).eq('user_id', userId).maybeSingle();
  if (lookupError) throw new Error(`Conversation lookup failed: ${lookupError.message}`);
  if (!conversation) throw new Error('Conversation not found');

  const { error } = await client.from('conversation_messages').insert(messages.map((message) => ({
    conversation_id: conversationId,
    role: message.role,
    content: message.content,
    citations: message.citations ?? [],
  })));
  if (error) throw new Error(`Conversation message creation failed: ${error.message}`);
  await client.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
}

function fromConversation(row: Record<string, string>): Conversation {
  return { id: row.id, userId: row.user_id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

function fromMessage(row: Record<string, any>): ConversationMessage {
  return { id: row.id, conversationId: row.conversation_id, role: row.role, content: row.content, citations: row.citations ?? [], createdAt: row.created_at };
}
