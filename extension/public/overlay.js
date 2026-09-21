// Executed in Chrome's isolated world only. There is deliberately no postMessage bridge.
(() => {
  const VERSION = 'workspace-2-floating-v4';
  if (globalThis.__sprintxOverlay?.version === VERSION) return;

  let mounted = null;

  function sampleAppearance() {
    const background = getComputedStyle(document.body ?? document.documentElement).backgroundColor;
    const channels = background.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
    const dark = channels
      ? Number(channels[1]) * .2126 + Number(channels[2]) * .7152 + Number(channels[3]) * .0722 < 128
      : window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
    return { theme: dark ? 'dark' : 'light', accent: null };
  }

  function invoke(nonce, initialBounds) {
    if (mounted?.host.isConnected) {
      mounted.show(initialBounds);
      return;
    }
    mounted?.close();

    if (typeof nonce !== 'string' || !nonce || nonce.length > 100) return;

    const host = document.createElement('div');
    host.setAttribute('data-sprintx-host', '');
    for (const [property, value] of Object.entries({
      all: 'initial',
      position: 'fixed',
      inset: '0',
      width: '0',
      height: '0',
      'z-index': '2147483647',
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      'pointer-events': 'none',
    })) host.style.setProperty(property, value, 'important');

    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { color-scheme: light dark; }
      * { box-sizing: border-box; }
      .shell {
        --sx-bg: #ffffff;
        --sx-surface: #f8fafd;
        --sx-ink: #121b2e;
        --sx-muted: #59647a;
        --sx-line: #e5eaf3;
        --sx-accent: #384dbe;
        --sx-accent-soft: #eef1ff;
        position: fixed;
        width: min(430px, calc(100vw - 20px));
        height: min(720px, calc(100vh - 20px));
        min-width: min(300px, calc(100vw - 20px));
        min-height: min(420px, calc(100vh - 20px));
        max-width: calc(100vw - 20px);
        max-height: calc(100vh - 20px);
        display: flex;
        flex-direction: column;
        pointer-events: auto;
        overflow: hidden;
        resize: both;
        border: 1px solid var(--sx-line);
        border-radius: 18px;
        background: var(--sx-bg);
        color: var(--sx-ink);
        box-shadow: 0 18px 60px rgba(31, 44, 76, .22);
        font: 13px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .shell[data-theme="dark"] {
        --sx-bg: #131314;
        --sx-surface: #1e1f20;
        --sx-ink: #e3e3e3;
        --sx-muted: #c4c7c5;
        --sx-line: #34373c;
        --sx-accent: #8ab4f8;
        --sx-accent-soft: #243044;
        box-shadow: 0 18px 60px rgba(0, 0, 0, .38);
      }
      .bar {
        min-height: 42px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 7px 6px 9px;
        cursor: grab;
        touch-action: none;
        user-select: none;
        border-bottom: 1px solid var(--sx-line);
        background: color-mix(in srgb, var(--sx-bg) 94%, transparent);
      }
      .bar:active { cursor: grabbing; }
      .brand {
        min-width: 0;
        flex: 1;
        display: flex;
        align-items: center;
        gap: 7px;
        color: var(--sx-ink);
        font-weight: 750;
        letter-spacing: -.01em;
      }
      .mark {
        width: 26px;
        height: 26px;
        flex: 0 0 26px;
        border-radius: 8px;
        display: grid;
        place-items: center;
        background: var(--sx-accent);
        color: #fff;
        font-size: 10px;
        font-weight: 850;
        letter-spacing: -.04em;
      }
      .actions { display: flex; align-items: center; gap: 4px; }
      button {
        appearance: none;
        min-width: 30px;
        height: 30px;
        display: inline-grid;
        place-items: center;
        border: 1px solid var(--sx-line);
        border-radius: 9px;
        background: var(--sx-surface);
        color: var(--sx-muted);
        font: 650 12px/1 ui-sans-serif, system-ui, sans-serif;
        cursor: pointer;
      }
      button:hover { background: var(--sx-accent-soft); color: var(--sx-accent); }
      button:focus-visible { outline: 2px solid var(--sx-accent); outline-offset: 1px; }
      .attach { width: auto; padding: 0 10px; gap: 5px; grid-auto-flow: column; }
      iframe {
        width: 100%;
        flex: 1;
        min-height: 0;
        border: 0;
        background: var(--sx-bg);
      }
      iframe[hidden], button[hidden] { display: none; }
      .shell.collapsed {
        width: 176px !important;
        height: 42px !important;
        min-width: 0;
        min-height: 0;
        resize: none;
      }
      .shell.collapsed .bar { border-bottom: 0; cursor: default; }
      @media (max-width: 380px) {
        .shell { min-width: calc(100vw - 16px); }
        .attach-label { display: none; }
        .attach { width: 30px; padding: 0; }
      }
      @media (prefers-reduced-motion: no-preference) {
        button { transition: background-color .15s ease, color .15s ease, border-color .15s ease; }
      }
      @media (forced-colors: active) {
        .shell, button { border: 1px solid CanvasText; }
      }
    `;

    const shell = document.createElement('section');
    shell.className = 'shell';
    shell.setAttribute('aria-label', 'SprintX floating workspace');
    shell.dataset.theme = sampleAppearance().theme;

    const header = document.createElement('header');
    header.className = 'bar';
    header.setAttribute('data-drag', '');

    const brand = document.createElement('span');
    brand.className = 'brand';
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = 'SX';
    const label = document.createElement('span');
    label.textContent = 'SprintX';
    brand.append(mark, label);

    const actions = document.createElement('span');
    actions.className = 'actions';

    const frame = document.createElement('iframe');
    frame.title = 'SprintX BD Assistant';
    frame.referrerPolicy = 'no-referrer';

    const listeners = new AbortController();
    let collapsed = false;
    const validBounds = initialBounds && typeof initialBounds === 'object'
      && [initialBounds.left, initialBounds.top, initialBounds.width, initialBounds.height].every(Number.isFinite)
      ? initialBounds
      : null;
    let left = validBounds ? initialBounds.left : Math.max(10, window.innerWidth - 450);
    let top = validBounds ? initialBounds.top : 16;
    let drag = null;
    let boundsTimer = null;

    if (validBounds) {
      shell.style.width = `${initialBounds.width}px`;
      shell.style.height = `${initialBounds.height}px`;
    }

    const button = (ariaLabel, title, text, handler, className = '') => {
      const element = document.createElement('button');
      element.type = 'button';
      element.setAttribute('aria-label', ariaLabel);
      element.title = title;
      element.className = className;
      element.innerHTML = text;
      element.addEventListener('click', handler, { signal: listeners.signal });
      actions.append(element);
      return element;
    };

    function clamp() {
      const rect = shell.getBoundingClientRect();
      const width = collapsed
        ? Math.min(176, Math.max(0, window.innerWidth - 20))
        : Math.min(Math.max(rect.width || 430, 280), Math.max(280, window.innerWidth - 20));
      const height = collapsed
        ? 42
        : Math.min(Math.max(rect.height || 720, 320), Math.max(320, window.innerHeight - 20));

      if (!collapsed) {
        shell.style.width = `${width}px`;
        shell.style.height = `${height}px`;
      }
      left = Math.max(10, Math.min(left, window.innerWidth - width - 10));
      top = Math.max(10, Math.min(top, window.innerHeight - height - 10));
      shell.style.left = `${left}px`;
      shell.style.top = `${top}px`;
    }

    function snapshotBounds() {
      const rect = shell.getBoundingClientRect();
      return {
        left: Math.round(left),
        top: Math.round(top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }

    function publishBounds() {
      if (collapsed || !host.isConnected) return;
      const bounds = snapshotBounds();
      chrome.runtime.sendMessage({ type: 'sprintx:overlay-bounds', nonce, bounds }).catch(() => undefined);
    }

    function scheduleBounds() {
      if (collapsed) return;
      if (boundsTimer) clearTimeout(boundsTimer);
      boundsTimer = setTimeout(() => {
        boundsTimer = null;
        publishBounds();
      }, 120);
    }

    function endDrag(event) {
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      const pointerId = drag.pointerId;
      drag = null;
      if (header.hasPointerCapture?.(pointerId)) header.releasePointerCapture(pointerId);
      publishBounds();
    }

    function toggle() {
      endDrag();
      collapsed = !collapsed;
      shell.classList.toggle('collapsed', collapsed);
      frame.hidden = collapsed;
      minimize.hidden = collapsed;
      restore.hidden = !collapsed;
      attach.hidden = collapsed;
      clamp();
      (collapsed ? restore : minimize).focus();
    }

    let resizeObserver = null;

    function close(notify = true) {
      endDrag();
      if (boundsTimer) clearTimeout(boundsTimer);
      boundsTimer = null;
      resizeObserver?.disconnect();
      listeners.abort();
      chrome.runtime.onMessage.removeListener(presentation);
      host.remove();
      mounted = null;
      if (notify) chrome.runtime.sendMessage({ type: 'sprintx:close', nonce }).catch(() => undefined);
    }

    function presentation(message, sender) {
      if (sender.id !== chrome.runtime.id || !message) return;
      if (message.type === 'sprintx:remove-overlay' && message.nonce === nonce) {
        close(false);
        return;
      }
      if (
        message.type !== 'sprintx:apply-appearance'
        || Object.keys(message).length !== 3
        || (message.theme !== 'light' && message.theme !== 'dark')
        || (message.accent !== null && (typeof message.accent !== 'string' || !/^#[\da-f]{6}$/i.test(message.accent)))
      ) return;
      shell.dataset.theme = message.theme;
    }

    chrome.runtime.onMessage.addListener(presentation);

    const attach = button(
      'Attach SprintX to browser',
      'Attach to browser side panel',
      '<span aria-hidden="true">↙</span><span class="attach-label">Attach</span>',
      () => {
        chrome.runtime.sendMessage({ type: 'sprintx:attach-overlay', nonce }).then((response) => {
          if (response?.ok === true) close(false);
        }).catch(() => undefined);
      },
      'attach',
    );
    const minimize = button('Minimize SprintX', 'Minimize', '−', toggle);
    const restore = button('Restore SprintX', 'Restore', '□', toggle);
    restore.hidden = true;
    button('Close SprintX', 'Close', '×', () => close(true));

    header.append(brand, actions);

    header.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button') || collapsed || event.button !== 0 || drag) return;
      drag = { pointerId: event.pointerId, x: event.clientX - left, y: event.clientY - top };
      try {
        header.setPointerCapture?.(event.pointerId);
      } catch {
        drag = null;
        return;
      }
      event.preventDefault();
    }, { signal: listeners.signal });

    window.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      left = event.clientX - drag.x;
      top = event.clientY - drag.y;
      clamp();
    }, { signal: listeners.signal });
    window.addEventListener('pointerup', endDrag, { signal: listeners.signal });
    window.addEventListener('pointercancel', endDrag, { signal: listeners.signal });
    header.addEventListener('lostpointercapture', (event) => {
      if (drag?.pointerId === event.pointerId) drag = null;
    }, { signal: listeners.signal });
    window.addEventListener('resize', clamp, { signal: listeners.signal });
    header.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    }, { signal: listeners.signal });

    shell.append(header, frame);
    root.append(style, shell);
    document.documentElement.append(host);

    resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { clamp(); scheduleBounds(); }) : null;
    resizeObserver?.observe(shell);

    function show(bounds) {
      if (bounds && typeof bounds === 'object'
          && [bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite)) {
        left = bounds.left;
        top = bounds.top;
        shell.style.width = `${bounds.width}px`;
        shell.style.height = `${bounds.height}px`;
      }
      if (collapsed) toggle();
      else clamp();
    }

    mounted = { host, toggle, close, show };
    clamp();
    frame.src = chrome.runtime.getURL(`index.html?overlay=${encodeURIComponent(nonce)}`);
  }

  globalThis.__sprintxOverlay = {
    version: VERSION,
    invoke,
    sampleAppearance,
    toggleExisting() {
      if (!mounted?.host.isConnected) return false;
      mounted.toggle();
      return true;
    },
    showExisting(bounds) {
      if (!mounted?.host.isConnected) return false;
      mounted.show(bounds);
      return true;
    },
    removeExisting() {
      if (!mounted?.host.isConnected) return false;
      mounted.close(false);
      return true;
    },
  };
})();
