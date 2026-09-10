# Supabase user bootstrap

Run this script from a trusted server or local admin machine only. The secret
key must never be committed or exposed to the browser.

1. Copy `email-map.example.json` to a private `email-map.json` and replace all
   placeholder addresses with the seven real addresses.
2. Install dependencies in this directory: `npm install`.
3. Set `SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY` environment
   variables. Optionally set `SUPABASE_REDIRECT_URL` to the deployed callback.
4. Run `node bootstrap-users.mjs email-map.json`.

The script finds existing Auth users before inviting, and only links a profile
whose `auth_user_id` is still null, so it is safe to rerun. It prints legacy
IDs and status only; it never prints email addresses, keys, or passwords.
