# SprintX Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a floating, modern extension and reliable evidence-backed case-study intelligence.

**Architecture:** The page host handles presentation only; authenticated work stays in the extension origin. Structured facts are versioned source metadata derived from indexed chunks, separate from embeddings.

**Tech Stack:** React, TypeScript, Chrome MV3, Express, Supabase, pgvector, Gemini.

**Spec:** docs/superpowers/specs/2026-09-16-sprintx-command-design.md

## Global Constraints

- Preserve account isolation and encrypted personal-key handling.
- No persistent all-sites host permission or automatically registered content script is added.
- Never expose API keys, authentication tokens, conversations or user inputs through content-script messages or page DOM.
- Case-study classification uses the Case Studies folder, not filenames.
- No automatic web browsing is introduced.
- Preserve unrelated user files. Live Chrome and production checks must be reported separately from local builds.

### Task 1: Floating presentation host

**Files:** extension/public/background.js, extension/public/manifest.json, extension/public/overlay.js, extension/src/appearance.ts, extension/tests/overlay.test.ts, extension/tests/appearance.test.ts.

**Interfaces:** A toolbar click invokes an isolated script on the active tab. Presentation messages contain only type, theme and validated accent; no credentials or content. The existing index.html is shared. Decide the safest frame authorization method before exposing it: use a background-issued per-tab nonce tied to the sender frame/tab, reject direct external embeddings, and show no account content until authorization succeeds. Use trusted extension window sign-in when framed identity is unavailable. Build output resources must be accessible to the authorized frame without exposing backend secrets.

- [ ] RED: Test the real overlay mount twice (one host), minimize without iframe unload, restore, close cleanup, drag clamping, and rejected malformed appearance values. Test background invocation and restricted-page fallback through fake Chrome API boundaries, exercising the actual controller.
- [ ] GREEN: Add activeTab and scripting permissions and narrow web-accessible resources (resources are not host permissions). Retain direct sidebar access through a user-gesture context-menu or command. On asynchronous injection failure show a trusted actionable extension window rather than trying a late sidePanel.open gesture. Use a shadow-root host with a draggable glass shell, minimize/restore/close controls, viewport clamping and cleanup. Prefer no page-to-frame postMessage privilege bridge; use extension runtime transport validated by background.
- [ ] Verify: npm run extension:test and npm run extension:build; commit only task files, write report with RED/GREEN evidence and unresolved live-Chrome checks.

### Task 2: Command workspace UX

**Files:** extension/src/App.tsx, extension/src/styles.css, extension/src/components/AnswerContent.tsx, extension/src/components/Sources.tsx, extension/src/components/AppearanceSettings.tsx, extension/tests/workspace.test.tsx; modify existing tests only for intentional user-visible changes.

**Interfaces:** Keep existing API response shapes and authentication flow. Consume Task 1 presentation transport for theme only. Group citations with their original 1-based source indices. Refine sets question, Use in Draft sets mode/context; neither auto-sends.

Visual verification uses a development-only Vite preview under extension/tests/preview/ with explicit mock auth/API module aliases and a visible synthetic-data banner. It is excluded from production entrypoints and makes no real API/provider calls. Share a local invocation command and fixture URL so the coordinator can inspect the actual workspace in the connected in-app browser; this is not evidence of unpacked Chrome behavior.

- [ ] RED: Render real components and verify grouped duplicate citations retain source numbers, javascript URLs are never linked, raw HTML is text, mutually exclusive secondary views, input survives failed request, and masked-key state clears on settings exit. Extend account/session tests rather than replace them.
- [ ] GREEN: Use graphite/warm-white design tokens, teal accent, system themes, restrained glass surfaces, keyboard-visible focus, reduced motion and responsive layout. Replace duplicate result/transcript presentation with one timeline and anchored composer; keep all messages and evidence accessible. Add suggested prompts, copy success/failure feedback, Refine and Use in Draft actions with explicit bounded-context feedback. Make History/Settings/Admin mutually exclusive secondary views, retain their full functionality and busy protections. No new styling dependency is required.
- [ ] Verify: npm run extension:test, npm run extension:build, inspect actual light/dark/narrow rendering and keyboard navigation; commit task files and report evidence.

### Task 3: Versioned grounded facts and advice routing

**Files:** src/lib/case-study-facts.ts, src/lib/vector-store.ts, src/lib/ask-service.ts, src/lib/ingest.ts, src/server.ts, extension/src/api.ts, extension/src/App.tsx, test/case-study-facts.test.ts, README.md.

**Interfaces:** Store facts in source metadata with content hash, extractor version, evidence quotes/chunk IDs and current/stale status. Add getSourceChunks(sourceId) to both vector stores returning actual indexed chunks without embedding calls. Admin-only POST /api/kb/facts-sync performs bounded extraction and reuses valid cached facts. Ask deterministic structured queries consume only current valid facts and report coverage. General advice is explicitly requested/labelled and never promoted to SprintX evidence.

Save facts using atomic patchSourceMetadata(id, patch) in both stores, not a stale addSource snapshot. Keep the primitive metadata contract with validated facts serialized as JSON strings. Recheck indexed state and fingerprint before saving; preserve concurrent ingestion flags, titles and other metadata.

- [ ] RED: Test facts validation rejects invented quotes/chunk IDs, hash invalidation after changed content, zero extraction for unchanged sources, bounded batches/resume, partial failure preserves prior data without including stale facts, folder selection, technology-filter/comparison answers and labelled general advice. Use real MemoryVectorStore and PGlite storage for persistence boundary checks.
- [ ] GREEN: Extract at most a small bounded number of sources per admin request with provider timeout; validate each field's evidence against indexed chunk text before saving. Unknowns stay unknown, no embeddings are regenerated. Fingerprints cover all source chunk content; only current hash/version records answer filters/counts/comparisons. Explain partial coverage rather than infer global absence. Add admin UI progress and cancellation with account guards, preserve inventory/named retrieval routing. Preserve generated paragraph formatting and do not render unsafe HTML.
- [ ] Verify: npm test, npm run extension:test, npm run extension:build, git diff --check. Document facts-only refresh and extension reload. Report production migration and provider invocation as pending unless actually verified.

### Task 4: Security and whole-flow review

**Files:** Review all task diffs; README.md release notes.

- [ ] Independent reviewer checks full change against approved spec, especially external iframe embedding, Chrome user gestures, source coverage and state isolation.
- [ ] Fix Important/Critical findings with focused regression tests, rerun affected checks, obtain scoped re-review.
- [ ] Report delivered features, local verification, exact pending Chrome/production checks and any explicitly deferred requirement. Do not push or publish without current authorization.
