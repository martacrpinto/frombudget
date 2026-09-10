# Budget Solution Cloud

Cloud rebuild of the internal Budget Solution using React, Vite, Supabase and Vercel.

The original SQLite application is treated as read-only. Migration tooling reads a selected backup and writes generated import artifacts under `migration-output/`, which is ignored by Git.

## Local setup

1. Copy `.env.example` to `client/.env.local` and fill in the browser-safe Supabase values.
2. Apply the SQL migrations in `supabase/migrations` to a new Supabase project.
3. Run the migration tooling documented in `docs/`.
4. Install and start the frontend from `client/`.

Never expose `SUPABASE_SECRET_KEY` or `SUPABASE_DB_URL` in frontend environment variables.

