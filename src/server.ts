import express, { Request, Response } from 'express';
import { z } from 'zod';

import { config } from './config';
import { authenticateRequest, AuthenticationError, isAdmin } from './lib/auth';
import { answerQuestion } from './lib/ask-service';
import { createDraft } from './lib/draft-service';
import { createUser, getUserApiKey, getUserById, listUsers, removeUserApiKey, setUserApiKey } from './lib/user-store';
import { createVectorStore } from './lib/vector-store';
import { appendConversationMessages, createConversation, getConversationMessages, listConversations } from './lib/conversation-store';

const app = express();
const vectorStorePromise = createVectorStore();

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const configuredOrigins = (process.env.ALLOWED_EXTENSION_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const isChromeExtensionOrigin = typeof origin === 'string' && origin.startsWith('chrome-extension://');

  if (origin && (configuredOrigins.includes(origin) || isChromeExtensionOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

app.use(express.json());

export default app;

const searchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
});

const askSchema = z.object({
  question: z.string().min(1),
  limit: z.number().int().min(1).max(10).optional(),
  userId: z.string().optional(),
  conversationId: z.string().uuid().optional(),
});

const draftSchema = z.object({
  type: z.enum(['cold-email', 'follow-up', 'linkedin', 'proposal']),
  audience: z.string().min(1).max(500),
  objective: z.string().min(1).max(500),
  tone: z.enum(['professional', 'friendly', 'persuasive', 'concise']).default('professional'),
  length: z.enum(['short', 'medium', 'long']).default('medium'),
  context: z.string().max(2000).optional(),
  conversationId: z.string().uuid().optional(),
});

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'intern']).optional(),
});

const apiKeySchema = z.object({
  apiKey: z.string().min(1),
});

function sendError(res: Response, error: unknown, fallbackMessage: string): Response {
  const status = error instanceof AuthenticationError ? error.statusCode : 500;
  return res.status(status).json({ ok: false, error: error instanceof Error ? error.message : fallbackMessage });
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, status: 'healthy' });
});

app.get('/', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'sprintx-bd-assistant', health: '/health' });
});

app.post('/api/kb/ingest', async (_req: Request, res: Response) => {
  try {
    const user = await authenticateRequest(_req.headers.authorization);
    if (config.requireAuth && !isAdmin(user)) {
      return res.status(403).json({ ok: false, error: 'Admin access required' });
    }

    const store = await vectorStorePromise;
    const { runFullIngest } = await import('./lib/ingest.js');
    const result = await runFullIngest(store, {
      driveRoot: config.driveRoot,
      siteUrls: config.siteUrls,
    });

    app.post('/api/kb/drive-sync', async (req: Request, res: Response) => {
      try {
        const user = await authenticateRequest(req.headers.authorization);
        if (config.requireAuth && !isAdmin(user)) {
          return res.status(403).json({ ok: false, error: 'Admin access required' });
        }
        if (!config.googleDriveFolderId || !config.googleServiceAccountJson) {
          return res.status(503).json({ ok: false, error: 'Google Drive sync is not configured' });
        }

        const store = await vectorStorePromise;
        const { ingestGoogleDriveFolder } = await import('./lib/ingest.js');
        const result = await ingestGoogleDriveFolder(store, {
          folderId: config.googleDriveFolderId,
          serviceAccountJson: config.googleServiceAccountJson,
        });
        return res.json({ ok: true, result });
      } catch (error) {
        return sendError(res, error, 'Unknown Google Drive sync error');
      }
    });

    res.json({ ok: true, result });
  } catch (error) {
    return sendError(res, error, 'Unknown ingestion error');
  }
});

app.post('/api/kb/search', async (req: Request, res: Response) => {
  try {
    const parse = searchSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ ok: false, error: parse.error.issues });
    }

    const { query, limit = 5 } = parse.data;
    const store = await vectorStorePromise;
    const results = await store.search(query, limit);

    return res.json({ ok: true, query, results });
  } catch (error) {
    return sendError(res, error, 'Unknown search error');
  }
});

app.get('/api/users', async (_req: Request, res: Response) => {
  try {
    const user = await authenticateRequest(_req.headers.authorization);
    if (config.requireAuth && !isAdmin(user)) {
      return res.status(403).json({ ok: false, error: 'Admin access required' });
    }

    const users = await listUsers();
    return res.json({ ok: true, users: users.map(({ apiKeyEncrypted, apiKeyIv, apiKeyTag, ...user }) => user) });
  } catch (error) {
    return sendError(res, error, 'Unknown user listing error');
  }
});

app.post('/api/users', async (req: Request, res: Response) => {
  try {
    const authenticatedUser = await authenticateRequest(req.headers.authorization);
    if (config.requireAuth && !isAdmin(authenticatedUser)) {
      return res.status(403).json({ ok: false, error: 'Admin access required' });
    }

    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.issues });
    }

    const createdUser = await createUser(parsed.data);
    return res.json({ ok: true, user: { ...createdUser, apiKeyEncrypted: undefined, apiKeyIv: undefined, apiKeyTag: undefined } });
  } catch (error) {
    return sendError(res, error, 'Unknown user creation error');
  }
});

app.post('/api/users/:id/api-key', async (req: Request, res: Response) => {
  try {
    const authenticatedUser = await authenticateRequest(req.headers.authorization);
    const requestedUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (config.requireAuth && authenticatedUser?.id !== requestedUserId && !isAdmin(authenticatedUser)) {
      return res.status(403).json({ ok: false, error: 'You may only update your own API key' });
    }

    const parsed = apiKeySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.issues });
    }

    const user = await setUserApiKey(requestedUserId, parsed.data.apiKey);
    return res.json({ ok: true, user: { ...user, apiKeyEncrypted: undefined, apiKeyIv: undefined, apiKeyTag: undefined } });
  } catch (error) {
    return sendError(res, error, 'Unknown API-key update error');
  }
});

app.delete('/api/users/:id/api-key', async (req: Request, res: Response) => {
  try {
    const authenticatedUser = await authenticateRequest(req.headers.authorization);
    const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (config.requireAuth && authenticatedUser?.id !== userId && !isAdmin(authenticatedUser)) {
      return res.status(403).json({ ok: false, error: 'You may only remove your own API key' });
    }

    await removeUserApiKey(userId);
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error, 'Unknown API-key removal error');
  }
});

app.get('/api/me', async (req: Request, res: Response) => {
  try {
    const user = await authenticateRequest(req.headers.authorization);
    if (!user) return res.status(401).json({ ok: false, error: 'Authentication required' });
    return res.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      geminiKeyConfigured: Boolean((await getUserById(user.id))?.apiKeyEncrypted),
    });
  } catch (error) {
    return sendError(res, error, 'Unknown profile lookup error');
  }
});

app.post('/api/me/api-key', async (req: Request, res: Response) => {
  try {
    const user = await authenticateRequest(req.headers.authorization);
    if (!user) return res.status(401).json({ ok: false, error: 'Authentication required' });
    const parsed = apiKeySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues });
    await setUserApiKey(user.id, parsed.data.apiKey);
    return res.json({ ok: true, geminiKeyConfigured: true });
  } catch (error) {
    return sendError(res, error, 'Unknown API-key update error');
  }
});

app.delete('/api/me/api-key', async (req: Request, res: Response) => {
  try {
    const user = await authenticateRequest(req.headers.authorization);
    if (!user) return res.status(401).json({ ok: false, error: 'Authentication required' });
    await removeUserApiKey(user.id);
    return res.json({ ok: true, geminiKeyConfigured: false });
  } catch (error) {
    return sendError(res, error, 'Unknown API-key removal error');
  }
});

app.post('/api/ask', async (req: Request, res: Response) => {
  try {
    const parse = askSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ ok: false, error: parse.error.issues });
    }

    const { question, limit = 5, userId: requestedUserId, conversationId } = parse.data;
    const authenticatedUser = await authenticateRequest(req.headers.authorization);
    const userId = requestedUserId ?? authenticatedUser?.id;
    if (config.requireAuth && (!authenticatedUser || (userId && userId !== authenticatedUser.id))) {
      return res.status(403).json({ ok: false, error: 'Ask requests must use the authenticated user' });
    }
    const store = await vectorStorePromise;
    const results = await store.search(question, limit);

    let apiKey: string | undefined;
    if (userId) {
      const user = await getUserById(userId);
      if (!user) {
        return res.status(404).json({ ok: false, error: 'User not found' });
      }

      apiKey = await getUserApiKey(userId);
    }

    const answer = await answerQuestion(question, results, apiKey);

    if (conversationId && authenticatedUser) {
      await appendConversationMessages(authenticatedUser.id, conversationId, [
        { role: 'user', content: question },
        { role: 'assistant', content: answer.answer, citations: answer.sources },
      ]);
    }
    return res.json({ ok: true, question, answer: answer.answer, sources: answer.sources, usedGemini: answer.usedGemini, userId: userId ?? null, conversationId: conversationId ?? null });
  } catch (error) {
    return sendError(res, error, 'Unknown ask error');
  }
});

app.post('/api/draft', async (req: Request, res: Response) => {
  try {
    const parse = draftSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ ok: false, error: parse.error.issues });
    }

    const authenticatedUser = await authenticateRequest(req.headers.authorization);
    if (config.requireAuth && !authenticatedUser) {
      return res.status(403).json({ ok: false, error: 'Draft requests require an authenticated user' });
    }

    const store = await vectorStorePromise;
    const results = await store.search(`${parse.data.audience} ${parse.data.objective} ${parse.data.context ?? ''}`, 5);
    const apiKey = authenticatedUser ? await getUserApiKey(authenticatedUser.id) : undefined;
    const result = await createDraft(parse.data, results, apiKey);
    if (parse.data.conversationId && authenticatedUser) {
      await appendConversationMessages(authenticatedUser.id, parse.data.conversationId, [
        { role: 'user', content: `Draft request: ${parse.data.audience} — ${parse.data.objective}` },
        { role: 'assistant', content: result.draft, citations: result.sources },
      ]);
    }

    return res.json({ ok: true, ...result, conversationId: parse.data.conversationId ?? null });
  } catch (error) {
    return sendError(res, error, 'Unknown draft error');
  }
});

app.get('/api/conversations', async (req: Request, res: Response) => {
  try {
    const user = await authenticateRequest(req.headers.authorization);
    if (!user) return res.status(401).json({ ok: false, error: 'Authentication required' });
    return res.json({ ok: true, conversations: await listConversations(user.id) });
  } catch (error) {
    return sendError(res, error, 'Unknown conversation listing error');
  }
});

app.post('/api/conversations', async (req: Request, res: Response) => {
  try {
    const user = await authenticateRequest(req.headers.authorization);
    if (!user) return res.status(401).json({ ok: false, error: 'Authentication required' });
    const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim().slice(0, 120) : undefined;
    return res.status(201).json({ ok: true, conversation: await createConversation(user.id, title) });
  } catch (error) {
    return sendError(res, error, 'Unknown conversation creation error');
  }
});

app.get('/api/conversations/:id/messages', async (req: Request, res: Response) => {
  try {
    const user = await authenticateRequest(req.headers.authorization);
    if (!user) return res.status(401).json({ ok: false, error: 'Authentication required' });
    const conversationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    return res.json({ ok: true, messages: await getConversationMessages(user.id, conversationId) });
  } catch (error) {
    return sendError(res, error, 'Unknown conversation message error');
  }
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`SprintX BD assistant API listening on http://localhost:${config.port}`);
  });
}
