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
            Form {
                Section("Connection") {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: connectorSymbol)
                            .font(.title2)
                            .foregroundStyle(connectorColor)
                            .frame(width: 28)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(connectorTitle).font(.headline)
                            Text(connectorDetail).font(.callout).foregroundStyle(.secondary)
                            Text("The passive status check contacts Google but never refreshes or rewrites your saved session. NotebookLM is unofficial, optional, and never blocks your local library.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 12)
                        if isCheckingConnection { ProgressView().controlSize(.small) }
                    }

                    HStack {
                        Button("Check again") { Task { await refreshConnection() } }
                            .disabled(isCheckingConnection || isWorking)
                        if connectorState != .ready {
                            Button(showingSetup ? "Hide setup" : "Set up NotebookLM") {
                                showingSetup.toggle()
                            }
                        }
                    }

                    if showingSetup, connectorState != .ready {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(setupTitle).font(.headline)
                            Text(setupDetail).font(.callout).foregroundStyle(.secondary)
                            if let command = setupCommand {
                                Text(command)
                                    .font(.caption.monospaced())
                                    .textSelection(.enabled)
                                    .padding(10)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 6))
                                Button("Copy setup command") { copyToPasteboard(command) }
                            }
                            Text("The Desk never installs packages or opens a sign-in window automatically. Run the copied command when you are ready, then choose Check again.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }

                Section("Class notebook") {
                    Picker("Space", selection: Binding(
                        get: { selectedSpaceID ?? store.selectedSpaceID },
                        set: { selectedSpaceID = $0; selectedSourceID = nil }
                    )) {
                        ForEach(store.spaces) { Text($0.title).tag(Optional($0.id)) }
                    }
                    TextField("Notebook ID", text: $notebookID)
                    HStack {
                        Button("List notebooks") { runList() }
                            .disabled(!connectorIsReady || isWorking)
                        Button("Create for this space") { runCreate() }
                            .disabled(!connectorIsReady || isWorking || selectedSpace == nil)
                    }
                }

                Section("Selected-source mirror") {
                    Picker("Source", selection: $selectedSourceID) {
                        Text("Choose a source").tag(UUID?.none)
                        ForEach(availableSources) { Text($0.title).tag(Optional($0.id)) }
                    }
                    Button("Mirror original into NotebookLM") { runMirror() }
                        .disabled(!connectorIsReady || isWorking || notebookID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || selectedSourceID == nil)
                    Text("Only the selected original is mirrored. NotebookLM is optional and never becomes The Desk's canonical library.")
                        .font(.caption).foregroundStyle(.secondary)
                }

                Section("Ask the selected notebook") {
                    TextField("Question", text: $question, axis: .vertical).lineLimit(2...5)
                    Button("Ask NotebookLM") { runAsk() }
                        .disabled(!connectorIsReady || isWorking || notebookID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }

                Section("Connector result") {
                    if isWorking { ProgressView("Waiting for the Mac connector…") }
                    if let noticeMessage {
                        Label(noticeMessage, systemImage: "info.circle")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    Text(output.isEmpty ? "No connector action has run yet." : output)
                        .font(.callout.monospaced())
                        .textSelection(.enabled)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("NotebookLM secondary engine")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        }
        .frame(minWidth: 620, minHeight: 600)
        .task { await refreshConnection() }
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
        default: LearningPalette.indigo
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
