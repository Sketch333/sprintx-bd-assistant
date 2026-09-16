import { config } from '../config';
import { SearchResult } from '../types';
import { SYSTEM_PROMPT } from '../system-prompt';
import { generateGeminiText } from './gemini-models';
import { ContextMessage, conversationPrompt } from './conversation-context';

export type AskAnswer = {
  answer: string;
  sources: Array<{ title: string; path: string; url?: string; snippet: string }>;
  usedGemini: boolean;
};

export async function answerQuestion(question: string, results: SearchResult[], userApiKeyOverride?: string, history: ContextMessage[] = []): Promise<AskAnswer> {
  const relevantResults = results.filter((result) => result.score >= 0.18 || hasMeaningfulOverlap(question, result.content));

  if (!relevantResults.length) {
    return {
      answer: 'I could not find sufficiently relevant SprintX information in the current knowledge base for that question, so I should not guess. Try a more specific question about services, case studies, pricing, or outreach strategy and make sure the source content has been ingested.',
      sources: [],
      usedGemini: false,
    };
  }

  const apiKey = userApiKeyOverride || config.testGeminiApiKey || config.googleApiKey;

  const sources = relevantResults.map((result) => ({
    title: result.sourceTitle,
    path: result.sourcePath,
    url: result.sourceUrl,
    snippet: result.content.slice(0, 200),
  }));

  const prompt = `${conversationPrompt(history)}\n\n${buildPrompt(question, relevantResults)}`;

  if (!apiKey) {
      return {
        answer: fallbackAnswer(question, relevantResults),
      sources,
      usedGemini: false,
    };
  }

  try {
    const text = await generateGeminiText(`${SYSTEM_PROMPT}\n\n${prompt}`, SYSTEM_PROMPT, apiKey);

    return {
      answer: sanitizeAnswer(text || fallbackAnswer(question, relevantResults)),
      sources,
      usedGemini: true,
    };
  } catch (error) {
    console.warn('Gemini generation failed, using KB fallback answer:', error);
    return {
      answer: fallbackAnswer(question, relevantResults),
      sources,
      usedGemini: false,
    };
  }
}

function buildPrompt(question: string, results: SearchResult[]): string {
  const context = results
    .map((result, index) => {
      const sourceLabel = `Source ${index + 1} — ${result.sourceTitle}`;
      return `${sourceLabel}\n${result.content}`;
    })
    .join('\n\n---\n\n');

  return `
Answer the user's question using ONLY the knowledge base below.
Provide a concise but useful response in a senior BD voice.
Include source references like [Source 1], [Source 2].
When there is not enough evidence, say so instead of guessing.

Question: ${question}
Answer this latest question, not an earlier question from the conversation.
Prior dialogue only resolves references; it is not knowledge-base evidence.

Knowledge base context:
${context}
`;
}

function fallbackAnswer(question: string, results: SearchResult[]): string {
  const primary = results[0];
  const summary = primary?.content.slice(0, 300) ?? 'The current KB is missing enough detail for a confident answer.';

  return `Based on the current SprintX knowledge base, the closest relevant evidence is: "${summary}". This suggests the answer is grounded in SprintX's public materials, but I would want a more specific question or additional sources for a fully confident answer. [Source 1: ${primary?.sourceTitle ?? 'Knowledge base source'}]`;
}

function sanitizeAnswer(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function hasMeaningfulOverlap(question: string, content: string): boolean {
  const stopWords = new Set(['what', 'which', 'when', 'where', 'why', 'who', 'how', 'the', 'a', 'an', 'is', 'are', 'does', 'do', 'did', 'can', 'could', 'should', 'for', 'to', 'of', 'and', 'or', 'this', 'that', 'these', 'those', 'with', 'about', 'provide', 'provides']);

  const questionTerms = new Set(
    question
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((term) => term && !stopWords.has(term)),
  );

  const contentTerms = new Set(
    content
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((term) => term && !stopWords.has(term)),
  );

  const overlap = [...questionTerms].filter((term) => contentTerms.has(term));
  return overlap.length >= 1;
}
