// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AnswerContent } from '../src/components/AnswerContent';
import { Sources } from '../src/components/Sources';
import { AppearanceSettings, useAppearance } from '../src/components/AppearanceSettings';
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function AppearanceHarness() { return <AppearanceSettings appearance={useAppearance()} />; }

test('evidence disclosure keeps original indices and every distinct duplicate excerpt', () => {
  render(<Sources sources={[
    { title: 'Services', path: 'services.md', url: 'https://example.test/services', snippet: 'First excerpt' },
    { title: 'Case study', path: 'case.md', snippet: 'Another source' },
    { title: 'Services', path: 'services.md', url: 'https://example.test/services', snippet: 'Second excerpt' },
  ]} />);
  const summary = screen.getByText('Evidence · 2 sources'); fireEvent.click(summary);
  expect(screen.getAllByText('Services')).toHaveLength(1);
  expect(screen.getByText('[1], [3]')).toBeTruthy(); expect(screen.getByText('[2]')).toBeTruthy();
  expect(screen.getByText('First excerpt')).toBeTruthy(); expect(screen.getByText('Second excerpt')).toBeTruthy();
  const link = screen.getByRole('link') as HTMLAnchorElement;
  expect(link.href).toBe('https://example.test/services'); expect(link.rel).toContain('noopener');
});
test.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '/relative', 'not a URL'])('unsafe source URL %s stays unlinked', (url) => {
  render(<Sources sources={[{ title: 'Untrusted source', path: 'fixture.md', url, snippet: '<svg onload=alert(1)>' }]} />);
  fireEvent.click(screen.getByText('Evidence · 1 source'));
  expect(screen.queryByRole('link')).toBeNull(); expect(screen.getByText('fixture.md')).toBeTruthy();
  expect(screen.getByText('<svg onload=alert(1)>')).toBeTruthy(); expect(document.querySelector('svg')).toBeNull();
});
test('answer preserves multiline and citation text without parsing raw HTML', () => {
  render(<AnswerContent content={'Evidence [1]\n\n<img src=x onerror=alert(1)>'} />);
  expect(document.querySelector('.answer')?.textContent).toBe('Evidence [1]\n\n<img src=x onerror=alert(1)>');
  expect(document.querySelector('img')).toBeNull();
});
test('answer renders safe Markdown structure instead of exposing formatting markers', () => {
  render(<AnswerContent content={'### Scoping Questions\n\n1. **Architecture:** Use a *multi-agent* design.\n2. **Data:** Keep [approved facts](https://example.test/facts).'} />);
  expect(screen.getByRole('heading', { name: 'Scoping Questions' })).toBeTruthy();
  expect(screen.getByText('Architecture:')).toBeTruthy();
  expect(screen.getByText('multi-agent')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'approved facts' }).getAttribute('href')).toBe('https://example.test/facts');
  expect(document.querySelector('.answer')?.textContent).not.toContain('**');
  expect(document.querySelector('.answer')?.textContent).not.toContain('*multi-agent*');
});
test('answer separates compact headings and list markers returned on one line', () => {
  render(<AnswerContent content={'Here are questions: ### Scoping Questions 1. **Architecture:** Use a coordinator. * Will it remember orders? [Source 1] 2. **Data:** Use approved facts.'} />);
  expect(screen.getByRole('heading', { name: 'Scoping Questions' })).toBeTruthy();
  expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('Architecture:')).toBeTruthy();
});
test('answer separates compact bullets before bold service categories and items', () => {
  render(<AnswerContent content={'Services include: * **Consulting** * Business Consulting [Source 1] * HR Consulting [Source 1] * **Operations** * Project Management [Source 2]'} />);
  expect(screen.getAllByRole('list')).toHaveLength(1);
  expect(screen.getByText('Consulting')).toBeTruthy();
  expect(screen.getByText('Business Consulting [Source 1]')).toBeTruthy();
  expect(screen.getByText('Project Management [Source 2]')).toBeTruthy();
});
test('light is the default appearance when no preference has been saved', () => {
  render(<AppearanceHarness />);
  expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('light');
  expect(document.documentElement.dataset.theme).toBe('light');
});

test('auto tracks system changes while a saved explicit theme overrides them', () => {
  localStorage.setItem('sprintx.appearance', JSON.stringify({ theme: 'auto', adaptiveAccent: false }));
  const listeners = new Set<() => void>();
  const media = { matches: false, addEventListener: (_name: string, listener: () => void) => listeners.add(listener), removeEventListener: (_name: string, listener: () => void) => listeners.delete(listener) };
  vi.stubGlobal('matchMedia', () => media);
  const first = render(<AppearanceHarness />);
  expect(document.documentElement.dataset.theme).toBe('light');
  act(() => { media.matches = true; listeners.forEach((listener) => listener()); });
  expect(document.documentElement.dataset.theme).toBe('dark');
  fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'light' } });
  first.unmount(); expect(listeners.size).toBe(0);
  render(<AppearanceHarness />);
  expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('light');
  expect(document.documentElement.dataset.theme).toBe('light');
});
test('restricted preference storage reports a session-only theme without losing its selection', () => {
  render(<AppearanceHarness />);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Restricted storage'); });
  fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(screen.getByRole('status').textContent).toContain('could not be saved');
});
