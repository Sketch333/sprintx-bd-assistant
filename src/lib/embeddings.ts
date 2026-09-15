import { generateGeminiEmbedding } from './gemini-models';

export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';

  if (apiKey) {
    try {
      return await generateGeminiEmbedding(text, apiKey);
    } catch (error) {
      console.warn('Falling back to local embedding generation because Gemini embedding failed:', error);
    }
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
