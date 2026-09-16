# Named case-study retrieval fix

ECC agents independently traced retrieval and conversation context. Current
question transport from extension to API is correct; no frontend rewrite needed.

## Root causes

1. PostgreSQL lexical reranking considered only the first vector shortlist.
   Synced named documents outside that shortlist could never be recovered.
2. Every standalone question inherited the last question and answer during
   retrieval, allowing an earlier Fiverr/count discussion to contaminate Dream.

## TDD evidence

`8640f79` records two executed failing tests in
`test/named-case-study.test.ts`. The standalone query included the previous
count/Fiverr text, and the vector store performed only one candidate query.

`8db03ff` fixes both: bounded full-KB lexical candidates join vector candidates,
distinctive complete title matches rank above generic semantic neighbors, and
only referential questions inherit conversation retrieval context. Generation
explicitly prioritizes the latest question.

Verification: `npm test` passed 29 application tests and 3 CommonJS runtime
checks; `npm run extension:test` passed 4 React tests; extension production build
and `git diff --check` passed. ECC final review found no blockers.

## Limits

PostgreSQL ranking is tested with query-result fixtures, not a live database.
No production ingestion/deletion occurred. The actual Dream document's tech
stack and an authenticated live answer were not verified. Existing titles can
benefit without resyncing; files with extra filename suffixes may not receive
the complete-title boost. Full-KB lexical retrieval can increase query cost on
large corpora; consider a matching full-text index as corpus size grows.
Global coverage remains below ECC's 80% target from the preceding audit.

## PDF filename follow-up

The exact filename `Case Study - Dream.pdf` exposed a missed PostgreSQL behavior:
`to_tsvector('simple', 'Case Study - Dream.pdf')` produces a `dream.pdf` lexeme,
which does not match `plainto_tsquery('simple', 'dream')`. The former mock-only
regression did not execute this parser and therefore missed the failure.

`test/pdf-filename-search.test.ts` now executes the actual lexical SQL through
PGlite's PostgreSQL engine (substituting only the unavailable pgvector distance).
It reproduced the failure, then passed after SQL title normalization replaced
filename punctuation with spaces before tokenization. No re-ingestion required.

Verification: 30 application tests, 3 CommonJS checks, and 4 React tests pass;
backend and extension builds pass. This still does not verify the real Dream
PDF is present in production. The separate generic request-failure message
cannot be diagnosed from its text alone; Vercel runtime access again returned
403. Live authenticated verification and the failed request's HTTP status/log
are needed to distinguish timeout, upstream error, or persistence failure.
