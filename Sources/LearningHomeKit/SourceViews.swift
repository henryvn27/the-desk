import SwiftUI
import UniformTypeIdentifiers

public struct SourceLibraryView: View {
    @EnvironmentObject private var store: LearningHomeStore
    private let fixedSpaceID: UUID?
    @ViewStorage private var selectedSpaceID: UUID?
    @ViewStorage private var showingImporter = false
    @ViewStorage private var isImporting = false
    @ViewStorage private var importStatus = ""
    @ViewStorage private var errorMessage: String?
    @ViewStorage private var revisionTargetID: UUID?
    @ViewStorage private var actionSource: SourceAsset?
    @ViewStorage private var searchText = ""

    public init(spaceID: UUID? = nil) {
        fixedSpaceID = spaceID
        _selectedSpaceID = ViewStorage(wrappedValue: spaceID)
    }

    private var activeSpaceID: UUID? { fixedSpaceID ?? selectedSpaceID ?? store.selectedSpaceID ?? store.spaces.first?.id }
    private var visibleSources: [SourceAsset] {
        guard let activeSpaceID else { return store.sources }
        return store.sources(in: activeSpaceID)
    }
    private var filteredSources: [SourceAsset] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return visibleSources }
        return visibleSources.filter { source in
            source.title.localizedCaseInsensitiveContains(query)
                || source.connectorName.localizedCaseInsensitiveContains(query)
                || source.kind.rawValue.localizedCaseInsensitiveContains(query)
                || source.originalFilename.localizedCaseInsensitiveContains(query)
        }
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LHSpacing.lg) {
                DeskPageHeader(
                    "Library",
                    eyebrow: activeSpaceTitle,
                    detail: "Your class materials, preserved with page and timestamp citations.",
                    actionTitle: "Import",
                    actionSymbol: "plus"
                ) {
                    showingImporter = true
                }

                HStack(spacing: LHSpacing.sm) {
                    if fixedSpaceID == nil {
                        Picker("Space", selection: $selectedSpaceID) {
                            Text("All spaces").tag(nil as UUID?)
                            ForEach(store.spaces) { Text($0.title).tag(Optional($0.id)) }
                        }
                        .labelsHidden()
                        .frame(maxWidth: 220)
                    }
                    TextField("Search source titles and metadata", text: $searchText)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 380)
                    Spacer()
                    if isImporting {
                        ProgressView()
                            .controlSize(.small)
                    }
                    if !importStatus.isEmpty {
                        ProgressChip(importStatus, tint: isImporting ? LearningPalette.copper : LearningPalette.moss)
                    }
                }
                .padding(LHSpacing.sm)
                .background(LearningPalette.secondarySurface, in: RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous))

                HStack(spacing: LHSpacing.sm) {
                    libraryMetric(value: "\(visibleSources.count)", label: "sources", symbol: "books.vertical")
                    libraryMetric(value: "\(readySourceCount)", label: "ready to study", symbol: "checkmark.circle")
                    libraryMetric(value: "\(queuedSourceCount)", label: "processing", symbol: "arrow.triangle.2.circlepath")
                }

                if visibleSources.isEmpty {
                    ContentUnavailableView(
                        "Build this space’s library",
                        systemImage: "doc.badge.plus",
                        description: Text("Import notes, a textbook, slides, photos, or a recording. The originals stay preserved.")
                    )
                    .frame(maxWidth: .infinity, minHeight: 320)
                    .learningSurface(emphasized: false)
                } else if filteredSources.isEmpty {
                    ContentUnavailableView.search(text: searchText)
                        .frame(maxWidth: .infinity, minHeight: 260)
                } else {
                    SectionHeading(
                        "Materials",
                        detail: "\(filteredSources.count) item\(filteredSources.count == 1 ? "" : "s") in this view"
                    )
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: LHSpacing.sm)], spacing: LHSpacing.sm) {
                        ForEach(filteredSources) { source in
                            SourceCard(source: source)
                                .onTapGesture {
                                    store.selectedSourceID = source.id
                                    store.selectedSpaceID = source.spaceID
                                }
                                #if os(macOS)
                                .contextMenu {
                                    Button("Extract study actions") {
                                        actionSource = source
                                    }
                                    Button("Import newer revision") {
                                        revisionTargetID = source.id
                                        showingImporter = true
                                    }
                                }
                                #endif
                        }
                    }
                }
            }
            .padding(LHSpacing.lg)
            .frame(maxWidth: 1180, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .background(LearningPalette.appBackground)
        .navigationTitle("Library")
        .fileImporter(
            isPresented: $showingImporter,
            allowedContentTypes: Self.allowedTypes,
            allowsMultipleSelection: true
        ) { result in
            switch result {
            case .success(let urls): importFiles(urls)
            case .failure(let error): errorMessage = error.localizedDescription
            }
        }
        .alert("Import failed", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "Unknown error") }
        #if os(macOS)
        .sheet(item: $actionSource) { source in
            StudyActionReviewSheet(source: source)
                .frame(minWidth: 620, idealWidth: 700, minHeight: 520, idealHeight: 620)
        }
        #endif
        .onAppear {
            if fixedSpaceID == nil && selectedSpaceID == nil {
                selectedSpaceID = store.selectedSpaceID ?? store.spaces.first?.id
            }
        }
    }

    private var activeSpaceTitle: String {
        guard let activeSpaceID, let space = store.space(id: activeSpaceID) else { return "All spaces" }
        return space.title
    }

    private var readySourceCount: Int {
        visibleSources.filter { $0.processingState == .ready }.count
    }

    private var queuedSourceCount: Int {
        visibleSources.filter { $0.processingState == .queued || $0.processingState == .processing }.count
    }

    private func libraryMetric(value: String, label: String, symbol: String) -> some View {
        MetricBlock(value: value, label: label, symbol: symbol, tint: LearningPalette.moss)
            .padding(LHSpacing.sm)
            .background(LearningPalette.surface, in: RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous)
                    .stroke(LearningPalette.hairline.opacity(0.72), lineWidth: 0.75)
            }
    }

    private func importFiles(_ urls: [URL]) {
        guard let destination = activeSpaceID else { return }
        isImporting = true
        importStatus = "Preparing \(urls.count) item\(urls.count == 1 ? "" : "s")…"
        Task {
            do {
                #if os(iOS)
                for url in urls {
                    let id = try await CloudCaptureQueue.shared.enqueueFile(url, spaceID: destination)
                    try store.createJob(kind: "fileCapture", payload: Data(), state: .waitingForMac, idempotencyKey: id)
                }
                importStatus = "Queued for your Mac"
                #else
                for (index, url) in urls.enumerated() {
                    importStatus = "Extracting \(index + 1) of \(urls.count)…"
                    let prepared = try await SourceIngestionService.shared.prepare(url)
                    if let revisionTargetID {
                        _ = try await store.importPreparedRevision(prepared, sourceID: revisionTargetID)
                    } else {
                        _ = try await store.importPreparedSource(prepared, into: destination)
                    }
                }
                importStatus = revisionTargetID == nil ? "Imported" : "Revision imported · dependent canvases marked stale"
                revisionTargetID = nil
                #endif
            } catch {
                errorMessage = error.localizedDescription
                importStatus = ""
            }
            isImporting = false
        }
    }

    private static let allowedTypes: [UTType] = [
        .pdf, .epub, .plainText, .rtf, .image, .audio, .json,
        UTType(filenameExtension: "docx") ?? .data,
        UTType(filenameExtension: "pptx") ?? .data,
        UTType(filenameExtension: "md") ?? .plainText,
    ]
}

#if os(macOS)
private struct StudyActionReviewSheet: View {
    @EnvironmentObject private var store: LearningHomeStore
    @Environment(\.dismiss) private var dismiss
    let source: SourceAsset
    @ViewStorage private var actions: [SuggestedStudyAction] = []
    @ViewStorage private var selectedIDs: Set<UUID> = []
    @ViewStorage private var providerChoice = "automatic"
    @ViewStorage private var usedProvider: ProviderIdentifier?
    @ViewStorage private var usedModel = ""
    @ViewStorage private var linkReminders = false
    @ViewStorage private var isLoading = false
    @ViewStorage private var isApplying = false
    @ViewStorage private var didApply = false
    @ViewStorage private var resultMessage = ""
    @ViewStorage private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack {
                    Picker("Provider", selection: $providerChoice) {
                        Text("Automatic").tag("automatic")
                        ForEach(ProviderIdentifier.allCases, id: \.rawValue) { provider in
                            Text(provider.title).tag(provider.rawValue)
                        }
                    }
                    .frame(maxWidth: 230)
                    Button("Extract again") { Task { await load() } }
                        .disabled(isLoading || didApply)
                    Spacer()
                    if let usedProvider {
                        StatusPill("\(usedProvider.title) · \(usedModel)", symbol: "cpu", tone: .info)
                    }
                }
                .padding(LHSpacing.md)

                Divider()

                if isLoading {
                    VStack(spacing: LHSpacing.sm) {
                        ProgressView()
                        Text("Finding concrete follow-ups in \(source.title)…")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if actions.isEmpty {
                    ContentUnavailableView(
                        "No concrete actions found",
                        systemImage: "checklist.unchecked",
                        description: Text("Nothing has been added. Try another provider or keep this source as reference material.")
                    )
                } else {
                    List(actions) { action in
                        Toggle(isOn: Binding(
                            get: { selectedIDs.contains(action.id) },
                            set: { selected in
                                if selected { selectedIDs.insert(action.id) }
                                else { selectedIDs.remove(action.id) }
                            }
                        )) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(action.title).font(.headline)
                                if !action.detail.isEmpty { Text(action.detail).font(.subheadline).foregroundStyle(.secondary) }
                                Text("Due in \(action.dueInDays) day\(action.dueInDays == 1 ? "" : "s") · priority \(action.priority)")
                                    .font(.caption).foregroundStyle(.secondary)
                                if let anchor = action.sourceAnchor {
                                    Label(actionAnchorLabel(anchor), systemImage: anchor.timestamp == nil ? "book.pages" : "waveform")
                                        .font(.caption2.weight(.medium))
                                        .foregroundStyle(LearningPalette.copper)
                                    if !anchor.excerpt.isEmpty {
                                        Text(anchor.excerpt)
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(2)
                                    }
                                }
                            }
                        }
                        .disabled(didApply)
                    }
                }

                Divider()
                VStack(alignment: .leading, spacing: LHSpacing.sm) {
                    Toggle("Also create explicitly linked Apple Reminders", isOn: $linkReminders)
                        .disabled(didApply)
                    Text("Suggestions do nothing until you approve them. Reminder completion will still not prove external submission.")
                        .font(.caption).foregroundStyle(.secondary)
                    if !resultMessage.isEmpty {
                        Label(resultMessage, systemImage: "checkmark.circle.fill")
                            .foregroundStyle(LearningPalette.success)
                    }
                    HStack {
                        Button("Cancel", role: .cancel) { dismiss() }
                        Spacer()
                        if didApply {
                            Button("Done") { dismiss() }.buttonStyle(.borderedProminent)
                        } else {
                            Button("Approve \(selectedIDs.count) action\(selectedIDs.count == 1 ? "" : "s")") {
                                Task { await applySelected() }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(selectedIDs.isEmpty || isLoading || isApplying)
                        }
                    }
                }
                .padding(LHSpacing.md)
            }
            .navigationTitle("Review study actions")
        }
        .task { await load() }
        .alert("Actions were not changed", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "Unknown error") }
    }

    private func load() async {
        guard let space = store.space(id: source.spaceID),
              let revision = store.latestRevision(for: source.id) else { return }
        isLoading = true
        actions = []
        selectedIDs = []
        usedProvider = nil
        usedModel = ""
        let override: ProviderOverride = providerChoice == "automatic"
            ? .automatic
            : .provider(ProviderIdentifier(rawValue: providerChoice) ?? .localDemo)
        do {
            let result = try await StudyActionExtractor.shared.extract(
                source: source,
                revision: revision,
                space: space,
                override: override
            )
            actions = result.actions
            selectedIDs = Set(result.actions.map(\.id))
            usedProvider = result.provider
            usedModel = result.model
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func applySelected() async {
        guard let space = store.space(id: source.spaceID) else { return }
        isApplying = true
        let inputs = actions.filter { selectedIDs.contains($0.id) }.map { action in
            let dueAt = Calendar.current.date(byAdding: .day, value: action.dueInDays, to: Date()) ?? Date()
            return AssignmentInput(
                spaceID: space.id,
                title: action.title,
                detail: action.detail,
                dueAt: dueAt,
                priority: action.priority,
                sourceName: "Suggested from \(source.title)",
                sourceAnchor: action.sourceAnchor,
                originatingProvider: usedProvider,
                originatingModel: usedModel.isEmpty ? nil : usedModel
            )
        }
        let created: [Assignment]
        do {
            if linkReminders { try store.preflightDurableWrite() }
            created = try store.addAssignments(inputs)
        } catch {
            errorMessage = error.localizedDescription
            isApplying = false
            return
        }

        var linked = 0
        if linkReminders {
            for assignment in created {
                do {
                    let identifier = try await ReminderConnector.shared.createLinkedReminder(for: assignment, spaceTitle: space.title)
                    try store.linkReminderDurably(identifier, to: assignment.id)
                    linked += 1
                } catch {
                    errorMessage = "\(created.count) assignment\(created.count == 1 ? " was" : "s were") added, but only \(linked) reminder\(linked == 1 ? " was" : "s were") linked: \(error.localizedDescription)"
                    break
                }
            }
        }
        resultMessage = linkReminders
            ? "Added \(created.count) assignment\(created.count == 1 ? "" : "s") and linked \(linked) reminder\(linked == 1 ? "" : "s")."
            : "Added \(created.count) approved assignment\(created.count == 1 ? "" : "s"). No reminders were created."
        didApply = true
        isApplying = false
    }

    private func actionAnchorLabel(_ anchor: SourceAnchor) -> String {
        if let page = anchor.page { return "Source page \(page) · revision \(anchor.revision)" }
        if let timestamp = anchor.timestamp { return "Source \(Int(timestamp))s · revision \(anchor.revision)" }
        return "Source revision \(anchor.revision)"
    }
}
#endif

public struct SourceCard: View {
    @EnvironmentObject private var store: LearningHomeStore
    let source: SourceAsset

    public init(source: SourceAsset) { self.source = source }

    public var body: some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            HStack(alignment: .top, spacing: LHSpacing.sm) {
                Image(systemName: source.kind.symbol)
                    .font(.title3.weight(.medium))
                    .foregroundStyle(tint)
                    .frame(width: 44, height: 44)
                    .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: LHRadius.control, style: .continuous))
                VStack(alignment: .leading, spacing: LHSpacing.xxs) {
                    Text(source.title)
                        .font(.headline)
                        .foregroundStyle(LearningPalette.ink)
                        .lineLimit(2)
                    Text(source.connectorName)
                        .font(.caption)
                        .foregroundStyle(LearningPalette.mutedInk)
                }
                Spacer(minLength: LHSpacing.xs)
                ProcessingStatusPill(source.processingState)
            }

            if let text = store.latestRevision(for: source.id)?.extractedText, !text.isEmpty {
                Text(String(text.prefix(1_500)).replacingOccurrences(of: #"\[\[(page|time):[^\]]+\]\]"#, with: "", options: .regularExpression))
                    .font(.subheadline)
                    .foregroundStyle(LearningPalette.mutedInk)
                    .lineLimit(3)
                    .frame(maxWidth: .infinity, minHeight: 54, alignment: .topLeading)
            }

            Divider()

            HStack(spacing: LHSpacing.xs) {
                SourceKindLabel(source: source)
                Spacer()
                if source.pageCount > 0 {
                    Label("\(source.pageCount) pages", systemImage: "book.pages")
                        .font(.caption)
                        .foregroundStyle(LearningPalette.mutedInk)
                } else if source.duration > 0 {
                    Label(source.duration.formattedDuration, systemImage: "waveform")
                        .font(.caption)
                        .foregroundStyle(LearningPalette.mutedInk)
                }
            }
        }
        .padding(LHSpacing.md)
        .learningSurface()
        .frame(maxHeight: .infinity, alignment: .top)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var tint: Color {
        store.space(id: source.spaceID).map { Color(hex: $0.colorHex) } ?? LearningPalette.copper
    }
}

private extension TimeInterval {
    var formattedDuration: String {
        Duration.seconds(self).formatted(.time(pattern: .minuteSecond))
    }
}
