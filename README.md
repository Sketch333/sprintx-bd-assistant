# SprintX BD Assistant MVP

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
- `POST /api/kb/ingest`
- `POST /api/kb/drive-sync` (admin-only Google Drive sync)
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

1. Create a Supabase project and run [`supabase/schema.sql`](./supabase/schema.sql) in the SQL editor.
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

The extension Settings view can save, replace, or remove a user's Gemini key. The raw key is sent over HTTPS to the backend, encrypted there, and never returned or stored in the extension.

Admins also have an Admin view for provisioning users and starting the existing authenticated knowledge-base ingestion. The backend remains the source of truth for authorization.

## Notes

The deployed backend now supports authenticated Ask, Draft, and persistent conversation workflows. An admin dashboard remains a future milestone.

To enable Google Drive sync, share the source folder with the service-account email and configure `GOOGLE_DRIVE_FOLDER_ID` plus `GOOGLE_SERVICE_ACCOUNT_JSON` in Vercel. The JSON value must contain the service account's `client_email` and `private_key`; keep it server-side and never add it to the extension.
