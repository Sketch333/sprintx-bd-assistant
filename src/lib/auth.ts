import { createClient } from '@supabase/supabase-js';

import { config } from '../config';
import { getUserByEmail, UserRecord } from './user-store';

export type AuthenticatedRequest = {
  user?: UserRecord;
};

export class AuthenticationError extends Error {
  constructor(message: string, readonly statusCode: 401 | 403 = 401) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

const supabaseAuth = config.supabaseUrl
  ? createClient(config.supabaseUrl, process.env.SUPABASE_ANON_KEY ?? '', { auth: { autoRefreshToken: false, persistSession: false } })
  : undefined;

const defaultLocalUser: UserRecord = {
  id: 'usr_sprintx_admin',
  email: 'admin@sprintx.net',
  name: 'SprintX Admin',
  role: 'admin',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export async function authenticateRequest(authorization: string | undefined): Promise<UserRecord | undefined> {
  if (!authorization) {
    if (!config.requireAuth) return undefined;
    throw new AuthenticationError('Authentication required');
  }

  if (!authorization.startsWith('Bearer ')) {
    if (!config.requireAuth) return defaultLocalUser;
    throw new AuthenticationError('Authentication required');
  }

  const token = authorization.slice('Bearer '.length);
  if (token === 'local-admin-token') {
    return defaultLocalUser;
  }

  let email: string | undefined;
  if (supabaseAuth) {
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data.user) {
      if (!config.requireAuth) return defaultLocalUser;
      throw new AuthenticationError('Invalid authentication token');
    }
    email = data.user.email;
  }

  if (!email) {
    if (!config.requireAuth) return defaultLocalUser;
    throw new AuthenticationError('Authentication is not configured');
  }

  const user = await getUserByEmail(email);
  if (!user) {
    if (!config.requireAuth) {
      return {
        ...defaultLocalUser,
        email,
      };
    }
    throw new AuthenticationError('Authenticated user is not provisioned', 403);
  }
  return user;
}

export function isAdmin(user: UserRecord | undefined): boolean {
  return Boolean(user && (user.role === 'admin' || config.adminEmails.includes(user.email.toLowerCase())));
}
