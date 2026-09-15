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
- `POST /api/kb/search`
- `POST /api/ask`
- `GET/POST /api/users` (admin-provisioned when hosted auth is enabled)
- `POST/DELETE /api/users/:id/api-key`

## Supabase and Vercel deployment

1. Create a Supabase project and run [`supabase/schema.sql`](./supabase/schema.sql) in the SQL editor.
2. Configure Google as a Supabase Auth provider and add the Vercel callback URL:
   `https://<your-project>.vercel.app/auth/v1/callback`
3. Set the variables in [`.env.example`](./.env.example) in Vercel. Keep `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, and `USER_STORE_KEY` server-side only.
4. Set `REQUIRE_AUTH=true` and `ADMIN_EMAILS` to the admin's Google email before inviting users.
5. Deploy from the repository root. The included `vercel.json` routes requests to `api/index.ts`.

When Supabase variables are absent, local development uses the encrypted JSON user store. Hosted deployments should always use Supabase and `REQUIRE_AUTH=true`.

## Notes

This is intentionally scoped to the Milestone 1 ingestion foundation. Ask mode, Draft mode, auth, and extension UI are planned for later milestones.
