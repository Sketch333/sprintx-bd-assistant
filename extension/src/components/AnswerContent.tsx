import { Fragment, ReactNode } from 'react';

type InlineToken = { type: 'text' | 'strong' | 'em' | 'link'; value: string; href?: string };

function normalizeMarkdown(value: string): string {
  return value
    .replace(/(^|[ \t])###\s+/g, '\n\n### ')
    .replace(/(###\s+[A-Za-z][^.\n]*?)\s+(\d+[.)])\s+/g, '$1\n\n$2 ')
    .replace(/([.!?:\]])\s+(\d+[.)])\s+/g, '$1\n$2 ')
    .replace(/\s+([-*])\s+(?=(?:\*\*|__[^\n]+__|[A-Z0-9]))/g, '\n$1 ')
    .replace(/([ \t])([-*])\s+(?=[A-Z])/g, '\n$2 ');
}

function tokenizeInline(value: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\))/g;
  let lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) tokens.push({ type: 'text', value: value.slice(lastIndex, index) });
    const token = match[0];
    if (token.startsWith('**') || token.startsWith('__')) {
      tokens.push({ type: 'strong', value: token.slice(2, -2) });
    } else if (token.startsWith('*') || token.startsWith('_')) {
      tokens.push({ type: 'em', value: token.slice(1, -1) });
    } else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      if (link) tokens.push({ type: 'link', value: link[1], href: link[2] });
    }
    lastIndex = index + token.length;
  }
  if (lastIndex < value.length) tokens.push({ type: 'text', value: value.slice(lastIndex) });
  return tokens.length ? tokens : [{ type: 'text', value }];
}

function renderInline(value: string, keyPrefix: string): ReactNode[] {
  return tokenizeInline(value).map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    if (token.type === 'strong') return <strong key={key}>{token.value}</strong>;
    if (token.type === 'em') return <em key={key}>{token.value}</em>;
    if (token.type === 'link') return <a key={key} href={token.href} target="_blank" rel="noreferrer">{token.value}</a>;
    return <Fragment key={key}>{token.value}</Fragment>;
  });
}

function renderBlock(block: string, index: number): ReactNode {
  const lines = block.split('\n');
  const heading = lines.length === 1 ? lines[0].match(/^(#{1,3})\s+(.+)$/) : null;
  if (heading) {
    const Heading = heading[1].length === 1 ? 'h3' : 'h4';
    return <Heading key={`heading-${index}`}>{renderInline(heading[2], `heading-${index}`)}</Heading>;
  }

  const listItems = lines.map((line) => line.match(/^\s*[-*]\s+(.+)$/));
  if (listItems.every(Boolean)) {
    return <ul key={`list-${index}`}>{listItems.map((item, itemIndex) => <li key={`item-${index}-${itemIndex}`}>{renderInline(item![1], `item-${index}-${itemIndex}`)}</li>)}</ul>;
  }
  if (listItems.some(Boolean)) {
    const firstListIndex = listItems.findIndex(Boolean);
    const prefix = lines.slice(0, firstListIndex).join(' ').trim();
    const items = listItems.filter((item): item is RegExpMatchArray => Boolean(item));
    return <Fragment key={`mixed-list-${index}`}>
      {prefix && <p>{renderInline(prefix, `mixed-prefix-${index}`)}</p>}
      <ul>{items.map((item, itemIndex) => <li key={`mixed-item-${index}-${itemIndex}`}>{renderInline(item[1], `mixed-item-${index}-${itemIndex}`)}</li>)}</ul>
    </Fragment>;
  }

  const numberedItems = lines.map((line) => line.match(/^\s*\d+[.)]\s+(.+)$/));
  if (numberedItems.every(Boolean)) {
    return <ol key={`ordered-${index}`}>{numberedItems.map((item, itemIndex) => <li key={`ordered-item-${index}-${itemIndex}`}>{renderInline(item![1], `ordered-item-${index}-${itemIndex}`)}</li>)}</ol>;
  }

  if (numberedItems.some(Boolean)) {
    const items: Array<{ text: string; bullets: string[] }> = [];
    for (const line of lines) {
      const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      if (numbered) items.push({ text: numbered[1], bullets: [] });
      else if (bullet && items.length) items[items.length - 1].bullets.push(bullet[1]);
    }
    return <ol key={`ordered-mixed-${index}`}>{items.map((item, itemIndex) => <li key={`ordered-mixed-item-${index}-${itemIndex}`}>{renderInline(item.text, `ordered-mixed-${index}-${itemIndex}`)}{item.bullets.length > 0 && <ul>{item.bullets.map((bullet, bulletIndex) => <li key={`nested-${index}-${itemIndex}-${bulletIndex}`}>{renderInline(bullet, `nested-${index}-${itemIndex}-${bulletIndex}`)}</li>)}</ul>}</li>)}</ol>;
  }

  return <p key={`paragraph-${index}`}>{lines.map((line, lineIndex) => <Fragment key={`line-${index}-${lineIndex}`}>{lineIndex > 0 && <>{'\n'}<br /></>}{renderInline(line, `paragraph-${index}-${lineIndex}`)}</Fragment>)}</p>;
}

export function AnswerContent({ content }: { content: string }) {
  const normalized = normalizeMarkdown(content);
  return <div className="answer">{normalized.split(/\n{2,}/).map((block, index) => <Fragment key={`block-${index}`}>{index > 0 && '\n\n'}{renderBlock(block, index)}</Fragment>)}</div>;
}
