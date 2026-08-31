import SwiftUI
#if os(macOS)
import AppKit
#endif

/// Explicit Mac-side NotebookLM workspace. The Desk remains canonical; every
/// create, mirror, and query action is initiated here and can fail independently.
public struct NotebookLMManagerView: View {
    @EnvironmentObject private var store: LearningHomeStore
    @Environment(\.dismiss) private var dismiss
    @ViewStorage private var selectedSpaceID: UUID?
    @ViewStorage private var selectedSourceID: UUID?
    @ViewStorage private var notebookID = ""
    @ViewStorage private var question = ""
    @ViewStorage private var output = ""
    @ViewStorage private var isWorking = false
    @ViewStorage private var isCheckingConnection = false
    @ViewStorage private var connectorState: ConnectorHealthState = .disconnected
    @ViewStorage private var connectorDetail = "Checking the optional Mac connector…"
    @ViewStorage private var showingSetup = false
    @ViewStorage private var noticeMessage: String?
    @ViewStorage private var recoveryCommand: String?

    public init() {}

    private var selectedSpace: StudySpace? {
        store.space(id: selectedSpaceID ?? store.selectedSpaceID)
    }

    private var availableSources: [SourceAsset] {
        selectedSpace.map { store.sources(in: $0.id) } ?? []
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: LHSpacing.lg) {
                    DeskPageHeader(
                        "NotebookLM companion",
                        eyebrow: "Optional secondary engine",
                        detail: "Mirror only what you choose. The Desk remains your complete, canonical study library."
                    )

                    connectionCard

                    if connectorIsReady {
                        workspaceCard
                        mirrorCard
                        askCard
                    } else {
                        pausedWorkspaceCard
                    }

                    resultCard
                }
                .padding(.horizontal, LHSpacing.xl)
                .padding(.vertical, LHSpacing.lg)
                .frame(maxWidth: 860, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(LearningPalette.appBackground)
            .navigationTitle("NotebookLM")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .frame(minWidth: 620, minHeight: 600)
        .task { await refreshConnection() }
    }

    private var connectionCard: some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            HStack(alignment: .top, spacing: LHSpacing.md) {
                Image(systemName: connectorSymbol)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(connectorState == .ready ? LearningPalette.primaryForeground : connectorColor)
                    .frame(width: 44, height: 44)
                    .background(connectorState == .ready ? connectorColor : connectorColor.opacity(0.12), in: RoundedRectangle(cornerRadius: LHRadius.control, style: .continuous))
                VStack(alignment: .leading, spacing: LHSpacing.xxs) {
                    HStack(spacing: LHSpacing.xs) {
                        Text(connectorTitle)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(LearningPalette.ink)
                        StatusPill(connectorIsReady ? "Available" : "Optional", symbol: connectorIsReady ? "checkmark" : "pause", tone: connectorIsReady ? .success : .neutral)
                    }
                    Text(connectorDetail)
                        .font(.subheadline)
                        .foregroundStyle(LearningPalette.mutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: LHSpacing.sm)
                if isCheckingConnection {
                    ProgressView()
                        .controlSize(.small)
                        .tint(LearningPalette.copper)
                        .accessibilityLabel("Checking NotebookLM connection")
                }
            }

            Text("A passive status check may contact Google, but it never refreshes or rewrites your saved session. If this connector is unavailable, every local study feature still works.")
                .font(.caption)
                .foregroundStyle(LearningPalette.mutedInk)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: LHSpacing.sm) {
                Button { Task { await refreshConnection() } } label: {
                    Label("Check connection", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .tint(LearningPalette.copper)
                .disabled(isCheckingConnection || isWorking)

                if connectorState != .ready {
                    Button(showingSetup ? "Hide setup" : "Show setup") {
                        showingSetup.toggle()
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(LearningPalette.copper)
                }
            }

            if showingSetup, connectorState != .ready {
                setupCard
            }
        }
        .padding(LHSpacing.lg)
        .learningSurface()
    }

    private var setupCard: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            Label(setupTitle, systemImage: "wrench.and.screwdriver")
                .font(.headline)
                .foregroundStyle(LearningPalette.ink)
            Text(setupDetail)
                .font(.callout)
                .foregroundStyle(LearningPalette.mutedInk)
                .fixedSize(horizontal: false, vertical: true)
            if let command = setupCommand {
                Text(command)
                    .font(.caption.monospaced())
                    .foregroundStyle(LearningPalette.onGraphite)
                    .textSelection(.enabled)
                    .padding(LHSpacing.sm)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(LearningPalette.graphite, in: RoundedRectangle(cornerRadius: LHRadius.control, style: .continuous))
                Button { copyToPasteboard(command) } label: {
                    Label("Copy setup command", systemImage: "doc.on.doc")
                }
                .buttonStyle(.borderedProminent)
                .tint(LearningPalette.copper)
            }
            Text("Nothing installs and no browser opens until you run the copied command yourself. Return here and check the connection afterward.")
                .font(.caption)
                .foregroundStyle(LearningPalette.mutedInk)
        }
        .padding(LHSpacing.md)
        .background(LearningPalette.copperSoft, in: RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous))
    }

    private var workspaceCard: some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            SectionHeading("Class notebook", detail: "Link or create one NotebookLM notebook for the selected class or track.")
            Picker("Space", selection: Binding(
                get: { selectedSpaceID ?? store.selectedSpaceID },
                set: { selectedSpaceID = $0; selectedSourceID = nil }
            )) {
                ForEach(store.spaces) { Text($0.title).tag(Optional($0.id)) }
            }
            TextField("Notebook ID", text: $notebookID)
                .textFieldStyle(.roundedBorder)
            HStack(spacing: LHSpacing.sm) {
                Button("List notebooks") { runList() }
                    .disabled(isWorking)
                Button("Create for this space") { runCreate() }
                    .buttonStyle(.borderedProminent)
                    .tint(LearningPalette.copper)
                    .disabled(isWorking || selectedSpace == nil)
            }
        }
        .padding(LHSpacing.lg)
        .learningSurface()
    }

    private var mirrorCard: some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            SectionHeading("Mirror one source", detail: "NotebookLM receives only the original you explicitly select.")
            Picker("Source", selection: $selectedSourceID) {
                Text("Choose a source").tag(UUID?.none)
                ForEach(availableSources) { Text($0.title).tag(Optional($0.id)) }
            }
            Button { runMirror() } label: {
                Label("Mirror selected original", systemImage: "arrow.up.doc")
            }
            .buttonStyle(.borderedProminent)
            .tint(LearningPalette.copper)
            .disabled(isWorking || notebookID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || selectedSourceID == nil)
            Label("Your original and citations stay in The Desk.", systemImage: "lock.doc")
                .font(.caption)
                .foregroundStyle(LearningPalette.mutedInk)
        }
        .padding(LHSpacing.lg)
        .learningSurface(emphasized: false)
    }

    private var askCard: some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            SectionHeading("Ask NotebookLM", detail: "Run an explicit query against the linked notebook.")
            TextField("What should I understand from these sources?", text: $question, axis: .vertical)
                .lineLimit(2...5)
                .textFieldStyle(.roundedBorder)
            Button { runAsk() } label: {
                Label("Ask selected notebook", systemImage: "sparkles")
            }
            .buttonStyle(.borderedProminent)
            .tint(LearningPalette.copper)
            .disabled(isWorking || notebookID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(LHSpacing.lg)
        .learningSurface()
    }

    private var pausedWorkspaceCard: some View {
        HStack(alignment: .top, spacing: LHSpacing.md) {
            Image(systemName: "books.vertical")
                .font(.title2)
                .foregroundStyle(LearningPalette.moss)
            VStack(alignment: .leading, spacing: LHSpacing.xxs) {
                Text("Your Desk library is ready without NotebookLM")
                    .font(.headline)
                    .foregroundStyle(LearningPalette.ink)
                Text("You can keep importing, searching, studying, and building canvases now. Set up this optional companion whenever it becomes useful.")
                    .font(.subheadline)
                    .foregroundStyle(LearningPalette.mutedInk)
            }
        }
        .padding(LHSpacing.lg)
        .background(LearningPalette.mossSoft)
        .clipShape(RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous))
    }

    private var resultCard: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            HStack {
                Text("Connector activity")
                    .font(.headline)
                    .foregroundStyle(LearningPalette.ink)
                Spacer()
                if isWorking {
                    ProgressView()
                        .controlSize(.small)
                        .tint(LearningPalette.copper)
                        .accessibilityLabel("Waiting for NotebookLM")
                }
            }
            if let noticeMessage {
                Label(noticeMessage, systemImage: "info.circle")
                    .font(.callout)
                    .foregroundStyle(LearningPalette.mutedInk)
            }
            Text(output.isEmpty ? "No NotebookLM action has run in this session." : output)
                .font(.callout.monospaced())
                .foregroundStyle(output.isEmpty ? LearningPalette.mutedInk : LearningPalette.ink)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(LHSpacing.lg)
        .learningSurface(emphasized: false)
    }

    private var connectorIsReady: Bool { connectorState == .ready }

    private var connectorTitle: String {
        switch connectorState {
        case .ready: "Connected"
        case .managedRuntimeMissing: "Mac engine setup needed"
        case .packageMissing: "Connector setup needed"
        case .needsAuthentication: "Google sign-in needed"
        case .transientFailure, .degraded: "Temporarily unavailable"
        case .disconnected: "Checking connection"
        case .unavailable: "Unavailable"
        }
    }

    private var connectorSymbol: String {
        switch connectorState {
        case .ready: "checkmark.circle.fill"
        case .disconnected: "clock"
        case .transientFailure, .degraded: "arrow.clockwise.circle"
        default: "wrench.and.screwdriver.fill"
        }
    }

    private var connectorColor: Color {
        switch connectorState {
        case .ready: LearningPalette.success
        case .transientFailure, .degraded: LearningPalette.warning
        case .disconnected: .secondary
        default: LearningPalette.copper
        }
    }

    private var setupTitle: String {
        switch connectorState {
        case .managedRuntimeMissing: "Install Python 3.14"
        case .packageMissing: "Install the pinned connector"
        case .needsAuthentication: "Sign in once with Google"
        case .transientFailure, .degraded: "Try the connection again"
        default: "Finish connector setup"
        }
    }

    private var setupDetail: String {
        switch connectorState {
        case .managedRuntimeMissing:
            "The Desk bundles its connector bridge but not Python. The copied command opens Python's official macOS download page in the background; choose a Python 3.14 installer, finish installation, then return here and check again."
        case .packageMissing:
            "This creates an isolated runtime in The Desk's Application Support folder and installs notebooklm-py \(NotebookLMSecondaryConnector.pinnedPackageVersion)."
        case .needsAuthentication:
            "The copied command starts notebooklm-py's browser-based login. The resulting Google session stays on this Mac and must never be committed or synced."
        case .transientFailure, .degraded:
            "The package is present, but its health check did not complete. Check your connection and try again; reinstalling is not required."
        default:
            "Follow the next step, then check the connection again."
        }
    }

    private var setupCommand: String? {
        recoveryCommand
    }

    @MainActor
    private func refreshConnection() async {
        isCheckingConnection = true
        let health = await NotebookLMSecondaryConnector().health()
        connectorState = health.state
        connectorDetail = health.detail
        recoveryCommand = health.recoveryCommand
        if health.state == .ready {
            showingSetup = false
            noticeMessage = nil
        }
        isCheckingConnection = false
    }

    @MainActor
    private func copyToPasteboard(_ value: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
        noticeMessage = "Setup command copied. The Desk did not open or activate another app."
        #else
        noticeMessage = "Select the command above to copy it on this device."
        #endif
    }

    private func runList() {
        perform {
            let result = try await NotebookLMSecondaryConnector().listNotebooks()
            return (result, result.firstString(for: ["id", "notebook_id", "notebookId"]))
        }
    }

    private func runCreate() {
        guard let selectedSpace else { return }
        let title = selectedSpace.title
        perform {
            let result = try await NotebookLMSecondaryConnector().createNotebook(title: title)
            return (result, result.firstString(for: ["id", "notebook_id", "notebookId"]))
        }
    }

    private func runMirror() {
        guard let selectedSourceID,
              let revision = store.latestRevision(for: selectedSourceID) else { return }
        let fileURL = revision.originalFilePath.isEmpty ? nil : URL(fileURLWithPath: revision.originalFilePath)
        let selectedNotebookID = notebookID
        perform {
            let result = try await NotebookLMSecondaryConnector().mirror(fileURL: fileURL, notebookID: selectedNotebookID)
            return (result, nil)
        }
    }

    private func runAsk() {
        let selectedNotebookID = notebookID
        let prompt = question
        perform {
            let result = try await NotebookLMSecondaryConnector().ask(notebookID: selectedNotebookID, prompt: prompt)
            return (result, nil)
        }
    }

    @MainActor
    private func perform(_ operation: @escaping () async throws -> (JSONValue, String?)) {
        isWorking = true
        output = ""
        noticeMessage = nil
        Task {
            do {
                let (result, discoveredID) = try await operation()
                if let discoveredID { notebookID = discoveredID }
                output = result.prettyPrinted
            } catch {
                noticeMessage = error.localizedDescription
                await refreshConnection()
            }
            isWorking = false
        }
    }
}

private extension JSONValue {
    func firstString(for keys: Set<String>) -> String? {
        switch self {
        case .object(let object):
            for key in keys {
                if case .some(.string(let value)) = object[key], !value.isEmpty { return value }
            }
            return object.values.lazy.compactMap { $0.firstString(for: keys) }.first
        case .array(let values):
            return values.lazy.compactMap { $0.firstString(for: keys) }.first
        default:
            return nil
        }
    }

    var prettyPrinted: String {
        guard let data = try? JSONEncoder().encode(self),
              let object = try? JSONSerialization.jsonObject(with: data),
              let pretty = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]) else {
            return String(describing: self)
        }
        return String(decoding: pretty, as: UTF8.self)
    }
}
