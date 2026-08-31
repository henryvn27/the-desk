import SwiftUI

private enum CodexLoginPhase: Equatable {
    case idle
    case starting
    case waiting
    case timedOut
}

public struct IntegrationsView: View {
    @EnvironmentObject private var store: LearningHomeStore
    @ViewStorage private var engineHealth: EngineHealth?
    @ViewStorage private var codexAccount = "Checking…"
    @ViewStorage private var codexIsConnected = false
    @ViewStorage private var codexLoginPhase: CodexLoginPhase = .idle
    @ViewStorage private var codexLoginTask: Task<Void, Never>?
    @ViewStorage private var notebookDetail = "Checking managed environment…"
    @ViewStorage private var isRefreshing = false
    @ViewStorage private var deviceLogin: CodexDeviceLogin?
    @ViewStorage private var providerKeys: [ProviderIdentifier: String] = [:]
    @ViewStorage private var providerAvailability: [ProviderIdentifier: Bool] = [:]
    @ViewStorage private var message = ""
    @ViewStorage private var errorMessage: String?
    @ViewStorage private var showingNotebookLMManager = false

    public init() {}

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LHSpacing.lg) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Integrations")
                        .font(.system(.largeTitle, design: .serif, weight: .semibold))
                    Text("External services are optional and independently health-checked. Local sources and saved canvases keep working when one fails.")
                        .foregroundStyle(.secondary)
                }

                codexSection
                byokSection
                studyConnectorSection
                privacySection
            }
            .padding(LHSpacing.lg)
            .frame(maxWidth: 920, alignment: .leading)
        }
        .background(LearningPalette.appBackground)
        .navigationTitle("Integrations")
        .task { await refresh() }
        .onDisappear {
            codexLoginTask?.cancel()
            codexLoginTask = nil
        }
        .alert("Integration needs attention", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "Unknown error") }
        .sheet(isPresented: $showingNotebookLMManager) {
            NotebookLMManagerView()
                .environmentObject(store)
        }
    }

    private var codexSection: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            SectionHeading("Default AI · Codex plan", detail: "Connect the ChatGPT plan already used by Codex on this Mac. No API key or separate billing.")
            VStack(alignment: .leading, spacing: LHSpacing.md) {
                HStack(alignment: .top, spacing: LHSpacing.md) {
                    IntegrationIcon(symbol: "cpu", tint: codexIsConnected ? LearningPalette.success : LearningPalette.indigo)
                    VStack(alignment: .leading, spacing: 5) {
                        Text("ChatGPT through Codex").font(.headline)
                        Text(codexAccount).font(.subheadline).foregroundStyle(.secondary)
                        if let version = engineHealth?.codex.version {
                            Text("Pinned runtime · \(version)")
                                .font(.caption.monospaced())
                                .foregroundStyle(.tertiary)
                        }
                    }
                    Spacer()
                    StatusPill(codexStatusLabel, symbol: codexStatusSymbol, tone: codexStatusTone)
                }

                if let deviceLogin {
                    VStack(alignment: .leading, spacing: LHSpacing.sm) {
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Enter this one-time code")
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(.secondary)
                                Text(deviceLogin.userCode ?? "Code unavailable")
                                    .font(.title2.weight(.semibold).monospaced())
                                    .textSelection(.enabled)
                            }
                            Spacer()
                            if codexLoginPhase == .waiting {
                                ProgressView().controlSize(.small).accessibilityLabel("Checking ChatGPT connection")
                            }
                        }
                        Text(loginInstruction)
                            .font(.caption)
                            .foregroundStyle(codexLoginPhase == .timedOut ? LearningPalette.warning : .secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        HStack {
                            if let url = deviceLogin.verificationURL {
                                Link("Open ChatGPT sign-in", destination: url)
                                    .buttonStyle(.borderedProminent)
                            }
                            Button("Cancel") { cancelCodexLogin() }
                                .buttonStyle(.bordered)
                            if codexLoginPhase == .timedOut {
                                Button("Try a new code") { startCodexLogin() }
                                    .buttonStyle(.bordered)
                            }
                        }
                    }
                    .padding(LHSpacing.md)
                    .background(LearningPalette.indigo.opacity(0.07), in: RoundedRectangle(cornerRadius: LHRadius.control))
                    .accessibilityElement(children: .contain)
                }

                HStack {
                    if !codexIsConnected && deviceLogin == nil {
                        Button("Connect ChatGPT") { startCodexLogin() }
                            .buttonStyle(.borderedProminent)
                            .disabled(engineHealth?.codex.available != true || codexLoginPhase == .starting)
                    }
                    if codexLoginPhase == .starting {
                        ProgressView().controlSize(.small)
                        Text("Creating a secure sign-in code…").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button {
                        Task { await refresh() }
                    } label: {
                        Label("Check now", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                    .disabled(isRefreshing)
                }
            }
            .padding(LHSpacing.md)
            .learningSurface()
        }
    }

    private var byokSection: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            SectionHeading("Bring your own provider", detail: "Keys stay in this Mac’s Keychain and never enter CloudKit.")
            ForEach([ProviderIdentifier.openAI, .anthropic, .gemini], id: \.rawValue) { provider in
                HStack(spacing: LHSpacing.md) {
                    IntegrationIcon(symbol: providerSymbol(provider), tint: providerTint(provider))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(provider.title).font(.headline)
                        Text(providerAvailability[provider] == true ? "Configured on this Mac" : "Separate API billing")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    SecureField("API key", text: Binding(
                        get: { providerKeys[provider] ?? "" },
                        set: { providerKeys[provider] = $0 }
                    ))
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 240)
                    Button("Save") { saveKey(provider) }
                        .buttonStyle(.borderedProminent)
                        .disabled((providerKeys[provider] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if providerAvailability[provider] == true {
                        Button(role: .destructive) { removeKey(provider) } label: { Image(systemName: "trash") }
                            .buttonStyle(.bordered)
                    }
                }
                .padding(LHSpacing.md)
                .learningSurface()
            }
        }
    }

    private var studyConnectorSection: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            SectionHeading("Study sources and tasks", detail: "Permissions and proof boundaries are visible before you connect.")
            #if os(macOS)
            ConnectorCard(
                title: "Apple & Google Calendar",
                symbol: "calendar.badge.clock",
                detail: "Creates only time blocks you approve in a selected Apple or Google calendar configured on this Mac. Other setups can use .ics export from Study Plan.",
                status: integrationStatus("calendar"),
                badge: "Approved blocks only",
                action: "Check calendars"
            ) { requestCalendars() }
            #endif
            ConnectorCard(
                title: "Apple Reminders",
                symbol: "checklist",
                detail: "Two-way sync for The Desk-created or explicitly linked reminders only.",
                status: integrationStatus("reminders"),
                badge: "Scoped write",
                action: "Allow access"
            ) { requestReminders() }
            ConnectorCard(
                title: "Google Classroom",
                symbol: "graduationcap",
                detail: "Read-only courses, coursework, due dates, grades, and your submission state. The Desk cannot submit.",
                status: integrationStatus("classroom"),
                badge: "Read only",
                action: "Configure OAuth"
            ) { message = "Add a Google OAuth client in the generated Xcode project before authorizing Classroom." }
            ConnectorCard(
                title: "Wispr Flow",
                symbol: "quote.bubble",
                detail: "Imports completed meeting transcripts and summaries through the read-only MCP connector.",
                status: integrationStatus("wispr"),
                badge: "Read only",
                action: "Connector required"
            ) { message = "Wispr stays disconnected until its read-only MCP session is available to the Mac engine." }
            ConnectorCard(
                title: "NotebookLM",
                symbol: "notebook",
                detail: notebookDetail,
                status: engineHealth?.notebooklm.authenticated == true ? "ready" : (engineHealth?.notebooklm.available == true ? "needs-authentication" : "optional-unavailable"),
                badge: "Secondary engine",
                action: "Manage"
            ) { showingNotebookLMManager = true }
            ConnectorCard(
                title: "Khan Academy",
                symbol: "play.rectangle",
                detail: "Stores course and lesson links, then records score, confidence, and next step after you return. No scraping.",
                status: "ready",
                badge: "Links + check-ins",
                action: nil,
                actionHandler: {}
            )
            if !message.isEmpty {
                Text(message).font(.subheadline).foregroundStyle(.secondary).padding(LHSpacing.sm)
            }
        }
    }

    private var privacySection: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            SectionHeading("Execution boundary")
            HStack(alignment: .top, spacing: LHSpacing.md) {
                Image(systemName: "lock.shield.fill").font(.title2).foregroundStyle(LearningPalette.success)
                Text("The Mac is the only AI execution host. Companion devices upload private captures and typed jobs through the user’s iCloud account. Provider keys, Codex sessions, logs, and raw screen captures never sync to iPhone or iPad.")
                    .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .padding(LHSpacing.md)
            .learningSurface(emphasized: false)
        }
    }

    private func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let health = try await LearningEngineClient.shared.health()
            engineHealth = health
            notebookDetail = health.notebooklm.detail
            if health.codex.available {
                _ = await updateCodexAccount(showSignedOutMessage: deviceLogin == nil)
            } else {
                codexIsConnected = false
                codexLoginPhase = .idle
                deviceLogin = nil
                codexAccount = "The compatible Codex runtime was not found. Install or update the ChatGPT Mac app, then check again."
            }
        } catch {
            engineHealth = nil
            codexIsConnected = false
            codexAccount = "Mac engine unavailable"
            notebookDetail = error.localizedDescription
        }
        providerAvailability = await AIHarness.shared.availability()
    }

    private func startCodexLogin() {
        guard engineHealth?.codex.available == true else {
            errorMessage = "A compatible pinned Codex runtime is required before ChatGPT can connect."
            return
        }
        codexLoginTask?.cancel()
        deviceLogin = nil
        codexLoginPhase = .starting
        codexAccount = "Preparing ChatGPT sign-in…"
        codexLoginTask = Task {
            do {
                let events = try await LearningEngineClient.shared.codexDeviceLoginEvents()
                for try await event in events {
                    guard !Task.isCancelled else { return }
                    switch event {
                    case .started(let login):
                        deviceLogin = login
                        codexLoginPhase = .waiting
                        codexAccount = "Waiting for ChatGPT approval"
                    case .completed(let completion):
                        if completion.success {
                            codexAccount = "ChatGPT approved · confirming connection…"
                            if await confirmCodexAccount() {
                                message = "ChatGPT is connected through Codex."
                            } else {
                                codexLoginPhase = .idle
                                deviceLogin = nil
                                codexAccount = "ChatGPT approved; connection status is still updating"
                                message = "Choose Check now in a moment if the connected state does not appear."
                            }
                        } else {
                            codexLoginPhase = completion.error?.localizedCaseInsensitiveContains("five minutes") == true ? .timedOut : .idle
                            codexAccount = "ChatGPT sign-in was not completed"
                            if codexLoginPhase == .idle { deviceLogin = nil }
                            errorMessage = completion.error ?? "ChatGPT did not complete sign-in."
                        }
                    }
                }
            } catch is CancellationError {
                codexLoginPhase = .idle
                deviceLogin = nil
            } catch {
                codexLoginPhase = .idle
                deviceLogin = nil
                codexAccount = "ChatGPT sign-in could not start"
                errorMessage = error.localizedDescription
            }
            codexLoginTask = nil
        }
    }

    private func confirmCodexAccount() async -> Bool {
        for attempt in 0..<5 {
            if await updateCodexAccount(showSignedOutMessage: false) { return true }
            if attempt < 4 {
                do { try await Task.sleep(nanoseconds: 500_000_000) }
                catch { return false }
            }
        }
        return false
    }

    @discardableResult
    private func updateCodexAccount(showSignedOutMessage: Bool) async -> Bool {
        do {
            let envelope = try await LearningEngineClient.shared.codexAccount()
            let status = CodexAccountStatus(envelope)
            codexIsConnected = status.isConnectedWithChatGPT
            if status.isConnectedWithChatGPT {
                codexAccount = status.summary
                codexLoginPhase = .idle
                deviceLogin = nil
                return true
            }
            if showSignedOutMessage { codexAccount = status.summary }
        } catch {
            codexIsConnected = false
            if showSignedOutMessage { codexAccount = "Runtime ready · ChatGPT sign-in required" }
        }
        return false
    }

    private func cancelCodexLogin() {
        codexLoginTask?.cancel()
        codexLoginTask = nil
        deviceLogin = nil
        codexLoginPhase = .idle
        codexAccount = "ChatGPT sign-in canceled"
        message = "Canceled this one-time sign-in. No browser was opened by The Desk."
    }

    private var codexStatusLabel: String {
        if codexIsConnected { return "Connected" }
        if engineHealth?.codex.available != true { return "Runtime missing" }
        switch codexLoginPhase {
        case .starting: return "Starting"
        case .waiting: return "Waiting"
        case .timedOut: return "Check needed"
        case .idle: return "Not connected"
        }
    }

    private var codexStatusSymbol: String {
        if codexIsConnected { return "checkmark.circle.fill" }
        switch codexLoginPhase {
        case .starting, .waiting: return "clock"
        case .timedOut: return "exclamationmark.triangle"
        case .idle: return engineHealth?.codex.available == true ? "person.crop.circle.badge.plus" : "desktopcomputer.trianglebadge.exclamationmark"
        }
    }

    private var codexStatusTone: StatusPill.Tone {
        if codexIsConnected { return .success }
        switch codexLoginPhase {
        case .starting, .waiting: return .info
        case .timedOut: return .warning
        case .idle: return engineHealth?.codex.available == true ? .neutral : .warning
        }
    }

    private var loginInstruction: String {
        if codexLoginPhase == .timedOut {
            return "The Desk stopped checking after \(CodexLoginPolicy.timeoutDescription). You can check now or request a new code."
        }
        return "Open the sign-in page, enter the code, and approve Codex. The Desk confirms the connection automatically for \(CodexLoginPolicy.timeoutDescription)."
    }

    private func saveKey(_ provider: ProviderIdentifier) {
        do {
            try APIKeyStore.shared.set(providerKeys[provider] ?? "", for: provider)
            providerKeys[provider] = ""
            Task { await refresh() }
        } catch { errorMessage = error.localizedDescription }
    }

    private func removeKey(_ provider: ProviderIdentifier) {
        APIKeyStore.shared.remove(provider)
        providerAvailability[provider] = false
    }

    private func requestReminders() {
        Task {
            do {
                _ = try await ReminderConnector.shared.requestAccess()
                try store.updateIntegration(id: "reminders", status: "ready", detail: "Only The Desk-created or explicitly linked reminders sync.")
                let linked = try await ReminderConnector.shared.syncLinkedAssignments(store.assignments)
                for item in linked where item.isCompleted {
                    try store.appendEvidence(AssignmentEvidence(kind: .reminderCompleted, summary: "Linked reminder completed; external submission still unverified.", observedAt: item.completionDate ?? Date()), to: item.assignmentID)
                }
                message = "Reminders access is ready. \(linked.count) linked reminder\(linked.count == 1 ? "" : "s") checked."
            } catch { errorMessage = error.localizedDescription }
        }
    }

    #if os(macOS)
    private func requestCalendars() {
        Task {
            do {
                let calendars = try await StudyCalendarConnector.shared.writableCalendars()
                let googleCount = calendars.filter { $0.accountKind == .google }.count
                let detail = "\(calendars.count) writable calendar\(calendars.count == 1 ? "" : "s") available; \(googleCount) from Google. Choose the destination in Study Plan."
                try store.updateIntegration(id: "calendar", status: "ready", detail: detail)
                message = detail
            } catch { errorMessage = error.localizedDescription }
        }
    }
    #endif

    private func integrationStatus(_ id: String) -> String { store.integrations.first(where: { $0.id == id })?.statusRaw ?? "disconnected" }

    private func providerSymbol(_ provider: ProviderIdentifier) -> String {
        switch provider { case .openAI: "circle.hexagongrid"; case .anthropic: "textformat"; case .gemini: "sparkles"; default: "cpu" }
    }
    private func providerTint(_ provider: ProviderIdentifier) -> Color {
        switch provider { case .openAI: .teal; case .anthropic: .orange; case .gemini: .blue; default: LearningPalette.indigo }
    }
}

private struct IntegrationIcon: View {
    let symbol: String
    let tint: Color
    var body: some View {
        Image(systemName: symbol).font(.title3).foregroundStyle(tint)
            .frame(width: 42, height: 42)
            .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
    }
}

private struct ConnectorCard: View {
    let title: String
    let symbol: String
    let detail: String
    let status: String
    let badge: String
    let action: String?
    let actionHandler: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: LHSpacing.md) {
            IntegrationIcon(symbol: symbol, tint: tint)
            VStack(alignment: .leading, spacing: 4) {
                HStack { Text(title).font(.headline); StatusPill(badge, tone: .neutral) }
                Text(detail).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            StatusPill(statusLabel, symbol: status == "ready" ? "checkmark" : "gearshape", tone: status == "ready" ? .success : .warning)
            if let action { Button(action, action: actionHandler).buttonStyle(.bordered) }
        }
        .padding(LHSpacing.md)
        .learningSurface()
    }

    private var tint: Color { status == "ready" ? LearningPalette.success : LearningPalette.indigo }
    private var statusLabel: String {
        switch status {
        case "ready": "Ready"
        case "permissionRequired": "Permission needed"
        case "configurationRequired": "Setup needed"
        case "needs-authentication": "Sign-in needed"
        case "optional-unavailable": "Not installed"
        default: status.replacingOccurrences(of: "-", with: " ").capitalized
        }
    }
}
