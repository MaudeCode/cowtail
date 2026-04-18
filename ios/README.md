# Cowtail iOS

Native iPhone app for Cowtail, the alerting and operations companion to the Cowtail site.

This project now lives inside the main `cowtail` monorepo at `ios/`.

Current scope:
- XcodeGen-based iOS app project
- SwiftUI inbox, alert detail, and settings flows
- Apple sign-in session handling
- push registration and notification-routing logic
- universal links for alert URLs
- build-time generated OpenAPI client/types from the shared `protocol/` package
- planning docs for future native parity work

## Local config
Deployment-specific endpoint values are not tracked in the repo.

Use:
- `Config/project.env.example` as the template
- `Config/project.env` for your real local values

The generated app reads those values through the project definition and `Info.plist`. Runtime access is centralized in `CowtailApp/Sources/App/AppConfig.swift`.

## Generate the project
```bash
cd ios
./generate.sh
```

Then open `ios/Cowtail.xcodeproj` in Xcode.

The project generation step also refreshes `OpenAPITools/Sources/CowtailGeneratedAPI/openapi.json` from the shared protocol package.
When building in Xcode, a pre-build script refreshes the OpenAPI spec from the shared protocol package and then regenerates Swift client/types into `OpenAPITools/Sources/CowtailGeneratedAPI/GeneratedSources` automatically.

## UI Tests
Generate the project first:

```bash
cd ios
./generate.sh
```

In this workspace, run the full UI suite after loading `Config/project.env` and the same derived defaults used by `./generate.sh`:

```bash
cd ios
set -a
. Config/project.env
set +a
export COWTAIL_AUTH_SESSION_URL="${COWTAIL_AUTH_SESSION_URL:-${COWTAIL_ALERT_WRITE_URL%/alerts}/auth/session}"
export COWTAIL_NOTIFICATION_PREFERENCES_URL="${COWTAIL_NOTIFICATION_PREFERENCES_URL:-${COWTAIL_ALERT_WRITE_URL%/alerts}/me/notification-preferences}"
export COWTAIL_ROUNDUP_TIMEZONE="${COWTAIL_ROUNDUP_TIMEZONE:-America/New_York}"
xcodebuild test \
  -project Cowtail.xcodeproj \
  -scheme Cowtail \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.4.1' \
  -only-testing:CowtailUITests
```

The UI test suite launches the app in deterministic test mode using seeded scenarios.
It should pass on repeated runs without manually resetting the simulator.

See:
- `docs/apple-setup.md`
- `docs/architecture.md`
- `docs/web-parity.md`

## Platform
- Bundle ID: configured from `Config/project.env`
- Deployment target: iOS 26.0
- App name: `Cowtail`
