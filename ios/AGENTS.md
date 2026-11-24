# AGENTS.md

## Scope

This file covers the native iOS app in [`ios/`](./).

## Working Rules

- Treat `ios/` as a standalone Xcode/XcodeGen project inside the monorepo.
- Do not add `ios/` to the pnpm workspace.
- `./generate.sh` and the Xcode pre-build script run the OpenAPI generator on Node; run `pnpm install` at the repository root first.
- Run project generation from `ios/` with `./generate.sh`.
- Build with Xcode 27.2, the version CI pins in `.github/actions/setup-ios`.
- Prefer the `iPhone 17 Pro (iOS 27.2)` simulator unless the user asks for a different target.

## Product-Specific Values

These values are intentionally product-specific and are currently injected from local config:

- bundle identifier from `Config/project.env`
- development team from `Config/project.env`
- associated domains and app endpoints are injected from `Config/project.env` during `./generate.sh`

## Verification

- Generate the project with `cd ios && ./generate.sh`.
- The OpenAPI generator, runtime and URLSession transport are pinned to exact versions in `OpenAPITools/Package.swift` and `project.yml`. Bump them together, run `./generate.sh`, and commit `OpenAPITools/Package.resolved` with the regenerated sources. iOS Verify fails when the committed sources differ from what the pins generate.
- Build from `ios/` so path assumptions match the monorepo.
- When changing notifications or universal links, verify both the app path and the linked backend path instead of assuming the simulator proves the full flow.
- The seeded iOS UI-test harness is deterministic for in-app flows, but it still exposes system-owned notification controls such as `Open System Settings` and `Sign in with Apple`. Do not add UI tests that tap those controls unless you first isolate them behind a test-safe boundary.
