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
  'text-embedding-004',
];

export const LIVE_MODELS = [
  'gemini-3-flash-live',
  'gemini-2.5-flash-live',
];

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

  const errors: unknown[] = [];
  for (const modelName of EMBEDDING_MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.embedContent(text);
      const values = result.embedding?.values ?? result.embeddings?.[0]?.values ?? [];
      if (Array.isArray(values) && values.length > 0) {
        return values;
      }
    } catch (error) {
      errors.push(error);
      console.warn(`Gemini embedding model failed: ${modelName}`, error);
    }
  }

  const lastError = errors[errors.length - 1];
  throw lastError instanceof Error ? lastError : new Error('Gemini embedding failed for all configured models.');
}
