// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const sessionStore: Record<string, unknown> = {};

function installChrome(overrides: Record<string, unknown> = {}) {
  const chrome = {
    runtime: {
      id: 'unit',
      sendMessage: vi.fn().mockResolvedValue({ ok: true, detached: true }),
    },
    windows: {
      getCurrent: vi.fn().mockResolvedValue({ id: 12, type: 'normal' }),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    sidePanel: {
      open: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionStore[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(sessionStore, values)),
        remove: vi.fn(async (key: string) => { delete sessionStore[key]; }),
      },
    },
    ...overrides,
  };
  vi.stubGlobal('chrome', chrome);
  return chrome as any;
}

beforeEach(() => {
  for (const key of Object.keys(sessionStore)) delete sessionStore[key];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

test('presentation mode distinguishes web, side panel and pop-out surfaces', async () => {
  installChrome();
  const presentation = await import('../src/presentation');
  expect(presentation.resolvePresentationMode('https://example.test/', false)).toBe('web');
  expect(presentation.resolvePresentationMode('chrome-extension://unit/index.html', false)).toBe('side-panel');
  expect(presentation.resolvePresentationMode('chrome-extension://unit/index.html?popout=1&sourceWindowId=12', false)).toBe('popout');
  expect(presentation.resolvePresentationMode('chrome-extension://unit/index.html?overlay=nonce', true)).toBe('framed');
});

test('workspace presentation state round-trips through extension session storage', async () => {
  installChrome();
  const presentation = await import('../src/presentation');
  const state = {
    userId: 'alice',
    conversationId: 'conversation-1',
    question: 'Unsent question',
    mode: 'draft' as const,
    composerExpanded: true,
    askMode: 'knowledge' as const,
    draft: { type: 'cold-email' as const, audience: 'Founder', objective: 'Book a call', tone: 'professional' as const, length: 'medium' as const, context: 'Keep this context' },
  };
  await presentation.savePresentationWorkspaceState(state);
  expect(await presentation.readPresentationWorkspaceState()).toEqual(state);
});

test('pop out asks the background to create a popup for the current browser window', async () => {
  const chrome = installChrome();
  const presentation = await import('../src/presentation');
  await expect(presentation.popOutPresentation()).resolves.toEqual({ detached: true });
  expect(chrome.windows.getCurrent).toHaveBeenCalledTimes(1);
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sprintx:pop-out', sourceWindowId: 12 });
  expect(chrome.sidePanel.close).toHaveBeenCalledWith({ windowId: 12 });
});

test('attach back opens the side panel in the source window and closes only the popup window', async () => {
  const chrome = installChrome();
  chrome.windows.getCurrent.mockResolvedValue({ id: 44, type: 'popup' });
  window.history.replaceState({}, '', '/?popout=1&sourceWindowId=12');
  const presentation = await import('../src/presentation');
  await presentation.attachPresentationToBrowser();
  expect(chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 12 });
  expect(chrome.windows.remove).toHaveBeenCalledWith(12).not;
  expect(chrome.windows.remove).toHaveBeenCalledWith(12);
});


test('pop out remains available on Chrome versions without sidePanel.close', async () => {
  const chrome = installChrome();
  delete chrome.sidePanel.close;
  const presentation = await import('../src/presentation');
  await expect(presentation.popOutPresentation()).resolves.toEqual({ detached: false });
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sprintx:pop-out', sourceWindowId: 12 });
});


test('clearing presentation state removes unsent workspace data on sign-out', async () => {
  installChrome();
  const presentation = await import('../src/presentation');
  await presentation.savePresentationWorkspaceState({
    userId: 'alice',
    conversationId: 'conversation-1',
    question: 'Sensitive unsent question',
    mode: 'ask',
    composerExpanded: true,
    askMode: 'knowledge',
    draft: { type: 'cold-email', audience: '', objective: '', tone: 'professional', length: 'medium', context: '' },
  });
  await presentation.clearPresentationWorkspaceState();
  expect(await presentation.readPresentationWorkspaceState()).toBeNull();
});
