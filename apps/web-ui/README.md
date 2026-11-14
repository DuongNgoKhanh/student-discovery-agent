# Web UI

Next.js presentation app for students and Studio. Business APIs run in `../studio-api`.

Run `pnpm install`, `pnpm gen:api`, `pnpm dev` (port 3000).
Set `STUDIO_API_ORIGIN` for SSR and the development proxy. Production uses the shared gateway.
The UI requires no Product database, JWT signing key or storage credentials.

## Admin agent draft conflicts

When saving or publishing a draft, a `409` revision conflict means another admin saved a newer copy. The editor keeps the local changes in place and shows the newer revision, editor, and update time. Use **Tải bản của tôi dạng JSON** to download the local content before choosing **Tải bản mới** to replace it with the server copy.

## Chatflow editor

In **Chatflow** mode, the **Sơ đồ** tab renders the runtime node catalog as an editable canvas. Select a node to edit its JSON-Schema-driven form, connect handles, move nodes, or add/delete nodes; the **JSON** tab edits the same workflow state. Older Chatflow releases are shown read-only in the version viewer and can be copied into the draft before editing.
