// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { runInNewContext } from 'node:vm';

function overlay() {
  let root: ShadowRoot | undefined;
  const attach = Element.prototype.attachShadow;
  const spy = vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, options) { root = attach.call(this, options); return root; });
  let presentation: any;
  const chrome = { runtime: { id: 'unit', getURL: (path: string) => `chrome-extension://unit/${path}`, sendMessage: vi.fn().mockResolvedValue({}), onMessage: { addListener: (callback: any) => { presentation = callback; }, removeListener: vi.fn() } } };
  const scope: any = { document, window, chrome, URL, getComputedStyle, AbortController: window.AbortController };
  scope.globalThis = scope;
  runInNewContext(readFileSync('public/overlay.js', 'utf8'), scope);
  return { scope, chrome, spy, message: (value: any, sender: any) => presentation?.(value, sender), get root() { return root!; } };
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

test('real host mounts once, minimizes without unloading, restores, closes and cleans listeners', () => {
  const host = overlay();
  expect(typeof host.scope.__sprintxOverlay?.invoke).toBe('function');
  host.scope.__sprintxOverlay.invoke('nonce');
  const frame = host.root.querySelector('iframe');
  expect(frame?.src).toBe('chrome-extension://unit/index.html?overlay=nonce');
  expect(host.root.host.shadowRoot).toBeNull();
  host.scope.__sprintxOverlay.invoke('another');
  expect(host.spy).toHaveBeenCalledTimes(1);
  expect(host.root.querySelector('iframe')).toBe(frame);
  expect(host.root.querySelector('iframe')?.hidden).toBe(true);
  (host.root.querySelector('[aria-label="Restore SprintX"]') as HTMLElement).click();
  expect(frame?.hidden).toBe(false);
  (host.root.querySelector('[aria-label="Close SprintX"]') as HTMLElement).click();
  expect(document.querySelector('[data-sprintx-host]')).toBeNull();
  expect(host.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sprintx:close', nonce: 'nonce' });
});

test('drag and viewport resize clamp shell inside viewport', () => {
  const host = overlay(); host.scope.__sprintxOverlay.invoke('nonce');
  const shell = host.root.querySelector('section') as HTMLElement;
  const handle = host.root.querySelector('[data-drag]')!;
  handle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 900, clientY: 100, bubbles: true }));
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: -3000, clientY: -3000 }));
  expect(shell.style.left).toBe('8px'); expect(shell.style.top).toBe('8px');
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 9000, clientY: 9000 }));
  expect(parseFloat(shell.style.left)).toBeLessThan(window.innerWidth);
  window.dispatchEvent(new Event('resize'));
  expect(parseFloat(shell.style.top)).toBeLessThan(window.innerHeight);
  (host.root.querySelector('[aria-label="Close SprintX"]') as HTMLElement).click();
  const oldLeft = shell.style.left;
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, clientY: 0 }));
  expect(shell.style.left).toBe(oldLeft);
});

async function background(sharedStore?: any) {
  const handlers: any = {};
  const store: any = sharedStore ?? {};
  const event = (key: string) => ({ addListener: (callback: any) => { handlers[key] = callback; } });
  const chrome: any = {
    runtime: { id: 'unit', getURL: (path: string) => `chrome-extension://unit/${path}`, onMessage: event('message'), onInstalled: event('installed') },
    action: { onClicked: event('action') }, contextMenus: { create: vi.fn(), onClicked: event('menu') },
    sidePanel: { setPanelBehavior: vi.fn().mockResolvedValue(undefined), open: vi.fn().mockResolvedValue(undefined) },
    windows: { create: vi.fn().mockResolvedValue({}) }, tabs: { onRemoved: event('removed'), sendMessage: vi.fn().mockResolvedValue({}) },
    scripting: { executeScript: vi.fn().mockResolvedValue([{ frameId: 0, documentId: 'top-document' }]) },
    storage: { session: { set: async (values: any) => Object.assign(store, values), get: async (key: string) => ({ [key]: store[key] }), remove: async (key: string) => { delete store[key]; } } },
    webNavigation: { getFrame: vi.fn(async ({ frameId }: any) => frameId === 0 ? { documentId: 'top-document', parentFrameId: -1, url: 'https://example.test' } : { documentId: 'frame-document', parentFrameId: 0, url: `chrome-extension://unit/index.html?overlay=${store['overlay:7']?.nonce}` }) },
  };
  const scope: any = { chrome, crypto: { randomUUID: () => 'secure-nonce' }, URL, Date, console };
  runInNewContext(readFileSync('public/background.js', 'utf8'), scope);
  const message = (body: any, sender: any) => new Promise<any>((resolve) => handlers.message(body, sender, resolve));
  return { handlers, chrome, store, message };
}

test('toolbar HTTP invocation injects only active tab; restricted and late failures open trusted window', async () => {
  const bg = await background();
  expect(typeof bg.handlers.action).toBe('function');
  await bg.handlers.action({ id: 7, url: 'https://example.test' });
  expect(bg.chrome.scripting.executeScript.mock.calls[0][0]).toEqual({ target: { tabId: 7, frameIds: [0] }, files: ['overlay.js'] });
  expect(bg.store['overlay:7'].topDocumentId).toBe('top-document');
  await bg.handlers.action({ id: 8, url: 'chrome://settings' });
  expect(bg.chrome.windows.create).toHaveBeenCalledWith({ url: 'chrome-extension://unit/index.html?fallback=1', type: 'popup', width: 460, height: 720 });
  bg.chrome.scripting.executeScript.mockRejectedValueOnce(new Error('navigation race'));
  await bg.handlers.action({ id: 9, url: 'https://example.test' });
  expect(bg.chrome.windows.create).toHaveBeenCalledTimes(2);
  expect(bg.chrome.sidePanel.open).not.toHaveBeenCalled();
  bg.handlers.menu({ menuItemId: 'sprintx-sidebar' }, { id: 7 });
  expect(bg.chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 });
});

test('private presentation relay controls shell without accepting page messages or unsafe colors', () => {
  const host = overlay(); host.scope.__sprintxOverlay.invoke('nonce');
  const shell = host.root.querySelector('section') as HTMLElement;
  host.message({ type: 'sprintx:apply-appearance', theme: 'light', accent: '#22aabb' }, { id: 'unit' });
  expect(shell.dataset.theme).toBe('light');
  expect(shell.style.getPropertyValue('--page-accent')).toBe('#22aabb');
  host.message({ type: 'sprintx:apply-appearance', theme: 'dark', accent: 'url(secret)' }, { id: 'unit' });
  host.message({ type: 'sprintx:apply-appearance', theme: 'dark', accent: null }, { id: 'external' });
  expect(shell.dataset.theme).toBe('light');
  (host.root.querySelector('[aria-label="Close SprintX"]') as HTMLElement).click();
  expect(host.chrome.runtime.onMessage.removeListener).toHaveBeenCalled();
});

test('authorized theme relay survives worker restart and reinvocation leaves nonce intact', async () => {
  const bg = await background(); await bg.handlers.action({ id: 7, url: 'https://example.test' });
  const sender = { id: 'unit', tab: { id: 7 }, frameId: 2, documentId: 'frame-document', url: 'chrome-extension://unit/index.html?overlay=secure-nonce' };
  await bg.message({ type: 'sprintx:authorize', nonce: 'secure-nonce' }, sender);
  bg.store['overlay:7'].expiresAt = 0;
  const restarted = await background(bg.store);
  expect(await restarted.message({ type: 'sprintx:apply-appearance', theme: 'dark', accent: '#22aabb' }, sender)).toEqual({ ok: true });
  expect(restarted.chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'sprintx:apply-appearance', theme: 'dark', accent: '#22aabb' }, { documentId: 'top-document' });
  expect(await restarted.message({ type: 'sprintx:apply-appearance', theme: 'dark', accent: '#22aabb', token: 'secret' }, sender)).toEqual({ ok: false });
  expect(await restarted.message({ type: 'sprintx:appearance', theme: 'dark', accent: 'url(secret)' }, { id: 'unit', tab: { id: 7 }, frameId: 0, documentId: 'top-document', url: 'https://example.test' })).toEqual({ ok: false });
  restarted.chrome.scripting.executeScript.mockResolvedValueOnce([{ documentId: 'top-document' }]).mockResolvedValueOnce([{ result: true }]);
  await restarted.handlers.action({ id: 7, url: 'https://example.test' });
  expect(restarted.store['overlay:7'].frameDocumentId).toBe('frame-document');
});

test('authorization binds nonce to tab, extension child frame and live top document; consumed nonce rejects replay', async () => {
  const bg = await background(); await bg.handlers.action({ id: 7, url: 'https://example.test' });
  const sender = { id: 'unit', tab: { id: 7 }, frameId: 2, documentId: 'frame-document', url: 'chrome-extension://unit/index.html?overlay=secure-nonce' };
  const request = { type: 'sprintx:authorize', nonce: 'secure-nonce' };
  expect(await bg.message(request, { ...sender, id: 'evil' })).toEqual({ authorized: false });
  expect(await bg.message(request, { ...sender, frameId: 0 })).toEqual({ authorized: false });
  expect(await bg.message(request, { ...sender, tab: { id: 8 } })).toEqual({ authorized: false });
  expect(await bg.message(request, sender)).toEqual({ authorized: true, appearance: { theme: 'light', accent: null } });
  expect(await bg.message(request, { ...sender, documentId: 'replayed' })).toEqual({ authorized: false });
  expect(await bg.message({ type: 'sprintx:trusted-window' }, { ...sender, documentId: 'replayed' })).toEqual({ ok: false });
});

test('expired nonce and navigated parent document deny authorization', async () => {
  const bg = await background(); await bg.handlers.action({ id: 7, url: 'https://example.test' });
  const sender = { id: 'unit', tab: { id: 7 }, frameId: 2, documentId: 'frame-document', url: 'chrome-extension://unit/index.html?overlay=secure-nonce' };
  bg.store['overlay:7'].expiresAt = 0;
  expect(await bg.message({ type: 'sprintx:authorize', nonce: 'secure-nonce' }, sender)).toEqual({ authorized: false });
  bg.store['overlay:7'].expiresAt = Date.now() + 30000;
  bg.chrome.webNavigation.getFrame.mockResolvedValue({ documentId: 'new-top', parentFrameId: 0, url: sender.url });
  expect(await bg.message({ type: 'sprintx:authorize', nonce: 'secure-nonce' }, sender)).toEqual({ authorized: false });
});

test('stale detached host cannot revoke a replacement overlay authorization', async () => {
  const bg = await background(); await bg.handlers.action({ id: 7, url: 'https://example.test' });
  bg.store['overlay:7'].nonce = 'replacement-nonce';
  const sender = { id: 'unit', tab: { id: 7 }, frameId: 0, documentId: 'top-document', url: 'https://example.test' };
  expect(await bg.message({ type: 'sprintx:close', nonce: 'secure-nonce' }, sender)).toEqual({ ok: false });
  expect(bg.store['overlay:7'].nonce).toBe('replacement-nonce');
  expect(await bg.message({ type: 'sprintx:close', nonce: 'replacement-nonce' }, sender)).toEqual({ ok: true });
  expect(bg.store['overlay:7']).toBeUndefined();
});
