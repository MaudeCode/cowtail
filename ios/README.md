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

See:
- `docs/apple-setup.md`
- `docs/architecture.md`
- `docs/web-parity.md`

## Platform
- Bundle ID: configured from `Config/project.env`
- Deployment target: iOS 26.0
- App name: `Cowtail`
