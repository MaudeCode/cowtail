# cowtail-protocol

Shared protocol schemas and TypeScript types for Cowtail clients and services.

## Purpose

This package is the versioned contract between:

- `cowtail-cli`
- `cowtail`
- any future Cowtail clients or automation

It contains:

- Zod schemas for request and response bodies
- TypeScript types inferred from those schemas
- shared literals for statuses, outcomes, and scopes
- shared transport contracts such as push payloads and cluster health responses

It does not contain:

- CLI framework code
- Convex queries or mutations
- environment loading
- transport-specific HTTP clients

## Location

This package now lives inside the main Cowtail workspace at [`protocol/`](./).

The web app consumes it through the root Bun workspace as `@maudecode/cowtail-protocol`.

## Development

```bash
bun install
cd protocol
bun run check
bun run build
```
