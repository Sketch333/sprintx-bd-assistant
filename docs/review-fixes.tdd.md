# Audit fixes — TDD evidence

Journeys derived from the ten audit findings: protect internal search, isolate
accounts and threads, safely reconcile local files, ingest actual Drive content
without Archive or first-tab loss, and preserve one embedding space while using
ownership-checked conversation context for follow-ups.

## Evidence

- `60eed3e`: RED — `npm test` reproduced public search (200 instead of 401)
  and missing-root ingestion (missing expected rejection).
- `af568cc`: GREEN — 19 application tests and 3 CommonJS checks passed.
- `6a9a1be`: RED — five executed regressions reproduced blob metadata downloads,
  CSV-only Sheets export, Archive recursion, local production vectors, and model
  fallback to an incompatible embedding space.
- `91d1ec2`: GREEN — 24 application tests and 3 CommonJS checks passed;
  extension build passed.
- `17b8438`: RED — three actual React tests reproduced retained raw key state,
  selection reset on token refresh, and switching during generation. Provider
  fixture also reproduced absence of prior turns in the generation prompt.
- `4717d09`: GREEN — final `npm test`: 27 application tests plus 3 CommonJS
  checks; `npm run extension:test`: 4 React tests; extension build passed.

## Guarantees and operational notes

- Authenticated/provisioned search when `REQUIRE_AUTH=true`.
- Missing local roots fail before mutation. Reconciliation deletes only sources
  tagged with the matching `metadata.ingestionRoot`; untagged legacy sources
  are deliberately retained until migrated/re-ingested.
- Drive blobs use `alt=media`; Sheets export XLSX and parse every worksheet;
  recursive discovery skips Archive folders case-insensitively.
- Production/persistent embeddings require Gemini. Provider failures no longer
  silently introduce local vectors or switch embedding models. Existing vectors
  from fallback providers require a controlled re-index; no production data was
  rewritten during these tests.
- Account-keyed workspaces discard all account-local state. Refreshing the same
  account's token does not reset selection. Startup restores the transcript and
  navigation/generation actions cannot overlap.
- Ask/Draft load owner-matched history before retrieval/generation, bounded to
  12 turns / 12,000 characters, and treat prior dialogue as untrusted context.

## Known verification gaps

No production ingestion/deletion was exercised. Fixtures mock Google/Gemini;
live authenticated end-to-end testing remains necessary. Coverage percentage
was not measured and the ECC 80% target is not claimed. No lint script exists.
Vercel connector access returned 403, so deployment/log inspection requires an
authorized connection. `git diff --check` passed.
