import SwiftUI

/// A local-only entry point for deterministic, non-activating visual checks.
/// It is intentionally outside Package.swift and the Xcode targets.
@main
struct TheDeskVisualHarness: App {
    @StateObject private var store = LearningHomeStore(inMemory: true)

    private var requestedScreen: String {
        ProcessInfo.processInfo.environment["THE_DESK_VISUAL_SCREEN"] ?? "home"
    }

    var body: some Scene {
        WindowGroup {
            visualScreen
                .environmentObject(store)
                .frame(minWidth: 980, minHeight: 680)
                .tint(LearningPalette.copper)
        }
        #if os(macOS)
        .defaultSize(width: 1_280, height: 820)
        .windowToolbarStyle(.unifiedCompact)
        #endif
    }

    @ViewBuilder
    private var visualScreen: some View {
        switch requestedScreen {
        case "class":
            if let space = store.spaces.first(where: { $0.kind == .class }) {
                StudySpaceView(space: space)
            } else {
                ContentUnavailableView("Class unavailable", systemImage: "books.vertical")
            }
        case "plan":
            StudyPlannerView()
        case "capture":
            CaptureView()
        case "library":
            SourceLibraryView()
        case "canvas":
            if let artifact = store.canvases.first,
               let space = store.space(id: artifact.spaceID) {
                StudyCanvasView(artifact: artifact, space: space)
            } else {
                ContentUnavailableView("Canvas unavailable", systemImage: "point.3.filled.connected.trianglepath.dotted")
            }
        case "integrations":
            IntegrationsView()
        #if os(macOS)
        case "buddy":
            StudyBuddyView()
        #endif
        default:
            TodayView()
        }
    }
}
