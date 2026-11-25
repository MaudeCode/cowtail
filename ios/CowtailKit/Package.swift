// swift-tools-version:6.2
import PackageDescription

/// The app's logic, tested on macOS with `swift test` and no simulator. The app target compiles these same sources
/// (project.yml), so they need no `public` API; this package proves they build and pass without iOS.
let package = Package(
    name: "CowtailKit",
    platforms: [.iOS(.v26), .macOS(.v26)],
    dependencies: [
        // Exact, as in ../project.yml and ../OpenAPITools/Package.swift; bump them together.
        .package(url: "https://github.com/apple/swift-openapi-runtime", exact: "1.13.4"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", exact: "1.4.0"),
        .package(url: "https://github.com/apple/swift-http-types", from: "1.8.0"),
    ],
    targets: [
        .target(
            name: "CowtailKit",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
            ],
            // Set only here, never in the app: AppConfig reads example values instead of the app's Info.plist.
            swiftSettings: [.define("COWTAIL_PACKAGE")]
        ),
        .testTarget(
            name: "CowtailKitTests",
            dependencies: [
                "CowtailKit",
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
            ]
        ),
    ]
)
