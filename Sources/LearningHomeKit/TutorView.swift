import SwiftUI
import PDFKit

public struct TutorView: View {
    @EnvironmentObject private var store: LearningHomeStore
    let space: StudySpace

    @ViewStorage private var prompt = "Why is horizontal velocity constant while vertical velocity changes?"
    @ViewStorage private var answer = ""
    @ViewStorage private var status = "Ready"
    @ViewStorage private var providerChoice = "automatic"
    @ViewStorage private var usedProvider: ProviderIdentifier?
    @ViewStorage private var usedModel = ""
    @ViewStorage private var citations: [StudyCitation] = []
    @ViewStorage private var selectedCitation: StudyCitation?
    @ViewStorage private var isRunning = false
    @ViewStorage private var errorMessage: String?

    public init(space: StudySpace) { self.space = space }

    public var body: some View {
        VStack(spacing: 0) {
            tutorToolbar
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: LHSpacing.lg) {
                    if answer.isEmpty { starter }
                    else { conversation }
                }
                .padding(LHSpacing.lg)
                .frame(maxWidth: 820, alignment: .leading)
            }
            Divider()
            composer
        }
        .background(LearningPalette.appBackground)
        .alert("Tutor could not respond", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "Unknown error") }
        .sheet(item: $selectedCitation) { citation in
            CitationAnchorSheet(citation: citation, space: space)
                .environmentObject(store)
        }
    }

    private var tutorToolbar: some View {
        HStack(spacing: LHSpacing.sm) {
            SpaceIdentity(space: space, compact: true)
            Divider().frame(height: 24)
            Label(space.tutorStyle.title, systemImage: "person.crop.circle.badge.questionmark")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            #if os(macOS)
            Picker("Provider", selection: $providerChoice) {
                Text("Automatic").tag("automatic")
                ForEach(ProviderIdentifier.allCases, id: \.rawValue) { provider in
                    Text(provider.title).tag(provider.rawValue)
                }
            }
            .labelsHidden()
            .frame(width: 170)
            #else
            StatusPill("Runs on paired Mac", symbol: "desktopcomputer", tone: .info)
            #endif
            StatusPill(status, symbol: isRunning ? "ellipsis" : "checkmark", tone: isRunning ? .info : .neutral)
        }
        .padding(.horizontal, LHSpacing.md)
        .padding(.vertical, LHSpacing.sm)
        .background(LearningPalette.surface)
    }

    private var starter: some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            Text("Study with your sources")
                .font(.system(.title, design: .serif, weight: .semibold))
            Text("The Desk retrieves a small set of relevant class passages, keeps their page or timestamp anchors, and labels any knowledge the provider adds.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: LHSpacing.sm) {
                starterButton("Quiz me from my notes", symbol: "checkmark.message")
                starterButton("Explain my weakest topic", symbol: "lightbulb")
                starterButton("Plan a 25-minute session", symbol: "timer")
            }
        }
        .padding(LHSpacing.lg)
        .learningSurface()
    }

    private func starterButton(_ title: String, symbol: String) -> some View {
        Button {
            prompt = title
            submit()
        } label: {
            Label(title, systemImage: symbol)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.bordered)
    }

    private var conversation: some View {
        VStack(alignment: .leading, spacing: LHSpacing.lg) {
            VStack(alignment: .leading, spacing: LHSpacing.xs) {
                Text("You").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(prompt).font(.body)
            }

            VStack(alignment: .leading, spacing: LHSpacing.sm) {
                HStack {
                    Text("The Desk").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Spacer()
                    if let usedProvider {
                        StatusPill("\(usedProvider.title) · \(usedModel)", symbol: "cpu", tone: .info)
                    }
                }
                Text(answer)
                    .font(.body)
                    .textSelection(.enabled)
                    .lineSpacing(4)
                if isRunning { ProgressView().controlSize(.small) }
            }
            .padding(LHSpacing.md)
            .learningSurface()

            if !citations.isEmpty {
                VStack(alignment: .leading, spacing: LHSpacing.xs) {
                    Text("Grounding").font(.headline)
                    ForEach(citations) { citation in
                        CitationRow(citation: citation) { openCitation(citation) }
                    }
                }
            }
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: LHSpacing.sm) {
            TextField("Ask about this class…", text: $prompt, axis: .vertical)
                .lineLimit(1...5)
                .textFieldStyle(.plain)
                .padding(11)
                .background(LearningPalette.secondarySurface, in: RoundedRectangle(cornerRadius: LHRadius.surface))
                .overlay {
                    RoundedRectangle(cornerRadius: LHRadius.surface)
                        .stroke(LearningPalette.separator.opacity(0.7), lineWidth: 1)
                }
                .onSubmit { submit() }
            Button(action: submit) {
                Image(systemName: isRunning ? "stop.fill" : "arrow.up")
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color(hex: space.colorHex))
            .disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isRunning)
            Button(action: visualize) {
                Image(systemName: "point.3.filled.connected.trianglepath.dotted")
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.bordered)
            .help("Create a persistent Study Canvas from this prompt")
            .disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isRunning)
        }
        .padding(LHSpacing.md)
        .background(LearningPalette.surface)
    }

    private func submit() {
        let cleanPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanPrompt.isEmpty, !isRunning else { return }
        #if os(iOS)
        queueForMac(kind: "studyQuestion", prompt: cleanPrompt)
        return
        #endif
        answer = ""
        citations = []
        isRunning = true
        status = "Retrieving"
        usedProvider = nil
        usedModel = ""

        let override: ProviderOverride = providerChoice == "automatic"
            ? .automatic
            : .provider(ProviderIdentifier(rawValue: providerChoice) ?? .localDemo)

        Task {
            do {
                let grounding = await grounding(for: cleanPrompt)
                citations = grounding.citations
                guard !grounding.citations.isEmpty else {
                    answer = grounding.context
                    status = "Choose a source"
                    isRunning = false
                    return
                }
                let request = AIStudyRequest(
                    spaceID: space.id,
                    task: .tutor,
                    prompt: cleanPrompt,
                    tutorStyle: space.tutorStyle,
                    context: grounding.context,
                    citations: grounding.citations,
                    allowProviderKnowledge: true
                )
                let stream = try await AIHarness.shared.stream(request, override: override)
                for try await event in stream {
                    switch event {
                    case .status(let value): status = value
                    case .token(let value): answer += value
                    case .citations(let value): citations = value
                    case .completed(let provider, let model):
                        usedProvider = provider
                        usedModel = model
                        status = "Complete"
                        let run = ProviderRun(spaceID: space.id, provider: provider, modelName: model, task: StudyTaskKind.tutor.rawValue, prompt: cleanPrompt)
                        run.response = answer
                        run.citationsData = (try? JSONEncoder().encode(citations)) ?? Data()
                        try store.recordProviderRun(run)
                    }
                }
            } catch {
                errorMessage = error.localizedDescription
                status = "Needs attention"
            }
            isRunning = false
        }
    }

    private func visualize() {
        let cleanPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanPrompt.isEmpty, !isRunning else { return }
        #if os(iOS)
        queueForMac(kind: "visualizeTask", prompt: cleanPrompt)
        return
        #endif
        isRunning = true
        status = "Building canvas"
        let override: ProviderOverride = providerChoice == "automatic"
            ? .automatic
            : .provider(ProviderIdentifier(rawValue: providerChoice) ?? .localDemo)

        Task {
            do {
                let grounding = await grounding(for: cleanPrompt)
                guard !grounding.citations.isEmpty else {
                    answer = grounding.context
                    status = "Choose a source"
                    isRunning = false
                    return
                }
                let request = AIStudyRequest(
                    spaceID: space.id,
                    task: .visualize,
                    prompt: cleanPrompt,
                    tutorStyle: space.tutorStyle,
                    context: grounding.context,
                    citations: grounding.citations,
                    allowProviderKnowledge: true
                )
                let result = try await StudySceneGenerator.shared.generate(request: request, override: override)
                let signature = store.sources(in: space.id).compactMap { source in
                    store.latestRevision(for: source.id).map { "\(source.id.uuidString.prefix(8)):\($0.revisionNumber)" }
                }.sorted().joined(separator: ",")
                let artifact = CanvasArtifact(spaceID: space.id, title: result.spec.title, spec: result.spec, sourceRevisionSignature: signature)
                try store.saveCanvas(artifact)
                store.selectedCanvasID = artifact.id
                usedProvider = result.provider
                usedModel = result.model
                answer = "Created “\(result.spec.title)” as a persistent Study Canvas."
                status = "Canvas ready"
                let run = ProviderRun(spaceID: space.id, provider: result.provider, modelName: result.model, task: StudyTaskKind.visualize.rawValue, prompt: cleanPrompt)
                run.response = answer
                run.citationsData = (try? JSONEncoder().encode(result.spec.citations)) ?? Data()
                try store.recordProviderRun(run)
            } catch {
                errorMessage = error.localizedDescription
                status = "Needs attention"
            }
            isRunning = false
        }
    }

    #if os(iOS)
    private func queueForMac(kind: String, prompt: String) {
        isRunning = true
        status = "Queueing for Mac"
        answer = ""
        Task {
            do {
                let title = kind == "visualizeTask" ? "Canvas · \(prompt.prefix(54))" : "Question · \(prompt.prefix(54))"
                let id = try await CloudCaptureQueue.shared.enqueueText(prompt, title: title, spaceID: space.id, kind: kind)
                try store.createJob(kind: kind, payload: Data(prompt.utf8), state: .waitingForMac, idempotencyKey: id)
                answer = kind == "visualizeTask"
                    ? "Queued for your Mac. The finished canvas will return through your private iCloud library."
                    : "Queued for your Mac. The cited answer will return as a new item in this class library."
                status = "Waiting for Mac"
            } catch {
                errorMessage = error.localizedDescription
                status = "Needs attention"
            }
            isRunning = false
        }
    }
    #endif

    private struct TutorGrounding {
        var context: String
        var citations: [StudyCitation]
    }

    private func grounding(for query: String) async -> TutorGrounding {
        let sources = store.sources(in: space.id)
        #if os(macOS)
        let hits = (try? await StudySearchService.shared.search(query, sourceIDs: Set(sources.map(\.id)), limit: 6)) ?? []
        #else
        let hits: [SearchHit] = []
        #endif
        guard !hits.isEmpty else {
            return TutorGrounding(
                context: noRelevantPassageContext(for: query),
                citations: []
            )
        }

        let passages = hits.compactMap { hit -> String? in
            guard let source = sources.first(where: { $0.id == hit.sourceID }) else { return nil }
            let location = hit.page.map { "page \($0)" } ?? hit.timestamp.map { "time \(Int($0))s" } ?? "source excerpt"
            return "SOURCE: \(source.title) · \(location)\n\(hit.excerpt)"
        }
        let citations = hits.compactMap { hit -> StudyCitation? in
            guard let source = sources.first(where: { $0.id == hit.sourceID }) else { return nil }
            let location = hit.page.map { " · p. \($0)" } ?? hit.timestamp.map { " · \(Int($0))s" } ?? ""
            return StudyCitation(
                label: source.title + location,
                origin: source.connectorName == "Local" ? .classSource : .connector,
                anchor: SourceAnchor(
                    sourceID: source.id,
                    revision: hit.revision,
                    page: hit.page,
                    timestamp: hit.timestamp,
                    excerpt: hit.excerpt
                )
            )
        }
        guard !citations.isEmpty else {
            return TutorGrounding(
                context: noRelevantPassageContext(for: query),
                citations: []
            )
        }
        return TutorGrounding(context: passages.joined(separator: "\n\n"), citations: citations)
    }

    private func noRelevantPassageContext(for query: String) -> String {
        "No relevant class passage matched \"\(query)\". Choose a source or refine the question before asking The Desk for a grounded answer."
    }

    private func openCitation(_ citation: StudyCitation) {
        if let anchor = citation.anchor,
           let source = store.sources.first(where: { $0.id == anchor.sourceID }) {
            store.selectedSpaceID = source.spaceID
            store.selectedSourceID = source.id
        }
        if citation.anchor != nil || citation.url != nil {
            selectedCitation = citation
        }
    }

}

private struct CitationRow: View {
    let citation: StudyCitation
    let action: () -> Void

    var body: some View {
        Group {
            if citation.anchor != nil || citation.url != nil {
                Button(action: action) {
                    rowContent
                }
                .buttonStyle(.plain)
            } else {
                rowContent
            }
        }
        .contentShape(Rectangle())
    }

    private var rowContent: some View {
        HStack(spacing: LHSpacing.sm) {
            Image(systemName: symbol).foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 2) {
                Text(citation.label).font(.subheadline.weight(.medium))
                Text(originLabel).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if citation.anchor != nil || citation.url != nil {
                Image(systemName: "arrow.up.right.square").foregroundStyle(.secondary)
            }
        }
        .padding(LHSpacing.sm)
        .learningSurface(emphasized: false)
    }

    private var symbol: String {
        switch citation.origin {
        case .classSource: "book.closed"
        case .connector: "point.3.connected.trianglepath.dotted"
        case .web: "globe"
        case .modelKnowledge: "sparkles"
        }
    }

    private var tint: Color {
        citation.origin == .modelKnowledge ? LearningPalette.warning : LearningPalette.indigo
    }

    private var originLabel: String {
        switch citation.origin {
        case .classSource: "Class source"
        case .connector: "Imported connector source"
        case .web: "Web source"
        case .modelKnowledge: "Uncited provider knowledge"
        }
    }
}

struct CitationAnchorSheet: View {
    @EnvironmentObject private var store: LearningHomeStore
    @Environment(\.dismiss) private var dismiss
    let citation: StudyCitation
    let space: StudySpace

    private var source: SourceAsset? {
        guard let sourceID = citation.anchor?.sourceID else { return nil }
        return store.sources.first(where: { $0.id == sourceID })
    }

    private var anchoredRevision: SourceRevisionRecord? {
        guard let anchor = citation.anchor else { return nil }
        return store.revisions.first {
            $0.sourceID == anchor.sourceID && $0.revisionNumber == anchor.revision
        }
    }

    private var anchoredPDF: (URL, Int)? {
        guard let source, source.kind == .pdf,
              let page = citation.anchor?.page,
              let path = anchoredRevision?.originalFilePath,
              !path.isEmpty,
              FileManager.default.fileExists(atPath: path) else { return nil }
        return (URL(fileURLWithPath: path), page)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: LHSpacing.md) {
                    Label(citation.label, systemImage: citation.origin == .classSource ? "book.closed" : "link")
                        .font(.headline)

                    if let source {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(source.title).font(.title3.weight(.semibold))
                            Text(source.connectorName).font(.caption).foregroundStyle(.secondary)
                        }
                    } else if citation.anchor != nil {
                        Label("The saved source is not available on this device.", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(LearningPalette.warning)
                    }

                    if let anchor = citation.anchor {
                        HStack(spacing: LHSpacing.md) {
                            if let page = anchor.page {
                                Label("Page \(page)", systemImage: "book.pages")
                            }
                            if let slide = anchor.slide {
                                Label("Slide \(slide)", systemImage: "rectangle.on.rectangle")
                            }
                            if let timestamp = anchor.timestamp {
                                Label("Timestamp \(Int(timestamp))s", systemImage: "waveform")
                            }
                            Text("Revision \(anchor.revision)")
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                        }
                        .font(.subheadline)

                        VStack(alignment: .leading, spacing: LHSpacing.xs) {
                            Text("Anchored excerpt").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            Text(anchor.excerpt.isEmpty ? "No excerpt was saved for this anchor." : anchor.excerpt)
                                .textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(LHSpacing.md)
                        .learningSurface(emphasized: false)
                    }

                    if let (url, page) = anchoredPDF {
                        VStack(alignment: .leading, spacing: LHSpacing.xs) {
                            Text("Original page \(page)")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            AnchoredPDFPreview(url: url, page: page)
                                .frame(minHeight: 320)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .stroke(LearningPalette.separator, lineWidth: 1)
                                }
                        }
                    }

                    if let url = citation.url {
                        Link(destination: url) {
                            Label("Open source link", systemImage: "safari")
                        }
                        .buttonStyle(.borderedProminent)
                    }

                    if let source {
                        Button("Select source in Library") {
                            store.selectedSpaceID = source.spaceID
                            store.selectedSourceID = source.id
                            dismiss()
                        }
                        .buttonStyle(.bordered)
                    }
                }
                .padding(LHSpacing.lg)
                .frame(maxWidth: 720, alignment: .leading)
            }
            .navigationTitle("Source anchor")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .onAppear {
            if let source {
                store.selectedSpaceID = source.spaceID
                store.selectedSourceID = source.id
            } else {
                store.selectedSpaceID = space.id
            }
        }
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 420)
        #endif
    }
}

#if os(macOS)
private struct AnchoredPDFPreview: NSViewRepresentable {
    let url: URL
    let page: Int

    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displaysPageBreaks = true
        return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
        guard view.document?.documentURL != url,
              let document = PDFDocument(url: url) else {
            navigate(view)
            return
        }
        view.document = document
        navigate(view)
    }

    private func navigate(_ view: PDFView) {
        guard let document = view.document,
              let target = document.page(at: max(0, min(page - 1, document.pageCount - 1))) else { return }
        view.go(to: target)
    }
}
#else
private struct AnchoredPDFPreview: UIViewRepresentable {
    let url: URL
    let page: Int

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displaysPageBreaks = true
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        if view.document?.documentURL != url { view.document = PDFDocument(url: url) }
        guard let document = view.document,
              let target = document.page(at: max(0, min(page - 1, document.pageCount - 1))) else { return }
        view.go(to: target)
    }
}
#endif
