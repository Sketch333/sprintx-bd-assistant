// Executed in Chrome's isolated world only. There is deliberately no postMessage bridge.
(() => {
  if (globalThis.__sprintxOverlay) return;
  let mounted = null;
  function sampleAppearance() {
    const candidate = document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? '';
    const background = getComputedStyle(document.body ?? document.documentElement).backgroundColor;
    const channels = background.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
    const dark = channels ? Number(channels[1]) * .2126 + Number(channels[2]) * .7152 + Number(channels[3]) * .0722 < 128 : window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
    // Only validated theme-color, never page text. Blend toward teal for a restrained accent.
    const accent = /^#[\da-f]{6}$/i.test(candidate) ? '#' + [0x14, 0x9d, 0x91].map((base, index) => Math.round(base * .8 + parseInt(candidate.slice(1 + index * 2, 3 + index * 2), 16) * .2).toString(16).padStart(2, '0')).join('') : null;
    return { theme: dark ? 'dark' : 'light', accent };
  }
  function invoke(nonce) {
    if (mounted?.host.isConnected) { mounted.toggle(); return; }
    mounted?.close();
    if (typeof nonce !== 'string' || !nonce || nonce.length > 100) return;
    const host = document.createElement('div');
    host.setAttribute('data-sprintx-host', '');
    for (const [property, value] of Object.entries({ all: 'initial', position: 'fixed', inset: '0', width: '0', height: '0', 'z-index': '2147483647', display: 'block', visibility: 'visible', opacity: '1', 'pointer-events': 'none' })) host.style.setProperty(property, value, 'important');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `:host{color-scheme:light dark}*{box-sizing:border-box}section{position:fixed;width:min(420px,calc(100vw - 16px));height:min(700px,calc(100vh - 16px));display:flex;flex-direction:column;pointer-events:auto;border:1px solid #87bfbf55;border-radius:18px;overflow:hidden;background:#10202bea;box-shadow:0 14px 60px #0005;backdrop-filter:blur(20px);font:13px system-ui;color:#f0ffff}header{display:flex;align-items:center;gap:6px;padding:8px;min-height:42px;cursor:grab;touch-action:none}header span{flex:1;font-weight:700;padding-left:4px}button{font:inherit;cursor:pointer;border:1px solid #95bcbf55;background:#1c3943;color:#f0ffff;border-radius:8px;padding:6px}button:focus-visible{outline:2px solid #7ce5d6;outline-offset:-2px}iframe{width:100%;flex:1;border:0;background:transparent;min-height:0}iframe[hidden],button[hidden]{display:none}section.collapsed{width:180px;height:44px}section.collapsed header{cursor:default}@media(prefers-reduced-motion:no-preference){button{transition:background .15s}}`;
    // The sampled hue is decorative only; foreground and surfaces use fixed contrast pairs.
    style.textContent += `section{border-top:2px solid var(--page-accent,#149d91)}section[data-theme=light]{background:#f0f8f8ee;color:#102d37}section[data-theme=light] button{background:#e1efef;color:#102d37}`;
    const shell = document.createElement('section'); shell.setAttribute('aria-label', 'SprintX floating workspace');
    const header = document.createElement('header'); header.setAttribute('data-drag', '');
    const label = document.createElement('span'); label.textContent = 'SprintX'; header.append(label);
    const frame = document.createElement('iframe'); frame.title = 'SprintX BD Assistant';
    frame.referrerPolicy = 'no-referrer';
    const listeners = new AbortController();
    let collapsed = false, left = Math.max(8, window.innerWidth - 436), top = 16, drag = null;
    const button = (label, text, handler) => {
      const element = document.createElement('button'); element.type = 'button'; element.setAttribute('aria-label', label); element.textContent = text; element.addEventListener('click', handler, { signal: listeners.signal }); header.append(element); return element;
    };
    function clamp() {
      const width = collapsed ? Math.min(180, window.innerWidth - 16) : Math.min(420, window.innerWidth - 16);
      const height = collapsed ? 44 : Math.min(700, window.innerHeight - 16);
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
      shell.style.left = `${left}px`; shell.style.top = `${top}px`;
    }
    function toggle() { collapsed = !collapsed; shell.classList.toggle('collapsed', collapsed); frame.hidden = collapsed; minimize.hidden = collapsed; restore.hidden = !collapsed; fallback.hidden = collapsed; clamp(); (collapsed ? restore : minimize).focus(); }
    function close() { listeners.abort(); chrome.runtime.onMessage.removeListener(presentation); host.remove(); mounted = null; chrome.runtime.sendMessage({ type: 'sprintx:close', nonce }).catch(() => undefined); }
    function presentation(message, sender) {
      if (sender.id !== chrome.runtime.id || !message || message.type !== 'sprintx:apply-appearance' || Object.keys(message).length !== 3 || (message.theme !== 'light' && message.theme !== 'dark') || (message.accent !== null && !/^#[\da-f]{6}$/i.test(message.accent))) return;
      shell.dataset.theme = message.theme;
      if (message.accent === null) shell.style.removeProperty('--page-accent'); else shell.style.setProperty('--page-accent', message.accent);
    }
    chrome.runtime.onMessage.addListener(presentation);
    const fallback = button('Open SprintX trusted window', 'Window', () => chrome.runtime.sendMessage({ type: 'sprintx:trusted-window' }).catch(() => undefined));
    const minimize = button('Minimize SprintX', '−', toggle);
    const restore = button('Restore SprintX', 'Open', toggle); restore.hidden = true;
    button('Close SprintX', '×', close);
    header.addEventListener('pointerdown', (event) => { if (event.target.closest('button') || collapsed || event.button !== 0) return; drag = { x: event.clientX - left, y: event.clientY - top }; event.preventDefault(); }, { signal: listeners.signal });
    window.addEventListener('pointermove', (event) => { if (!drag) return; left = event.clientX - drag.x; top = event.clientY - drag.y; clamp(); }, { signal: listeners.signal });
    window.addEventListener('pointerup', () => { drag = null; }, { signal: listeners.signal });
    window.addEventListener('pointercancel', () => { drag = null; }, { signal: listeners.signal });
    window.addEventListener('resize', clamp, { signal: listeners.signal });
    header.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); }, { signal: listeners.signal });
    shell.append(header, frame); root.append(style, shell); document.documentElement.append(host);
    mounted = { host, toggle, close }; clamp();
    // Ordering: store appearance via private extension runtime before loading the frame.
    chrome.runtime.sendMessage({ type: 'sprintx:appearance', ...sampleAppearance() }).catch(() => undefined);
    frame.src = chrome.runtime.getURL(`index.html?overlay=${encodeURIComponent(nonce)}`);
  }
  globalThis.__sprintxOverlay = { invoke, toggleExisting() { if (!mounted?.host.isConnected) return false; mounted.toggle(); return true; } };
})();
