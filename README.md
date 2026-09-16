# SprintX BD Assistant MVP

## API hosting versus the extension

Vercel hosts the Express API, not the Chrome extension UI. Every URL is routed to `api/index.ts`; `/` deliberately returns service-status JSON. To use the UI, run `npm run extension:build`, open `chrome://extensions`, enable Developer mode, and load the `extension/dist` directory using **Load unpacked**. Open the extension's side panel. Hosting a normal browser UI would require a separate web build, routing, and browser-compatible authentication.

Embedding requests use `gemini-embedding-001` with 1536 dimensions, a 15-second SDK request timeout, and at most three attempts with exponential backoff for transient failures. They never switch to an incompatible vector space. Safe errors and structured `embedding_failure` logs include the provider HTTP status, without keys or raw provider payloads. HTTP 429 requires checking the server key's Google AI Studio quota; retries cannot overcome an exhausted quota. HTTP 401/403 requires checking server-key permissions and restrictions. A failed sync is not a completed sync: resolve the reported cause and rerun before relying on newly imported documents.

This project initializes the SprintX BD Assistant Milestone 1 foundation: a local ingestion pipeline and vector-search layer for Drive-based knowledge content.

## Included in this MVP foundation

- Drive-style file ingestion from `Docs/` and `Sheets/`
- Exclusion of `Archive/`
- Chunking and embedding generation
- Vector similarity search with a memory fallback and optional PostgreSQL + pgvector support
- Manual ingest/search scripts
- An Express API for KB ingestion and query endpoints

## Quick start

1. Copy `.env.example` to `.env` if you want to override defaults.
2. Install dependencies with `npm install`.
3. Run the ingestion pipeline:
   - `npm run ingest`
4. Search the index:
   - `npm run search -- "What services does SprintX offer?"`
5. Start the API:
   - `npm run dev`

## API

- `GET /health`
- `POST /api/kb/ingest` (admin-only configured local/website ingestion)
- `POST /api/kb/drive-sync` (admin-only Google Drive sync)
- `POST /api/kb/site-sync` (admin-only configured website crawl)
- `POST /api/kb/search`
- `POST /api/ask`
- `POST /api/draft`
- `GET/POST /api/users` (admin-provisioned when hosted auth is enabled)
- `POST/DELETE /api/users/:id/api-key`
- `GET /api/me`
- `POST/DELETE /api/me/api-key`
- `GET/POST /api/conversations`
- `GET /api/conversations/:id/messages`

## Supabase and Vercel deployment

1. Create a Supabase project and run [`supabase/schema.sql`](./supabase/schema.sql) in the SQL editor. Row Level Security is enabled on users, knowledge-base, and conversation tables; the backend uses the server-only service-role key for database access, while browser clients cannot query these tables directly.
2. Configure Google as a Supabase Auth provider and add the Vercel callback URL:
   `https://<your-project>.vercel.app/auth/v1/callback`
3. Set the variables in [`.env.example`](./.env.example) in Vercel. Keep `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, and `USER_STORE_KEY` server-side only.
4. Set `REQUIRE_AUTH=true` and `ADMIN_EMAILS` to the admin's Google email before inviting users.
5. Deploy from the repository root. The included `vercel.json` routes requests to `api/index.ts`.

When Supabase variables are absent, local development uses the encrypted JSON user store. Hosted deployments should always use Supabase and `REQUIRE_AUTH=true`.

## Chrome side-panel extension

The first user-facing Ask workflow is in `extension/`. It uses the public Vercel API URL and Supabase public client configuration at build time.

1. Create `extension/.env` from [`extension/.env.example`](./extension/.env.example). Use your production Vercel URL, Supabase project URL, and public anon/publishable key. Never put service-role keys or Gemini secrets in this file.
2. Build the extension:

   ```text
   npm run extension:install
   npm run extension:build
   ```

3. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `extension/dist`.
4. Copy the generated extension ID. Supabase Auth must allow the redirect URL `https://<extension-id>.chromiumapp.org/supabase-auth` under Authentication → URL Configuration.
5. Click the extension toolbar icon, sign in with Google, and ask a question.

The Vercel project must allow the extension origin for CORS. Set `ALLOWED_EXTENSION_ORIGINS` to the exact `chrome-extension://<extension-id>` origin in Vercel. Production rejects unconfigured extension origins; local development allows Chrome extension origins so a newly loaded unpacked extension can be tested before its ID is known.

The API includes a per-instance IP rate limit for `/api/*` routes. Configure `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_REQUESTS` in Vercel if needed. Responses include `X-Request-Id`, rate-limit headers, and `Retry-After` when the limit is exceeded. Because Vercel functions are horizontally scaled, this is a protective per-instance limit rather than a shared global quota.

JSON request bodies are limited to `100kb` by default to prevent accidental or abusive oversized payloads. Override `JSON_BODY_LIMIT` only when a legitimate integration requires a larger request.

Google Drive sync recursively scans the configured folder and its subfolders. Each Drive file uses a stable `gdrive-<file-id>` source ID; a successful sync removes previously indexed Drive sources that are no longer present or readable in the configured folder, while leaving website and local sources untouched.

Website crawling also uses stable URL-derived source IDs and replaces stale chunks for an existing source, so repeated crawls update knowledge instead of accumulating duplicate content.

Local Drive-style ingestion uses stable normalized file-path source IDs and replaces duplicate in-memory chunks. Missing directories fail safely; successful reconciliation removes only stale sources tagged with that ingestion root. Untagged legacy sources are retained until re-ingested or migrated. Website and Google Drive sources are left untouched by local reconciliation.

Production/persistent embeddings require a Gemini key and use one embedding model (`gemini-embedding-001`). Failures are surfaced rather than silently mixing incompatible vectors. Re-index any older knowledge generated with local or other-model fallback embeddings after reviewing the deployment. Google Drive blob downloads request media, Sheets imports cover all tabs via XLSX, and Archive folders are excluded.

See [audit fix verification](./docs/review-fixes.tdd.md) for regression evidence and remaining live-test gaps. Run `npm run extension:test` for React account/history regressions.

The extension Settings view can save, replace, or remove a user's Gemini key. The raw key is sent over HTTPS to the backend, encrypted there, and never returned or stored in the extension.

Admins also have an Admin view for provisioning users and independently syncing Google Drive or crawling configured websites. The backend remains the source of truth for authorization.

## Notes

The deployed backend now supports authenticated Ask, Draft, persistent conversation workflows, conversation switching, conversation rename/delete controls, and admin controls.

To enable Google Drive sync, share the source folder with the service-account email and configure `GOOGLE_DRIVE_FOLDER_ID` plus `GOOGLE_SERVICE_ACCOUNT_JSON` in Vercel. The JSON value must contain the service account's `client_email` and `private_key`; keep it server-side and never add it to the extension.
