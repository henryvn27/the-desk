#if os(macOS)
import AppKit
import SwiftUI

/// Cursor-adjacent streaming response UI adapted from Clicky's MIT-licensed
/// CompanionResponseOverlay pattern. The Desk keeps the implementation small,
/// non-activating, and independent of Clicky's cloud/provider stack.
@MainActor
public final class StudyBuddyResponseOverlayController {
    public static let shared = StudyBuddyResponseOverlayController()

    private let state = StudyBuddyResponseOverlayState()
    private var panel: NSPanel?
    private var trackingTimer: Timer?
    private var hideTask: Task<Void, Never>?

    private init() {}

    public func begin(spaceTitle: String) {
        hideTask?.cancel()
        state.spaceTitle = spaceTitle
        state.text = "Listening… release ⌥Space when you’re done."
        state.isWorking = true
        createPanelIfNeeded()
        positionPanel()
        panel?.alphaValue = 1
        panel?.orderFrontRegardless()
        startTracking()
    }

    public func update(text: String, status: String) {
        state.text = text.isEmpty ? status : text
        state.isWorking = true
        resizeToFit()
        positionPanel()
    }

    public func finish(text: String) {
        state.text = text
        state.isWorking = false
        resizeToFit()
        hideTask?.cancel()
        hideTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(8))
            guard !Task.isCancelled else { return }
            self?.hide()
        }
    }

    public func hide() {
        hideTask?.cancel()
        hideTask = nil
        trackingTimer?.invalidate()
        trackingTimer = nil
        panel?.orderOut(nil)
    }

    private func createPanelIfNeeded() {
        guard panel == nil else { return }
        let initial = NSRect(x: 0, y: 0, width: 344, height: 96)
        let panel = NSPanel(
            contentRect: initial,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .statusBar
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.isExcludedFromWindowsMenu = true
        panel.contentView = NSHostingView(rootView: StudyBuddyResponseOverlayView(state: state))
        self.panel = panel
    }

    private func startTracking() {
        guard trackingTimer == nil else { return }
        trackingTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.positionPanel() }
        }
    }

    private func resizeToFit() {
        guard let panel, let content = panel.contentView else { return }
        let fit = content.fittingSize
        let size = CGSize(width: min(max(fit.width, 260), 364), height: min(max(fit.height, 72), 244))
        panel.setContentSize(size)
        content.frame = NSRect(origin: .zero, size: size)
    }

    private func positionPanel() {
        guard let panel else { return }
        let pointer = NSEvent.mouseLocation
        guard let screen = NSScreen.screens.first(where: { $0.frame.contains(pointer) }) ?? NSScreen.main else { return }
        let visible = screen.visibleFrame
        let size = panel.frame.size
        var x = pointer.x + 22
        var y = pointer.y - size.height - 8
        if x + size.width > visible.maxX { x = pointer.x - size.width - 22 }
        if y < visible.minY { y = pointer.y + 12 }
        x = min(max(x, visible.minX + 8), visible.maxX - size.width - 8)
        y = min(max(y, visible.minY + 8), visible.maxY - size.height - 8)
        panel.setFrameOrigin(CGPoint(x: x, y: y))
    }
}

@MainActor
private final class StudyBuddyResponseOverlayState: ObservableObject {
    @Published var spaceTitle = "Study"
    @Published var text = ""
    @Published var isWorking = false
}

private struct StudyBuddyResponseOverlayView: View {
    @ObservedObject var state: StudyBuddyResponseOverlayState

    var body: some View {
        VStack(alignment: .leading, spacing: LHSpacing.xs) {
            HStack(spacing: LHSpacing.xs) {
                Image(systemName: "cursorarrow.rays")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(LearningPalette.copper)
                Text(state.spaceTitle)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Spacer(minLength: 8)
                if state.isWorking {
                    HStack(spacing: 5) {
                        Circle()
                            .fill(LearningPalette.moss)
                            .frame(width: 6, height: 6)
                        Text("Working")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(LearningPalette.onGraphite.opacity(0.68))
                        ProgressView()
                            .controlSize(.mini)
                            .tint(LearningPalette.onGraphite)
                    }
                }
            }
            Text(state.text)
                .font(.system(size: 13))
                .lineSpacing(2)
                .lineLimit(8)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.disabled)
        }
        .foregroundStyle(LearningPalette.onGraphite)
        .padding(.horizontal, LHSpacing.sm)
        .padding(.vertical, 12)
        .frame(maxWidth: 344, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous)
                .fill(LearningPalette.graphite.opacity(0.98))
                .overlay(alignment: .top) {
                    Capsule()
                        .fill(LearningPalette.copper)
                        .frame(width: 54, height: 3)
                        .padding(.top, 1)
                }
                .overlay {
                    RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous)
                        .stroke(LearningPalette.copper.opacity(0.28), lineWidth: 0.75)
                }
                .shadow(color: .black.opacity(0.22), radius: 16, y: 8)
        )
        .padding(LHSpacing.xs)
    }
}
#endif
