# Contributing

## Prerequisites

- Windows recommended (packaging and Job Object / port tools are Windows-first)
- Node.js ≥ 20
- pnpm 9 (`packageManager` in root `package.json`)

## Setup

```bash
pnpm bootstrap
# or
pnpm install
pnpm --filter @pkg-runner/tokens build
pnpm rebuild:native   # optional; needed for interactive shell
```

## Checks before PR

```bash
pnpm check            # typecheck + vue-controller lint
pnpm --filter @pkg-runner/runner verify:pty   # optional smoke (needs built runner main)
```

## Conventions

- Apps stay `"private": true` unless we intentionally publish an npm package.
- Theme colors: edit `packages/tokens` only, then `pnpm --filter @pkg-runner/tokens build`. Do not hand-edit synced `apps/*/ui/tokens.css` or `apps/tray/ui/pkg-tokens.js`.
- Brand images: edit `packages/assets/media` only, then `pnpm --filter @pkg-runner/assets build`. Do not duplicate icons under each app.
- Prefer small, focused PRs. Match existing TypeScript / Vue Controller patterns (`docs/CONTROLLER-VUE.md`).
- Do not commit agent/IDE leftovers (`.cursor/`, `.ds-agent/`, `.co-der-fs-bak/`), `release/`, or local logs.

## Issues

Bug reports: OS version, Node/pnpm version, steps, and relevant `.logs` / diag snippets (redact paths if needed).
