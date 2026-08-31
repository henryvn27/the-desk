import Foundation
import PDFKit
import SwiftUI
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#else
import UIKit
#endif

public struct StudyCanvasView: View {
    @EnvironmentObject private var store: LearningHomeStore
    let artifact: CanvasArtifact
    let space: StudySpace
    @ViewStorage private var practiceMode = false
    @ViewStorage private var hideLabels = false
    @ViewStorage private var angle = 45.0
    @ViewStorage private var speed = 18.0
    @ViewStorage private var showingAccessibility = false
    @ViewStorage private var showingDiff = false
    @ViewStorage private var selectedCitation: StudyCitation?
    @ViewStorage private var refreshedSpec: StudySceneSpec?
    @ViewStorage private var refreshedSourceSignature = ""
    @ViewStorage private var isRefreshing = false
    @ViewStorage private var showingEditor = false
    @ViewStorage private var showingHistory = false
    @ViewStorage private var showingExporter = false
    @ViewStorage private var exportDocument: CanvasExportDocument?
    @ViewStorage private var exportType = UTType.png
    @ViewStorage private var exportFilename = "Study Canvas"
    @ViewStorage private var errorMessage: String?

    public init(artifact: CanvasArtifact, space: StudySpace) {
        self.artifact = artifact
        self.space = space
    }

    public var body: some View {
        VStack(spacing: 0) {
            canvasToolbar
            Divider()
            if let spec = artifact.spec {
                ScrollView {
                    VStack(alignment: .leading, spacing: LHSpacing.lg) {
                        if artifact.isStale { staleBanner }
                        canvasHeader(spec)
                        StudySceneRenderer(spec: spec, tint: LearningPalette.copper, hideLabels: hideLabels, angle: $angle, speed: $speed)
                            .frame(minHeight: 420)
                            .learningSurface()
                        practiceControls(spec)
                        sourceSection(spec)
                        if showingAccessibility { accessibilitySection(spec) }
                    }
                    .padding(LHSpacing.lg)
                    .frame(maxWidth: 1040, alignment: .leading)
                }
            } else {
                ContentUnavailableView("Canvas is unreadable", systemImage: "exclamationmark.triangle")
            }
        }
        .background(LearningPalette.appBackground)
        .onAppear { store.selectedCanvasID = artifact.id }
        .sheet(isPresented: $showingEditor) {
            if let spec = artifact.spec {
                CanvasEditorSheet(spec: spec, tint: LearningPalette.copper) { updated in
                    do {
                        try store.updateCanvasSpec(id: artifact.id, spec: updated)
                        showingEditor = false
                    } catch {
                        errorMessage = error.localizedDescription
                    }
                }
            }
        }
        .sheet(isPresented: $showingHistory) {
            CanvasHistorySheet(artifact: artifact) { snapshot in
                do {
                    try store.restoreCanvas(
                        id: artifact.id,
                        snapshot: snapshot,
                        currentSourceSignature: currentSourceSignature
                    )
                } catch {
                    errorMessage = error.localizedDescription
                }
            }
        }
        .sheet(item: $selectedCitation) { citation in
            CitationAnchorSheet(citation: citation, space: space)
                .environmentObject(store)
        }
        .fileExporter(
            isPresented: $showingExporter,
            document: exportDocument,
            contentType: exportType,
            defaultFilename: exportFilename
        ) { result in
            if case .failure(let error) = result { errorMessage = error.localizedDescription }
        }
        .alert("Canvas action failed", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "Unknown error") }
    }

    private var canvasToolbar: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: LHSpacing.sm) {
                canvasToolbarIdentity
                Spacer(minLength: LHSpacing.sm)
                canvasToolbarActions
            }
            VStack(alignment: .leading, spacing: LHSpacing.sm) {
                canvasToolbarIdentity
                canvasToolbarActions
            }
        }
        .padding(.horizontal, LHSpacing.md)
        .padding(.vertical, LHSpacing.sm)
        .background(LearningPalette.surface)
    }

    private var canvasToolbarIdentity: some View {
        HStack(spacing: LHSpacing.sm) {
            ZStack {
                RoundedRectangle(cornerRadius: LHRadius.control, style: .continuous)
                    .fill(LearningPalette.copperSoft)
                Image(systemName: "point.3.filled.connected.trianglepath.dotted")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(LearningPalette.copper)
            }
            .frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 1) {
                Text("Study Canvas")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(LearningPalette.ink)
                Text(space.title)
                    .font(.caption)
                    .foregroundStyle(LearningPalette.mutedInk)
            }
            StatusPill("v\(artifact.version)", symbol: "clock.arrow.circlepath")
            if artifact.isPinned { StatusPill("Pinned", symbol: "pin.fill", tone: .info) }
        }
        .accessibilityElement(children: .combine)
    }

    private var canvasToolbarActions: some View {
        HStack(spacing: LHSpacing.xs) {
            Toggle("Practice", isOn: $practiceMode)
                .toggleStyle(.switch)
                .tint(LearningPalette.moss)
            #if os(macOS)
            Button { showingEditor = true } label: { Label("Edit", systemImage: "pencil") }
                .buttonStyle(.bordered)
            #endif
            Button { showingAccessibility.toggle() } label: {
                Label(showingAccessibility ? "Hide accessible view" : "Accessible view", systemImage: "accessibility")
            }
            .buttonStyle(.bordered)
            #if os(iOS)
            .labelStyle(.iconOnly)
            .accessibilityLabel(showingAccessibility ? "Hide accessible view" : "Show accessible view")
            #endif
            Menu {
                Button("Export image") { prepareExport(type: .png) }
                Button("Export PDF") { prepareExport(type: .pdf) }
                #if os(macOS)
                Divider()
                Button("View revision history") { showingHistory = true }
                #endif
            } label: {
                Label("Export", systemImage: "square.and.arrow.up")
            }
            #if os(iOS)
            .labelStyle(.iconOnly)
            .accessibilityLabel("Export canvas")
            #endif
        }
        .controlSize(.regular)
    }

    private func canvasHeader(_ spec: StudySceneSpec) -> some View {
        HStack(alignment: .top, spacing: LHSpacing.lg) {
            VStack(alignment: .leading, spacing: LHSpacing.xs) {
                HStack(spacing: LHSpacing.xs) {
                    Circle()
                        .fill(Color(hex: space.colorHex))
                        .frame(width: 8, height: 8)
                    Text(spec.kind.title.uppercased())
                        .font(.caption.weight(.semibold))
                        .tracking(0.8)
                        .foregroundStyle(LearningPalette.copper)
                }
                Text(spec.title)
                    .font(.largeTitle.weight(.semibold))
                    .foregroundStyle(LearningPalette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(spec.summary)
                    .font(.body)
                    .foregroundStyle(LearningPalette.mutedInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: LHSpacing.sm)
            VStack(alignment: .trailing, spacing: LHSpacing.xs) {
                ProgressChip("Sourced", value: "\(spec.citations.count)", tint: LearningPalette.moss)
                Text("Saved learning artifact")
                    .font(.caption)
                    .foregroundStyle(LearningPalette.mutedInk)
            }
        }
        .padding(.vertical, LHSpacing.xs)
    }

    private var staleBanner: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            HStack(spacing: LHSpacing.sm) {
                Image(systemName: "arrow.triangle.2.circlepath").foregroundStyle(LearningPalette.warning)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Source changed").font(.subheadline.weight(.semibold))
                    Text("This canvas still shows its previous version. Review the source diff before updating.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                #if os(macOS)
                Button(refreshButtonTitle) {
                    if hasCurrentRefresh { showingDiff.toggle() } else { prepareRefresh() }
                }
                .buttonStyle(.bordered)
                .disabled(isRefreshing)
                Button("Accept refreshed scene", action: acceptRefresh)
                .buttonStyle(.borderedProminent)
                .tint(LearningPalette.warning)
                .disabled(!hasCurrentRefresh)
                #else
                Text("Your Mac will prepare a reviewed update. Practice stays available here.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                #endif
            }
            if isRefreshing {
                Label("Generating a refreshed scene from the latest source text…", systemImage: "arrow.triangle.2.circlepath")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if showingDiff, let refreshedSpec {
                Grid(alignment: .leading, horizontalSpacing: LHSpacing.lg, verticalSpacing: 4) {
                    GridRow { Text("Canvas v\(artifact.version)").font(.caption.weight(.semibold)); Text(artifact.sourceRevisionSignature).font(.caption.monospaced()).foregroundStyle(.secondary) }
                    GridRow { Text("Current sources").font(.caption.weight(.semibold)); Text(currentSourceSignature).font(.caption.monospaced()).foregroundStyle(LearningPalette.warning) }
                }
                refreshDiff(refreshedSpec)
            } else if refreshedSpec != nil && !hasCurrentRefresh {
                Text("Sources changed again. Prepare a new refreshed scene before accepting this review.")
                    .font(.caption)
                    .foregroundStyle(LearningPalette.warning)
            } else if refreshedSpec == nil {
                Text("Prepare a refreshed scene to compare source text and claims. The revision signature alone cannot update this canvas.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(LHSpacing.md)
        .background(LearningPalette.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: LHRadius.surface))
        .overlay { RoundedRectangle(cornerRadius: LHRadius.surface).stroke(LearningPalette.warning.opacity(0.25)) }
    }

    private var currentSourceSignature: String {
        store.sources(in: space.id).compactMap { source in
            store.latestRevision(for: source.id).map { "\(source.id.uuidString.prefix(8)):\($0.revisionNumber)" }
        }.sorted().joined(separator: ",")
    }

    private var hasCurrentRefresh: Bool {
        refreshedSpec != nil && refreshedSourceSignature == currentSourceSignature
    }

    private var refreshButtonTitle: String {
        if isRefreshing { return "Preparing…" }
        if hasCurrentRefresh { return showingDiff ? "Hide diff" : "Review diff" }
        return "Prepare review"
    }

    private func practiceControls(_ spec: StudySceneSpec) -> some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            HStack(alignment: .top, spacing: LHSpacing.sm) {
                ZStack {
                    RoundedRectangle(cornerRadius: LHRadius.control, style: .continuous)
                        .fill(LearningPalette.mossSoft)
                    Image(systemName: "brain.head.profile")
                        .foregroundStyle(LearningPalette.moss)
                }
                .frame(width: 38, height: 38)
                SectionHeading("Practice this canvas", detail: "Transform the same sourced scene without losing its evidence.")
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: LHSpacing.xs)], alignment: .leading, spacing: LHSpacing.xs) {
                ForEach(spec.interactions) { interaction in
                    practiceButton(interaction)
                }
            }
            if practiceMode {
                Text("Prediction: before changing the controls, explain which launch angle should maximize range and what assumptions your prediction needs.")
                    .font(.subheadline)
                    .foregroundStyle(LearningPalette.ink)
                    .padding(LHSpacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(LearningPalette.mossSoft, in: RoundedRectangle(cornerRadius: LHRadius.control, style: .continuous))
            }
        }
        .padding(LHSpacing.md)
        .learningSurface(emphasized: false)
    }

    private func practiceButton(_ interaction: SceneInteraction) -> some View {
        let isActive = interaction.kind == .hideLabels ? hideLabels : (interaction.kind == .prediction && practiceMode)
        return Button {
            if interaction.kind == .hideLabels { hideLabels.toggle() }
            if interaction.kind == .prediction { practiceMode = true }
        } label: {
            Label(interaction.label, systemImage: interactionSymbol(interaction.kind))
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(minHeight: 28)
        }
        .buttonStyle(.bordered)
        .tint(isActive ? LearningPalette.moss : LearningPalette.copper)
        .accessibilityValue(isActive ? "On" : "Off")
    }

    private func sourceSection(_ spec: StudySceneSpec) -> some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            HStack(alignment: .firstTextBaseline) {
                SectionHeading("Evidence", detail: "Every important claim stays traceable after editing or export.")
                Spacer()
                ProgressChip("Anchors", value: "\(spec.citations.count)", tint: LearningPalette.copper)
            }
            ForEach(spec.citations) { citation in
                if citation.anchor != nil || citation.url != nil {
                    Button { openCitation(citation) } label: {
                        sourceCitationContent(citation)
                    }
                    .buttonStyle(.plain)
                } else {
                    sourceCitationContent(citation)
                }
            }
        }
    }

    private func sourceCitationContent(_ citation: StudyCitation) -> some View {
        HStack {
            Image(systemName: citationSymbol(citation.origin))
                .foregroundStyle(citation.origin == .modelKnowledge ? LearningPalette.warning : LearningPalette.copper)
                .frame(width: 24)
            VStack(alignment: .leading) {
                Text(citation.label)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(LearningPalette.ink)
                Text(citationOriginLabel(citation.origin))
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(citation.origin == .modelKnowledge ? LearningPalette.warning : LearningPalette.mutedInk)
                if let excerpt = citation.anchor?.excerpt {
                    Text(excerpt).font(.caption).foregroundStyle(LearningPalette.mutedInk).lineLimit(2)
                }
            }
            Spacer()
            if citation.anchor != nil || citation.url != nil {
                Image(systemName: "arrow.up.right.square").foregroundStyle(.secondary)
            }
        }
        .padding(LHSpacing.sm)
        .learningSurface(emphasized: false)
        .contentShape(Rectangle())
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

    private func accessibilitySection(_ spec: StudySceneSpec) -> some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            SectionHeading("Accessible summary", detail: "The scene is also available as navigable text and data.")
            Text(spec.accessibilitySummary)
            Grid(alignment: .leading, horizontalSpacing: LHSpacing.lg, verticalSpacing: LHSpacing.xs) {
                GridRow { Text("Element").bold(); Text("Explanation").bold() }
                Divider()
                ForEach(spec.nodes) { node in GridRow { Text(node.title); Text(node.detail).foregroundStyle(.secondary) } }
            }
            .padding(LHSpacing.md)
            .learningSurface(emphasized: false)
        }
    }

    private func interactionSymbol(_ kind: SceneInteraction.Kind) -> String {
        switch kind {
        case .reveal: "eye"
        case .hideLabels: "eye.slash"
        case .reorder: "arrow.up.arrow.down"
        case .parameter: "slider.horizontal.3"
        case .prediction: "questionmark.bubble"
        case .explainAloud: "waveform"
        }
    }

    private func citationSymbol(_ origin: CitationOrigin) -> String {
        switch origin {
        case .classSource: "book.closed"
        case .connector: "point.3.connected.trianglepath.dotted"
        case .web: "globe"
        case .modelKnowledge: "sparkles"
        }
    }

    private func citationOriginLabel(_ origin: CitationOrigin) -> String {
        switch origin {
        case .classSource: "Class source"
        case .connector: "Connector source"
        case .web: "Web source"
        case .modelKnowledge: "Uncited model knowledge"
        }
    }

    private func prepareRefresh() {
        #if os(macOS)
        guard !isRefreshing, let currentSpec = artifact.spec else { return }
        let signature = currentSourceSignature
        let request = AIStudyRequest(
            spaceID: space.id,
            task: .visualize,
            prompt: "Refresh the saved Study Canvas \"\(currentSpec.title)\". Re-check every claim against the latest class material and preserve the learning goal.\n\(currentSpec.summary)",
            tutorStyle: space.tutorStyle,
            context: currentSourceContext,
            citations: currentSourceCitations,
            allowProviderKnowledge: false
        )

        isRefreshing = true
        showingDiff = false
        refreshedSpec = nil
        refreshedSourceSignature = signature
        Task {
            do {
                let result = try await StudySceneGenerator.shared.generate(request: request)
                refreshedSpec = result.spec
                showingDiff = true
            } catch {
                refreshedSourceSignature = ""
                errorMessage = error.localizedDescription
            }
            isRefreshing = false
        }
        #endif
    }

    private func acceptRefresh() {
        #if os(macOS)
        guard let refreshedSpec, hasCurrentRefresh else {
            errorMessage = "Prepare a refreshed scene and review its claims before accepting."
            return
        }
        let signature = currentSourceSignature
        do {
            try refreshedSpec.validate()
        } catch {
            errorMessage = "The refreshed scene failed validation and was not applied."
            return
        }
        do {
            try store.acceptCanvasRefresh(
                id: artifact.id,
                sourceSignature: signature,
                spec: refreshedSpec,
                title: refreshedSpec.title
            )
        } catch {
            errorMessage = error.localizedDescription
            return
        }
        self.refreshedSpec = nil
        refreshedSourceSignature = ""
        showingDiff = false
        #endif
    }

    private var currentSourceContext: String {
        store.sources(in: space.id).prefix(6).compactMap { source in
            guard let revision = store.latestRevision(for: source.id) else { return nil }
            let text = revision.extractedText.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            return "SOURCE: \(source.title)\n\(text.prefix(2_400))"
        }.joined(separator: "\n\n")
    }

    private var currentSourceCitations: [StudyCitation] {
        store.sources(in: space.id).prefix(6).compactMap { source in
            guard let revision = store.latestRevision(for: source.id) else { return nil }
            let indexedAnchor = (try? JSONDecoder().decode([SourceAnchor].self, from: revision.anchorIndexData))?.first
            let page = indexedAnchor?.page ?? Self.firstPageMarker(in: revision.extractedText)
            let time = indexedAnchor?.timestamp ?? Self.firstTimeMarker(in: revision.extractedText)
            let excerpt = indexedAnchor.map { $0.excerpt.isEmpty ? String(revision.extractedText.prefix(320)) : $0.excerpt }
                ?? String(revision.extractedText.prefix(320))
            let anchor = SourceAnchor(
                sourceID: source.id,
                revision: revision.revisionNumber,
                page: page,
                slide: indexedAnchor?.slide,
                timestamp: time,
                region: indexedAnchor?.region,
                excerpt: excerpt
            )
            let location = page.map { " · p. \($0)" } ?? time.map { " · \(Int($0))s" } ?? ""
            return StudyCitation(
                label: source.title + location,
                origin: source.connectorName == "Local" ? .classSource : .connector,
                anchor: anchor
            )
        }
    }

    private func refreshDiff(_ refreshedSpec: StudySceneSpec) -> some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            Text("Source content changes")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if sourceDiffs.isEmpty {
                Text("No source text diff is available from the saved revision signature. Review the regenerated claims below before accepting.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(sourceDiffs) { diff in
                    VStack(alignment: .leading, spacing: LHSpacing.xs) {
                        HStack {
                            Text(diff.title).font(.subheadline.weight(.medium))
                            Spacer()
                            Text(diff.revisionLabel).font(.caption.monospaced()).foregroundStyle(.secondary)
                        }
                        diffRow("Source text", before: diff.before, after: diff.after, kind: diff.kind)
                    }
                }
            }

            Text("Refreshed scene claims")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if sceneTextDiffs.isEmpty && sceneClaimDiffs.isEmpty {
                Text("The regenerated scene has the same title, summary, and node claims. The source content above is the review boundary.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(sceneTextDiffs) { diff in
                    diffRow(diff.label, before: diff.before, after: diff.after, kind: .changed)
                }
                ForEach(sceneClaimDiffs) { diff in
                    diffRow("\(diff.kind.label) claim · \(diff.label)", before: diff.before, after: diff.after, kind: diff.kind)
                }
            }

            Text("Nothing is saved until you accept the refreshed scene. The previous spec remains in revision history.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func diffRow(_ label: String, before: String, after: String, kind: CanvasDiffKind) -> some View {
        VStack(alignment: .leading, spacing: LHSpacing.xs) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(kind.tint)
            HStack(alignment: .top, spacing: LHSpacing.sm) {
                Text("Before").font(.caption2.weight(.semibold)).foregroundStyle(.secondary).frame(width: 48, alignment: .leading)
                Text(before).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            HStack(alignment: .top, spacing: LHSpacing.sm) {
                Text("After").font(.caption2.weight(.semibold)).foregroundStyle(.secondary).frame(width: 48, alignment: .leading)
                Text(after).font(.caption).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(LHSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LearningPalette.secondarySurface, in: RoundedRectangle(cornerRadius: LHRadius.control))
    }

    private var sourceDiffs: [CanvasSourceDiff] {
        store.sources(in: space.id).compactMap { source in
            guard let current = store.latestRevision(for: source.id) else { return nil }
            let previousNumber = recordedRevision(for: source)
            guard previousNumber != current.revisionNumber else { return nil }
            let previous = previousNumber.flatMap { number in
                store.revisions.first { $0.sourceID == source.id && $0.revisionNumber == number }
            }
            return CanvasSourceDiff(
                id: source.id,
                title: source.title,
                previousRevision: previous?.revisionNumber,
                currentRevision: current.revisionNumber,
                before: previous.map { sourceExcerpt($0.extractedText) } ?? "No saved revision text is available for this source.",
                after: sourceExcerpt(current.extractedText),
                kind: previous == nil ? .added : .changed
            )
        }
    }

    private func recordedRevision(for source: SourceAsset) -> Int? {
        let sourcePrefix = source.id.uuidString.prefix(8)
        for entry in artifact.sourceRevisionSignature.split(separator: ",") {
            let parts = entry.split(separator: ":", maxSplits: 1)
            if parts.count == 2, parts[0] == sourcePrefix, let revision = Int(parts[1]) {
                return revision
            }
        }
        return nil
    }

    private func sourceExcerpt(_ text: String) -> String {
        let lines = text.components(separatedBy: .newlines).filter {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("[[")
        }
        let compact = lines.joined(separator: " ").split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        return String(compact.prefix(480))
    }

    private var sceneClaimDiffs: [CanvasClaimDiff] {
        guard let previous = artifact.spec else { return [] }
        let previousByID = Dictionary(uniqueKeysWithValues: previous.nodes.map { ($0.id, $0) })
        let refreshedNodes = refreshedSpec?.nodes ?? []
        let refreshedByID = Dictionary(uniqueKeysWithValues: refreshedNodes.map { ($0.id, $0) })
        let ids = Set(previousByID.keys).union(refreshedByID.keys).sorted()
        return ids.compactMap { id in
            let oldNode = previousByID[id]
            let newNode = refreshedByID[id]
            switch (oldNode, newNode) {
            case let (nil, newNode?):
                return CanvasClaimDiff(id: id, label: newNode.title, before: "Claim not present in the saved scene.", after: claimText(newNode), kind: .added)
            case let (oldNode?, nil):
                return CanvasClaimDiff(id: id, label: oldNode.title, before: claimText(oldNode), after: "Claim removed from the refreshed scene.", kind: .removed)
            case let (oldNode?, newNode?):
                guard oldNode.title != newNode.title || oldNode.detail != newNode.detail else { return nil }
                return CanvasClaimDiff(id: id, label: newNode.title, before: claimText(oldNode), after: claimText(newNode), kind: .changed)
            default:
                return nil
            }
        }
    }

    private var sceneTextDiffs: [CanvasTextDiff] {
        guard let previous = artifact.spec, let refreshedSpec else { return [] }
        var diffs: [CanvasTextDiff] = []
        if previous.title != refreshedSpec.title {
            diffs.append(CanvasTextDiff(id: "title", label: "Canvas title", before: previous.title, after: refreshedSpec.title))
        }
        if previous.summary != refreshedSpec.summary {
            diffs.append(CanvasTextDiff(id: "summary", label: "Canvas summary", before: previous.summary, after: refreshedSpec.summary))
        }
        if previous.accessibilitySummary != refreshedSpec.accessibilitySummary {
            diffs.append(CanvasTextDiff(id: "accessibility", label: "Accessible summary", before: previous.accessibilitySummary, after: refreshedSpec.accessibilitySummary))
        }
        return diffs
    }

    private func claimText(_ node: SceneNode) -> String {
        node.detail.isEmpty ? node.title : "\(node.title): \(node.detail)"
    }

    private static func firstPageMarker(in text: String) -> Int? {
        guard let range = text.range(of: "[[page:") else { return nil }
        return Int(text[range.upperBound...].prefix { $0.isNumber })
    }

    private static func firstTimeMarker(in text: String) -> TimeInterval? {
        guard let range = text.range(of: "[[time:") else { return nil }
        return TimeInterval(text[range.upperBound...].prefix { $0.isNumber || $0 == "." })
    }

    private func prepareExport(type: UTType) {
        guard let spec = artifact.spec else { return }
        let exportView = CanvasExportView(
            spec: spec,
            tint: LearningPalette.copper,
            angle: angle,
            speed: speed
        )
        let renderer = ImageRenderer(content: exportView)
        renderer.scale = 2
        guard let image = renderer.cgImage else {
            errorMessage = "The canvas could not be rendered."
            return
        }

        let data: Data?
        if type == .pdf {
            #if os(macOS)
            let platformImage = NSImage(cgImage: image, size: NSSize(width: image.width, height: image.height))
            #else
            let platformImage = UIImage(cgImage: image)
            #endif
            let document = PDFDocument()
            if let page = PDFPage(image: platformImage) {
                document.insert(page, at: 0)
                data = document.dataRepresentation()
            } else { data = nil }
        } else {
            #if os(macOS)
            data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
            #else
            data = UIImage(cgImage: image).pngData()
            #endif
        }

        guard let data else {
            errorMessage = "The export file could not be created."
            return
        }
        exportType = type
        exportFilename = artifact.title.replacingOccurrences(of: "/", with: "-")
        exportDocument = CanvasExportDocument(data: data)
        showingExporter = true
    }
}

private enum CanvasDiffKind {
    case added, removed, changed

    var label: String {
        switch self {
        case .added: "Added"
        case .removed: "Removed"
        case .changed: "Changed"
        }
    }

    var tint: Color {
        switch self {
        case .added: LearningPalette.success
        case .removed: LearningPalette.danger
        case .changed: LearningPalette.warning
        }
    }
}

private struct CanvasSourceDiff: Identifiable {
    let id: UUID
    let title: String
    let previousRevision: Int?
    let currentRevision: Int
    let before: String
    let after: String
    let kind: CanvasDiffKind

    var revisionLabel: String {
        if let previousRevision { return "r\(previousRevision) → r\(currentRevision)" }
        return "new · r\(currentRevision)"
    }
}

private struct CanvasClaimDiff: Identifiable {
    let id: String
    let label: String
    let before: String
    let after: String
    let kind: CanvasDiffKind
}

private struct CanvasTextDiff: Identifiable {
    let id: String
    let label: String
    let before: String
    let after: String
}

public struct CanvasExportDocument: FileDocument {
    public static var readableContentTypes: [UTType] { [.png, .pdf] }
    public var data: Data

    public init(data: Data = Data()) { self.data = data }

    public init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }

    public func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

private struct CanvasExportView: View {
    let spec: StudySceneSpec
    let tint: Color
    let angle: Double
    let speed: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 5) {
                Text(spec.kind.title.uppercased()).font(.caption.bold()).tracking(1).foregroundStyle(tint)
                Text(spec.title).font(.system(size: 30, weight: .semibold))
                Text(spec.summary).font(.body).foregroundStyle(.secondary)
            }
            StudySceneRenderer(
                spec: spec,
                tint: tint,
                hideLabels: false,
                angle: .constant(angle),
                speed: .constant(speed)
            )
            .frame(height: 560)
            .learningSurface()
            HStack(spacing: 18) {
                ForEach(spec.citations.prefix(3)) { citation in
                    Label(citation.label, systemImage: "book.closed")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(40)
        .frame(width: 1_200, height: 800, alignment: .topLeading)
        .background(Color.white)
        .foregroundStyle(Color.black)
    }
}

private struct CanvasEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ViewStorage private var draft: StudySceneSpec
    @ViewStorage private var errorMessage: String?
    let tint: Color
    let onSave: (StudySceneSpec) -> Void

    init(spec: StudySceneSpec, tint: Color, onSave: @escaping (StudySceneSpec) -> Void) {
        _draft = ViewStorage(wrappedValue: spec)
        self.tint = tint
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Canvas title", text: $draft.title)
                TextField("Summary", text: $draft.summary, axis: .vertical).lineLimit(2...6)
                Section("Elements") {
                    ForEach($draft.nodes) { $node in
                        VStack(alignment: .leading, spacing: 6) {
                            TextField("Label", text: $node.title)
                            TextField("Explanation", text: $node.detail, axis: .vertical).lineLimit(2...4)
                        }
                        .padding(.vertical, 4)
                    }
                }
                Section("Accessibility") {
                    TextField("Scene summary", text: $draft.accessibilitySummary, axis: .vertical).lineLimit(3...8)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Edit Study Canvas")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        do { try draft.validate(); onSave(draft) }
                        catch { errorMessage = "Keep every connection attached to a unique, named element." }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(tint)
                }
            }
        }
        .frame(minWidth: 540, minHeight: 580)
        .alert("Canvas is invalid", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "Unknown error") }
    }
}

private struct CanvasHistorySheet: View {
    let artifact: CanvasArtifact
    let onRestore: (CanvasVersionSnapshot) -> Void

    var body: some View {
        NavigationStack {
            List(artifact.history.sorted { $0.version > $1.version }) { snapshot in
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Version \(snapshot.version)").font(.headline)
                        Text(snapshot.savedAt.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                        if let spec = try? JSONDecoder().decode(StudySceneSpec.self, from: snapshot.specData) {
                            Text(spec.title).font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    if snapshot.version == artifact.version {
                        StatusPill("Current", symbol: "checkmark", tone: .success)
                    } else {
                        Button("Restore as new version") { onRestore(snapshot) }.buttonStyle(.bordered)
                    }
                }
                .padding(.vertical, 4)
            }
            .navigationTitle("Canvas history")
        }
        .frame(minWidth: 520, minHeight: 460)
    }
}

private struct StudySceneRenderer: View {
    let spec: StudySceneSpec
    let tint: Color
    let hideLabels: Bool
    @Binding var angle: Double
    @Binding var speed: Double

    var body: some View {
        VStack(spacing: 0) {
            if spec.kind == .parameterLab {
                HStack(spacing: 0) {
                    ConceptMapView(spec: spec, tint: tint, hideLabels: hideLabels)
                        .frame(maxWidth: .infinity)
                    Divider()
                    TrajectoryLab(angle: $angle, speed: $speed, tint: tint)
                        .frame(maxWidth: .infinity)
                }
            } else {
                ConceptMapView(spec: spec, tint: tint, hideLabels: hideLabels)
            }
        }
        .padding(LHSpacing.md)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(spec.accessibilitySummary)
    }
}

private struct ConceptMapView: View {
    let spec: StudySceneSpec
    let tint: Color
    let hideLabels: Bool

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                ForEach(spec.connections) { connection in
                    if let start = spec.nodes.first(where: { $0.id == connection.fromNodeID }),
                       let end = spec.nodes.first(where: { $0.id == connection.toNodeID }) {
                        Path { path in
                            path.move(to: point(start, proxy.size))
                            path.addLine(to: point(end, proxy.size))
                        }
                        .stroke(tint.opacity(0.38), style: StrokeStyle(lineWidth: 1.5, dash: [4, 4]))
                    }
                }
                ForEach(spec.nodes) { node in
                    let displayTitle: String = hideLabels ? "?" : node.title
                    VStack(spacing: 4) {
                        Text(displayTitle)
                            .font(.subheadline)
                            .fontWeight(.semibold)
                        if !hideLabels {
                            Text(node.detail)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                                .lineLimit(3)
                        }
                    }
                    .padding(LHSpacing.sm)
                    .frame(width: 142)
                    .frame(minHeight: 68)
                    .background(node.role == "result" ? tint.opacity(0.12) : LearningPalette.surface, in: RoundedRectangle(cornerRadius: 10))
                    .overlay { RoundedRectangle(cornerRadius: 10).stroke(tint.opacity(node.role == "result" ? 0.5 : 0.22)) }
                    .position(point(node, proxy.size))
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .padding(LHSpacing.sm)
    }

    private func point(_ node: SceneNode, _ size: CGSize) -> CGPoint {
        CGPoint(x: max(75, min(size.width - 75, node.x * size.width)), y: max(45, min(size.height - 45, node.y * size.height)))
    }
}

private struct TrajectoryLab: View {
    @Binding var angle: Double
    @Binding var speed: Double
    let tint: Color

    private var range: Double {
        let radians = angle * .pi / 180
        return speed * speed * sin(2 * radians) / 9.81
    }

    var body: some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            HStack {
                VStack(alignment: .leading) {
                    Text("Trajectory lab").font(.headline)
                    Text("Ideal launch · same elevation").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(range, format: .number.precision(.fractionLength(1))) m").font(.title3.weight(.semibold).monospacedDigit()).foregroundStyle(tint)
            }
            Canvas { context, size in
                let baselineY = size.height - 18
                var baseline = Path()
                baseline.move(to: CGPoint(x: 8, y: baselineY))
                baseline.addLine(to: CGPoint(x: size.width - 8, y: baselineY))
                context.stroke(baseline, with: .color(.secondary.opacity(0.25)), lineWidth: 1)

                let radians = angle * .pi / 180
                let flight = 2 * speed * sin(radians) / 9.81
                var path = Path()
                for step in 0...80 {
                    let t = flight * Double(step) / 80
                    let xMeters = speed * cos(radians) * t
                    let yMeters = speed * sin(radians) * t - 4.905 * t * t
                    let x = 8 + CGFloat(xMeters / max(range, 0.1)) * (size.width - 16)
                    let scaleY = max(speed * speed * pow(sin(radians), 2) / 19.62, 0.1)
                    let y = baselineY - CGFloat(max(yMeters, 0) / scaleY) * (size.height - 35)
                    if step == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
                }
                context.stroke(path, with: .color(tint), style: StrokeStyle(lineWidth: 3, lineCap: .round))
            }
            .frame(height: 190)
            .background(LearningPalette.paper.opacity(0.7), in: RoundedRectangle(cornerRadius: 8))

            LabeledContent("Launch angle", value: "\(Int(angle))°")
            Slider(value: $angle, in: 15...75, step: 1).tint(tint)
            LabeledContent("Initial speed", value: "\(Int(speed)) m/s")
            Slider(value: $speed, in: 8...30, step: 1).tint(tint)
        }
        .padding(LHSpacing.md)
    }
}
