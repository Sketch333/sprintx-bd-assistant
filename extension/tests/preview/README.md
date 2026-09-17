# Isolated workspace preview

Run from the repository root:

```
npm --prefix extension run preview:workspace
```

Open http://127.0.0.1:4173. This uses the real App and its top-level presentation authorization gate, with explicit auth/API aliases. All account, evidence, key and admin interactions are synthetic. No backend, OAuth, Supabase or provider requests are made. This config is not a production input and disables public assets.

Use Settings for light/dark/auto. Use the empty saved conversation for suggested questions. A question containing `fail` exercises failure feedback. Preview data is memory-only and resets on refresh; appearance preferences use the ordinary local browser preference storage. Browser checks do not verify Chrome extension APIs.
