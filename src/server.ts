import express, { Request, Response } from 'express';
import { z } from 'zod';

import { config } from './config';
import { authenticateRequest, isAdmin } from './lib/auth';
import { answerQuestion } from './lib/ask-service';
import { runFullIngest } from './lib/ingest';
import { createUser, getUserApiKey, getUserById, listUsers, removeUserApiKey, setUserApiKey } from './lib/user-store';
import { createVectorStore } from './lib/vector-store';

const app = express();
const vectorStorePromise = createVectorStore();

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
});

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'intern']).optional(),
});

const apiKeySchema = z.object({
  apiKey: z.string().min(1),
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, status: 'healthy' });
});

app.post('/api/kb/ingest', async (_req: Request, res: Response) => {
  try {
    const user = await authenticateRequest(_req.headers.authorization);
    if (config.requireAuth && !isAdmin(user)) {
      return res.status(403).json({ ok: false, error: 'Admin access required' });
    }

    const store = await vectorStorePromise;
    const result = await runFullIngest(store, {
      driveRoot: config.driveRoot,
      siteUrls: config.siteUrls,
    });

    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown ingestion error' });
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
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown search error' });
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
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown user listing error' });
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
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown user creation error' });
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
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown API-key update error' });
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
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown API-key removal error' });
  }
});

app.post('/api/ask', async (req: Request, res: Response) => {
  try {
    const parse = askSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ ok: false, error: parse.error.issues });
    }

    const { question, limit = 5, userId: requestedUserId } = parse.data;
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

    return res.json({ ok: true, question, answer: answer.answer, sources: answer.sources, usedGemini: answer.usedGemini, userId: userId ?? null });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown ask error' });
  }
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`SprintX BD assistant API listening on http://localhost:${config.port}`);
  });
}
