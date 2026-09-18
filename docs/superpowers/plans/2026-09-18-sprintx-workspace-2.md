# SprintX Workspace 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved SprintX Workspace 2.0 light-first redesign, including the SX Spark identity and local favicon/extension icons, without changing existing API, auth, conversation, retrieval, Draft, evidence, or admin behavior.

**Architecture:** Keep `SessionWorkspace` as the state/handler owner and make the redesign presentation-led. Reuse the verified composer-collapse/scrolling behavior, change appearance defaults through the existing preference hook, restyle the current semantic markup, and add only small local brand components/assets. No backend or state-management rewrite is part of this change.

**Tech Stack:** React, TypeScript, CSS, Chrome Manifest V3, Vitest, Testing Library, Vite.

**Spec:** `docs/superpowers/specs/2026-09-18-sprintx-workspace-2-design.md`

## Global Constraints

- Light theme is the default when no appearance preference has been saved.
- Dark and System/Auto remain selectable in Settings.
- No Google Fonts, Material Symbols, remote icon fonts, or new CDN dependencies.
- Preserve the verified composer collapse behavior and Draft internal scrolling.
- Preserve all existing API contracts and backend behavior.
- Preserve auth/session isolation, role gating, conversation persistence, evidence safety, and admin operations.
- Do not expose unsupported model, voice, upload, screenshot, page-element, Insights, Library, or insert-into-page features.
- Native Chrome Side Panel remains the primary presentation.

---

### Task 1: Lock light-first appearance behavior with tests

**Files:**
- Modify: `extension/tests/workspace.test.tsx`
- Modify: `extension/src/components/AppearanceSettings.tsx`

**Interfaces:**
- Consumes: existing `useAppearance()` return shape.
- Produces: default preferences `{ theme: 'light', adaptiveAccent: false }` when storage is empty or invalid.

- [ ] **Step 1: Add a regression test**

Add a test that clears local storage, renders `AppearanceSettings`, and asserts Theme is `light` and `document.documentElement.dataset.theme` becomes `light`.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm run extension:test -- --run tests/workspace.test.tsx
```

Expected before implementation: the selector resolves to `auto`.

- [ ] **Step 3: Change the fallback preference**

Change `readPreferences()` so invalid/missing storage returns:

```ts
return { theme: 'light', adaptiveAccent: false };
```

Reorder Theme options to Light, Dark, System / Auto.

- [ ] **Step 4: Run the workspace tests**

Run:

```bash
npm run extension:test
```

Expected: all extension tests pass.

- [ ] **Step 5: Commit**

```bash
git add extension/tests/workspace.test.tsx extension/src/components/AppearanceSettings.tsx
git commit -m "feat(extension): make SprintX light-first"
```

### Task 2: Add SprintX SX Spark identity and browser assets

**Files:**
- Create: `extension/src/components/BrandMark.tsx`
- Create: `extension/public/brand/sprintx-mark.svg`
- Create: `extension/public/brand/icon-16.png`
- Create: `extension/public/brand/icon-32.png`
- Create: `extension/public/brand/icon-48.png`
- Create: `extension/public/brand/icon-128.png`
- Create: `extension/public/favicon.svg`
- Modify: `extension/public/manifest.json`
- Modify: `extension/index.html`

**Interfaces:**
- Produces: `BrandMark({ compact?: boolean })` for React surfaces.
- Produces: local icon files referenced by manifest and favicon.

- [ ] **Step 1: Add a simple local BrandMark component**

Create an inline SVG component with a rounded blue tile and a white SX/forward-motion path. Use `aria-hidden="true"` for the decorative SVG.

- [ ] **Step 2: Add local source SVG and raster icons**

Create the same mark as an SVG source, then generate PNGs at 16, 32, 48, and 128 px with transparent outer background and the rounded indigo tile.

- [ ] **Step 3: Wire manifest icons**

Add:

```json
"icons": {
  "16": "brand/icon-16.png",
  "32": "brand/icon-32.png",
  "48": "brand/icon-48.png",
  "128": "brand/icon-128.png"
}
```

and matching `action.default_icon` entries for 16 and 32.

- [ ] **Step 4: Wire favicon**

Add:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

to `extension/index.html`.

- [ ] **Step 5: Build**

Run:

```bash
npm run extension:build
```

Expected: Vite build succeeds and the favicon/brand files are copied into `extension/dist`.

- [ ] **Step 6: Commit**

```bash
git add extension/src/components/BrandMark.tsx extension/public/brand extension/public/favicon.svg extension/public/manifest.json extension/index.html
git commit -m "feat(extension): add SprintX brand identity"
```

### Task 3: Apply the Calm Workspace layout without changing handlers

**Files:**
- Modify: `extension/src/App.tsx`
- Modify: `extension/src/styles.css`

**Interfaces:**
- Consumes: all existing state and handlers in `SessionWorkspace`.
- Produces: same labels/roles used by tests, but new visual hierarchy.

- [ ] **Step 1: Replace the header brand markup**

Use `BrandMark` next to `SprintX` and a small `BD Assistant` descriptor. Keep Settings/Admin/Sign out actions and their handlers intact.

- [ ] **Step 2: Restyle the conversation bar and timeline**

Keep the existing conversation/history button and quick actions. Change assistant messages to open-canvas reading blocks and user messages to right-aligned subtle bubbles via CSS only.

- [ ] **Step 3: Restyle evidence and response actions**

Keep `Sources`, Copy, Refine, and Use in Draft behavior unchanged. Make actions compact pills and evidence a subtle disclosure card.

- [ ] **Step 4: Restyle the composer**

Retain:
- `composerExpanded`
- `pendingComposerFocus`
- Ask/Draft mode switching
- Ask mode selector
- Draft fieldset scroll boundary
- submit buttons
- collapse/expand control

Use a floating white/light surface with high radius, restrained shadow, and a compact collapsed state.

- [ ] **Step 5: Restyle secondary views**

Apply the same surface, spacing, field, and button system to History, Settings, and Admin without changing their control flow.

- [ ] **Step 6: Replace the old green/cream CSS tokens**

Use the semantic light and dark palettes from the spec. Keep `--adaptive-accent` available but prevent it from replacing the main brand button color.

- [ ] **Step 7: Run tests**

Run:

```bash
npm run extension:test
```

Expected: all extension tests pass.

- [ ] **Step 8: Commit**

```bash
git add extension/src/App.tsx extension/src/styles.css
git commit -m "feat(extension): apply SprintX Workspace 2 design"
```

### Task 4: Final verification and preview handoff

**Files:**
- Verify only.

**Interfaces:**
- Consumes: completed redesign branch.
- Produces: a branch the user can pull, build, and reload in Chrome.

- [ ] **Step 1: Run backend regression suite**

```bash
npm test
```

Expected: all existing server/runtime tests pass.

- [ ] **Step 2: Run extension regression suite**

```bash
npm run extension:test
```

Expected: all extension tests pass.

- [ ] **Step 3: Build production extension**

```bash
npm run extension:build
```

Expected: production assets compile successfully.

- [ ] **Step 4: Check whitespace/errors**

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Manual Chrome check**

Reload the unpacked extension and inspect:
- new toolbar icon/favicon,
- default light theme,
- dark mode through Settings,
- Ask collapse/expand,
- long Draft Additional Context scroll,
- Create Draft accessibility,
- Copy/Refine/Use in Draft,
- History,
- Settings,
- Admin,
- evidence disclosure.

- [ ] **Step 6: Push the branch**

```bash
git push -u origin design/workspace-2
```
