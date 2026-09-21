// SprintX presentation orchestration.
// The native side panel is global to a Chrome window. Floating mode mirrors that
// lifecycle by maintaining one transferable overlay session per browser window.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);

const overlayKeyFor = (tabId) => 'overlay:' + tabId;
const floatingWindowKeyFor = (windowId) => 'floating-window:' + windowId;
const FLOATING_WINDOW_PREFIX = 'floating-window:';
const OVERLAY_VERSION = 'workspace-2-floating-v4';

const POPOUT_SESSION_KEY = 'sprintx:popout-session';
const POPOUT_BOUNDS_KEY = 'sprintx:popout-bounds';
const DEFAULT_POPOUT_BOUNDS = { width: 480, height: 760 };

const queues = new Map();
const floatingWindows = new Set();
let floatingWindowsHydrated = false;

chrome.storage.session.get(null).then((items) => {
  for (const key of Object.keys(items ?? {})) {
    if (!key.startsWith(FLOATING_WINDOW_PREFIX)) continue;
    const windowId = Number(key.slice(FLOATING_WINDOW_PREFIX.length));
    if (Number.isInteger(windowId)) floatingWindows.add(windowId);
  }
  floatingWindowsHydrated = true;
}).catch(() => { floatingWindowsHydrated = true; });

function serial(key, action) {
  const next = (queues.get(key) ?? Promise.resolve()).then(action, action);
  queues.set(key, next);
  next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  }).catch(() => undefined);
  return next;
}

const serialWindow = (windowId, action) => serial('window:' + windowId, action);

function popoutBounds(value) {
  if (!value || typeof value !== 'object') return DEFAULT_POPOUT_BOUNDS;
  const bounds = {};
  if (Number.isInteger(value.width) && value.width >= 320 && value.width <= 1200) bounds.width = value.width;
  if (Number.isInteger(value.height) && value.height >= 420 && value.height <= 1200) bounds.height = value.height;
  if (Number.isInteger(value.left)) bounds.left = value.left;
  if (Number.isInteger(value.top)) bounds.top = value.top;
  return { ...DEFAULT_POPOUT_BOUNDS, ...bounds };
}

function validFloatingBounds(value) {
  if (!value || typeof value !== 'object') return null;
  const fields = [value.left, value.top, value.width, value.height];
  if (!fields.every(Number.isFinite)) return null;
  if (value.width < 280 || value.width > 1600 || value.height < 320 || value.height > 1600) return null;
  return {
    left: Math.round(value.left),
    top: Math.round(value.top),
    width: Math.round(value.width),
    height: Math.round(value.height),
  };
}

function validAppearance(value) {
  return value
    && typeof value === 'object'
    && Object.keys(value).length === 2
    && (value.theme === 'light' || value.theme === 'dark')
    && (value.accent === null || (typeof value.accent === 'string' && /^#[\da-f]{6}$/i.test(value.accent)));
}

function tabUrl(tab) {
  if (typeof tab?.url === 'string' && tab.url) return tab.url;
  if (typeof tab?.pendingUrl === 'string' && tab.pendingUrl) return tab.pendingUrl;
  return '';
}

function isNormalWebUrl(url) {
  return /^https?:\/\//i.test(url);
}

function isRestrictedInjectionError(error) {
  const detail = error instanceof Error ? error.message : String(error ?? '');
  return /Cannot access a chrome:\/\/ URL|Cannot access contents of url ['"]?chrome:\/\/|cannot be scripted|extensions gallery/i.test(detail);
}

async function getFloatingWindowSession(windowId) {
  const key = floatingWindowKeyFor(windowId);
  const stored = await chrome.storage.session.get(key);
  return stored[key] ?? null;
}

async function saveFloatingWindowSession(session) {
  floatingWindows.add(session.windowId);
  await chrome.storage.session.set({ [floatingWindowKeyFor(session.windowId)]: session });
  return session;
}

async function removeFloatingWindowSession(windowId) {
  floatingWindows.delete(windowId);
  await chrome.storage.session.remove(floatingWindowKeyFor(windowId));
}

async function getOverlayRecord(tabId) {
  const key = overlayKeyFor(tabId);
  const stored = await chrome.storage.session.get(key);
  return stored[key] ?? null;
}

async function clearOverlayRecord(tabId) {
  await chrome.storage.session.remove(overlayKeyFor(tabId));
}

async function removeOverlayFromTab(tabId) {
  const record = await getOverlayRecord(tabId);
  if (record?.topDocumentId && typeof record.nonce === 'string') {
    await chrome.tabs.sendMessage(
      tabId,
      { type: 'sprintx:remove-overlay', nonce: record.nonce },
      { documentId: record.topDocumentId },
    ).catch(() => undefined);
  } else {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: () => Boolean(globalThis.__sprintxOverlay?.removeExisting?.()),
    }).catch(() => undefined);
  }
  await clearOverlayRecord(tabId);
}

async function suspendFloatingWindowSession(session, targetTabId, reason) {
  session.activeTabId = null;
  session.targetTabId = Number.isInteger(targetTabId) ? targetTabId : null;
  session.suspended = true;
  if (reason) session.lastSuspendedReason = reason;
  else delete session.lastSuspendedReason;
  return saveFloatingWindowSession(session);
}

async function injectOverlayIntoTab(session, tab) {
  const tabId = tab.id;
  if (!Number.isInteger(tabId) || tab.windowId !== session.windowId) {
    return { ok: false, error: 'The selected tab is no longer in the floating SprintX window.' };
  }

  const url = tabUrl(tab);
  if (url && !isNormalWebUrl(url)) {
    await suspendFloatingWindowSession(session, tabId, 'restricted-page');
    return { ok: true, suspended: true, tabId };
  }

  const target = { tabId, frameIds: [0] };
  let existing;
  try {
    existing = await chrome.scripting.executeScript({
      target,
      func: (expectedVersion, bounds) => {
        const overlay = globalThis.__sprintxOverlay;
        if (overlay?.version === expectedVersion && typeof overlay.showExisting === 'function') {
          return Boolean(overlay.showExisting(bounds));
        }
        if (overlay) {
          if (typeof overlay.removeExisting === 'function') overlay.removeExisting();
          else {
            document.querySelector('[data-sprintx-host]')?.remove();
            try { delete globalThis.__sprintxOverlay; }
            catch { globalThis.__sprintxOverlay = undefined; }
          }
        }
        return false;
      },
      args: [OVERLAY_VERSION, session.bounds ?? null],
    });
  } catch (error) {
    if (isRestrictedInjectionError(error)) {
      await suspendFloatingWindowSession(session, tabId, 'restricted-page');
      return { ok: true, suspended: true, tabId };
    }
    return {
      ok: false,
      error: 'SprintX floating mode failed during page access check'
        + (url ? ' on ' + url.split('#')[0] : '')
        + ': ' + (error instanceof Error ? error.message : String(error ?? 'unknown error')),
    };
  }

  if (existing?.[0]?.result === true) {
    session.activeTabId = tabId;
    session.targetTabId = tabId;
    session.suspended = false;
    delete session.lastSuspendedReason;
    await saveFloatingWindowSession(session);
    return { ok: true, suspended: false, tabId };
  }

  let injected;
  try {
    injected = await chrome.scripting.executeScript({ target, files: ['overlay.js'] });
  } catch (error) {
    if (isRestrictedInjectionError(error)) {
      await suspendFloatingWindowSession(session, tabId, 'restricted-page');
      return { ok: true, suspended: true, tabId };
    }
    return {
      ok: false,
      error: 'SprintX floating mode failed during overlay injection'
        + (url ? ' on ' + url.split('#')[0] : '')
        + ': ' + (error instanceof Error ? error.message : String(error ?? 'unknown error')),
    };
  }

  const topDocument = injected?.find((result) => result.frameId === 0);
  if (!topDocument?.documentId) {
    return {
      ok: false,
      error: 'SprintX overlay injected but Chrome did not return the top document id'
        + (url ? ' for ' + url.split('#')[0] : '') + '.',
    };
  }

  let sampled;
  try {
    sampled = await chrome.scripting.executeScript({
      target,
      func: () => globalThis.__sprintxOverlay?.sampleAppearance?.() ?? { theme: 'light', accent: null },
    });
  } catch (error) {
    return {
      ok: false,
      error: 'SprintX floating mode failed during appearance sampling'
        + (url ? ' on ' + url.split('#')[0] : '')
        + ': ' + (error instanceof Error ? error.message : String(error ?? 'unknown error')),
    };
  }

  const appearance = validAppearance(sampled?.[0]?.result)
    ? sampled[0].result
    : { theme: 'light', accent: null };
  const nonce = crypto.randomUUID();

  await chrome.storage.session.set({
    [overlayKeyFor(tabId)]: {
      nonce,
      windowId: session.windowId,
      topDocumentId: topDocument.documentId,
      expiresAt: Date.now() + 30000,
      appearance,
    },
  });

  try {
    await chrome.scripting.executeScript({
      target,
      func: (value, bounds) => globalThis.__sprintxOverlay?.invoke?.(value, bounds),
      args: [nonce, session.bounds ?? null],
    });
  } catch (error) {
    await clearOverlayRecord(tabId);
    return {
      ok: false,
      error: 'SprintX floating mode failed during overlay mount'
        + (url ? ' on ' + url.split('#')[0] : '')
        + ': ' + (error instanceof Error ? error.message : String(error ?? 'unknown error')),
    };
  }

  session.activeTabId = tabId;
  session.targetTabId = tabId;
  session.suspended = false;
  delete session.lastSuspendedReason;
  await saveFloatingWindowSession(session);
  return { ok: true, suspended: false, tabId };
}

async function reconcileFloatingWindow(windowId, targetTabId, options = {}) {
  const session = await getFloatingWindowSession(windowId);
  if (!session) return { ok: false, inactive: true };

  if (Number.isInteger(session.activeTabId)
      && session.activeTabId !== targetTabId) {
    await removeOverlayFromTab(session.activeTabId);
    session.activeTabId = null;
  }

  const tab = await chrome.tabs.get(targetTabId).catch(() => undefined);
  if (!tab || tab.windowId !== windowId) {
    await suspendFloatingWindowSession(session, targetTabId, 'tab-unavailable');
    return { ok: true, suspended: true, tabId: targetTabId };
  }

  if (!options.force
      && session.activeTabId === targetTabId
      && session.suspended === false) {
    return injectOverlayIntoTab(session, tab);
  }

  const result = await injectOverlayIntoTab(session, tab);
  if (!result.ok && options.silentFailure) {
    await suspendFloatingWindowSession(session, targetTabId, 'transfer-failed');
    session.lastTransferError = result.error;
    await saveFloatingWindowSession(session);
    return { ok: true, suspended: true, tabId: targetTabId };
  }
  return result;
}

async function startFloatingWindowSession(windowId, sourceTabId) {
  const previous = await getFloatingWindowSession(windowId);
  if (Number.isInteger(previous?.activeTabId)) {
    await removeOverlayFromTab(previous.activeTabId);
  }

  const session = {
    windowId,
    activeTabId: null,
    targetTabId: sourceTabId,
    suspended: true,
    startedAt: previous?.startedAt ?? Date.now(),
    bounds: validFloatingBounds(previous?.bounds),
  };
  await saveFloatingWindowSession(session);

  const result = await reconcileFloatingWindow(windowId, sourceTabId, { force: true });
  if (!result.ok) {
    await removeFloatingWindowSession(windowId);
    return result;
  }
  return {
    ok: true,
    suspended: Boolean(result.suspended),
    tabId: sourceTabId,
    windowId,
  };
}

async function stopFloatingWindowSession(windowId) {
  const session = await getFloatingWindowSession(windowId);
  if (!session) return null;
  if (Number.isInteger(session.activeTabId)) {
    await removeOverlayFromTab(session.activeTabId);
  }
  await removeFloatingWindowSession(windowId);
  return session;
}

async function openPopout(sourceWindowId) {
  const source = await chrome.windows.get(sourceWindowId).catch(() => undefined);
  if (!source || source.type !== 'normal') return { ok: false };

  const active = (await chrome.storage.session.get(POPOUT_SESSION_KEY))[POPOUT_SESSION_KEY];
  if (Number.isInteger(active?.popupWindowId)) {
    try {
      await chrome.windows.update(active.popupWindowId, { focused: true });
      return { ok: true };
    } catch {
      await chrome.storage.session.remove(POPOUT_SESSION_KEY);
    }
  }

  const saved = (await chrome.storage.local.get(POPOUT_BOUNDS_KEY))[POPOUT_BOUNDS_KEY];
  const popup = await chrome.windows.create({
    url: chrome.runtime.getURL('index.html?popout=1&sourceWindowId=' + sourceWindowId),
    type: 'popup',
    focused: true,
    ...popoutBounds(saved),
  });
  if (!Number.isInteger(popup?.id)) return { ok: false, detached: false };

  await chrome.storage.session.set({
    [POPOUT_SESSION_KEY]: { popupWindowId: popup.id, sourceWindowId },
  });
  return { ok: true };
}

const trustedWindow = () => chrome.windows.create({
  url: chrome.runtime.getURL('index.html?fallback=1'),
  type: 'popup',
  width: 460,
  height: 720,
});

const frameURL = (nonce) => chrome.runtime.getURL('index.html?overlay=' + encodeURIComponent(nonce));

async function liveFrame(record, sender) {
  if (!record
      || sender.id !== chrome.runtime.id
      || !sender.tab
      || !Number.isInteger(sender.tab.id)
      || sender.frameId <= 0
      || !sender.documentId) return false;
  if (sender.url !== frameURL(record.nonce)) return false;
  const top = await chrome.webNavigation.getFrame({
    tabId: sender.tab.id,
    frameId: 0,
  }).catch(() => undefined);
  return top?.documentId === record.topDocumentId;
}

async function handleMessage(message, sender) {
  if (!message || sender.id !== chrome.runtime.id) return { authorized: false };

  if (message.type === 'sprintx:trusted-window'
      && !sender.tab
      && sender.url?.startsWith(chrome.runtime.getURL('index.html'))) {
    await trustedWindow();
    return { ok: true };
  }

  if (message.type === 'sprintx:pop-out'
      && Object.keys(message).length === 2
      && Number.isInteger(message.sourceWindowId)
      && sender.url === chrome.runtime.getURL('index.html')) {
    return openPopout(message.sourceWindowId);
  }

  if (message.type === 'sprintx:float-over-page'
      && Object.keys(message).length === 3
      && Number.isInteger(message.sourceWindowId)
      && Number.isInteger(message.sourceTabId)
      && sender.url === chrome.runtime.getURL('index.html')) {
    return serialWindow(
      message.sourceWindowId,
      () => startFloatingWindowSession(message.sourceWindowId, message.sourceTabId),
    );
  }

  if (!sender.tab || !Number.isInteger(sender.tab.id)) return { authorized: false };

  const record = await getOverlayRecord(sender.tab.id);
  if (message.type === 'sprintx:authorize') {
    if (Object.keys(message).length !== 2
        || message.nonce !== record?.nonce
        || !(await liveFrame(record, sender))) return { authorized: false };

    if (record.frameDocumentId
        ? record.frameDocumentId !== sender.documentId || record.frameId !== sender.frameId
        : record.expiresAt < Date.now()) return { authorized: false };

    record.frameId = sender.frameId;
    record.frameDocumentId = sender.documentId;
    await chrome.storage.session.set({ [overlayKeyFor(sender.tab.id)]: record });
    return { authorized: true, appearance: record.appearance };
  }

  if (sender.frameId === 0
      && sender.documentId === record?.topDocumentId
      && message.nonce === record.nonce) {
    if (message.type === 'sprintx:close' && Object.keys(message).length === 2) {
      await serialWindow(record.windowId, () => stopFloatingWindowSession(record.windowId));
      return { ok: true };
    }

    if (message.type === 'sprintx:overlay-bounds'
        && Object.keys(message).length === 3) {
      const bounds = validFloatingBounds(message.bounds);
      if (!bounds) return { ok: false };
      const session = await getFloatingWindowSession(record.windowId);
      if (!session || session.activeTabId !== sender.tab.id) return { ok: false };
      session.bounds = bounds;
      await saveFloatingWindowSession(session);
      return { ok: true };
    }

    if (message.type === 'sprintx:trusted-window'
        && Object.keys(message).length === 1) {
      await trustedWindow();
      return { ok: true };
    }
  }

  if (record?.frameDocumentId === sender.documentId
      && record.frameId === sender.frameId
      && await liveFrame(record, sender)) {
    if (message.type === 'sprintx:trusted-window'
        && Object.keys(message).length === 1) {
      await trustedWindow();
      return { ok: true };
    }

    if (message.type === 'sprintx:apply-appearance'
        && Object.keys(message).length === 3
        && validAppearance({ theme: message.theme, accent: message.accent })) {
      await chrome.tabs.sendMessage(
        sender.tab.id,
        { type: message.type, theme: message.theme, accent: message.accent },
        { documentId: record.topDocumentId },
      );
      return { ok: true };
    }
  }

  return { ok: false };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'sprintx:attach-overlay'
      && sender.id === chrome.runtime.id
      && sender.tab
      && Number.isInteger(sender.tab.windowId)
      && sender.frameId === 0
      && typeof message.nonce === 'string'
      && Object.keys(message).length === 2) {
    const windowId = sender.tab.windowId;
    const open = chrome.sidePanel.open({ windowId });
    open.then(
      () => {
        respond({ ok: true });
        void serialWindow(windowId, () => stopFloatingWindowSession(windowId));
      },
      () => respond({ ok: false, error: 'SprintX could not attach to the browser side panel.' }),
    );
    return true;
  }

  serial(sender.tab?.id ?? 'trusted', () => handleMessage(message, sender))
    .then(respond, () => respond({ authorized: false, ok: false }));
  return true;
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  void serialWindow(windowId, async () => {
    const session = await getFloatingWindowSession(windowId);
    if (!session) return;
    await reconcileFloatingWindow(windowId, tabId, { force: true, silentFailure: true });
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active || !Number.isInteger(tab.windowId)) return;
  if (!changeInfo.url && changeInfo.status !== 'loading') return;

  void serialWindow(tab.windowId, async () => {
    const session = await getFloatingWindowSession(tab.windowId);
    if (!session) return;
    await reconcileFloatingWindow(tab.windowId, tabId, { force: true, silentFailure: true });
  });
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  void clearOverlayRecord(tabId);
  if (!Number.isInteger(removeInfo?.windowId)) return;
  void serialWindow(removeInfo.windowId, async () => {
    const session = await getFloatingWindowSession(removeInfo.windowId);
    if (!session || session.activeTabId !== tabId) return;
    await suspendFloatingWindowSession(session, null, 'tab-closed');
  });
});

chrome.action.onClicked.addListener((tab) => {
  if (!Number.isInteger(tab?.windowId)) return;
  const windowId = tab.windowId;

  const restoreFloating = () => {
    if (!Number.isInteger(tab.id)) return;
    void serialWindow(
      windowId,
      () => reconcileFloatingWindow(windowId, tab.id, { force: false, silentFailure: true }),
    );
  };

  if (floatingWindows.has(windowId)) {
    restoreFloating();
    return;
  }

  if (!floatingWindowsHydrated) {
    void getFloatingWindowSession(windowId).then((session) => {
      if (session) {
        floatingWindows.add(windowId);
        restoreFloating();
        return;
      }
      return chrome.sidePanel.open({ windowId });
    }).catch(() => undefined);
    return;
  }

  chrome.sidePanel.open({ windowId }).catch(() => undefined);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'sprintx-sidebar',
    title: 'Open SprintX in sidebar',
    contexts: ['action'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'sprintx-sidebar' || !Number.isInteger(tab?.windowId)) return;
  const windowId = tab.windowId;
  const open = chrome.sidePanel.open({ windowId });
  open.then(
    () => void serialWindow(windowId, () => stopFloatingWindowSession(windowId)),
    () => trustedWindow(),
  );
});

chrome.windows.onBoundsChanged.addListener(async (window) => {
  const active = (await chrome.storage.session.get(POPOUT_SESSION_KEY))[POPOUT_SESSION_KEY];
  if (window.id !== active?.popupWindowId || window.state !== 'normal') return;
  if (![window.width, window.height, window.left, window.top].every(Number.isInteger)) return;
  await chrome.storage.local.set({
    [POPOUT_BOUNDS_KEY]: {
      width: window.width,
      height: window.height,
      left: window.left,
      top: window.top,
    },
  });
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  floatingWindows.delete(windowId);
  await chrome.storage.session.remove(floatingWindowKeyFor(windowId));

  const active = (await chrome.storage.session.get(POPOUT_SESSION_KEY))[POPOUT_SESSION_KEY];
  if (windowId === active?.popupWindowId) {
    await chrome.storage.session.remove(POPOUT_SESSION_KEY);
  }
});
