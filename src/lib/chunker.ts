export const DEFAULT_CHUNK_SIZE = 900;
export const DEFAULT_CHUNK_OVERLAP = 120;

export function chunkText(text: string, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = start + chunkSize;
    if (end >= normalized.length) {
      end = normalized.length;
    }

    let slice = normalized.slice(start, end);

    if (end < normalized.length) {
      const lastSpace = slice.lastIndexOf(' ');
      if (lastSpace > chunkSize * 0.7) {
        slice = slice.slice(0, lastSpace);
        end = start + lastSpace;
      }
    }

    const trimmed = slice.trim();
    if (trimmed) {
      chunks.push(trimmed);
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(start + 1, end - overlap);
  }

  return chunks;
}
