# SprintX Workspace 2.0 — Design Specification

Date: 2026-09-18  
Status: Approved design direction; implementation not started  
Branch baseline: `fix/extension-composer-ux`

## 1. Purpose

Redesign the SprintX BD Assistant Chrome side panel into a light-first, blue/white branded workspace while preserving the extension's existing business logic, API contracts, auth/session behavior, retrieval modes, Draft workflow, admin capabilities, conversation persistence, evidence handling, and the composer UX fixes already completed on `fix/extension-composer-ux`.

The redesign should feel materially more polished and deliberate without advertising capabilities SprintX does not actually implement.

## 2. Product Direction

Adopt the approved **Calm Workspace** direction:

- Light theme is the default.
- Dark theme remains available in Settings.
- Keep System/Auto as an optional appearance mode to preserve existing behavior, but do not make it the default.
- Use a cool SprintX blue/periwinkle identity on a blue-white canvas.
- Keep the conversation as the primary workspace.
- Use a compact top bar and a floating/expandable bottom composer.
- Give Draft a dedicated reading/editor treatment rather than presenting it as a generic chat reply.
- Use structured cards selectively for evidence, admin/status information, and Draft metadata.
- Avoid permanent bottom navigation in the narrow side panel.
- Avoid fake or unsupported controls.

## 3. Non-Negotiable Functional Integrity

The redesign must not change the semantics of the following existing flows:

### Authentication and account isolation
- Google sign-in and sign-out.
- Trusted-window fallback.
- Session refresh.
- Account-scoped remounting and stale async callback isolation.
- Existing role detection.

### Conversation management
- Startup restores the latest transcript.
- New conversation.
- History view.
- Select conversation.
- Rename conversation.
- Delete conversation.
- Thread switching remains blocked while relevant work is in flight.

### Ask
- Question input.
- Ctrl/Cmd + Enter submit.
- Ask modes:
  - Grounded knowledge.
  - Structured case-study facts.
  - General advice.
- Existing `askAssistant` API contract.
- Question preservation on failed requests.
- Question clearing only after a successful request.
- Successful requests may auto-collapse the composer.
- Quick Ask action reopens the composer and restores focus.
- Refine stages an existing answer into Ask without sending automatically.

### Draft
- Existing Draft input fields:
  - Message type.
  - Audience.
  - Objective.
  - Tone.
  - Length.
  - Additional context.
- Existing `draftMessage` API contract.
- Additional context remains bounded by current behavior.
- Draft fields remain internally scrollable at constrained side-panel heights.
- Primary Draft action remains reachable outside the field scroll region.
- Use in Draft stages an answer as Draft context without sending automatically.
- Successful Draft generation may auto-collapse the configuration composer.
- Failed Draft requests preserve editable inputs.

### Evidence and response safety
- Existing safe Markdown rendering.
- Raw HTML remains text and never executable markup.
- Evidence/source grouping.
- Original citation indices remain stable.
- Unsafe source URLs remain unlinked.
- Copy, Refine, and Use in Draft actions remain available.

### Settings and admin
- Appearance settings.
- Gemini personal key save/remove.
- Admin role gating.
- User provisioning.
- Google Drive sync and progress.
- Case-study facts refresh.
- Website crawl.
- Existing busy-state protections.
- Errors and status feedback remain visible in constrained layouts.

### Chrome extension behavior
- Native Chrome Side Panel remains the primary presentation.
- Existing authorization and trusted-window protections remain unchanged.
- No restoration of automatic toolbar overlay injection.
- No change to backend endpoints or retrieval architecture as part of this redesign.

## 4. Brand System

### 4.1 Core palette

Light theme:

- Canvas: `#F5F7FB`
- Surface: `#FFFFFF`
- Surface muted: `#F8FAFD`
- Primary: `#384DBE`
- Primary hover/emphasis: `#5367D8`
- Primary soft: `#EEF1FF`
- Main ink: `#121B2E`
- Secondary text: `#59647A`
- Hairline/border: `#E5EAF3`
- User bubble: `#F0F3FB`
- Success: `#1E9A6C`
- Danger: semantic red mapped from existing error tokens.

Dark theme:

- Canvas: `#131314`
- Surface: `#1E1F20`
- Raised surface: `#282A2C`
- Primary: `#8AB4F8`
- Primary soft: dark blue surface token.
- Main ink: `#E3E3E3`
- Secondary text: approximately `#C4C7C5`
- Border: approximately `#3C4043`

All UI components consume semantic CSS variables rather than hard-coded per-component colors.

### 4.2 Typography

Do not load Google Fonts or icon fonts remotely.

Use:
- UI/body: existing system sans stack, refined for weight and spacing.
- Draft reading canvas: local/system serif fallback such as Georgia for a document-like feel.
- Small caps/eyebrows sparingly.

No external font dependency should be required by the extension CSP.

### 4.3 Shape and elevation

- Main panels/cards: 14–18 px radius.
- Composer: high-radius floating capsule/card, approximately 22–26 px.
- Pills/chips: fully rounded.
- Shadows: low-opacity and shallow; hierarchy should come mainly from spacing, borders, and surface contrast.
- Avoid heavy gradients except for the brand mark if used.

## 5. SprintX Identity

### 5.1 Logo concept

Create a compact **SX Spark** identity:

- Simple geometric mark that remains legible at 16 px.
- Visual language suggests:
  - an `S`,
  - an `X`,
  - and forward/upward motion.
- Primary presentation: indigo/blue rounded tile with white mark.
- Header presentation: mark + `SprintX` wordmark.
- Compact presentation: mark only.

The mark must not resemble the Gemini sparkle closely enough to look derivative.

### 5.2 Asset strategy

Create one vector source of truth and generate raster sizes from it.

Planned assets:
- `extension/public/brand/sprintx-mark.svg`
- `extension/public/brand/icon-16.png`
- `extension/public/brand/icon-32.png`
- `extension/public/brand/icon-48.png`
- `extension/public/brand/icon-128.png`
- `extension/public/favicon.svg`

Manifest changes:
- Add top-level `icons` for 16/32/48/128.
- Add `action.default_icon` for 16/32.
- Keep `action.default_title` unchanged.

HTML changes:
- Add a local favicon reference to `extension/index.html`.
- Built public output should inherit the same favicon through the normal extension build path.

No font files are introduced.

## 6. Information Architecture

The side panel has one primary workspace and focused secondary views.

### Primary workspace
- Compact brand/header.
- Conversation title and quick actions.
- Scrollable conversation timeline.
- Floating/expandable Ask/Draft composer.

### Secondary views
- History.
- Settings.
- Admin.

Only one secondary view is visible at a time, preserving the existing mutual-exclusion model.

Do not add permanent Assistant/Drafts/Insights/Library bottom navigation.

## 7. Header

Replace the current large heading block with a compact approximately 54–58 px top bar.

Contents:
- SX Spark mark.
- `SprintX` wordmark.
- Small `BD Assistant` descriptor where width permits.
- Compact action cluster:
  - History.
  - Settings.
  - Admin when role permits.
  - Sign out remains available but should not compete visually with primary actions; it may live in Settings or an overflow-style local menu if implemented without new dependencies.

The header must remain usable at narrow side-panel widths.

## 8. Conversation Workspace

### 8.1 Timeline visual hierarchy

Assistant responses:
- Mostly open canvas rather than a full bubble.
- `SprintX` label above response.
- Comfortable 14–15 px reading size and 1.6–1.7 line height.
- Structured cards only for content that benefits from grouping.

User messages:
- Right-aligned.
- Max width about 82–86%.
- Subtle cool-gray/blue bubble.
- Compact spacing.

Do not alter stored message content or response rendering semantics.

### 8.2 Response actions

Keep:
- Copy.
- Refine.
- Use in Draft.

Restyle as quiet inline/pill actions.

### 8.3 Evidence

Retain the existing disclosure behavior and source safety logic.

Visual update:
- Summary appears as a compact evidence pill/disclosure.
- Expanded sources render as light cards or separated rows.
- Keep source indices, snippets, path fallback, and safe URLs exactly as existing logic provides.

## 9. Composer

The composer-fix branch is the functional baseline.

### Expanded Ask state
- Floating bottom surface.
- Compact Ask/Draft switch.
- Question textarea.
- Ask mode selector.
- Send action.
- Ctrl/Cmd + Enter hint can be visually deemphasized.
- Collapse control.

### Collapsed state
- Thin, low-height dock.
- Ask/Draft state remains identifiable.
- User input state is preserved.
- Expand control remains keyboard accessible.

### Height rules
- Composer must never consume the full side panel.
- Timeline remains the primary scroll region.
- Draft configuration fields have their own scroll region.
- Error/status UI must remain visible and not be pushed outside the shell.

### Focus
All mode changes and staging actions must continue using post-render focus intent rather than direct pre-render DOM focus.

## 10. Draft Experience

Draft mode has two distinct states:

### 10.1 Draft configuration
Retain every existing input and handler.

Presentation:
- Compact form controls.
- Internal scroll region for the input fields.
- `Create draft` remains pinned/reachable outside the scrolling fieldset.
- Additional Context remains visible through scrolling.
- Collapsing Draft does not discard unsent input.

### 10.2 Generated Draft reading canvas
When a generated Draft response is present, render it with a dedicated visual treatment:
- White/light surface in light mode.
- Document-style reading width.
- Serif body treatment.
- Clear action row with Copy and revision/staging actions that map to existing capabilities.

Important: the message remains part of the existing conversation data model. This is a presentation distinction, not a new Draft persistence model.

Do not add subject variants, editable rich text, Insert into Email/Page, or AI revision commands unless those capabilities are implemented separately in a future feature project.

## 11. Settings and Appearance

### Default behavior
Change the no-preference default from `auto` to `light`.

Preserve existing explicit stored preferences.

Appearance options remain:
- Light.
- Dark.
- System / Auto.

Order should make Light first and visually indicate it is the product default.

Adaptive page accent:
- Preserve functionality for parity.
- Default remains off.
- Move wording to an advanced/subtle area so page-derived accent does not undermine SprintX brand consistency.
- It may affect decorative accents only, never primary brand surfaces or readable foreground contrast.

## 12. Admin and History

History and Admin remain focused secondary screens.

### History
- Cleaner list rows.
- Active conversation uses primary-soft highlight.
- Rename/Delete remain available.
- New conversation remains accessible.

### Admin
- Preserve all current controls.
- Group operations:
  - Team/user provisioning.
  - Knowledge refresh operations.
- Drive sync progress remains visible.
- Long sync/error output wraps and scrolls safely.

No backend or permission changes.

## 13. Iconography

Use a small local inline-SVG icon set for:
- History.
- Settings.
- New conversation.
- Send.
- Collapse/expand.
- Copy.
- Refine.
- Draft.
- Evidence/source indication.
- Admin actions where useful.

Requirements:
- No Material Symbols CDN.
- No remote icon font.
- Each actionable icon button has an accessible name.
- Decorative SVGs are hidden from assistive technology.

## 14. Accessibility

Maintain or improve:
- Visible focus ring with sufficient contrast.
- Semantic buttons and links.
- Existing labels for form controls.
- `aria-expanded` for disclosure/collapse controls.
- `aria-controls` for composer body.
- Status/error roles.
- Reduced-motion handling.
- Forced-colors support.
- Minimum practical touch target around 30–36 px for side-panel density.
- No color-only indication for errors or active state.

## 15. Error and Loading Behavior

Preserve current control-flow semantics.

Visual rules:
- Errors use a visible constrained status region with internal scrolling if necessary.
- Failed Ask/Draft does not collapse or clear the editable input.
- Successful Ask/Draft may collapse only after response state is appended.
- Busy states disable controls exactly as existing logic does.
- Admin long-running operations keep progress visible.

No optimistic UI that contradicts server state.

## 16. Component Boundaries

Implementation should reduce pressure on `App.tsx` without changing behavior.

Target components:
- `BrandMark`
- `WorkspaceHeader`
- `ConversationBar`
- `ConversationTimeline`
- `MessageActions`
- `Composer`
- `AskComposer`
- `DraftComposer`
- `HistoryPanel`
- `SettingsPanel`
- `AdminPanel`
- optional `DraftReadingCanvas`

Handlers and state can remain owned by `SessionWorkspace` initially and be passed down as props. Do not introduce a new global state system.

This extraction is allowed only when it directly improves the redesign's clarity/testability; avoid unrelated architecture work.

## 17. Files Expected to Change

Likely:
- `extension/src/App.tsx`
- `extension/src/styles.css`
- `extension/src/components/AppearanceSettings.tsx`
- `extension/src/components/Sources.tsx`
- `extension/src/components/AnswerContent.tsx` only if a presentation hook is necessary without changing sanitization behavior.
- New local presentation components under `extension/src/components/`.
- `extension/public/manifest.json`
- `extension/index.html`
- New local brand/icon assets.
- Extension tests.

Do not modify server/backend files unless testing reveals a pre-existing API mismatch. This redesign does not require backend changes.

## 18. Testing Strategy

Use TDD for behavior changes.

### Existing suite must remain green
- Session tests.
- Workspace tests.
- Appearance tests.
- Overlay/side-panel tests.
- API error tests.
- Drive sync tests.

### New regression coverage
- No saved appearance preference resolves to Light.
- Explicit Dark remains persistent across Settings exit/remount.
- Explicit Auto remains supported.
- Header actions preserve existing secondary-view mutual exclusion.
- Composer collapse/expand preserves Ask and Draft state.
- Successful Ask auto-collapse behavior.
- Failed Ask remains expanded with question preserved.
- Draft field scroll structure keeps Create Draft outside the scroll region.
- Use in Draft preserves 2,000-character staging bound.
- Evidence rendering safety remains unchanged after restyle.
- New icon buttons expose accessible names.

### Build verification
Before merge:
- `npm test`
- `npm run extension:test`
- `npm run extension:build`
- `git diff --check`

### Manual Chrome verification
At narrow and wider native Side Panel widths:
- Sign in/out.
- Conversation restore.
- Ask all three modes.
- Failed Ask.
- Draft with long Additional Context.
- Generated Draft presentation.
- Copy / Refine / Use in Draft.
- Evidence disclosure.
- History select/rename/delete/new.
- Settings Light/Dark/Auto.
- Gemini key controls.
- Admin role controls.
- Drive sync progress.
- Reload extension and verify favicon/toolbar icon crispness.
- Confirm no external font/icon requests are required.

## 19. Rollout and Branch Safety

- Current `main` remains unchanged until the composer-fix PR and redesign are independently verified.
- This design branch is based on `fix/extension-composer-ux` so the redesign cannot silently discard the composer fixes.
- Implementation should occur on a dedicated implementation branch derived from the verified baseline.
- Do not force-push `main`.
- Merge through a PR after local test/build evidence and manual Chrome verification.

## 20. Explicitly Deferred Features

Do not implement in Workspace 2.0:
- Model selector.
- Voice input.
- File attachment/upload.
- Screenshot attachment.
- Page-element selection.
- Page scraping/context indicator not backed by current logic.
- Insights screen.
- Prompt Library screen.
- Subject-line variants.
- Rich text editor.
- Insert into Email/Page.
- Direct page DOM modification.
- New backend endpoints.

These can be separate future features with their own product and security design.

## 21. Success Criteria

Workspace 2.0 is successful when:

1. The extension visibly reads as a cohesive SprintX product rather than a generic form UI.
2. Light mode is the default and Dark remains fully usable from Settings.
3. The SX Spark mark is recognizable in the header, favicon, and Chrome extension icon sizes.
4. Ask and Draft consume materially less permanent vertical space.
5. Draft Additional Context and Create Draft remain reachable at narrow side-panel heights.
6. All current functional capabilities remain present and behave identically at the API/state level.
7. No unsupported feature is exposed in the UI.
8. No remote font or icon dependency is introduced.
9. Existing and new tests pass.
10. Manual Chrome Side Panel verification confirms layout, scrolling, focus, icons, and theme behavior.
