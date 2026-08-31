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
    @ViewStorage private var showingAdditionalProviders = false

    public init() {}

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LHSpacing.xl) {
                DeskPageHeader(
                    "Connections",
                    eyebrow: "The Desk",
                    detail: "Keep your study system connected without giving up control of your library or credentials.",
                    actionTitle: "Check all",
                    actionSymbol: "arrow.clockwise"
                ) {
                    Task { await refresh() }
                }

                connectionOverview

                codexSection
                byokSection
                studyConnectorSection
                privacySection
            }
            .padding(.horizontal, LHSpacing.xl)
            .padding(.vertical, LHSpacing.lg)
            .frame(maxWidth: 1_020, alignment: .leading)
            .frame(maxWidth: .infinity)
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

    private var connectionOverview: some View {
        HStack(spacing: LHSpacing.md) {
            IntegrationIcon(
                symbol: engineHealth == nil ? "desktopcomputer.trianglebadge.exclamationmark" : "desktopcomputer",
                tint: engineHealth == nil ? LearningPalette.warning : LearningPalette.moss,
                emphasized: true
            )
            VStack(alignment: .leading, spacing: LHSpacing.xxs) {
                Text(engineHealth == nil ? "Mac learning engine unavailable" : "Mac learning engine ready")
                    .font(.headline)
                    .foregroundStyle(LearningPalette.ink)
                Text("Local study, sources, and saved canvases stay available even when an optional connector is offline.")
                    .font(.subheadline)
                    .foregroundStyle(LearningPalette.mutedInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: LHSpacing.sm)
            if isRefreshing {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel("Checking integrations")
            } else {
                StatusPill(engineHealth == nil ? "Check needed" : "Local first", symbol: engineHealth == nil ? "exclamationmark" : "lock.fill", tone: engineHealth == nil ? .warning : .success)
            }
        }
        .padding(LHSpacing.md)
        .background(LearningPalette.mossSoft)
        .clipShape(RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous)
                .stroke(LearningPalette.moss.opacity(0.22), lineWidth: 0.75)
        }
    }

    private var codexSection: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            SectionHeading("Your default study intelligence", detail: "Use the ChatGPT plan already connected to Codex on this Mac. There is no API key to paste and no separate API bill.")
            VStack(alignment: .leading, spacing: LHSpacing.lg) {
                HStack(alignment: .top, spacing: LHSpacing.md) {
                    IntegrationIcon(symbol: "sparkles", tint: codexIsConnected ? LearningPalette.moss : LearningPalette.copper, emphasized: true)
                    VStack(alignment: .leading, spacing: 5) {
                        Text("ChatGPT through Codex")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(LearningPalette.onGraphite)
                        Text(codexAccount)
                            .font(.subheadline)
                            .foregroundStyle(LearningPalette.onGraphite.opacity(0.72))
                        if let version = engineHealth?.codex.version {
                            Text("Pinned runtime · \(version)")
                                .font(.caption.monospaced())
                                .foregroundStyle(LearningPalette.onGraphite.opacity(0.52))
                        }
                    }
                    Spacer()
                    StatusPill(codexStatusLabel, symbol: codexStatusSymbol, tone: codexStatusTone)
                }

                if let deviceLogin {
                    VStack(alignment: .leading, spacing: LHSpacing.md) {
                        HStack(alignment: .top, spacing: LHSpacing.md) {
                            ZStack {
                                Circle()
                                    .fill(LearningPalette.copper)
                                    .frame(width: 30, height: 30)
                                Text("1")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(LearningPalette.primaryForeground)
                            }
                            VStack(alignment: .leading, spacing: LHSpacing.xxs) {
                                Text("Copy your one-time code")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(LearningPalette.ink)
                                Text(deviceLogin.userCode ?? "Code unavailable")
                                    .font(.system(.title2, design: .monospaced).weight(.bold))
                                    .foregroundStyle(LearningPalette.copper)
                                    .tracking(1.2)
                                    .textSelection(.enabled)
                            }
                            Spacer()
                            if codexLoginPhase == .waiting {
                                ProgressView()
                                    .controlSize(.small)
                                    .tint(LearningPalette.copper)
                                    .accessibilityLabel("Checking ChatGPT connection")
                            }
                        }

                        HStack(alignment: .top, spacing: LHSpacing.md) {
                            ZStack {
                                Circle()
                                    .fill(LearningPalette.moss)
                                    .frame(width: 30, height: 30)
                                Text("2")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(LearningPalette.primaryForeground)
                            }
                            VStack(alignment: .leading, spacing: LHSpacing.xs) {
                                Text("Approve Codex in ChatGPT")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(LearningPalette.ink)
                                Text(loginInstruction)
                                    .font(.caption)
                                    .foregroundStyle(codexLoginPhase == .timedOut ? LearningPalette.warning : LearningPalette.mutedInk)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }

                        HStack(spacing: LHSpacing.sm) {
                            if let url = deviceLogin.verificationURL {
                                Link(destination: url) {
                                    Label("Continue in ChatGPT", systemImage: "arrow.up.right")
                                }
                                    .buttonStyle(.borderedProminent)
                                    .tint(LearningPalette.copper)
                                    .controlSize(.large)
                            }
                            if codexLoginPhase == .timedOut {
                                Button("Try a new code") { startCodexLogin() }
                                    .buttonStyle(.bordered)
                            }
                            Button("Cancel") { cancelCodexLogin() }
                                .buttonStyle(.plain)
                                .foregroundStyle(LearningPalette.mutedInk)
                        }
                    }
                    .padding(LHSpacing.md)
                    .background(LearningPalette.paper, in: RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous)
                            .stroke(LearningPalette.copper.opacity(0.22), lineWidth: 0.75)
                    }
                    .accessibilityElement(children: .contain)
                }

                HStack(spacing: LHSpacing.sm) {
                    if !codexIsConnected && deviceLogin == nil {
                        Button { startCodexLogin() } label: {
                            Label("Connect ChatGPT", systemImage: "person.crop.circle.badge.plus")
                        }
                            .buttonStyle(.borderedProminent)
                            .tint(LearningPalette.copper)
                            .controlSize(.large)
                            .disabled(engineHealth?.codex.available != true || codexLoginPhase == .starting)
                    }
                    if codexLoginPhase == .starting {
                        ProgressView().controlSize(.small).tint(LearningPalette.copper)
                        Text("Preparing a secure one-time code…")
                            .font(.caption)
                            .foregroundStyle(LearningPalette.onGraphite.opacity(0.7))
                    }
                    Spacer()
                    Button {
                        Task { await refresh() }
                    } label: {
                        Label("Check now", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(LearningPalette.onGraphite.opacity(0.72))
                    .disabled(isRefreshing)
                }
            }
            .padding(LHSpacing.lg)
            .background(LearningPalette.graphite)
            .clipShape(RoundedRectangle(cornerRadius: LHRadius.prominent, style: .continuous))
            .overlay(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: LHRadius.prominent, style: .continuous)
                    .stroke(LearningPalette.copper.opacity(0.26), lineWidth: 0.75)
            }
            .shadow(color: LearningPalette.ink.opacity(0.12), radius: 18, x: 0, y: 8)
        }
    }

    private var byokSection: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            SectionHeading("More AI providers", detail: "Codex stays the default. Add a separate API provider only when you want one.")
            if showingAdditionalProviders {
                ForEach([ProviderIdentifier.openAI, .anthropic, .gemini], id: \.rawValue) { provider in
                    HStack(spacing: LHSpacing.md) {
                        IntegrationIcon(symbol: providerSymbol(provider), tint: providerTint(provider), emphasized: providerAvailability[provider] == true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(provider.title).font(.headline).foregroundStyle(LearningPalette.ink)
                            Text(providerAvailability[provider] == true ? "Configured on this Mac" : "Separate API billing")
                                .font(.caption).foregroundStyle(LearningPalette.mutedInk)
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
                            .tint(LearningPalette.copper)
                            .disabled((providerKeys[provider] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        if providerAvailability[provider] == true {
                            Button(role: .destructive) { removeKey(provider) } label: { Image(systemName: "trash") }
                                .buttonStyle(.bordered)
                        }
                    }
                    .padding(LHSpacing.md)
                    .learningSurface(emphasized: false)
                }
                Button("Hide provider setup") {
                    withAnimation(LHMotion.direct) { showingAdditionalProviders = false }
                }
                .buttonStyle(.plain)
                .foregroundStyle(LearningPalette.mutedInk)
            } else {
                Button {
                    withAnimation(LHMotion.direct) { showingAdditionalProviders = true }
                } label: {
                    HStack(spacing: LHSpacing.md) {
                        IntegrationIcon(symbol: "plus", tint: LearningPalette.copper, emphasized: true)
                        VStack(alignment: .leading, spacing: LHSpacing.xxs) {
                            Text(configuredProviderCount == 0 ? "Add another AI provider" : "Manage additional providers")
                                .font(.headline)
                                .foregroundStyle(LearningPalette.ink)
                            Text(configuredProviderCount == 0
                                 ? "OpenAI API, Anthropic, and Gemini use keys stored only in this Mac’s Keychain."
                                 : "\(configuredProviderCount) additional provider\(configuredProviderCount == 1 ? " is" : "s are") configured on this Mac.")
                                .font(.subheadline)
                                .foregroundStyle(LearningPalette.mutedInk)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .foregroundStyle(LearningPalette.copper)
                    }
                    .padding(LHSpacing.md)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .learningSurface(emphasized: false)
            }
        }
    }

    private var configuredProviderCount: Int {
        [ProviderIdentifier.openAI, .anthropic, .gemini]
            .filter { providerAvailability[$0] == true }
            .count
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
                Label(message, systemImage: "info.circle")
                    .font(.subheadline)
                    .foregroundStyle(LearningPalette.mutedInk)
                    .padding(LHSpacing.sm)
            }
        }
    }

    private var privacySection: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            SectionHeading("Execution boundary")
            HStack(alignment: .top, spacing: LHSpacing.md) {
                Image(systemName: "lock.shield.fill").font(.title2).foregroundStyle(LearningPalette.moss)
                Text("The Mac is the only AI execution host. Companion devices upload private captures and typed jobs through the user’s iCloud account. Provider keys, Codex sessions, logs, and raw screen captures never sync to iPhone or iPad.")
                    .font(.subheadline).foregroundStyle(LearningPalette.mutedInk).fixedSize(horizontal: false, vertical: true)
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
        switch provider {
        case .openAI: LearningPalette.moss
        case .anthropic: LearningPalette.copper
        case .gemini: LearningPalette.graphiteSoft
        default: LearningPalette.copper
        }
    }
}

private struct IntegrationIcon: View {
    let symbol: String
    let tint: Color
    var emphasized = false
    var body: some View {
        Image(systemName: symbol)
            .font(.title3.weight(.semibold))
            .foregroundStyle(emphasized ? LearningPalette.primaryForeground : tint)
            .frame(width: 44, height: 44)
            .background(emphasized ? tint : tint.opacity(0.12), in: RoundedRectangle(cornerRadius: LHRadius.control, style: .continuous))
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
            IntegrationIcon(symbol: symbol, tint: tint, emphasized: status == "ready")
            VStack(alignment: .leading, spacing: 4) {
                HStack { Text(title).font(.headline).foregroundStyle(LearningPalette.ink); StatusPill(badge, tone: .neutral) }
                Text(detail).font(.subheadline).foregroundStyle(LearningPalette.mutedInk).fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            StatusPill(statusLabel, symbol: status == "ready" ? "checkmark" : "gearshape", tone: status == "ready" ? .success : .warning)
            if let action {
                Button(action, action: actionHandler)
                    .buttonStyle(.bordered)
                    .tint(LearningPalette.copper)
            }
        }
        .padding(LHSpacing.md)
        .learningSurface(emphasized: false)
    }

    private var tint: Color { status == "ready" ? LearningPalette.moss : LearningPalette.copper }
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
