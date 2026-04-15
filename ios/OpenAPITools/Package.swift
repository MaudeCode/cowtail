// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "CowtailOpenAPITools",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.10.0"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.9.0"),
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
