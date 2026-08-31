import SwiftUI

public enum AppDestination: Hashable {
    case today
    case planner
    case capture
    case integrations
    case space(UUID)
}

public extension Notification.Name {
    static let learningHomeShowStudyBuddy = Notification.Name("LearningHome.ShowStudyBuddy")
    static let learningHomeStudyBuddyHoldBegan = Notification.Name("LearningHome.StudyBuddyHoldBegan")
    static let learningHomeStudyBuddyHoldEnded = Notification.Name("LearningHome.StudyBuddyHoldEnded")
    static let learningHomeOpenCapture = Notification.Name("LearningHome.OpenCapture")
}

public struct LearningHomeRootView: View {
    public init() {}

    public var body: some View {
        #if os(macOS)
        MacLearningHomeRootView()
        #else
        MobileLearningHomeRootView()
        #endif
    }
}

#if os(macOS)
private struct MacLearningHomeRootView: View {
    @EnvironmentObject private var store: LearningHomeStore
    @ViewStorage private var selection = AppDestination.today
    @ViewStorage private var showingNewSpace = false

    var body: some View {
        NavigationSplitView {
            LearningSidebar(selection: $selection)
                .navigationSplitViewColumnWidth(min: 210, ideal: 232, max: 280)
        } content: {
            destinationView
                .navigationSplitViewColumnWidth(min: 570, ideal: 720)
        } detail: {
            LearningInspector(selection: selection)
                .navigationSplitViewColumnWidth(min: 250, ideal: 286, max: 360)
        }
        .background(LearningPalette.appBackground)
        .safeAreaInset(edge: .top, spacing: 0) { PersistenceRecoveryBanner() }
        .tint(LearningPalette.indigo)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    selection = .capture
                } label: {
                    Label("Capture", systemImage: "plus.viewfinder")
                }
                .help("Capture notes, a file, or a recording")

                Button {
                    showingNewSpace = true
                } label: {
                    Label("New space", systemImage: "folder.badge.plus")
                }
                .help("Create a class or long-term track")

                Button {
                    StudyBuddyPanelController.shared.show(store: store)
                } label: {
                    Label("Study Buddy", systemImage: "cursorarrow.rays")
                }
                .keyboardShortcut(.space, modifiers: [.option])
                .help("Ask about the current screen (⌥Space)")
            }
        }
        .sheet(isPresented: $showingNewSpace) {
            NewStudySpaceSheet { space in
                selection = .space(space.id)
                showingNewSpace = false
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .learningHomeShowStudyBuddy)) { _ in
            StudyBuddyPanelController.shared.show(store: store)
        }
        .onReceive(NotificationCenter.default.publisher(for: .learningHomeOpenCapture)) { _ in
            selection = .capture
        }
        .onChange(of: selection) { _, newValue in
            if case .space(let id) = newValue { store.selectedSpaceID = id }
        }
        .onAppear { GlobalStudyBuddyHotKey.shared.register() }
        .onDisappear { GlobalStudyBuddyHotKey.shared.unregister() }
        .task {
            try? await StudySearchService.shared.rebuild(store.searchDocuments())
            repeat {
                _ = await MacQueueProcessor.shared.drain(into: store)
                if let snapshot = store.companionSnapshotData() {
                    try? await CloudCompanionLibrary.shared.publish(snapshotData: snapshot)
                }
                try? await Task.sleep(for: .seconds(30))
            } while !Task.isCancelled
        }
    }

    @ViewBuilder
    private var destinationView: some View {
        switch selection {
        case .today: TodayView(openSpace: { selection = .space($0) })
        case .planner: StudyPlannerView()
        case .capture: CaptureView()
        case .integrations: IntegrationsView()
        case .space(let id):
            if let space = store.space(id: id) {
                StudySpaceView(space: space)
            } else {
                ContentUnavailableView("Space unavailable", systemImage: "books.vertical")
            }
        }
    }
}

private struct LearningSidebar: View {
    @EnvironmentObject private var store: LearningHomeStore
    @Binding var selection: AppDestination

    var body: some View {
        List(selection: $selection) {
            Section {
                Label("Today", systemImage: "sun.max")
                    .tag(AppDestination.today)
                Label("Study Plan", systemImage: "calendar.badge.clock")
                    .tag(AppDestination.planner)
                HStack {
                    Label("Capture Inbox", systemImage: "tray.and.arrow.down")
                    Spacer()
                    let waiting = store.jobs.filter { $0.state == .waitingForMac || $0.state == .queued }.count
                    if waiting > 0 { Text("\(waiting)").foregroundStyle(.secondary) }
                }
                .tag(AppDestination.capture)
            }

            Section("Classes") {
                ForEach(store.spaces.filter { $0.kind == .class }) { space in
                    SpaceSidebarLabel(space: space)
                        .tag(AppDestination.space(space.id))
                }
            }

            Section("Tracks") {
                ForEach(store.spaces.filter { $0.kind == .track }) { space in
                    SpaceSidebarLabel(space: space)
                        .tag(AppDestination.space(space.id))
                }
            }

            Section {
                Label("Integrations", systemImage: "point.3.connected.trianglepath.dotted")
                    .tag(AppDestination.integrations)
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("The Desk")
    }
}

private struct SpaceSidebarLabel: View {
    let space: StudySpace

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 1) {
                Text(space.title)
                Text(space.subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        } icon: {
            Image(systemName: space.symbolName)
                .foregroundStyle(Color(hex: space.colorHex))
        }
        .accessibilityElement(children: .combine)
    }
}
#endif

#if os(iOS)
private struct MobileLearningHomeRootView: View {
    @EnvironmentObject private var store: LearningHomeStore
    @ViewStorage private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack { TodayView() }
                .tabItem { Label("Today", systemImage: "sun.max") }
                .tag(0)
            MobileSpacesView()
                .tabItem { Label("Spaces", systemImage: "books.vertical") }
                .tag(1)
            NavigationStack { StudyPlannerView() }
                .tabItem { Label("Plan", systemImage: "calendar.badge.clock") }
                .tag(2)
            NavigationStack { CaptureView() }
                .tabItem { Label("Capture", systemImage: "plus.viewfinder") }
                .tag(3)
            NavigationStack { SourceLibraryView() }
                .tabItem { Label("Library", systemImage: "books.vertical.fill") }
                .tag(4)
        }
        .tint(LearningPalette.indigo)
        .safeAreaInset(edge: .top, spacing: 0) { PersistenceRecoveryBanner() }
        .task {
            repeat {
                _ = await CloudCaptureQueue.shared.flushLocalOutbox()
                if let snapshot = await CloudCompanionLibrary.shared.fetchLatestData() {
                    do {
                        try store.applyCompanionSnapshotData(snapshot)
                    } catch {
                        // The published persistence banner provides the recovery path.
                    }
                }
                try? await Task.sleep(for: .seconds(30))
            } while !Task.isCancelled
        }
    }
}

private struct MobileSpacesView: View {
    @EnvironmentObject private var store: LearningHomeStore

    var body: some View {
        NavigationStack {
            List {
                Section("Classes") {
                    ForEach(store.spaces.filter { $0.kind == .class }) { space in
                        NavigationLink(value: space.id) { MobileSpaceLabel(space: space) }
                    }
                }
                Section("Tracks") {
                    ForEach(store.spaces.filter { $0.kind == .track }) { space in
                        NavigationLink(value: space.id) { MobileSpaceLabel(space: space) }
                    }
                }
            }
            .navigationTitle("Spaces")
            .navigationDestination(for: UUID.self) { id in
                if let space = store.space(id: id) { StudySpaceView(space: space) }
            }
        }
    }
}

private struct MobileSpaceLabel: View {
    let space: StudySpace
    var body: some View {
        Label {
            VStack(alignment: .leading) {
                Text(space.title)
                Text(space.subtitle).font(.caption).foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: space.symbolName).foregroundStyle(Color(hex: space.colorHex))
        }
    }
}
#endif

private struct NewStudySpaceSheet: View {
    @EnvironmentObject private var store: LearningHomeStore
    @Environment(\.dismiss) private var dismiss
    @ViewStorage private var kind = StudySpaceKind.class
    @ViewStorage private var title = ""
    @ViewStorage private var subtitle = ""
    @ViewStorage private var colorHex = "#4657B8"
    @ViewStorage private var tutorStyle = TutorStyle.coachFirst
    @ViewStorage private var errorMessage: String?
    let onCreate: (StudySpace) -> Void

    private let colors = ["#4657B8", "#B86D3E", "#347A78", "#76589B", "#2E7D5B", "#B24B45"]

    var body: some View {
        NavigationStack {
            Form {
                Picker("Kind", selection: $kind) {
                    Text("Class").tag(StudySpaceKind.class)
                    Text("Track").tag(StudySpaceKind.track)
                }
                .pickerStyle(.segmented)
                TextField(kind == .class ? "Class name" : "Track name", text: $title)
                TextField("Subtitle or goal", text: $subtitle)
                Picker("Tutor style", selection: $tutorStyle) {
                    ForEach(TutorStyle.allCases, id: \.rawValue) { Text($0.title).tag($0) }
                }
                Section("Color") {
                    HStack(spacing: 14) {
                        ForEach(colors, id: \.self) { color in
                            Button { colorHex = color } label: {
                                Circle()
                                    .fill(Color(hex: color))
                                    .frame(width: 30, height: 30)
                                    .overlay { if colorHex == color { Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(.white) } }
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(colorHex == color ? "Selected color" : "Choose color")
                        }
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle(kind == .class ? "New class" : "New track")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        do {
                            let space = try store.addSpace(kind: kind, title: title, subtitle: subtitle, colorHex: colorHex, tutorStyle: tutorStyle)
                            onCreate(space)
                        } catch {
                            errorMessage = error.localizedDescription
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 430)
        #endif
        .alert("Space could not be saved", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "Unknown error") }
    }
}

private struct PersistenceRecoveryBanner: View {
    @EnvironmentObject private var store: LearningHomeStore
    @ViewStorage private var showingResetConfirmation = false
    @ViewStorage private var resetError: String?

    var body: some View {
        if let message = recoveryMessage {
            HStack(spacing: LHSpacing.sm) {
                Image(systemName: "externaldrive.badge.exclamationmark")
                    .foregroundStyle(LearningPalette.warning)
                Text(message)
                    .font(.caption)
                    .lineLimit(2)
                Spacer()
                recoveryAction
            }
            .padding(.horizontal, LHSpacing.md)
            .padding(.vertical, LHSpacing.xs)
            .background(LearningPalette.warning.opacity(0.12))
            .confirmationDialog(
                "Reset The Desk's local library?",
                isPresented: $showingResetConfirmation,
                titleVisibility: .visible
            ) {
                Button("Reset to demo data", role: .destructive) {
                    do { try store.resetDemoData() }
                    catch { resetError = error.localizedDescription }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(resetConfirmationMessage)
            }
            .alert("Library reset failed", isPresented: Binding(
                get: { resetError != nil },
                set: { if !$0 { resetError = nil } }
            )) { Button("OK", role: .cancel) {} } message: { Text(resetError ?? "Unknown error") }
        }
    }

    private var recoveryMessage: String? {
        switch store.persistenceState {
        case let .recoveryRequired(backupPath):
            if let backupPath {
                return "Recovery mode is read-only. The unreadable library was preserved at \(backupPath)."
            }
            return "Recovery mode is read-only. Reset the local library to save again."
        case let .failed(message):
            return "Saving is paused: \(message)"
        case .inMemory, .ready:
            return nil
        }
    }

    @ViewBuilder
    private var recoveryAction: some View {
        switch store.persistenceState {
        case let .recoveryRequired(backupPath) where backupPath != nil:
            Button("Reset local library…") { showingResetConfirmation = true }
                .buttonStyle(.bordered)
        case .failed:
            Button("Retry save") {
                do { try store.retryPersistence() }
                catch { resetError = error.localizedDescription }
            }
            .buttonStyle(.bordered)
        case .recoveryRequired, .inMemory, .ready:
            EmptyView()
        }
    }

    private var resetConfirmationMessage: String {
        if case let .recoveryRequired(backupPath) = store.persistenceState,
           let backupPath {
            return "The unreadable original is preserved at \(backupPath). Reset creates a new local library and re-enables saving."
        }
        return "Reset is unavailable because no verified recovery backup exists."
    }
}

#if os(macOS)
public struct LearningHomeCommands: Commands {
    public init() {}

    public var body: some Commands {
        CommandMenu("Study") {
            Button("Open Study Buddy") {
                NotificationCenter.default.post(name: .learningHomeShowStudyBuddy, object: nil)
            }
            .keyboardShortcut(.space, modifiers: [.option])
            Button("New Capture") {
                NotificationCenter.default.post(name: .learningHomeOpenCapture, object: nil)
            }
            .keyboardShortcut("n", modifiers: [.command, .shift])
        }
    }
}
#endif
