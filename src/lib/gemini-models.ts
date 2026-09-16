const { GoogleGenerativeAI } = require('@google/generative-ai');

export const GENERATION_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.8-flash',
];

export const EMBEDDING_MODELS = [
  'gemini-embedding-001',
];

export const LIVE_MODELS = [
  'gemini-3-flash-live',
  'gemini-2.5-flash-live',
];

export const EMBEDDING_DIMENSIONS = 1536;

function safeQuotaDiagnostics(error: unknown, apiKey: string) {
  const quotaViolations: Array<{ quotaMetric?: string; quotaId?: string; quotaValue?: string }> = [];
  let retryDelaySeconds: number | null = null;
  const details = (error as { errorDetails?: unknown } | null)?.errorDetails;
  if (Array.isArray(details)) {
    for (const detail of details.slice(0, 20)) {
      if (!detail || typeof detail !== 'object') continue;
      if (detail['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure' && Array.isArray(detail.violations)) {
        for (const violation of detail.violations.slice(0, 10)) {
          if (!violation || typeof violation !== 'object') continue;
          const safe: { quotaMetric?: string; quotaId?: string; quotaValue?: string } = {};
          if (typeof violation.quotaMetric === 'string' && /^generativelanguage\.googleapis\.com\/[a-z_]{1,150}$/.test(violation.quotaMetric) && !violation.quotaMetric.includes(apiKey)) safe.quotaMetric = violation.quotaMetric;
          if (typeof violation.quotaId === 'string' && /^(?:Embed|Generate|Batch)[A-Za-z0-9_-]{1,150}$/.test(violation.quotaId) && !violation.quotaId.includes(apiKey)) safe.quotaId = violation.quotaId;
          if ((typeof violation.quotaValue === 'string' || typeof violation.quotaValue === 'number') && /^\d{1,20}$/.test(String(violation.quotaValue))) safe.quotaValue = String(violation.quotaValue);
          if (Object.keys(safe).length) quotaViolations.push(safe);
        }
      }
      if (detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' && typeof detail.retryDelay === 'string' && /^\d{1,6}(?:\.\d{1,9})?s$/.test(detail.retryDelay)) {
        retryDelaySeconds = Number(detail.retryDelay.slice(0, -1));
      }
    }
  }
  return { quotaViolations, retryDelaySeconds };
}

export class EmbeddingProviderError extends Error {
  constructor(public readonly providerStatus?: number) {
    const reason = providerStatus === 429 ? 'quota or rate limit exceeded; check Google AI Studio quota'
      : providerStatus === 401 || providerStatus === 403 ? 'server API key rejected; check key permissions and restrictions'
      : providerStatus === 400 || providerStatus === 404 ? 'invalid embedding request or model configuration'
      : 'provider unavailable or request timed out; retry sync';
    super(`Gemini embedding failed${providerStatus ? ` (HTTP ${providerStatus})` : ''}: ${reason}.`);
  }
}

export async function generateGeminiText(prompt: string, systemPrompt?: string, apiKey?: string): Promise<string> {
  const key = apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';
  if (!key) {
    throw new Error('No Gemini API key configured.');
  }

  const genAI = new GoogleGenerativeAI(key);

  const errors: unknown[] = [];
  for (const modelName of GENERATION_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
      });

      const response = await model.generateContent(prompt);
      const text = response.response?.candidates?.[0]?.content?.parts?.map((part: any) => part.text).join('') ?? '';
      if (text) {
        return text;
      }
    } catch (error) {
      errors.push(error);
      console.warn(`Gemini generation model failed: ${modelName}`, error);
    }
  }

  const lastError = errors[errors.length - 1];
  throw lastError instanceof Error ? lastError : new Error('Gemini generation failed for all configured models.');
}

export async function generateGeminiEmbedding(text: string, apiKey?: string): Promise<number[]> {
  const key = apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';
  if (!key) {
    throw new Error('No Gemini API key configured.');
  }

  const genAI = new GoogleGenerativeAI(key);

  const modelName = EMBEDDING_MODELS[0];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.embedContent({
        content: { role: 'user', parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIMENSIONS,
      } as any, { timeout: 15000 });
      const values = result.embedding?.values ?? result.embeddings?.[0]?.values ?? [];
      if (Array.isArray(values) && values.length > 0) {
        return coerceEmbeddingDimensions(values, EMBEDDING_DIMENSIONS);
      }
      throw new EmbeddingProviderError();
    } catch (error) {
      const candidate = (error as { status?: unknown } | null)?.status;
      const status = typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : undefined;
      const retryable = status === 429 || (status !== undefined && status >= 500)
        || (status === undefined && !(error instanceof EmbeddingProviderError));
      console.warn(JSON.stringify({ event: 'embedding_failure', model: modelName, attempt, providerStatus: status ?? null, retrying: retryable && attempt < 3, ...safeQuotaDiagnostics(error, key) }));
      if (!retryable || attempt === 3) throw new EmbeddingProviderError(status);
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    }
  }

  throw new EmbeddingProviderError();
}

export function coerceEmbeddingDimensions(values: number[], dimensions: number): number[] {
  const resized = values.slice(0, dimensions);
  while (resized.length < dimensions) {
    resized.push(0);
  }

  const magnitude = Math.sqrt(resized.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? resized : resized.map((value) => value / magnitude);
}
