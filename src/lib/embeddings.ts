import { generateGeminiEmbedding } from './gemini-models';

export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';

  if (apiKey) {
    try {
      return await generateGeminiEmbedding(text, apiKey);
    } catch {
      throw new Error('Gemini embedding failed; retry without changing the vector space.');
    }
  }

  if (process.env.VERCEL || process.env.DATABASE_URL || process.env.NODE_ENV === 'production') {
    throw new Error('Gemini API key is required for persistent production embeddings.');
  }

  return fallbackEmbedding(text);
}

function fallbackEmbedding(text: string): number[] {
  const vectorSize = 1536;
  const values = new Array<number>(vectorSize).fill(0);
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const words = normalized.split(/\s+/).filter(Boolean);

  if (!words.length) {
    return values;
  }

  for (const word of words) {
    const hash = hashWord(word);
    values[hash % vectorSize] += 1;
  }

  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return values;
  }

  return values.map((value) => value / magnitude);
}

function hashWord(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
