// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "TheDesk",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "TheDeskKit", targets: ["LearningHomeKit"]),
        .executable(name: "TheDesk", targets: ["LearningHome"]),
    ],
    targets: [
        .target(
            name: "LearningHomeKit",
            resources: [.copy("Resources")],
            linkerSettings: [.linkedLibrary("sqlite3")]
        ),
        .executableTarget(
            name: "LearningHome",
            dependencies: ["LearningHomeKit"]
        ),
        .testTarget(
            name: "LearningHomeKitTests",
            dependencies: ["LearningHomeKit"]
        ),
    ]
)
