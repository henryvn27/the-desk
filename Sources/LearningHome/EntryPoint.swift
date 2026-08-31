import SwiftUI

#if SWIFT_PACKAGE
import LearningHomeKit
#endif

@main
struct LearningHomeApp: App {
    @StateObject private var store = LearningHomeStore()

    var body: some Scene {
        WindowGroup {
            LearningHomeRootView()
                .environmentObject(store)
                #if os(macOS)
                .frame(minWidth: 980, minHeight: 680)
                #endif
        }
        #if os(macOS)
        .defaultSize(width: 1_280, height: 820)
        .commands {
            LearningHomeCommands()
        }
        #endif
    }
}
