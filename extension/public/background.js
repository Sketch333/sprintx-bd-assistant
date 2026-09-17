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
chrome.action.onClicked.addListener((tab) => serial(tab.id ?? 'trusted', async () => {
  if (!Number.isInteger(tab.id) || !/^https?:\/\//i.test(tab.url ?? '')) { await trustedWindow(); return; }
  let issued = null;
  try {
    const target = { tabId: tab.id, frameIds: [0] };
    const injected = await chrome.scripting.executeScript({ target, files: ['overlay.js'] });
    const topDocumentId = injected[0]?.documentId;
    if (!topDocumentId) throw new Error('No document identity for overlay');
    const documentTarget = { tabId: tab.id, documentIds: [topDocumentId] };
    // This synchronous isolated-world probe returns colors, not a runtime promise.
    // Waiting on a message from inside this shared tab queue would deadlock.
    const probe = await chrome.scripting.executeScript({ target: documentTarget, func: () => {
      if (globalThis.__sprintxOverlay.toggleExisting()) return { existing: true };
      return { existing: false, appearance: globalThis.__sprintxOverlay.sampleAppearance() };
    } });
    const presentation = probe[0]?.result;
    if (presentation?.existing === true) return;
    if (presentation?.existing !== false || !validAppearance(presentation.appearance)) throw new Error('Invalid page appearance');
    const nonce = crypto.randomUUID();
    issued = { nonce, topDocumentId, expiresAt: Date.now() + 30000, appearance: presentation.appearance };
    await chrome.storage.session.set({ [keyFor(tab.id)]: issued });
    // Target the exact document, not a potentially navigated replacement tab.
    // invoke is synchronous; the frame's runtime authorization waits until this queue releases.
    await chrome.scripting.executeScript({ target: documentTarget, func: (issued) => globalThis.__sprintxOverlay.invoke(issued), args: [nonce] });
  } catch {
    if (issued) {
      const current = (await chrome.storage.session.get(keyFor(tab.id)))[keyFor(tab.id)];
      if (current?.nonce === issued.nonce && current?.topDocumentId === issued.topDocumentId) await chrome.storage.session.remove(keyFor(tab.id));
    }
    await trustedWindow();
  }
}));
chrome.runtime.onInstalled.addListener(() => chrome.contextMenus.create({ id: 'sprintx-sidebar', title: 'Open SprintX in sidebar', contexts: ['action'] }));
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'sprintx-sidebar' || !Number.isInteger(tab?.id)) return;
  // Call synchronously in the originating browser gesture, before any await.
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => trustedWindow());
});
chrome.tabs.onRemoved.addListener((tabId) => serial(tabId, () => chrome.storage.session.remove(keyFor(tabId))));
