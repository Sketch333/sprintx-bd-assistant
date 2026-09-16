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
