# Web UI

Next.js presentation app for students and Studio. Business APIs run in `../studio-api`.

Run `pnpm install`, `pnpm gen:api`, `pnpm dev` (port 3000).
Set `STUDIO_API_ORIGIN` for SSR and the development proxy. Production uses the shared gateway.
The UI requires no Product database, JWT signing key or storage credentials.
