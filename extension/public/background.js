// No automatic page access: only the toolbar gesture injects into its active tab.
// session storage remains extension-only (never enable TRUSTED_AND_UNTRUSTED_CONTEXTS).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
const keyFor = (tabId) => `overlay:${tabId}`;
const queues = new Map();
const serial = (tabId, action) => {
  const next = (queues.get(tabId) ?? Promise.resolve()).then(action, action);
  queues.set(tabId, next);
  next.finally(() => { if (queues.get(tabId) === next) queues.delete(tabId); }).catch(() => undefined);
  return next;
};
const trustedWindow = () => chrome.windows.create({ url: chrome.runtime.getURL('index.html?fallback=1'), type: 'popup', width: 460, height: 720 });
const validAppearance = (value) => value && Object.keys(value).length === 2 && (value.theme === 'light' || value.theme === 'dark') && (value.accent === null || /^#[\da-f]{6}$/i.test(value.accent));
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
    if (message.type === 'sprintx:appearance' && Object.keys(message).length === 3 && validAppearance({ theme: message.theme, accent: message.accent })) {
      record.appearance = { theme: message.theme, accent: message.accent };
      await chrome.storage.session.set({ [key]: record }); return { ok: true };
    }
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
chrome.action.onClicked.addListener(async (tab) => {
  if (!Number.isInteger(tab.id) || !/^https?:\/\//i.test(tab.url ?? '')) { await trustedWindow(); return; }
  try {
    const target = { tabId: tab.id, frameIds: [0] };
    const injected = await chrome.scripting.executeScript({ target, files: ['overlay.js'] });
    // First toggle an existing isolated controller without touching its authorization.
    const existing = await chrome.scripting.executeScript({ target, func: () => globalThis.__sprintxOverlay.toggleExisting() });
    if (existing[0]?.result === true) return;
    const topDocumentId = injected[0]?.documentId;
    if (!topDocumentId) throw new Error('No document identity for overlay');
    const nonce = crypto.randomUUID();
    await chrome.storage.session.set({ [keyFor(tab.id)]: { nonce, topDocumentId, expiresAt: Date.now() + 30000, appearance: { theme: 'light', accent: null } } });
    // Target the exact document, not a potentially navigated replacement tab.
    await chrome.scripting.executeScript({ target: { tabId: tab.id, documentIds: [topDocumentId] }, func: (issued) => globalThis.__sprintxOverlay.invoke(issued), args: [nonce] });
  } catch {
    await chrome.storage.session.remove(keyFor(tab.id));
    await trustedWindow();
  }
});
chrome.runtime.onInstalled.addListener(() => chrome.contextMenus.create({ id: 'sprintx-sidebar', title: 'Open SprintX in sidebar', contexts: ['action'] }));
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'sprintx-sidebar' || !Number.isInteger(tab?.id)) return;
  // Call synchronously in the originating browser gesture, before any await.
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => trustedWindow());
});
chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(keyFor(tabId)));
