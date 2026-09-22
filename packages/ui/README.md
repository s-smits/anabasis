# Anabasis

The original Forge dashboard, connected to Anabasis controller evidence. See [DESIGN.md](DESIGN.md).

From the repository root:

```sh
bun install --frozen-lockfile --cwd packages/ui
bun run ui:dev
```

The server binds to localhost:5173. `PORT` changes the port. `ANA_UI_REPO_ROOT`
selects an explicit evidence checkout; the default is this checkout. No configuration
is copied from another checkout. Evidence is read-only; Settings uses the existing
explicit backend selection action.

`bun run ui:build` creates a static snapshot in `packages/ui/dist`.
`bun run ui:gate` installs locked UI dependencies, builds and tests the UI.
The repository gate includes it.
