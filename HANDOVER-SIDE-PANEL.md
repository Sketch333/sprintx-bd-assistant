# Handover: Native Chrome Side Panel Migration

## User request

Replace the detached SprintX extension window with a friendlier native Chrome
Side Panel experience, using the supplied Gemini panel screenshots as visual
reference. The desired behavior is a docked panel beside the current webpage,
not a separate popup window.

## Work completed in this session

### Launch behavior

- `extension/public/background.js`
  - Chrome now owns toolbar launching through
    `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.
  - No asynchronous toolbar listener is used; this preserves Chrome's original
    user gesture and prevents an unintended popup fallback.
  - A trusted popup window remains available only through the explicit fallback
    message used by restricted/legacy surfaces.
  - The context-menu Side Panel action remains available.
- `extension/src/background.ts`
  - Side Panel behavior is configured with
    `openPanelOnActionClick: true`.
- `extension/public/manifest.json`
  - Already contains the required `sidePanel` permission and
    `side_panel.default_path: "index.html"`.

### Existing UI work preserved

- Markdown answers render safely as headings, paragraphs, bold/italic text,
  ordered lists, unordered lists, nested lists, and HTTPS links.
- Compact one-line Markdown responses are normalized into readable structure,
  including patterns such as `* **Consulting**`.
- Meaningful backend answer newlines are preserved.
- Answer spacing and list typography are defined in `extension/src/styles.css`.

### Tests changed

- `extension/tests/overlay.test.ts`
  - Updated the toolbar test to verify native Side Panel launch and popup
    fallback.
  - Removed tests for the old toolbar-driven overlay authorization lifecycle,
    because the toolbar no longer creates that overlay.
  - Standalone `public/overlay.js` behavior tests remain.
- `extension/tests/workspace.test.tsx`
  - Covers Markdown structure and compact list normalization.

## Validation completed

From the repository root:

- `npm run extension:test` — **42 tests passed**
- `npm run extension:build` — **passed**
- `git diff --check` — **passed**

## Important manual verification still needed

1. Run `npm run extension:build`.
2. Open `extension/dist` as an unpacked Chrome extension or reload the
   existing unpacked extension.
3. Click the SprintX toolbar icon on a normal `http`/`https` tab.
4. Confirm Chrome opens the native right-side panel and does not create a
   second popup window.
5. Confirm the panel remains available while switching tabs.
6. Test a restricted page such as `chrome://extensions`; if Chrome rejects
   the panel, confirm the trusted popup fallback is intentional and usable.
7. Verify sign-in, conversation restore, Ask, Draft, Sources, Settings, and
   Admin controls inside the native panel.

## Follow-up design work recommended

The current app content is functional in the Side Panel but still uses the
existing workspace layout. To align more closely with the reference images,
the next agent should consider:

- Dark panel-first visual treatment with a subtle ambient gradient.
- Compact top-right overflow and close controls where Chrome permits them.
- Branded welcome state with skeleton loading and suggestion chips.
- A bottom-docked composer with attach/context affordances.
- Side-panel-specific responsive width and reduced outer padding.
- Avoiding assumptions that the panel can control the host-page viewport;
  native Chrome Side Panel does not require page injection or viewport
  compression from the extension.

## Do not regress

- Do not restore automatic toolbar overlay injection.
- Do not expose service credentials or page content through the Side Panel.
- Keep `chrome.sidePanel.open` inside the toolbar/context-menu user gesture.
- Keep popup fallback only for genuine Side Panel failures or unsupported
  contexts.
- Preserve account isolation, safe Markdown rendering, and existing auth flow.
