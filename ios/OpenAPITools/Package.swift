// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "CowtailOpenAPITools",
    platforms: [.macOS(.v13)],
    dependencies: [
        // Exact, so every machine generates the same sources. Bump these with the two packages in ../project.yml and
        // ../CowtailKit/Package.swift, then run ../generate.sh and commit both Package.resolved files and the
        // regenerated sources.
        .package(url: "https://github.com/apple/swift-openapi-generator", exact: "1.14.4"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", exact: "1.13.4"),
    ],
    targets: [
        .target(
            name: "CowtailGeneratedAPI",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
            ]
        ),
    ]
)
