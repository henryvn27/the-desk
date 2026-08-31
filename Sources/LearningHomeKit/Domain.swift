import Foundation

public enum StudySpaceKind: String, Codable, CaseIterable, Sendable {
    case `class`
    case track
}

public enum TutorStyle: String, Codable, CaseIterable, Sendable {
    case coachFirst
    case explainFirst
    case examPractice
    case custom

    public var title: String {
        switch self {
        case .coachFirst: "Coach first"
        case .explainFirst: "Explain first"
        case .examPractice: "Exam practice"
        case .custom: "Custom"
        }
    }
}

public enum SourceKind: String, Codable, CaseIterable, Sendable {
    case pdf, epub, document, presentation, image, audio, url, note, wispr

    public var symbol: String {
        switch self {
        case .pdf, .epub: "book.closed"
        case .document: "doc.text"
        case .presentation: "rectangle.on.rectangle"
        case .image: "photo"
        case .audio: "waveform"
        case .url: "link"
        case .note: "note.text"
        case .wispr: "quote.bubble"
        }
    }
}

public enum ProcessingState: String, Codable, Sendable {
    case queued, processing, ready, needsAuthentication, failed
}

public enum AssignmentState: String, Codable, CaseIterable, Sendable {
    case planned
    case ready
    case submittedUnverified
    case verifiedComplete
    case returned

    public var title: String {
        switch self {
        case .planned: "Planned"
        case .ready: "Ready"
        case .submittedUnverified: "Submitted · verify"
        case .verifiedComplete: "Verified complete"
        case .returned: "Returned"
        }
    }
}

public struct AssignmentEvidence: Codable, Hashable, Identifiable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case manualNote, reminderCompleted, classroomAttachment, classroomTurnedIn, classroomReturned
    }

    public var id = UUID()
    public var kind: Kind
    public var summary: String
    public var observedAt: Date
    public var sourceURL: URL?

    public init(kind: Kind, summary: String, observedAt: Date = Date(), sourceURL: URL? = nil) {
        self.kind = kind
        self.summary = summary
        self.observedAt = observedAt
        self.sourceURL = sourceURL
    }

    public var provesSubmission: Bool { kind == .classroomTurnedIn || kind == .classroomReturned }
}

public enum SyncJobState: String, Codable, Sendable {
    case queued, processing, waitingForMac, needsAuthentication, failedRetryable, failedFinal, completed
}

public enum ProviderIdentifier: String, Codable, CaseIterable, Sendable {
    case codex, openAI, anthropic, gemini, localDemo

    public var title: String {
        switch self {
        case .codex: "Codex plan"
        case .openAI: "OpenAI API"
        case .anthropic: "Anthropic"
        case .gemini: "Gemini"
        case .localDemo: "Local preview"
        }
    }
}

public enum CitationOrigin: String, Codable, Sendable {
    case classSource, connector, web, modelKnowledge
}

public enum StudySceneKind: String, Codable, CaseIterable, Sendable {
    case conceptMap, timeline, process, comparison, annotatedDiagram, equationGraph, parameterLab

    public var title: String {
        switch self {
        case .conceptMap: "Concept map"
        case .timeline: "Timeline"
        case .process: "Process"
        case .comparison: "Comparison"
        case .annotatedDiagram: "Annotated diagram"
        case .equationGraph: "Equation graph"
        case .parameterLab: "Parameter lab"
        }
    }
}

public struct SourceAnchor: Codable, Hashable, Identifiable, Sendable {
    public var id = UUID()
    public var sourceID: UUID
    public var revision: Int
    public var page: Int?
    public var slide: Int?
    public var timestamp: TimeInterval?
    public var region: NormalizedRect?
    public var excerpt: String

    public init(
        sourceID: UUID,
        revision: Int = 1,
        page: Int? = nil,
        slide: Int? = nil,
        timestamp: TimeInterval? = nil,
        region: NormalizedRect? = nil,
        excerpt: String
    ) {
        self.sourceID = sourceID
        self.revision = revision
        self.page = page
        self.slide = slide
        self.timestamp = timestamp
        self.region = region
        self.excerpt = excerpt
    }
}

public struct NormalizedRect: Codable, Hashable, Sendable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public struct StudyCitation: Codable, Hashable, Identifiable, Sendable {
    public var id = UUID()
    public var label: String
    public var origin: CitationOrigin
    public var anchor: SourceAnchor?
    public var url: URL?

    public init(label: String, origin: CitationOrigin, anchor: SourceAnchor? = nil, url: URL? = nil) {
        self.label = label
        self.origin = origin
        self.anchor = anchor
        self.url = url
    }
}

public struct StudySceneSpec: Codable, Hashable, Sendable {
    public var schemaVersion: Int
    public var kind: StudySceneKind
    public var title: String
    public var summary: String
    public var nodes: [SceneNode]
    public var connections: [SceneConnection]
    public var interactions: [SceneInteraction]
    public var citations: [StudyCitation]
    public var accessibilitySummary: String

    public init(
        schemaVersion: Int = 1,
        kind: StudySceneKind,
        title: String,
        summary: String,
        nodes: [SceneNode],
        connections: [SceneConnection] = [],
        interactions: [SceneInteraction] = [],
        citations: [StudyCitation] = [],
        accessibilitySummary: String
    ) {
        self.schemaVersion = schemaVersion
        self.kind = kind
        self.title = title
        self.summary = summary
        self.nodes = nodes
        self.connections = connections
        self.interactions = interactions
        self.citations = citations
        self.accessibilitySummary = accessibilitySummary
    }

    public func validate() throws {
        guard schemaVersion == 1 else { throw StudySceneValidationError.unsupportedVersion }
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw StudySceneValidationError.missingTitle
        }
        guard (1...50).contains(nodes.count),
              nodes.allSatisfy({
                  !$0.id.isEmpty && !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                      && $0.x.isFinite && $0.y.isFinite
                      && (0...1).contains($0.x) && (0...1).contains($0.y)
              }) else { throw StudySceneValidationError.invalidNode }
        let ids = Set(nodes.map(\.id))
        guard ids.count == nodes.count else { throw StudySceneValidationError.duplicateNode }
        guard connections.allSatisfy({ ids.contains($0.fromNodeID) && ids.contains($0.toNodeID) }) else {
            throw StudySceneValidationError.invalidConnection
        }
        guard interactions.allSatisfy({ $0.targetNodeIDs.allSatisfy(ids.contains) }) else {
            throw StudySceneValidationError.invalidInteraction
        }
        guard !accessibilitySummary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw StudySceneValidationError.missingAccessibilitySummary
        }
    }
}

public struct SceneNode: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var title: String
    public var detail: String
    public var role: String
    public var x: Double
    public var y: Double

    public init(id: String, title: String, detail: String, role: String = "concept", x: Double, y: Double) {
        self.id = id
        self.title = title
        self.detail = detail
        self.role = role
        self.x = x
        self.y = y
    }
}

public struct SceneConnection: Codable, Hashable, Identifiable, Sendable {
    public var id = UUID()
    public var fromNodeID: String
    public var toNodeID: String
    public var label: String

    public init(from: String, to: String, label: String) {
        fromNodeID = from
        toNodeID = to
        self.label = label
    }
}

public struct SceneInteraction: Codable, Hashable, Identifiable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case reveal, hideLabels, reorder, parameter, prediction, explainAloud
    }

    public var id = UUID()
    public var kind: Kind
    public var label: String
    public var targetNodeIDs: [String]

    public init(kind: Kind, label: String, targetNodeIDs: [String] = []) {
        self.kind = kind
        self.label = label
        self.targetNodeIDs = targetNodeIDs
    }
}

public enum StudySceneValidationError: Error, Equatable {
    case unsupportedVersion, missingTitle, invalidNode, duplicateNode, invalidConnection, invalidInteraction, missingAccessibilitySummary
}

public struct OverlayCueSpec: Codable, Hashable, Sendable {
    public var schemaVersion = 1
    public var cues: [OverlayCue]

    public init(cues: [OverlayCue]) {
        self.cues = cues
    }

    public func validate() -> Bool {
        schemaVersion == 1 && cues.allSatisfy(\.isValid)
    }
}

public struct OverlayCue: Codable, Hashable, Identifiable, Sendable {
    public enum Kind: String, Codable, Sendable { case highlight, arrow, label }

    public var id = UUID()
    public var kind: Kind
    public var region: NormalizedRect
    public var label: String

    public init(kind: Kind, region: NormalizedRect, label: String) {
        self.kind = kind
        self.region = region
        self.label = label
    }

    public var isValid: Bool {
        let values = [region.x, region.y, region.width, region.height]
        return values.allSatisfy { $0.isFinite && $0 >= 0 && $0 <= 1 }
            && region.width > 0 && region.height > 0
            && region.x + region.width <= 1.001
            && region.y + region.height <= 1.001
            && label.count <= 160
    }
}

public final class StudySpace: Codable, Identifiable {
    public var id: UUID = UUID()
    public var kindRaw: String = StudySpaceKind.class.rawValue
    public var title: String = ""
    public var subtitle: String = ""
    public var colorHex: String = "#54706A"
    public var symbolName: String = "book.closed"
    public var tutorStyleRaw: String = TutorStyle.coachFirst.rawValue
    public var customTutorInstructions: String = ""
    public var sortOrder: Int = 0
    public var createdAt: Date = Date()
    public var lastOpenedAt: Date = Date()

    public init(
        id: UUID = UUID(),
        kind: StudySpaceKind,
        title: String,
        subtitle: String,
        colorHex: String,
        symbolName: String,
        tutorStyle: TutorStyle,
        sortOrder: Int
    ) {
        self.id = id
        kindRaw = kind.rawValue
        self.title = title
        self.subtitle = subtitle
        self.colorHex = colorHex
        self.symbolName = symbolName
        tutorStyleRaw = tutorStyle.rawValue
        self.sortOrder = sortOrder
    }

    public var kind: StudySpaceKind {
        get { StudySpaceKind(rawValue: kindRaw) ?? .class }
        set { kindRaw = newValue.rawValue }
    }

    public var tutorStyle: TutorStyle {
        get { TutorStyle(rawValue: tutorStyleRaw) ?? .coachFirst }
        set { tutorStyleRaw = newValue.rawValue }
    }
}

public final class SourceAsset: Codable, Identifiable {
    public var id: UUID = UUID()
    public var spaceID: UUID = UUID()
    public var title: String = ""
    public var kindRaw: String = SourceKind.note.rawValue
    public var connectorName: String = "Local"
    public var originalFilename: String = ""
    public var processingStateRaw: String = ProcessingState.queued.rawValue
    public var latestRevision: Int = 1
    public var pageCount: Int = 0
    public var duration: TimeInterval = 0
    public var importedAt: Date = Date()
    public var updatedAt: Date = Date()

    public init(
        id: UUID = UUID(),
        spaceID: UUID,
        title: String,
        kind: SourceKind,
        connectorName: String = "Local",
        originalFilename: String = "",
        processingState: ProcessingState = .ready,
        pageCount: Int = 0,
        duration: TimeInterval = 0
    ) {
        self.id = id
        self.spaceID = spaceID
        self.title = title
        kindRaw = kind.rawValue
        self.connectorName = connectorName
        self.originalFilename = originalFilename
        processingStateRaw = processingState.rawValue
        self.pageCount = pageCount
        self.duration = duration
    }

    public var kind: SourceKind {
        get { SourceKind(rawValue: kindRaw) ?? .note }
        set { kindRaw = newValue.rawValue }
    }

    public var processingState: ProcessingState {
        get { ProcessingState(rawValue: processingStateRaw) ?? .queued }
        set { processingStateRaw = newValue.rawValue }
    }
}

public final class SourceRevisionRecord: Codable, Identifiable {
    public var id: UUID = UUID()
    public var sourceID: UUID = UUID()
    public var revisionNumber: Int = 1
    public var sha256: String = ""
    public var extractedText: String = ""
    /// Relative filename used by the Mac store. It is deliberately not a path:
    /// persistence resolves it inside The Desk's revision-text directory.
    public var textStorageKey: String = ""
    /// Decode-only migration marker; never persisted as product data.
    public var hasInlineTextPayload = false
    public var anchorIndexData: Data = Data()
    public var originalFilePath: String = ""
    public var createdAt: Date = Date()

    public init(
        sourceID: UUID,
        revisionNumber: Int,
        sha256: String,
        extractedText: String,
        anchorIndexData: Data = Data(),
        originalFilePath: String = ""
    ) {
        self.sourceID = sourceID
        self.revisionNumber = revisionNumber
        self.sha256 = sha256
        self.extractedText = extractedText
        textStorageKey = "\(id.uuidString).txt"
        self.anchorIndexData = anchorIndexData
        self.originalFilePath = originalFilePath
    }

    private enum CodingKeys: String, CodingKey {
        case id, sourceID, revisionNumber, sha256, extractedText, textStorageKey
        case anchorIndexData, originalFilePath, createdAt
    }

    public required init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        sourceID = try values.decodeIfPresent(UUID.self, forKey: .sourceID) ?? UUID()
        revisionNumber = try values.decodeIfPresent(Int.self, forKey: .revisionNumber) ?? 1
        sha256 = try values.decodeIfPresent(String.self, forKey: .sha256) ?? ""
        extractedText = try values.decodeIfPresent(String.self, forKey: .extractedText) ?? ""
        hasInlineTextPayload = values.contains(.extractedText)
        // An absent key identifies a legacy inline-text snapshot. Persistence
        // assigns a key only after it has written that inline text safely.
        textStorageKey = try values.decodeIfPresent(String.self, forKey: .textStorageKey) ?? ""
        anchorIndexData = try values.decodeIfPresent(Data.self, forKey: .anchorIndexData) ?? Data()
        originalFilePath = try values.decodeIfPresent(String.self, forKey: .originalFilePath) ?? ""
        createdAt = try values.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(id, forKey: .id)
        try values.encode(sourceID, forKey: .sourceID)
        try values.encode(revisionNumber, forKey: .revisionNumber)
        try values.encode(sha256, forKey: .sha256)
        try values.encode(textStorageKey, forKey: .textStorageKey)
        try values.encode(anchorIndexData, forKey: .anchorIndexData)
        try values.encode(originalFilePath, forKey: .originalFilePath)
        try values.encode(createdAt, forKey: .createdAt)

        // Ordinary Codable callers retain the legacy self-contained behavior.
        // The persistent Mac snapshot opts out, while companion snapshots opt
        // into a bounded excerpt.
        if let limit = encoder.userInfo[.sourceRevisionTextLimit] as? Int {
            if limit > 0 {
                try values.encode(String(extractedText.prefix(limit)), forKey: .extractedText)
            }
        } else {
            try values.encode(extractedText, forKey: .extractedText)
        }
    }
}

public final class Assignment: Codable, Identifiable {
    public var id: UUID = UUID()
    public var spaceID: UUID = UUID()
    public var title: String = ""
    public var detail: String = ""
    public var dueAt: Date = Date()
    public var stateRaw: String = AssignmentState.planned.rawValue
    public var sourceName: String = "Manual"
    public var externalURLString: String = ""
    public var evidenceSummary: String = ""
    public var evidenceObservedAt: Date?
    public var linkedReminderIdentifier: String = ""
    public var evidenceData: Data = Data()
    public var priority: Int = 0
    public var sourceAnchorData: Data?
    public var originatingProviderRaw: String?
    public var originatingModel: String?

    public init(
        id: UUID = UUID(),
        spaceID: UUID,
        title: String,
        detail: String = "",
        dueAt: Date,
        state: AssignmentState,
        sourceName: String,
        externalURL: URL? = nil,
        evidenceSummary: String = "",
        priority: Int = 0,
        sourceAnchor: SourceAnchor? = nil,
        originatingProvider: ProviderIdentifier? = nil,
        originatingModel: String? = nil
    ) {
        self.id = id
        self.spaceID = spaceID
        self.title = title
        self.detail = detail
        self.dueAt = dueAt
        stateRaw = state.rawValue
        self.sourceName = sourceName
        externalURLString = externalURL?.absoluteString ?? ""
        self.evidenceSummary = evidenceSummary
        self.priority = priority
        sourceAnchorData = sourceAnchor.flatMap { try? JSONEncoder().encode($0) }
        originatingProviderRaw = originatingProvider?.rawValue
        self.originatingModel = originatingModel
        if !evidenceSummary.isEmpty {
            let kind: AssignmentEvidence.Kind = sourceName == "Google Classroom" ? .classroomAttachment : .manualNote
            evidenceData = (try? JSONEncoder().encode([AssignmentEvidence(kind: kind, summary: evidenceSummary)])) ?? Data()
        }
    }

    public var state: AssignmentState {
        get { AssignmentState(rawValue: stateRaw) ?? .planned }
        set { stateRaw = newValue.rawValue }
    }

    public var externalURL: URL? { URL(string: externalURLString) }

    public var sourceAnchor: SourceAnchor? {
        guard let sourceAnchorData else { return nil }
        return try? JSONDecoder().decode(SourceAnchor.self, from: sourceAnchorData)
    }

    public var originatingProvider: ProviderIdentifier? {
        originatingProviderRaw.flatMap(ProviderIdentifier.init(rawValue:))
    }

    public var evidence: [AssignmentEvidence] {
        get { (try? JSONDecoder().decode([AssignmentEvidence].self, from: evidenceData)) ?? [] }
        set { evidenceData = (try? JSONEncoder().encode(newValue)) ?? evidenceData }
    }
}

public final class CanvasArtifact: Codable, Identifiable {
    public var id: UUID = UUID()
    public var spaceID: UUID = UUID()
    public var title: String = ""
    public var kindRaw: String = StudySceneKind.conceptMap.rawValue
    public var version: Int = 1
    public var sourceRevisionSignature: String = ""
    public var isStale: Bool = false
    public var isPinned: Bool = false
    public var specData: Data = Data()
    /// Optional for backward-compatible decoding of pre-history snapshots.
    /// Migration seeds the first immutable version after decode.
    public var historyData: Data?
    public var createdAt: Date = Date()
    public var updatedAt: Date = Date()
    public var lastOpenedAt: Date = Date()

    public init(
        id: UUID = UUID(),
        spaceID: UUID,
        title: String,
        spec: StudySceneSpec,
        sourceRevisionSignature: String,
        isPinned: Bool = false
    ) {
        self.id = id
        self.spaceID = spaceID
        self.title = title
        kindRaw = spec.kind.rawValue
        self.sourceRevisionSignature = sourceRevisionSignature
        self.isPinned = isPinned
        specData = (try? JSONEncoder().encode(spec)) ?? Data()
        historyData = (try? JSONEncoder().encode([
            CanvasVersionSnapshot(version: 1, specData: specData, sourceRevisionSignature: sourceRevisionSignature)
        ])) ?? Data()
    }

    public var kind: StudySceneKind { StudySceneKind(rawValue: kindRaw) ?? .conceptMap }

    public var spec: StudySceneSpec? {
        get { try? JSONDecoder().decode(StudySceneSpec.self, from: specData) }
        set {
            guard let newValue else { return }
            var versions = history
            if !versions.contains(where: { $0.version == version }) {
                versions.append(CanvasVersionSnapshot(version: version, specData: specData, sourceRevisionSignature: sourceRevisionSignature))
            }
            kindRaw = newValue.kind.rawValue
            specData = (try? JSONEncoder().encode(newValue)) ?? specData
            version += 1
            updatedAt = Date()
            versions.append(CanvasVersionSnapshot(version: version, specData: specData, sourceRevisionSignature: sourceRevisionSignature))
            history = versions
        }
    }

    public func restore(_ snapshot: CanvasVersionSnapshot, currentSourceSignature: String) {
        guard (try? JSONDecoder().decode(StudySceneSpec.self, from: snapshot.specData)) != nil else { return }
        var versions = history
        if !versions.contains(where: { $0.version == version }) {
            versions.append(CanvasVersionSnapshot(version: version, specData: specData, sourceRevisionSignature: sourceRevisionSignature))
        }
        specData = snapshot.specData
        if let restored = try? JSONDecoder().decode(StudySceneSpec.self, from: snapshot.specData) {
            kindRaw = restored.kind.rawValue
        }
        sourceRevisionSignature = snapshot.sourceRevisionSignature
        isStale = snapshot.sourceRevisionSignature != currentSourceSignature
        version += 1
        updatedAt = Date()
        versions.append(CanvasVersionSnapshot(version: version, specData: specData, sourceRevisionSignature: sourceRevisionSignature))
        history = versions
    }

    public var history: [CanvasVersionSnapshot] {
        get {
            guard let historyData else { return [] }
            return (try? JSONDecoder().decode([CanvasVersionSnapshot].self, from: historyData)) ?? []
        }
        set { historyData = (try? JSONEncoder().encode(newValue)) ?? historyData }
    }

    var decodedHistoryState: CanvasHistoryDecodeState {
        guard let historyData else { return .missing }
        guard let snapshots = try? JSONDecoder().decode([CanvasVersionSnapshot].self, from: historyData) else {
            return .invalid
        }
        return .valid(snapshots)
    }

    public func acceptReviewedRefresh(sourceSignature: String, updatedSpec: StudySceneSpec? = nil) {
        var versions = history
        if !versions.contains(where: { $0.version == version }) {
            versions.append(CanvasVersionSnapshot(version: version, specData: specData, sourceRevisionSignature: sourceRevisionSignature))
        }
        if let updatedSpec {
            kindRaw = updatedSpec.kind.rawValue
            specData = (try? JSONEncoder().encode(updatedSpec)) ?? specData
        }
        version += 1
        sourceRevisionSignature = sourceSignature
        isStale = false
        updatedAt = Date()
        versions.append(CanvasVersionSnapshot(version: version, specData: specData, sourceRevisionSignature: sourceRevisionSignature))
        history = versions
    }
}

enum CanvasHistoryDecodeState {
    case missing
    case valid([CanvasVersionSnapshot])
    case invalid
}

extension CodingUserInfoKey {
    static let sourceRevisionTextLimit = CodingUserInfoKey(
        rawValue: "com.thedesk.source-revision-text-limit"
    )!
}

public struct CanvasVersionSnapshot: Codable, Hashable, Identifiable, Sendable {
    public var id = UUID()
    public var version: Int
    public var specData: Data
    public var sourceRevisionSignature: String
    public var savedAt: Date

    public init(version: Int, specData: Data, sourceRevisionSignature: String, savedAt: Date = Date()) {
        self.version = version
        self.specData = specData
        self.sourceRevisionSignature = sourceRevisionSignature
        self.savedAt = savedAt
    }
}

public enum StudySessionPlanState: String, Codable, Sendable {
    case planned, active, completed, cancelled
}

public final class StudySession: Codable, Identifiable {
    public var id: UUID = UUID()
    public var spaceID: UUID = UUID()
    public var title: String = ""
    public var startedAt: Date = Date()
    public var endedAt: Date?
    public var providerRaw: String = ProviderIdentifier.localDemo.rawValue
    public var notes: String = ""
    public var planID: UUID?
    public var scheduledStart: Date?
    public var plannedDurationMinutes: Int?
    public var planStateRaw: String?
    public var linkedAssignmentID: UUID?
    public var linkedMasteryRecordID: UUID?
    public var linkedSourceID: UUID?
    public var calendarEventIdentifier: String?
    public var calendarName: String?

    public init(spaceID: UUID, title: String, provider: ProviderIdentifier) {
        self.spaceID = spaceID
        self.title = title
        providerRaw = provider.rawValue
        planStateRaw = StudySessionPlanState.active.rawValue
    }

    public init(
        spaceID: UUID,
        title: String,
        notes: String,
        scheduledStart: Date,
        durationMinutes: Int,
        planID: UUID,
        linkedAssignmentID: UUID? = nil,
        linkedMasteryRecordID: UUID? = nil,
        linkedSourceID: UUID? = nil
    ) {
        self.spaceID = spaceID
        self.title = title
        self.notes = notes
        self.planID = planID
        self.linkedAssignmentID = linkedAssignmentID
        self.linkedMasteryRecordID = linkedMasteryRecordID
        self.linkedSourceID = linkedSourceID
        self.scheduledStart = scheduledStart
        plannedDurationMinutes = max(10, min(durationMinutes, 240))
        planStateRaw = StudySessionPlanState.planned.rawValue
        providerRaw = ProviderIdentifier.localDemo.rawValue
    }

    public var planState: StudySessionPlanState {
        get { planStateRaw.flatMap(StudySessionPlanState.init(rawValue:)) ?? (endedAt == nil ? .active : .completed) }
        set { planStateRaw = newValue.rawValue }
    }

    public var isPlannedBlock: Bool {
        scheduledStart != nil && plannedDurationMinutes != nil
    }
}

public final class MasteryRecord: Codable, Identifiable {
    public var id: UUID = UUID()
    public var spaceID: UUID = UUID()
    public var topic: String = ""
    public var score: Double = 0
    public var confidence: Int = 0
    public var nextReviewAt: Date = Date()
    public var updatedAt: Date = Date()

    public init(spaceID: UUID, topic: String, score: Double, confidence: Int, nextReviewAt: Date) {
        self.spaceID = spaceID
        self.topic = topic
        self.score = score
        self.confidence = confidence
        self.nextReviewAt = nextReviewAt
    }
}

public final class ProviderRun: Codable, Identifiable {
    public var id: UUID = UUID()
    public var spaceID: UUID = UUID()
    public var providerRaw: String = ProviderIdentifier.localDemo.rawValue
    public var modelName: String = ""
    public var taskRaw: String = "explain"
    public var prompt: String = ""
    public var response: String = ""
    public var citationsData: Data = Data()
    public var createdAt: Date = Date()

    public init(spaceID: UUID, provider: ProviderIdentifier, modelName: String, task: String, prompt: String) {
        self.spaceID = spaceID
        providerRaw = provider.rawValue
        self.modelName = modelName
        taskRaw = task
        self.prompt = prompt
    }
}

public final class SyncJob: Codable, Identifiable {
    public var id: UUID = UUID()
    public var kindRaw: String = "capture"
    public var stateRaw: String = SyncJobState.queued.rawValue
    public var payloadData: Data = Data()
    public var idempotencyKey: String = UUID().uuidString
    public var retryCount: Int = 0
    public var errorMessage: String = ""
    public var createdAt: Date = Date()
    public var updatedAt: Date = Date()

    public init(kind: String, state: SyncJobState, payloadData: Data, idempotencyKey: String = UUID().uuidString) {
        kindRaw = kind
        stateRaw = state.rawValue
        self.payloadData = payloadData
        self.idempotencyKey = idempotencyKey
    }

    public var state: SyncJobState {
        get { SyncJobState(rawValue: stateRaw) ?? .queued }
        set { stateRaw = newValue.rawValue }
    }
}

public final class IntegrationAccount: Codable, Identifiable {
    public var id: String = ""
    public var displayName: String = ""
    public var statusRaw: String = "disconnected"
    public var detail: String = ""
    public var lastSyncAt: Date?
    public var isReadOnly: Bool = true

    public init(id: String, displayName: String, status: String, detail: String, isReadOnly: Bool) {
        self.id = id
        self.displayName = displayName
        statusRaw = status
        self.detail = detail
        self.isReadOnly = isReadOnly
    }
}

public final class KhanCheckIn: Codable, Identifiable {
    public var id: UUID = UUID()
    public var spaceID: UUID = UUID()
    public var title: String = ""
    public var urlString: String = ""
    public var score: Double = 0
    public var confidence: Int = 0
    public var nextStep: String = ""
    public var checkedInAt: Date = Date()

    public init(spaceID: UUID, title: String, url: URL, score: Double, confidence: Int, nextStep: String) {
        self.spaceID = spaceID
        self.title = title
        urlString = url.absoluteString
        self.score = score
        self.confidence = confidence
        self.nextStep = nextStep
    }
}
