#if os(macOS)
import AppKit
import SwiftUI

/// Owns a non-activating floating panel so the global shortcut can reveal Study
/// Buddy without stealing focus from a lecture, video, worksheet, or browser.
@MainActor
public final class StudyBuddyPanelController: NSObject, NSWindowDelegate {
    public static let shared = StudyBuddyPanelController()
    private var panel: NSPanel?

    private override init() {}

    public func show(store: LearningHomeStore) {
        let panel = panel ?? makePanel(store: store)
        panel.setFrameOrigin(origin(for: panel.frame.size))
        panel.orderFrontRegardless()
    }

    public func hide() {
        tearDownPanel(closeWindow: true)
    }

    public func windowWillClose(_ notification: Notification) {
        tearDownPanel(closeWindow: false)
    }

    private func makePanel(store: LearningHomeStore) -> NSPanel {
        let size = CGSize(width: 760, height: 620)
        let panel = NSPanel(
            contentRect: CGRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .resizable, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.title = "Study Buddy"
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.minSize = CGSize(width: 640, height: 520)
        panel.delegate = self
        panel.contentView = NSHostingView(rootView: StudyBuddyView(onClose: { [weak self] in
            self?.hide()
        }).environmentObject(store))
        self.panel = panel
        return panel
    }

    private func tearDownPanel(closeWindow: Bool) {
        StudyBuddyResponseOverlayController.shared.hide()
        guard let current = panel else { return }
        panel = nil
        current.delegate = nil
        current.contentView = nil
        current.orderOut(nil)
        if closeWindow { current.close() }
    }

    private func origin(for size: CGSize) -> CGPoint {
        let pointer = NSEvent.mouseLocation
        let screen = NSScreen.screens.first(where: { $0.frame.contains(pointer) }) ?? NSScreen.main
        guard let visible = screen?.visibleFrame else { return pointer }
        let preferred = CGPoint(x: pointer.x + 16, y: pointer.y - size.height - 16)
        return CGPoint(
            x: min(max(preferred.x, visible.minX + 12), visible.maxX - size.width - 12),
            y: min(max(preferred.y, visible.minY + 12), visible.maxY - size.height - 12)
        )
    }
}
#endif
