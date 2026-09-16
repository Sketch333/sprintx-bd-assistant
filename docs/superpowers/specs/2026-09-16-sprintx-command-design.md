# SprintX Command design

## Approved direction

Modern, compact BD workspace with glass-style surfaces, system themes, restrained teal accents, purposeful motion, and accessible controls. Implement a floating experience rather than trying to make Chrome's native sidebar transparent. Preserve the sidebar as a fallback. Deliver presentation and knowledge intelligence as independently verified phases.

## Phase 1: Extension presentation and floating host

The toolbar action explicitly opens or toggles an overlay on the active HTTP(S) page using activeTab and scripting permissions. No persistent all-sites host permission or automatically registered content script is added. A toolbar context-menu action opens the native sidebar directly; restricted pages and injection failures receive an actionable sidebar fallback. Invocation must respect Chrome's user-gesture requirements.

An isolated content script mounts a uniquely identified shadow-root host. A glass frame has a drag handle, minimize, close and sidebar controls. Minimize leaves a compact launcher without unloading chat; close tears down listeners and the frame. Dragging and viewport changes clamp the frame inside the visible viewport. Narrow screens use a bounded width rather than covering the entire page. Page navigation removes the overlay naturally; persisted conversations remain available.

The frame hosts the same built React app in an extension-origin iframe. Only necessary bundled UI resources are declared web-accessible. Never expose API keys, authentication tokens, conversations or user inputs through content-script messages or page DOM. Web-accessible embedding requires a security review: direct external embedding must not allow unauthorized privileged commands, deceptive authentication, or frame-to-page secret leakage. Opening/signing in through a trusted extension surface is the fallback if framed identity APIs or browser storage are unavailable.

Optional adaptive appearance samples only theme-color and computed background colors locally after explicit invocation. It never reads or uploads page text. Validate sampled values, derive a restrained accent, and keep accessible foreground/background contrast. Provide Auto, Light and Dark appearance plus a toggle to disable page-derived accents. Authenticate any presentation-only communication using the expected frame/source and a narrow value schema; accept no page-origin privileged actions. System theme is the reliable default.

The workspace has a compact header, Ask/Draft switch, one primary conversation timeline, anchored composer, suggested questions and one secondary History/Settings/Admin view at a time. Keep existing account-remount isolation and cancellation protections. Maintain encrypted personal-key handling; clear raw input on settings exit and account change. Render answer formatting safely without raw HTML. Group citations by document while retaining original source numbers so citations remain valid. Copy reports success/failure; Refine fills a follow-up without auto-sending; Use in Draft carries bounded context without silently truncating it. Preserve input on failure and expose meaningful progress/retry states. Keyboard focus, reduced motion and readable narrow layouts are mandatory.

## Phase 2: Knowledge intelligence

Add versioned structured facts per fully indexed case-study source: project, industry, technology stack, services, challenges and outcomes. Extract only evidence-supported values with source/chunk references; unknown fields remain unknown. Use folder category, not filename, to select case studies. Cache extraction by content hash and extractor version, checkpoint progress and never repeat embeddings for facts-only updates. Failed extraction preserves prior valid facts but reports stale status; only current facts participate in aggregate answers.

Route counts/lists through indexed inventory, named projects through document-scoped retrieval, and comparisons/technology filters through structured facts with evidence links. Ambiguous names ask for clarification. Conversation follow-ups resolve references without treating previous generated prose as evidence. General BD advice is explicitly labelled and must not invent SprintX capabilities, prices, outcomes or actions. No automatic web browsing is introduced.

## Validation and release

Add failing regression tests before implementation for overlay lifecycle, restricted-page fallback, untrusted messages, theme validation, citation grouping, account isolation and structured-fact routing/cache invalidation. Run existing backend/runtime and extension suites plus production builds. Inspect light/dark layouts and keyboard flow at narrow and wide sizes. Actual unpacked Chrome verification is required for toolbar permission grants, iframe authentication, dragging, collapse, navigation and sidebar fallback; a normal browser preview cannot prove these extension APIs work. Production data migration and end-to-end verification are reported separately from local passing tests. Preserve unrelated user files and do not claim deployed completion without evidence.
