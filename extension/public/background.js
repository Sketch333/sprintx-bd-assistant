// No automatic page access: only the toolbar gesture injects into its active tab.
// session storage remains extension-only (never enable TRUSTED_AND_UNTRUSTED_CONTEXTS).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
const keyFor = (tabId) => `overlay:${tabId}`;
const POPOUT_SESSION_KEY = 'sprintx:popout-session';
const POPOUT_BOUNDS_KEY = 'sprintx:popout-bounds';
const DEFAULT_POPOUT_BOUNDS = { width: 480, height: 760 };

function popoutBounds(value) {
  if (!value || typeof value !== 'object') return DEFAULT_POPOUT_BOUNDS;
  const bounds = {};
  if (Number.isInteger(value.width) && value.width >= 320 && value.width <= 1200) bounds.width = value.width;
  if (Number.isInteger(value.height) && value.height >= 420 && value.height <= 1200) bounds.height = value.height;
  if (Number.isInteger(value.left)) bounds.left = value.left;
  if (Number.isInteger(value.top)) bounds.top = value.top;
  return { ...DEFAULT_POPOUT_BOUNDS, ...bounds };
}

async function openPopout(sourceWindowId) {
  const source = await chrome.windows.get(sourceWindowId).catch(() => undefined);
  if (!source || source.type !== 'normal') return { ok: false, detached: false };

  const active = (await chrome.storage.session.get(POPOUT_SESSION_KEY))[POPOUT_SESSION_KEY];
  if (Number.isInteger(active?.popupWindowId)) {
    try {
      await chrome.windows.update(active.popupWindowId, { focused: true });
      return { ok: true, detached: active.detached === true };
    } catch {
      await chrome.storage.session.remove(POPOUT_SESSION_KEY);
    }
  }

  const saved = (await chrome.storage.local.get(POPOUT_BOUNDS_KEY))[POPOUT_BOUNDS_KEY];
  const popup = await chrome.windows.create({
    url: chrome.runtime.getURL(`index.html?popout=1&sourceWindowId=${sourceWindowId}`),
    type: 'popup',
    focused: true,
    ...popoutBounds(saved),
  });
  if (!Number.isInteger(popup?.id)) return { ok: false, detached: false };

  let detached = false;
  if (typeof chrome.sidePanel.close === 'function') {
    try {
      await chrome.sidePanel.close({ windowId: sourceWindowId });
      detached = true;
    } catch {}
  }

  await chrome.storage.session.set({
    [POPOUT_SESSION_KEY]: { popupWindowId: popup.id, sourceWindowId, detached },
  });
  return { ok: true, detached };
}
const queues = new Map();
const serial = (tabId, action) => {
  const next = (queues.get(tabId) ?? Promise.resolve()).then(action, action);
  queues.set(tabId, next);
  next.finally(() => { if (queues.get(tabId) === next) queues.delete(tabId); }).catch(() => undefined);
  return next;
};
const trustedWindow = () => chrome.windows.create({ url: chrome.runtime.getURL('index.html?fallback=1'), type: 'popup', width: 460, height: 720 });
const validAppearance = (value) => value && typeof value === 'object' && Object.keys(value).length === 2 && (value.theme === 'light' || value.theme === 'dark') && (value.accent === null || (typeof value.accent === 'string' && /^#[\da-f]{6}$/i.test(value.accent)));
const frameURL = (nonce) => chrome.runtime.getURL(`index.html?overlay=${encodeURIComponent(nonce)}`);
async function liveFrame(record, sender) {
  if (!record || sender.id !== chrome.runtime.id || !sender.tab || sender.frameId <= 0 || !sender.documentId || sender.url !== frameURL(record.nonce)) return false;
  const [top, child] = await Promise.all([
    chrome.webNavigation.getFrame({ tabId: sender.tab.id, frameId: 0 }),
    chrome.webNavigation.getFrame({ tabId: sender.tab.id, frameId: sender.frameId }),
  ]);
  return top?.documentId === record.topDocumentId && child?.documentId === sender.documentId && child?.parentFrameId === 0 && child?.url === sender.url;
}
async function handleMessage(message, sender) {
  if (!message || sender.id !== chrome.runtime.id) return { authorized: false };
  // Top-level trusted extension surfaces may request a window; external frames may not.
  if (message.type === 'sprintx:trusted-window' && !sender.tab && sender.url?.startsWith(chrome.runtime.getURL('index.html'))) {
    await trustedWindow(); return { ok: true };
  }
  if (message.type === 'sprintx:pop-out'
      && Object.keys(message).length === 2
      && Number.isInteger(message.sourceWindowId)
      && sender.url === chrome.runtime.getURL('index.html')) {
    return openPopout(message.sourceWindowId);
  }
  if (!sender.tab || !Number.isInteger(sender.tab.id)) return { authorized: false };
  const key = keyFor(sender.tab.id);
  const record = (await chrome.storage.session.get(key))[key];
  if (message.type === 'sprintx:authorize') {
    if (Object.keys(message).length !== 2 || message.nonce !== record?.nonce || !(await liveFrame(record, sender))) return { authorized: false };
    // StrictMode/retry is idempotent only for the same bound document, never another frame.
    if (record.frameDocumentId ? record.frameDocumentId !== sender.documentId || record.frameId !== sender.frameId : record.expiresAt < Date.now()) return { authorized: false };
    record.frameId = sender.frameId; record.frameDocumentId = sender.documentId;
    await chrome.storage.session.set({ [key]: record });
    return { authorized: true, appearance: record.appearance };
  }
  if (sender.frameId === 0 && sender.documentId === record?.topDocumentId) {
    if (message.type === 'sprintx:close' && Object.keys(message).length === 2 && message.nonce === record.nonce) { await chrome.storage.session.remove(key); return { ok: true }; }
    // Overlay's sidebar control uses a trusted window; late sidePanel.open has no gesture.
    if (message.type === 'sprintx:trusted-window' && Object.keys(message).length === 1) { await trustedWindow(); return { ok: true }; }
  }
  if (record?.frameDocumentId === sender.documentId && record.frameId === sender.frameId && await liveFrame(record, sender)) {
    if (message.type === 'sprintx:trusted-window' && Object.keys(message).length === 1) { await trustedWindow(); return { ok: true }; }
    if (message.type === 'sprintx:apply-appearance' && Object.keys(message).length === 3 && validAppearance({ theme: message.theme, accent: message.accent })) {
      await chrome.tabs.sendMessage(sender.tab.id, { type: message.type, theme: message.theme, accent: message.accent }, { documentId: record.topDocumentId });
      return { ok: true };
    }
  }
  return { ok: false };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  serial(sender.tab?.id ?? 'trusted', () => handleMessage(message, sender)).then(respond, () => respond({ authorized: false, ok: false }));
  return true;
});
chrome.runtime.onInstalled.addListener(() => chrome.contextMenus.create({ id: 'sprintx-sidebar', title: 'Open SprintX in sidebar', contexts: ['action'] }));
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'sprintx-sidebar' || !Number.isInteger(tab?.id)) return;
  // Call synchronously in the originating browser gesture, before any await.
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => trustedWindow());
});
chrome.tabs.onRemoved.addListener((tabId) => serial(tabId, () => chrome.storage.session.remove(keyFor(tabId))));
chrome.windows.onBoundsChanged.addListener(async (window) => {
  const active = (await chrome.storage.session.get(POPOUT_SESSION_KEY))[POPOUT_SESSION_KEY];
  if (window.id !== active?.popupWindowId || window.state !== 'normal') return;
  if (![window.width, window.height, window.left, window.top].every(Number.isInteger)) return;
  await chrome.storage.local.set({
    [POPOUT_BOUNDS_KEY]: { width: window.width, height: window.height, left: window.left, top: window.top },
  });
});
chrome.windows.onRemoved.addListener(async (windowId) => {
  const active = (await chrome.storage.session.get(POPOUT_SESSION_KEY))[POPOUT_SESSION_KEY];
  if (windowId === active?.popupWindowId) await chrome.storage.session.remove(POPOUT_SESSION_KEY);
});
