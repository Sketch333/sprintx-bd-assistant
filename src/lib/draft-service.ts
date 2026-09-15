import { config } from '../config';
import { SearchResult } from '../types';
import { SYSTEM_PROMPT } from '../system-prompt';
import { generateGeminiText } from './gemini-models';

export type DraftInput = {
  type: 'cold-email' | 'follow-up' | 'linkedin' | 'proposal';
  audience: string;
  objective: string;
  tone: 'professional' | 'friendly' | 'persuasive' | 'concise';
  length: 'short' | 'medium' | 'long';
  context?: string;
};

export type DraftResult = {
  draft: string;
  sources: Array<{ title: string; path: string; url?: string; snippet: string }>;
  usedGemini: boolean;
};

export async function createDraft(input: DraftInput, results: SearchResult[], userApiKeyOverride?: string): Promise<DraftResult> {
  const relevantResults = results.filter((result) => result.score >= 0.18);
  const sources = relevantResults.map((result) => ({
    title: result.sourceTitle,
    path: result.sourcePath,
    url: result.sourceUrl,
    snippet: result.content.slice(0, 200),
  }));
  const apiKey = userApiKeyOverride || config.testGeminiApiKey || config.googleApiKey;

  if (!relevantResults.length) {
    return {
      draft: 'I could not find enough SprintX knowledge to create a grounded draft. Please ingest the knowledge base or provide a more specific audience and objective.',
      sources,
      usedGemini: false,
    };
  }

  if (!apiKey) {
    return { draft: fallbackDraft(input, relevantResults[0].sourceTitle), sources, usedGemini: false };
  }

  const context = relevantResults
    .map((result, index) => `Source ${index + 1} — ${result.sourceTitle}\n${result.content}`)
    .join('\n\n---\n\n');
  const prompt = `${SYSTEM_PROMPT}

Create a ${input.type} for SprintX using ONLY the knowledge base context below.
Audience: ${input.audience}
Objective: ${input.objective}
Tone: ${input.tone}
Length: ${input.length}
Additional context: ${input.context || 'None'}

Write only the ready-to-send draft. Do not invent services, clients, results, pricing, or claims not supported by the context.

Knowledge base context:
${context}`;

  try {
    const generated = await generateGeminiText(prompt, SYSTEM_PROMPT, apiKey);
    return {
      draft: sanitizeDraft(generated || fallbackDraft(input, relevantResults[0].sourceTitle)),
      sources,
      usedGemini: Boolean(generated),
    };
  } catch (error) {
    console.warn('Gemini drafting failed, using grounded fallback:', error);
    return { draft: fallbackDraft(input, relevantResults[0].sourceTitle), sources, usedGemini: false };
  }
}

function fallbackDraft(input: DraftInput, sourceTitle: string): string {
  const greeting = input.type === 'linkedin' ? 'Hi there,' : 'Hello,';
  return `${greeting}\n\nI’m reaching out because SprintX may be able to help with ${input.objective.toLowerCase()}. Based on our current materials, our relevant experience is described in ${sourceTitle}.\n\nWould you be open to a brief conversation to explore whether this could support your goals?\n\nBest,\nSprintX`;
}

function sanitizeDraft(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}
