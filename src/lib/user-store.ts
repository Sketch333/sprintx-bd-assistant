import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

import { config } from '../config';

export type UserRole = 'admin' | 'intern';

export type UserRecord = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  apiKeyEncrypted?: string;
  apiKeyIv?: string;
  apiKeyTag?: string;
  createdAt: string;
  updatedAt: string;
};

const storePath = path.resolve(process.cwd(), config.userStorePath);
const supabase = config.supabaseUrl && config.supabaseServiceRoleKey
  ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : undefined;

function assertWritableLocalStore(): void {
  if (process.env.VERCEL === '1') {
    throw new Error('Supabase user storage is required on Vercel; configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
}

export function isHostedUserStoreEnabled(): boolean {
  return Boolean(supabase);
}

export async function ensureUserStore(): Promise<void> {
  assertWritableLocalStore();
  const directory = path.dirname(storePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify({ users: [] }, null, 2));
  }
}

export async function listUsers(): Promise<UserRecord[]> {
  if (supabase) {
    const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: true });
    if (error) {
      throw new Error(`Supabase user listing failed: ${error.message}`);
    }
    return (data ?? []).map(fromDatabaseUser);
  }

  await ensureUserStore();
  const payload = JSON.parse(fs.readFileSync(storePath, 'utf8') || '{"users":[]}');
  return Array.isArray(payload.users) ? payload.users : [];
}

export async function getUserById(userId: string): Promise<UserRecord | undefined> {
  if (supabase) {
    const { data, error } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
    if (error) {
      throw new Error(`Supabase user lookup failed: ${error.message}`);
    }
    return data ? fromDatabaseUser(data) : undefined;
  }

  const users = await listUsers();
  return users.find((user) => user.id === userId);
}

export async function getUserByEmail(email: string): Promise<UserRecord | undefined> {
  if (supabase) {
    const { data, error } = await supabase.from('users').select('*').ilike('email', email).maybeSingle();
    if (error) {
      throw new Error(`Supabase user lookup failed: ${error.message}`);
    }
    return data ? fromDatabaseUser(data) : undefined;
  }

  const users = await listUsers();
  return users.find((user) => user.email.toLowerCase() === email.toLowerCase());
}

export async function createUser(input: { email: string; name: string; role?: UserRole }): Promise<UserRecord> {
  if (supabase) {
    const existing = await getUserByEmail(input.email);
    if (existing) {
      return existing;
    }

    const { data, error } = await supabase.from('users').insert({
      email: input.email,
      name: input.name,
      role: input.role ?? 'intern',
    }).select('*').single();
    if (error) {
      throw new Error(`Supabase user creation failed: ${error.message}`);
    }
    return fromDatabaseUser(data);
  }

  await ensureUserStore();
  const existing = await getUserByEmail(input.email);
  if (existing) {
    return existing;
  }

  const users = await listUsers();
  const now = new Date().toISOString();
  const user: UserRecord = {
    id: crypto.randomUUID(),
    email: input.email,
    name: input.name,
    role: input.role ?? 'intern',
    createdAt: now,
    updatedAt: now,
  };

  users.push(user);
  fs.writeFileSync(storePath, JSON.stringify({ users }, null, 2));
  return user;
}

export async function setUserApiKey(userId: string, apiKey: string): Promise<UserRecord> {
  if (supabase) {
    const encrypted = encryptApiKey(apiKey);
    const { data, error } = await supabase.from('users').update({
      api_key_encrypted: encrypted.encrypted,
      api_key_iv: encrypted.iv,
      api_key_tag: encrypted.tag,
      updated_at: new Date().toISOString(),
    }).eq('id', userId).select('*').single();
    if (error) {
      throw new Error(`Supabase API-key update failed: ${error.message}`);
    }
    return fromDatabaseUser(data);
  }

  const users = await listUsers();
  const userIndex = users.findIndex((user) => user.id === userId);
  if (userIndex === -1) {
    throw new Error('User not found');
  }

  const encrypted = encryptApiKey(apiKey);
  users[userIndex] = {
    ...users[userIndex],
    apiKeyEncrypted: encrypted.encrypted,
    apiKeyIv: encrypted.iv,
    apiKeyTag: encrypted.tag,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(storePath, JSON.stringify({ users }, null, 2));
  return users[userIndex];
}

export async function removeUserApiKey(userId: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from('users').update({
      api_key_encrypted: null,
      api_key_iv: null,
      api_key_tag: null,
      updated_at: new Date().toISOString(),
    }).eq('id', userId);
    if (error) {
      throw new Error(`Supabase API-key removal failed: ${error.message}`);
    }
    return;
  }

  const users = await listUsers();
  const userIndex = users.findIndex((user) => user.id === userId);
  if (userIndex === -1) {
    throw new Error('User not found');
  }

  delete users[userIndex].apiKeyEncrypted;
  delete users[userIndex].apiKeyIv;
  delete users[userIndex].apiKeyTag;
  users[userIndex].updatedAt = new Date().toISOString();
  fs.writeFileSync(storePath, JSON.stringify({ users }, null, 2));
}

export async function getUserApiKey(userId: string): Promise<string | undefined> {
  const user = await getUserById(userId);
  if (!user || !user.apiKeyEncrypted || !user.apiKeyIv || !user.apiKeyTag) {
    return undefined;
  }

  return decryptApiKey({ encrypted: user.apiKeyEncrypted, iv: user.apiKeyIv, tag: user.apiKeyTag });
}

function fromDatabaseUser(row: Record<string, any>): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    apiKeyEncrypted: row.api_key_encrypted ?? undefined,
    apiKeyIv: row.api_key_iv ?? undefined,
    apiKeyTag: row.api_key_tag ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function encryptApiKey(apiKey: string): { encrypted: string; iv: string; tag: string } {
  const secret = getStoreSecret();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', createKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

function decryptApiKey(input: { encrypted: string; iv: string; tag: string }): string {
  const secret = getStoreSecret();
  const iv = Buffer.from(input.iv, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', createKey(secret), iv);
  decipher.setAuthTag(Buffer.from(input.tag, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(input.encrypted, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

function getStoreSecret(): string {
  return process.env.USER_STORE_KEY ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? 'sprintx-local-dev-key';
}

function createKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}
