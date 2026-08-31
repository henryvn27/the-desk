import SwiftUI

public enum AppDestination: Hashable {
    case today
    case planner
    case capture
    case library
    case canvas
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
    @ViewStorage private var showingInspector = false

    var body: some View {
        NavigationSplitView {
            LearningSidebar(selection: $selection)
                .navigationSplitViewColumnWidth(min: 204, ideal: 220, max: 252)
        } detail: {
            destinationView
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationSplitViewStyle(.balanced)
        .inspector(isPresented: $showingInspector) {
            LearningInspector(selection: selection)
                .inspectorColumnWidth(min: 260, ideal: 300, max: 380)
        }
        .background(LearningPalette.appBackground)
        .safeAreaInset(edge: .top, spacing: 0) { PersistenceRecoveryBanner() }
        .tint(LearningPalette.copper)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    showingInspector.toggle()
                } label: {
                    Label(showingInspector ? "Hide context" : "Show context", systemImage: "sidebar.trailing")
                }
                .help("Show source and study context")

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
        case .today:
            TodayView(
                openSpace: { selection = .space($0) },
                openPlan: { selection = .planner }
            )
        case .planner: StudyPlannerView()
        case .capture: CaptureView()
        case .library: SourceLibraryView()
        case .canvas: CanvasLibraryDestinationView()
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
        VStack(spacing: 0) {
            HStack(spacing: LHSpacing.sm) {
                Image(systemName: "rectangle.topthird.inset.filled")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(LearningPalette.copper)
                    .frame(width: 34, height: 34)
                    .background(.white.opacity(0.09), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Text("The Desk")
                    .font(.title3.weight(.bold))
                    .tracking(-0.4)
                Spacer()
            }
            .padding(.horizontal, LHSpacing.md)
            .padding(.top, LHSpacing.lg)
            .padding(.bottom, LHSpacing.md)

            ScrollView {
                VStack(alignment: .leading, spacing: LHSpacing.xs) {
                    SidebarDestinationButton("Home", symbol: "house", destination: .today, selection: $selection)
                    SidebarDestinationButton("Study Plan", symbol: "calendar.badge.clock", destination: .planner, selection: $selection)
                    SidebarDestinationButton("Library", symbol: "books.vertical", destination: .library, selection: $selection)
                    SidebarDestinationButton("Canvas", symbol: "point.3.filled.connected.trianglepath.dotted", destination: .canvas, selection: $selection)

                    SidebarSectionTitle("Classes")
                    ForEach(store.spaces.filter { $0.kind == .class }) { space in
                        SidebarSpaceButton(space: space, selection: $selection)
                    }

                    SidebarSectionTitle("Tracks")
                    ForEach(store.spaces.filter { $0.kind == .track }) { space in
                        SidebarSpaceButton(space: space, selection: $selection)
                    }
                }
                .padding(.horizontal, LHSpacing.xs)
                .padding(.bottom, LHSpacing.md)
            }

            VStack(spacing: LHSpacing.xxs) {
                let waiting = store.jobs.filter { $0.state == .waitingForMac || $0.state == .queued }.count
                SidebarDestinationButton(
                    "Capture Inbox",
                    symbol: "tray.and.arrow.down",
                    badge: waiting > 0 ? "\(waiting)" : nil,
                    destination: .capture,
                    selection: $selection
                )
                SidebarDestinationButton("Settings", symbol: "gearshape", destination: .integrations, selection: $selection)
            }
            .padding(LHSpacing.xs)
            .overlay(alignment: .top) {
                Rectangle().fill(.white.opacity(0.09)).frame(height: 1)
            }
        }
        .foregroundStyle(.white)
        .background(LearningPalette.graphite)
        .accessibilityElement(children: .contain)
    }
}

private struct SidebarDestinationButton: View {
    let title: String
    let symbol: String
    let badge: String?
    let destination: AppDestination
    @Binding var selection: AppDestination

    init(
        _ title: String,
        symbol: String,
        badge: String? = nil,
        destination: AppDestination,
        selection: Binding<AppDestination>
    ) {
        self.title = title
        self.symbol = symbol
        self.badge = badge
        self.destination = destination
        _selection = selection
    }

    private var isSelected: Bool { selection == destination }

    var body: some View {
        Button {
            withAnimation(LHMotion.direct) { selection = destination }
        } label: {
            HStack(spacing: LHSpacing.sm) {
                Image(systemName: symbol)
                    .font(.system(size: 14, weight: .semibold))
                    .frame(width: 20)
                Text(title).font(.subheadline.weight(isSelected ? .semibold : .medium))
                Spacer(minLength: LHSpacing.xs)
                if let badge {
                    Text(badge)
                        .font(.caption2.weight(.bold).monospacedDigit())
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.white.opacity(0.11), in: Capsule())
                }
            }
            .foregroundStyle(isSelected ? .white : .white.opacity(0.68))
            .padding(.horizontal, LHSpacing.sm)
            .frame(maxWidth: .infinity, minHeight: 39, alignment: .leading)
            .background(isSelected ? LearningPalette.graphiteSoft : .clear, in: RoundedRectangle(cornerRadius: LHRadius.control, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

private struct SidebarSectionTitle: View {
    let title: String
    init(_ title: String) { self.title = title }

    var body: some View {
        Text(title.uppercased())
            .font(.caption2.weight(.bold))
            .tracking(1.15)
            .foregroundStyle(.white.opacity(0.38))
            .padding(.horizontal, LHSpacing.sm)
            .padding(.top, LHSpacing.lg)
            .padding(.bottom, LHSpacing.xxs)
    }
}

private struct SidebarSpaceButton: View {
    let space: StudySpace
    @Binding var selection: AppDestination

    private var destination: AppDestination { .space(space.id) }
    private var isSelected: Bool { selection == destination }

    var body: some View {
        Button {
            withAnimation(LHMotion.direct) { selection = destination }
        } label: {
            HStack(spacing: LHSpacing.sm) {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(Color(hex: space.colorHex))
                    .frame(width: 10, height: 10)
                VStack(alignment: .leading, spacing: 1) {
                    Text(space.title)
                        .font(.subheadline.weight(isSelected ? .semibold : .medium))
                        .lineLimit(1)
                    Text(space.subtitle)
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.42))
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(isSelected ? .white : .white.opacity(0.7))
            .padding(.horizontal, LHSpacing.sm)
            .frame(maxWidth: .infinity, minHeight: 45, alignment: .leading)
            .background(isSelected ? LearningPalette.graphiteSoft : .clear, in: RoundedRectangle(cornerRadius: LHRadius.control, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

private struct CanvasLibraryDestinationView: View {
    @EnvironmentObject private var store: LearningHomeStore

    var body: some View {
        HSplitView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Study Canvas")
                        .font(.title2.weight(.semibold))
                    Text("Persistent visual lessons")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(LHSpacing.md)

                Divider()

                ScrollView {
                    LazyVStack(spacing: LHSpacing.xs) {
                        ForEach(store.canvases) { artifact in
                            Button {
                                store.selectedCanvasID = artifact.id
                                store.selectedSpaceID = artifact.spaceID
                            } label: {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(artifact.title)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(.primary)
                                        .lineLimit(2)
                                    HStack {
                                        Text(store.space(id: artifact.spaceID)?.title ?? "Study")
                                        Spacer()
                                        Text("v\(artifact.version)").monospacedDigit()
                                    }
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                }
                                .padding(LHSpacing.sm)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(
                                    store.selectedCanvasID == artifact.id ? LearningPalette.copperMuted : .clear,
                                    in: RoundedRectangle(cornerRadius: LHRadius.control, style: .continuous)
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(LHSpacing.xs)
                }
            }
            .frame(minWidth: 210, idealWidth: 240, maxWidth: 280)
            .background(LearningPalette.secondarySurface)

            if let artifact = selectedArtifact,
               let space = store.space(id: artifact.spaceID) {
                StudyCanvasView(artifact: artifact, space: space)
            } else {
                ContentUnavailableView(
                    "No canvas yet",
                    systemImage: "point.3.filled.connected.trianglepath.dotted",
                    description: Text("Ask a tutor to visualize a topic, then save it here.")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(LearningPalette.appBackground)
            }
        }
        .onAppear {
            if store.selectedCanvasID == nil { store.selectedCanvasID = store.canvases.first?.id }
        }
    }

    private var selectedArtifact: CanvasArtifact? {
        store.canvases.first(where: { $0.id == store.selectedCanvasID }) ?? store.canvases.first
    }
}
#endif

#if os(iOS)
private struct MobileLearningHomeRootView: View {
    @EnvironmentObject private var store: LearningHomeStore
    @ViewStorage private var selectedTab = 0
    @ViewStorage private var showingPlan = false
    @State private var homePath: [UUID] = []

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack(path: $homePath) {
                TodayView(
                    openSpace: { id in
                        store.selectedSpaceID = id
                        homePath.append(id)
                    },
                    openPlan: { showingPlan = true }
                )
                .navigationDestination(for: UUID.self) { id in
                    if let space = store.space(id: id) {
                        StudySpaceView(space: space)
                    } else {
                        ContentUnavailableView("Space unavailable", systemImage: "books.vertical")
                    }
                }
            }
                .tabItem { Label("Home", systemImage: "house") }
                .tag(0)
            MobileSpacesView()
                .tabItem { Label("Classes", systemImage: "books.vertical") }
                .tag(1)
            NavigationStack { CaptureView() }
                .tabItem { Label("Capture", systemImage: "plus.viewfinder") }
                .tag(2)
            NavigationStack { SourceLibraryView() }
                .tabItem { Label("Library", systemImage: "books.vertical.fill") }
                .tag(3)
        }
        .tint(LearningPalette.copper)
        .safeAreaInset(edge: .top, spacing: 0) { PersistenceRecoveryBanner() }
        .sheet(isPresented: $showingPlan) {
            NavigationStack { StudyPlannerView() }
        }
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
    @ViewStorage private var colorHex = "#54706A"
    @ViewStorage private var tutorStyle = TutorStyle.coachFirst
    @ViewStorage private var errorMessage: String?
    let onCreate: (StudySpace) -> Void

    private let colors = ["#54706A", "#9D4E31", "#6C6A61", "#7A6651", "#3F765A", "#A34848"]

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
