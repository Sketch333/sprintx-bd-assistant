import type { AskAnswer } from './ask-service';
import { ContextMessage } from './conversation-context';
import { DocumentFilter, titleWords } from './document-inventory';
import type { VectorStore } from './vector-store';

type InventoryRequest = { action: 'count' | 'list'; filter: DocumentFilter; page: number; unsupportedFilter?: boolean };
const inventoryNoun = '(?:case[ -]+studies|documents|docs|files|spreadsheets)';
const inventoryTailWords = new Set(['are', 'is', 'there', 'do', 'we', 'you', 'have', 'has', 'in', 'on', 'from', 'the', 'our', 'all', 'google', 'drive', 'gdrive', 'kb', 'knowledge', 'base', 'stored', 'indexed', 'uploaded', 'available', 'current', 'currently', 'total', 'please', 'to']);
const inventoryPrefixWords = new Set([...inventoryTailWords, 'can', 'could', 'would', 'will', 'tell', 'me', 'what', 's', 'give', 'us', 'know', 'i', 'want', 'see', 'get', 'need', 'based']);

export function inventoryRequest(question: string, history: ContextMessage[] = []): InventoryRequest | undefined {
  const count = new RegExp(`\\b(?:how many|(?:total\\s+)?(?:number|count)\\s+of|count)\\s+(?:(?:the|our|all|indexed|uploaded|stored|total)\\s+)*${inventoryNoun}\\b`, 'i');
  const list = new RegExp(`\\b(?:list|show|name|enumerate)\\s+(?:(?:me|the|our|all|indexed|uploaded|stored|available)\\s+)*${inventoryNoun}\\b`, 'i');
  const countMatch = count.exec(question), listMatch = list.exec(question);
  const action = countMatch ? 'count' : listMatch ? 'list' : undefined;
  // Follow-ups inherit only the user's latest inventory request, never an
  // arbitrary old topic or a retrieved chunk pretending to be an instruction.
  const followUp = /^\s*(?:please\s+)?(?:(?:list|show)(?:\s+me)?\s+(?:them|those|these)(?:\s+please)?|next\s+page)(?:,?\s+page\s+\S+)?[.!?]?\s*$/i.test(question);
  if (!action && followUp) {
    const previous = history.filter((message) => message.role === 'user').at(-1);
    // Bound recursion to the small context window for repeated "next page".
    const previousIndex = previous ? history.lastIndexOf(previous) : -1;
    const request = previous && inventoryRequest(previous.content, history.slice(0, previousIndex));
    return request ? { ...request, action: 'list', page: requestedPage(question, /^\s*(?:please\s+)?next\s+page/i.test(question) ? request.page + 1 : 1) } : undefined;
  }
  if (!action) return undefined;
  const page = requestedPage(question, 1);
  const match = countMatch ?? listMatch!;
  const prefix = question.slice(0, match.index).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const tail = question.slice(match.index + match[0].length).replace(/\bpage\s+\S+/i, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return {
    action, page,
    filter: { scope: /\b(?:google\s*drive|gdrive|drive)\b/i.test(question) ? 'drive' : 'all', caseStudies: /\bcase[ -]+studies\b/i.test(question), sourceType: /\bspreadsheets\b/i.test(question) ? 'sheet' : undefined },
    // Validate supported modifiers positively. A keyword blacklist silently
    // lost constraints such as "in healthcare" or "from the sales team".
    unsupportedFilter: tail.some((word) => !inventoryTailWords.has(word)) || prefix.some((word) => !inventoryPrefixWords.has(word)),
  };
}

function requestedPage(question: string, fallback: number): number {
  const supplied = question.match(/\bpage\s+([^\s,?!]+)/i)?.[1];
  return supplied === undefined ? fallback : Number(supplied.replace(/\.$/, ''));
}

export async function inventoryAnswer(request: InventoryRequest, store: VectorStore): Promise<AskAnswer> {
  const { action, filter, page } = request;
  if (request.unsupportedFilter) return {
    answer: 'The document-inventory tool currently supports all indexed documents, Google Drive scope, folder-classified case studies, and spreadsheets. It cannot reliably count or list content-, project-, date-, or file-format-filtered subsets yet; I should not substitute an unfiltered total. Ask for an unfiltered list, or ask a specific question about a named document.',
    sources: [], usedGemini: false,
  };
  if (!Number.isSafeInteger(page) || page < 1 || page > 1001) {
    return { answer: 'Please request a document-list page between 1 and 1001.', sources: [], usedGemini: false };
  }
  const offset = action === 'list' ? (page - 1) * 20 : 0;
  const inventory = await store.listDocuments({ ...filter, offset, limit: action === 'list' ? 20 : 1 });
  const category = filter.caseStudies ? 'case studies classified by folder' : filter.sourceType === 'sheet' ? 'spreadsheets' : 'documents (including spreadsheets)';
  const scope = filter.scope === 'drive' ? 'the indexed Google Drive knowledge base' : 'the indexed knowledge base, excluding webpages';
  const caveat = `This counts active, fully indexed documents, not the live Drive directory or text chunks.${filter.caseStudies ? ' Documents under the Case Studies folder and its subfolders are included regardless of filename. Sync Google Drive after deploying this update to refresh folder classification for existing records without re-embedding unchanged content.' : ''}`;
  const summary = `There are ${inventory.total} ${category} in ${scope}.`;
  if (action === 'count' || inventory.total === 0) return { answer: `${summary}\n\n${caveat}\n\nSource: indexed document inventory.`, sources: [], usedGemini: false };
  const pages = Math.ceil(inventory.total / 20);
  if (offset >= inventory.total) return { answer: `${summary}\n\nPage ${page} is out of range. Request a page from 1 to ${pages}.\n\n${caveat}`, sources: [], usedGemini: false };
  const sources = inventory.documents.map((source) => ({ title: source.sourceTitle, path: source.sourcePath, url: source.sourceUrl ?? undefined, snippet: 'Active, fully indexed document; listed from the knowledge-base inventory.' }));
  const entries = sources.map((source, index) => `${offset + index + 1}. ${escapeMarkdown(source.title)} [Source ${index + 1}]`).join('\n');
  return { answer: `${summary}\n\nPage ${page} of ${pages}:\n\n${entries}\n\n${caveat}${inventory.hasMore ? `\n\nFor more, ask “List ${filter.caseStudies ? 'case studies' : filter.sourceType === 'sheet' ? 'spreadsheets' : 'documents'}${filter.scope === 'drive' ? ' in Google Drive' : ''}, page ${page + 1}”.` : ''}`, sources, usedGemini: false };
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\r\n]/g, ' ').replace(/[\\`*_{}\[\]()<>#!|]/g, '\\$&');
}

export function explicitDocumentQuestion(question: string): boolean {
  // A missing title in a named project question must not be answered with
  // another project's stack. Broad service questions still use normal RAG.
  return /\b(?:document|file|case[ -]+study)\s+(?:named|called|titled)\s+\S+/i.test(question)
    || /\.(?:pdf|docx?|txt|md|xlsx?)\b/i.test(question)
    || (/\b(?:stack|technologies|technology)\b/i.test(question)
      && /\b(?:in|for|of)\s+[A-Z][\w-]*(?:\s+[A-Z][\w-]*)*[?.!]?\s*$/.test(question));
}

const genericTitleWords = new Set(['services', 'service', 'about', 'us', 'overview', 'pricing', 'profile', 'company', 'proposal', 'draft', 'marketing', 'growth', 'sprintx', 'guide', 'capabilities', 'portfolio']);
export function distinctiveDocumentTitle(title: string): boolean {
  return titleWords(title).some((word) => !genericTitleWords.has(word));
}
