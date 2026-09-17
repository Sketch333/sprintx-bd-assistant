import type { Citation } from '../types';
function safeUrl(value?: string): string | null {
  if (!value) return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function Sources({ sources }: { sources: Citation[] }) {
  if (!sources.length) return null;
  const groups = new Map<string, { source: Citation; indices: number[]; snippets: string[] }>();
  sources.forEach((source, index) => {
    const key = JSON.stringify([source.path, source.url ?? '', source.title]);
    const group = groups.get(key) ?? { source, indices: [], snippets: [] };
    group.indices.push(index + 1);
    if (!group.snippets.includes(source.snippet)) group.snippets.push(source.snippet);
    groups.set(key, group);
  });
  return <details className="sources"><summary>Evidence · {groups.size} {groups.size === 1 ? 'source' : 'sources'}</summary>
    {[...groups.values()].map(({ source, indices, snippets }) => <article className="source" key={indices[0]}>
      <div className="source-heading"><span className="source-indices">{indices.map((index) => `[${index}]`).join(', ')}</span><strong>{source.title}</strong></div>
      {snippets.map((snippet, index) => <p key={index}>{snippet}</p>)}
      {safeUrl(source.url) ? <a href={safeUrl(source.url)!} target="_blank" rel="noopener noreferrer">Open source ↗</a> : <small className="muted">{source.path}</small>}
    </article>)}
  </details>;
}
