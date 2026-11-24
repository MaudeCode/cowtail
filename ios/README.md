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
Install the workspace dependencies once from the repository root with `pnpm install`; the OpenAPI generator runs on Node.

```bash
cd ios
./generate.sh
```

Then open `ios/Cowtail.xcodeproj` in Xcode.

The project generation step also refreshes `OpenAPITools/Sources/CowtailGeneratedAPI/openapi.json` from the shared protocol package.
When building in Xcode, a pre-build script refreshes the OpenAPI spec from the shared protocol package and then regenerates Swift client/types into `OpenAPITools/Sources/CowtailGeneratedAPI/GeneratedSources` automatically.

## Tests
Run the unit and UI suites on the `iPhone 17` simulator, the device CI tests on:

```bash
cd ios
scripts/test.sh CowtailTests CowtailUITests
```

`scripts/test.sh` generates the project and builds once for every test target it is given. Set
`COWTAIL_IOS_TEST_DESTINATION` to an `xcodebuild -destination` value to test on another simulator.

The UI test suite launches the app in deterministic test mode using seeded scenarios.
It should pass on repeated runs without manually resetting the simulator.

See:
- `docs/apple-setup.md`
- `docs/architecture.md`
- `docs/web-parity.md`

## Platform
- Bundle ID: configured from `Config/project.env`
- Built with Xcode 27.2 and the iOS 27.2 SDK; tests run on the iOS 27.2 simulator
- Deployment target: iOS 26.0
- App name: `Cowtail`
