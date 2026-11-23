# Campus Connect frontend

This is the independent event discovery frontend for the Campus Connect API. The Saathi benefits app remains in `frontend/`.

## Configure sign-in

Copy `config.example.js` to `config.js` and set the public Supabase project URL and publishable (anon) key. The key is meant for browser clients; keep database access protected by the row-level security rules in `backend/schema.sql`. `config.js` is ignored by Git so the local project configuration does not get committed.

Browsing public events works without Supabase client settings. Sign-in, RSVP, event hosting, and personal RSVP history require them.

## Run locally

Serve this directory over HTTP (for example, `python -m http.server 5173`) and open `http://localhost:5173`. Allow that origin in the API's `CORS_ORIGINS` setting.

## Deploy

Deploy this directory as a separate static site on Vercel. The frontend calls `https://campus-connect-api-lxnl.onrender.com`; set that API's `CORS_ORIGINS` to include the new Vercel production domain.
