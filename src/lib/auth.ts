import { createClient } from '@supabase/supabase-js';

import { config } from '../config';
import { getUserByEmail, UserRecord } from './user-store';

export type AuthenticatedRequest = {
  user?: UserRecord;
};

const supabaseAuth = config.supabaseUrl
  ? createClient(config.supabaseUrl, process.env.SUPABASE_ANON_KEY ?? '', { auth: { autoRefreshToken: false, persistSession: false } })
  : undefined;

export async function authenticateRequest(authorization: string | undefined): Promise<UserRecord | undefined> {
  if (!config.requireAuth && !authorization) {
    return undefined;
  }
  if (!authorization?.startsWith('Bearer ')) {
    throw new Error('Authentication required');
  }

  const token = authorization.slice('Bearer '.length);
  let email: string | undefined;
  if (supabaseAuth) {
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data.user) {
      throw new Error('Invalid authentication token');
    }
    email = data.user.email;
  }

  if (!email) {
    throw new Error('Authentication is not configured');
  }

  const user = await getUserByEmail(email);
  if (!user) {
    throw new Error('Authenticated user is not provisioned');
  }
  return user;
}

export function isAdmin(user: UserRecord | undefined): boolean {
  return Boolean(user && (user.role === 'admin' || config.adminEmails.includes(user.email.toLowerCase())));
}
