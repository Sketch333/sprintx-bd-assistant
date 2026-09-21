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
  const shell = host.root.querySelector('section') as HTMLElement;
  expect(host.root.querySelector('style')?.textContent).toContain('resize: both;');
  expect(host.root.querySelector('[aria-label="Attach SprintX to browser"]')).toBeTruthy();
  expect(host.root.querySelector('[aria-label="Open SprintX trusted window"]')).toBeNull();
  expect(host.root.host.shadowRoot).toBeNull();
  host.scope.__sprintxOverlay.invoke('another');
  expect(host.spy).toHaveBeenCalledTimes(1);
  expect(host.root.querySelector('iframe')).toBe(frame);
  expect(host.root.querySelector('iframe')?.hidden).toBe(false);
  (host.root.querySelector('[aria-label="Minimize SprintX"]') as HTMLElement).click();
  expect(frame?.hidden).toBe(true);
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
  expect(shell.style.left).toBe('10px'); expect(shell.style.top).toBe('10px');
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
    sidePanel: { setPanelBehavior: vi.fn().mockResolvedValue(undefined), open: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) },
    windows: {
      create: vi.fn().mockResolvedValue({ id: 50, type: 'popup' }),
      get: vi.fn().mockResolvedValue({ id: 9, type: 'normal' }),
      update: vi.fn().mockResolvedValue(undefined),
      onBoundsChanged: event('boundsChanged'),
      onRemoved: event('windowRemoved'),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 99, windowId: 9, url: 'chrome://extensions/' }]),
      get: vi.fn().mockResolvedValue({ id: 7, windowId: 9, url: 'https://example.test/path' }),
      onRemoved: event('removed'),
      sendMessage: vi.fn().mockResolvedValue({}),
    },
    scripting: {
      executeScript: vi.fn(async (options: any) => {
        if (options.files) return [{ frameId: 0, documentId: 'top-document' }];
        const source = String(options.func);
        if (source.includes('showExisting')) return [{ frameId: 0, documentId: 'top-document', result: false }];
        if (source.includes('sampleAppearance')) return [{ frameId: 0, documentId: 'top-document', result: { theme: 'light', accent: null } }];
        return [{ frameId: 0, documentId: 'top-document', result: undefined }];
      }),
    },
    storage: {
      session: { set: async (values: any) => Object.assign(store, values), get: async (key: string) => ({ [key]: store[key] }), remove: async (key: string) => { delete store[key]; } },
      local: { set: async (values: any) => Object.assign(store, values), get: async (key: string) => ({ [key]: store[key] }) },
    },
    webNavigation: { getFrame: vi.fn(async ({ frameId }: any) => frameId === 0 ? { documentId: 'top-document', parentFrameId: -1, url: 'https://example.test' } : { documentId: 'frame-document', parentFrameId: 0, url: `chrome-extension://unit/index.html?overlay=${store['overlay:7']?.nonce}` }) },
  };
  const scope: any = { chrome, crypto: { randomUUID: () => 'secure-nonce' }, URL, Date, console };
  runInNewContext(readFileSync('public/background.js', 'utf8'), scope);
  const message = (body: any, sender: any) => new Promise<any>((resolve) => handlers.message(body, sender, resolve));
  return { handlers, chrome, store, message };
}

test('native toolbar behavior delegates directly to Chrome Side Panel', async () => {
  const bg = await background();
  expect(bg.chrome.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  expect(bg.handlers.action).toBeUndefined();
  bg.handlers.menu({ menuItemId: 'sprintx-sidebar' }, { id: 7 });
  expect(bg.chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 });
});

test('private presentation relay controls Workspace 2 theme without accepting page accents or external messages', () => {
  const host = overlay(); host.scope.__sprintxOverlay.invoke('nonce');
  const shell = host.root.querySelector('section') as HTMLElement;
  host.message({ type: 'sprintx:apply-appearance', theme: 'light', accent: '#22aabb' }, { id: 'unit' });
  expect(shell.dataset.theme).toBe('light');
  expect(shell.style.getPropertyValue('--page-accent')).toBe('');
  host.message({ type: 'sprintx:apply-appearance', theme: 'dark', accent: 'url(secret)' }, { id: 'unit' });
  host.message({ type: 'sprintx:apply-appearance', theme: 'dark', accent: ['#22aabb'] }, { id: 'unit' });
  host.message({ type: 'sprintx:apply-appearance', theme: 'dark', accent: null }, { id: 'external' });
  expect(shell.dataset.theme).toBe('light');
  (host.root.querySelector('[aria-label="Close SprintX"]') as HTMLElement).click();
  expect(host.chrome.runtime.onMessage.removeListener).toHaveBeenCalled();
});

test('real isolated sampling follows page light/dark context without importing page accent colors', () => {
  const host = overlay();
  const meta = document.createElement('meta'); meta.name = 'theme-color'; meta.content = '#ff0000'; document.head.append(meta);
  document.body.style.backgroundColor = 'rgb(255, 255, 255)';
  expect(host.scope.__sprintxOverlay.sampleAppearance()).toEqual({ theme: 'light', accent: null });
  meta.content = 'url(secret)';
  expect(host.scope.__sprintxOverlay.sampleAppearance()).toEqual({ theme: 'light', accent: null });
  host.scope.__sprintxOverlay.invoke('nonce');
  expect(host.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  (host.root.querySelector('[aria-label="Close SprintX"]') as HTMLElement).click();
  meta.remove(); document.body.style.backgroundColor = '';
});

test('drag captures initiating pointer and releases on up, lost capture and close', () => {
  const host = overlay(); host.scope.__sprintxOverlay.invoke('nonce');
  const header = host.root.querySelector('[data-drag]') as HTMLElement;
  const captured = new Set<number>();
  header.setPointerCapture = vi.fn((id) => { captured.add(id); });
  header.hasPointerCapture = (id) => captured.has(id);
  header.releasePointerCapture = vi.fn((id) => { captured.delete(id); });
  const pointer = (type: string, id: number, x = 100, y = 100) => {
    const event = new MouseEvent(type, { bubbles: true, composed: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: id }); return event;
  };
  header.dispatchEvent(pointer('pointerdown', 42));
  expect(header.setPointerCapture).toHaveBeenCalledWith(42);
  window.dispatchEvent(pointer('pointerup', 99));
  expect(captured.has(42)).toBe(true);
  header.dispatchEvent(pointer('pointerup', 42));
  expect(header.releasePointerCapture).toHaveBeenCalledWith(42);
  header.dispatchEvent(pointer('pointerdown', 43));
  captured.delete(43); // The browser drops capture before emitting lostpointercapture.
  header.dispatchEvent(pointer('lostpointercapture', 43));
  const shell = host.root.querySelector('section') as HTMLElement;
  const oldLeft = shell.style.left;
  window.dispatchEvent(pointer('pointermove', 43, 900, 900));
  expect(shell.style.left).toBe(oldLeft);
  header.dispatchEvent(pointer('pointerdown', 44));
  (host.root.querySelector('[aria-label="Close SprintX"]') as HTMLElement).click();
  expect(header.releasePointerCapture).toHaveBeenCalledWith(44);
  expect(captured.size).toBe(0);
});


test('floating mode rejects a stale injected overlay instead of reusing legacy UI', async () => {
  const bg = await background();
  let staleRemoved = false;
  bg.chrome.scripting.executeScript.mockImplementation(async (options: any) => {
    if (options.files) return [{ frameId: 0, documentId: 'top-document' }];
    const source = String(options.func);
    if (source.includes('expectedVersion')) {
      staleRemoved = true;
      return [{ frameId: 0, documentId: 'top-document', result: false }];
    }
    if (source.includes('sampleAppearance')) return [{ frameId: 0, documentId: 'top-document', result: { theme: 'light', accent: null } }];
    return [{ frameId: 0, documentId: 'top-document', result: undefined }];
  });

  const response = await bg.message(
    { type: 'sprintx:float-over-page', sourceWindowId: 9, sourceTabId: 7 },
    { id: 'unit', url: 'chrome-extension://unit/index.html' },
  );

  expect(staleRemoved).toBe(true);
  expect(response).toMatchObject({ ok: true, tabId: 7 });
  expect(bg.chrome.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({ files: ['overlay.js'] }));
});

test('floating mode rejects browser-internal tabs before attempting injection', async () => {
  const bg = await background();
  bg.chrome.tabs.get.mockResolvedValueOnce({ id: 7, windowId: 9, url: 'chrome://extensions/' });
  const response = await bg.message(
    { type: 'sprintx:float-over-page', sourceWindowId: 9, sourceTabId: 7 },
    { id: 'unit', url: 'chrome-extension://unit/index.html' },
  );
  expect(response.ok).toBe(false);
  expect(response.error).toContain('only works on normal http/https webpages');
  expect(bg.chrome.scripting.executeScript).not.toHaveBeenCalled();
});

test('background cannot retarget floating mode to a different active tab', async () => {
  const bg = await background();
  bg.chrome.tabs.query.mockResolvedValueOnce([{ id: 99, windowId: 9, url: 'chrome://extensions/' }]);
  bg.chrome.tabs.get.mockResolvedValueOnce({ id: 7, windowId: 9, url: 'https://example.test/path' });

  const response = await bg.message(
    { type: 'sprintx:float-over-page', sourceWindowId: 9, sourceTabId: 7 },
    { id: 'unit', url: 'chrome-extension://unit/index.html' },
  );

  expect(response).toMatchObject({ ok: true, tabId: 7 });
  expect(bg.chrome.tabs.get).toHaveBeenCalledWith(7);
  expect(bg.chrome.tabs.query).not.toHaveBeenCalled();
});

test('side panel can float SprintX over the active webpage without opening a new OS window', async () => {
  const bg = await background();
  const response = await bg.message(
    { type: 'sprintx:float-over-page', sourceWindowId: 9, sourceTabId: 7 },
    { id: 'unit', url: 'chrome-extension://unit/index.html' },
  );
  expect(response).toMatchObject({ ok: true, tabId: 7 });
  expect(bg.chrome.tabs.get).toHaveBeenCalledWith(7);
  expect(bg.chrome.tabs.query).not.toHaveBeenCalled();
  expect(bg.chrome.scripting.executeScript).toHaveBeenCalled();
  expect(bg.chrome.windows.create).not.toHaveBeenCalled();
  expect(bg.store['overlay:7']).toMatchObject({
    nonce: 'secure-nonce',
    topDocumentId: 'top-document',
  });
});

test('floating iframe authorization does not depend on child-frame webNavigation metadata', async () => {
  const bg = await background();
  await bg.message(
    { type: 'sprintx:float-over-page', sourceWindowId: 9, sourceTabId: 7 },
    { id: 'unit', url: 'chrome-extension://unit/index.html' },
  );
  bg.chrome.webNavigation.getFrame.mockImplementation(async ({ frameId }: any) =>
    frameId === 0 ? { documentId: 'top-document', parentFrameId: -1, url: 'https://example.test' } : undefined
  );
  const response = await bg.message(
    { type: 'sprintx:authorize', nonce: 'secure-nonce' },
    {
      id: 'unit',
      tab: { id: 7 },
      frameId: 3,
      documentId: 'floating-frame-document',
      url: 'chrome-extension://unit/index.html?overlay=secure-nonce',
    },
  );
  expect(response).toEqual({ authorized: true, appearance: { theme: 'light', accent: null } });
  expect(bg.store['overlay:7']).toMatchObject({
    frameId: 3,
    frameDocumentId: 'floating-frame-document',
  });
});

test('floating overlay can attach back to the native side panel from its top-frame control', async () => {
  const bg = await background();
  const response = await bg.message(
    { type: 'sprintx:attach-overlay', nonce: 'secure-nonce' },
    { id: 'unit', tab: { id: 7 }, frameId: 0 },
  );
  expect(response).toEqual({ ok: true });
  expect(bg.chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 });
});

test('side panel can request a resizable Chrome popup without coupling popup creation to panel close', async () => {
  const bg = await background();
  const response = await bg.message(
    { type: 'sprintx:pop-out', sourceWindowId: 9 },
    { id: 'unit', url: 'chrome-extension://unit/index.html' },
  );
  expect(response).toEqual({ ok: true });
  expect(bg.chrome.windows.create).toHaveBeenCalledWith({
    url: 'chrome-extension://unit/index.html?popout=1&sourceWindowId=9',
    type: 'popup',
    focused: true,
    width: 480,
    height: 760,
  });
  expect(bg.chrome.sidePanel.close).not.toHaveBeenCalled();
  expect(bg.store['sprintx:popout-session']).toEqual({ popupWindowId: 50, sourceWindowId: 9 });
});

test('pop-out bounds are remembered after the user resizes or moves the popup', async () => {
  const bg = await background();
  await bg.message(
    { type: 'sprintx:pop-out', sourceWindowId: 9 },
    { id: 'unit', url: 'chrome-extension://unit/index.html' },
  );
  await bg.handlers.boundsChanged({ id: 50, type: 'popup', state: 'normal', width: 620, height: 810, left: 120, top: 80 });
  expect(bg.store['sprintx:popout-bounds']).toEqual({ width: 620, height: 810, left: 120, top: 80 });
});


