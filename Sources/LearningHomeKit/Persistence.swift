import CryptoKit
import Combine
import Foundation

public struct LearningHomeSnapshot: Codable {
    public var schemaVersion = 1
    public var spaces: [StudySpace]
    public var sources: [SourceAsset]
    public var revisions: [SourceRevisionRecord]
    public var assignments: [Assignment]
    public var canvases: [CanvasArtifact]
    public var sessions: [StudySession]
    public var mastery: [MasteryRecord]
    public var providerRuns: [ProviderRun]
    public var jobs: [SyncJob]
    public var integrations: [IntegrationAccount]
    public var khanCheckIns: [KhanCheckIn]

    public init(
        spaces: [StudySpace] = [],
        sources: [SourceAsset] = [],
        revisions: [SourceRevisionRecord] = [],
        assignments: [Assignment] = [],
        canvases: [CanvasArtifact] = [],
        sessions: [StudySession] = [],
        mastery: [MasteryRecord] = [],
        providerRuns: [ProviderRun] = [],
        jobs: [SyncJob] = [],
        integrations: [IntegrationAccount] = [],
        khanCheckIns: [KhanCheckIn] = []
    ) {
        self.spaces = spaces
        self.sources = sources
        self.revisions = revisions
        self.assignments = assignments
        self.canvases = canvases
        self.sessions = sessions
        self.mastery = mastery
        self.providerRuns = providerRuns
        self.jobs = jobs
        self.integrations = integrations
        self.khanCheckIns = khanCheckIns
    }
}

/// A reviewed study block ready to be committed as part of one approved plan.
public struct PlannedSessionInput: Sendable {
    public var spaceID: UUID
    public var title: String
    public var notes: String
    public var scheduledStart: Date
    public var durationMinutes: Int
    public var planID: UUID
    public var linkedAssignmentID: UUID?
    public var linkedMasteryRecordID: UUID?
    public var linkedSourceID: UUID?

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
        self.scheduledStart = scheduledStart
        self.durationMinutes = durationMinutes
        self.planID = planID
        self.linkedAssignmentID = linkedAssignmentID
        self.linkedMasteryRecordID = linkedMasteryRecordID
        self.linkedSourceID = linkedSourceID
    }
}

/// A reviewed action ready to become an assignment. Provenance remains attached
/// so later study views can distinguish source-grounded actions from manual work.
public struct AssignmentInput: Sendable {
    public var spaceID: UUID
    public var title: String
    public var detail: String
    public var dueAt: Date
    public var priority: Int
    public var sourceName: String
    public var sourceAnchor: SourceAnchor?
    public var originatingProvider: ProviderIdentifier?
    public var originatingModel: String?

    public init(
        spaceID: UUID,
        title: String,
        detail: String,
        dueAt: Date,
        priority: Int = 1,
        sourceName: String = "The Desk",
        sourceAnchor: SourceAnchor? = nil,
        originatingProvider: ProviderIdentifier? = nil,
        originatingModel: String? = nil
    ) {
        self.spaceID = spaceID
        self.title = title
        self.detail = detail
        self.dueAt = dueAt
        self.priority = priority
        self.sourceName = sourceName
        self.sourceAnchor = sourceAnchor
        self.originatingProvider = originatingProvider
        self.originatingModel = originatingModel
    }
}

public enum LearningHomePersistenceState: Equatable, Sendable {
    case inMemory
    case ready
    case recoveryRequired(backupPath: String?)
    case failed(message: String)
}

public enum LearningHomePersistenceError: Error, LocalizedError, Equatable {
    case notDurable
    case recoveryRequired(String?)
    case writeFailed(String)

    public var errorDescription: String? {
        switch self {
        case .notDurable:
            "This copy of The Desk is running in memory only. Connectors cannot write external Calendar or Reminder items."
        case let .recoveryRequired(backupPath):
            if let backupPath {
                "The Desk opened in recovery mode after preserving the unreadable library at \(backupPath). Reset the local library before making changes."
            } else {
                "The Desk opened in recovery mode. Reset the local library before making changes."
            }
        case let .writeFailed(message):
            "The Desk could not save the library. No further changes or external writes are allowed until the storage problem is resolved. \(message)"
        }
    }
}

private actor RevisionTextWriter {
    func writeIfMissing(_ text: String, to url: URL) throws {
        let directory = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard !FileManager.default.fileExists(atPath: url.path) else { return }
        try Data(text.utf8).write(to: url, options: .atomic)
    }

    func removeIfPresent(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
    }
}

@MainActor
public final class LearningHomeStore: ObservableObject {
    @Published public private(set) var spaces: [StudySpace]
    @Published public private(set) var sources: [SourceAsset]
    @Published public private(set) var revisions: [SourceRevisionRecord]
    @Published public private(set) var assignments: [Assignment]
    @Published public private(set) var canvases: [CanvasArtifact]
    @Published public private(set) var sessions: [StudySession]
    @Published public private(set) var mastery: [MasteryRecord]
    @Published public private(set) var providerRuns: [ProviderRun]
    @Published public private(set) var jobs: [SyncJob]
    @Published public private(set) var integrations: [IntegrationAccount]
    @Published public private(set) var khanCheckIns: [KhanCheckIn]
    @Published public private(set) var persistenceState: LearningHomePersistenceState
    @Published public var selectedSpaceID: UUID?
    @Published public var selectedSourceID: UUID?
    @Published public var selectedCanvasID: UUID?

    private let storageURL: URL?
    private let revisionTextWriter = RevisionTextWriter()
    private var lastDurableSnapshot = LearningHomeSnapshot()

    public init(
        inMemory: Bool = ProcessInfo.processInfo.environment["LEARNING_HOME_IN_MEMORY"] == "1",
        storageURL storageURLOverride: URL? = nil
    ) {
        let fileURL = inMemory ? nil : storageURLOverride ?? Self.defaultStorageURL()
        storageURL = fileURL

        let snapshot: LearningHomeSnapshot
        let initialPersistenceState: LearningHomePersistenceState
        let shouldPersist: Bool
        let legacyURL = storageURLOverride == nil && fileURL != nil ? Self.legacyStorageURL() : nil
        switch Self.loadSnapshot(from: fileURL, legacyURL: legacyURL) {
        case .missing:
            snapshot = DemoData.makeSnapshot()
            shouldPersist = fileURL != nil
            initialPersistenceState = fileURL == nil ? .inMemory : .ready
        case let .loaded(stored, shouldPersist: persistLoadedSnapshot):
            snapshot = stored
            shouldPersist = persistLoadedSnapshot
            initialPersistenceState = fileURL == nil ? .inMemory : .ready
        case let .invalid(backupPath):
            snapshot = LearningHomeSnapshotPersistence.migrate(LearningHomeSnapshot())
            shouldPersist = false
            initialPersistenceState = .recoveryRequired(backupPath: backupPath)
        }

        spaces = snapshot.spaces
        sources = snapshot.sources
        revisions = snapshot.revisions
        assignments = snapshot.assignments
        canvases = snapshot.canvases
        sessions = snapshot.sessions
        mastery = snapshot.mastery
        providerRuns = snapshot.providerRuns
        jobs = snapshot.jobs
        integrations = snapshot.integrations
        khanCheckIns = snapshot.khanCheckIns
        persistenceState = initialPersistenceState
        selectedSpaceID = snapshot.spaces.first?.id
        sortCollections()
        lastDurableSnapshot = Self.metadataClone(of: snapshot)
        if shouldPersist {
            do {
                try persist()
            } catch {
                persistenceState = .failed(message: error.localizedDescription)
            }
        }
    }

    public var canPerformDurableWrites: Bool {
        persistenceState == .ready
    }

    public func preflightDurableWrite() throws {
        switch persistenceState {
        case .ready:
            return
        case .inMemory:
            throw LearningHomePersistenceError.notDurable
        case let .recoveryRequired(backupPath):
            throw LearningHomePersistenceError.recoveryRequired(backupPath)
        case let .failed(message):
            throw LearningHomePersistenceError.writeFailed(message)
        }
    }

    private func preflightMutation() throws {
        switch persistenceState {
        case .ready, .inMemory:
            return
        case let .recoveryRequired(backupPath):
            throw LearningHomePersistenceError.recoveryRequired(backupPath)
        case let .failed(message):
            throw LearningHomePersistenceError.writeFailed(message)
        }
    }

    public func space(id: UUID?) -> StudySpace? {
        guard let id else { return nil }
        return spaces.first { $0.id == id }
    }

    @discardableResult
    public func addSpace(
        kind: StudySpaceKind,
        title: String,
        subtitle: String,
        colorHex: String,
        tutorStyle: TutorStyle
    ) throws -> StudySpace {
        try preflightMutation()
        let space = StudySpace(
            kind: kind,
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            subtitle: subtitle.trimmingCharacters(in: .whitespacesAndNewlines),
            colorHex: colorHex,
            symbolName: kind == .class ? "book.closed" : "scope",
            tutorStyle: tutorStyle,
            sortOrder: (spaces.map(\.sortOrder).max() ?? -1) + 1
        )
        spaces.append(space)
        selectedSpaceID = space.id
        try saveAndPublishOrThrow()
        return space
    }

    public func sources(in spaceID: UUID) -> [SourceAsset] {
        sources.filter { $0.spaceID == spaceID }
    }

    public func assignments(in spaceID: UUID) -> [Assignment] {
        assignments.filter { $0.spaceID == spaceID }
    }

    public func canvases(in spaceID: UUID) -> [CanvasArtifact] {
        canvases.filter { $0.spaceID == spaceID }
    }

    public func latestRevision(for sourceID: UUID) -> SourceRevisionRecord? {
        revisions.filter { $0.sourceID == sourceID }.max { $0.revisionNumber < $1.revisionNumber }
    }

    @discardableResult
    public func addSource(
        to spaceID: UUID,
        title: String,
        kind: SourceKind,
        filename: String,
        sha256: String,
        extractedText: String,
        anchorIndexData: Data = Data(),
        originalFilePath: String = "",
        connector: String = "Local",
        pageCount: Int = 0,
        duration: TimeInterval = 0
    ) async throws -> SourceAsset {
        try preflightMutation()
        if let existingRevision = revisions.first(where: { $0.sha256 == sha256 }),
           let existing = sources.first(where: { $0.id == existingRevision.sourceID && $0.spaceID == spaceID }) {
            selectedSpaceID = existing.spaceID
            selectedSourceID = existing.id
            return existing
        }

        let contentMatch = revisions.first(where: { $0.sha256 == sha256 })

        let source = SourceAsset(
            spaceID: spaceID,
            title: title,
            kind: kind,
            connectorName: connector,
            originalFilename: filename,
            processingState: .ready,
            pageCount: pageCount > 0 ? pageCount : sources.first(where: { $0.id == contentMatch?.sourceID })?.pageCount ?? 0,
            duration: duration > 0 ? duration : sources.first(where: { $0.id == contentMatch?.sourceID })?.duration ?? 0
        )
        let normalizedAnchorIndexData = Self.normalizedAnchorIndexData(
            anchorIndexData,
            sourceID: source.id,
            revisionNumber: 1
        )
        let revision = SourceRevisionRecord(
            sourceID: source.id,
            revisionNumber: 1,
            sha256: sha256,
            extractedText: extractedText,
            anchorIndexData: normalizedAnchorIndexData,
            originalFilePath: originalFilePath.isEmpty ? contentMatch?.originalFilePath ?? "" : originalFilePath
        )
        do {
            try await persistRevisionTextBeforeCommit(revision)
        } catch {
            await handleRevisionTextWriteFailure(error, revision: revision)
            throw error
        }
        do {
            try preflightMutation()
        } catch {
            await discardPreparedRevisionText(revision)
            throw error
        }
        if let existingRevision = revisions.first(where: { $0.sha256 == sha256 }),
           let existing = sources.first(where: { $0.id == existingRevision.sourceID && $0.spaceID == spaceID }) {
            await discardPreparedRevisionText(revision)
            selectedSpaceID = existing.spaceID
            selectedSourceID = existing.id
            return existing
        }
        sources.append(source)
        revisions.append(revision)
        markCanvasesStale(in: spaceID)
        selectedSpaceID = spaceID
        selectedSourceID = source.id
        do {
            try saveAndPublishOrThrow()
        } catch {
            await discardPreparedRevisionText(revision)
            throw error
        }
        return source
    }

    public func addNote(to spaceID: UUID, title: String, body: String) async throws {
        _ = try await addSource(
            to: spaceID,
            title: title,
            kind: .note,
            filename: "\(title).txt",
            sha256: SHA256Digest.hex(Data(body.utf8)),
            extractedText: body
        )
    }

    @discardableResult
    public func addRevision(
        to sourceID: UUID,
        sha256: String,
        extractedText: String,
        anchorIndexData: Data,
        originalFilePath: String,
        pageCount: Int,
        duration: TimeInterval
    ) async throws -> SourceRevisionRecord? {
        try preflightMutation()
        guard sources.contains(where: { $0.id == sourceID }) else { return nil }
        if let existing = revisions.first(where: { $0.sourceID == sourceID && $0.sha256 == sha256 }) { return existing }
        let revision = SourceRevisionRecord(
            sourceID: sourceID,
            revisionNumber: 1,
            sha256: sha256,
            extractedText: extractedText,
            anchorIndexData: anchorIndexData,
            originalFilePath: originalFilePath
        )
        do {
            try await persistRevisionTextBeforeCommit(revision)
        } catch {
            await handleRevisionTextWriteFailure(error, revision: revision)
            throw error
        }
        do {
            try preflightMutation()
        } catch {
            await discardPreparedRevisionText(revision)
            throw error
        }
        if let existing = revisions.first(where: { $0.sourceID == sourceID && $0.sha256 == sha256 }) {
            await discardPreparedRevisionText(revision)
            return existing
        }
        guard let source = sources.first(where: { $0.id == sourceID }) else {
            await discardPreparedRevisionText(revision)
            return nil
        }
        let next = (latestRevision(for: sourceID)?.revisionNumber ?? 0) + 1
        revision.revisionNumber = next
        revision.anchorIndexData = Self.normalizedAnchorIndexData(
            anchorIndexData,
            sourceID: sourceID,
            revisionNumber: next
        )
        revisions.append(revision)
        source.latestRevision = next
        source.pageCount = pageCount
        source.duration = duration
        source.updatedAt = Date()
        source.processingState = .ready
        markCanvasesStale(in: source.spaceID)
        do {
            try saveAndPublishOrThrow()
        } catch {
            await discardPreparedRevisionText(revision)
            throw error
        }
        return revision
    }

    public func setTutorStyle(_ style: TutorStyle, for spaceID: UUID) throws {
        try preflightMutation()
        guard let space = space(id: spaceID) else { return }
        space.tutorStyle = style
        try saveAndPublishOrThrow()
    }

    public func setAssignmentState(_ state: AssignmentState, assignmentID: UUID, evidence: String? = nil) throws {
        try preflightMutation()
        guard let assignment = assignments.first(where: { $0.id == assignmentID }) else { return }
        if state == .verifiedComplete || state == .returned {
            guard assignment.evidence.contains(where: \.provesSubmission) else { return }
        }
        assignment.state = state
        if let evidence {
            assignment.evidenceSummary = evidence
            assignment.evidenceObservedAt = Date()
            var records = assignment.evidence
            records.append(AssignmentEvidence(kind: .manualNote, summary: evidence))
            assignment.evidence = records
        }
        try saveAndPublishOrThrow()
    }

    @discardableResult
    public func addAssignment(
        spaceID: UUID,
        title: String,
        detail: String,
        dueAt: Date,
        priority: Int = 1,
        sourceName: String = "The Desk"
    ) throws -> Assignment {
        try addAssignments([
            AssignmentInput(
                spaceID: spaceID,
                title: title,
                detail: detail,
                dueAt: dueAt,
                priority: priority,
                sourceName: sourceName
            )
        ])[0]
    }

    /// Commits all explicitly approved action-derived assignments with one
    /// collection sort, snapshot encode, and change notification.
    @discardableResult
    public func addAssignments(_ inputs: [AssignmentInput]) throws -> [Assignment] {
        try preflightMutation()
        guard !inputs.isEmpty else { return [] }
        let created = inputs.map { input in
            Assignment(
                spaceID: input.spaceID,
                title: input.title.trimmingCharacters(in: .whitespacesAndNewlines),
                detail: input.detail.trimmingCharacters(in: .whitespacesAndNewlines),
                dueAt: input.dueAt,
                state: .planned,
                sourceName: input.sourceName,
                priority: max(0, min(input.priority, 3)),
                sourceAnchor: input.sourceAnchor,
                originatingProvider: input.originatingProvider,
                originatingModel: input.originatingModel
            )
        }
        assignments.append(contentsOf: created)
        try saveAndPublishOrThrow()
        return created
    }

    public func linkReminder(_ identifier: String, to assignmentID: UUID) throws {
        try preflightMutation()
        guard let assignment = assignments.first(where: { $0.id == assignmentID }) else { return }
        assignment.linkedReminderIdentifier = identifier
        try saveAndPublishOrThrow()
    }

    /// Completes an external Reminder write only when its local identifier can
    /// be committed durably. A failed commit rolls the in-memory mutation back.
    public func linkReminderDurably(_ identifier: String, to assignmentID: UUID) throws {
        try preflightDurableWrite()
        try linkReminder(identifier, to: assignmentID)
    }

    @discardableResult
    public func addPlannedSession(
        spaceID: UUID,
        title: String,
        notes: String,
        scheduledStart: Date,
        durationMinutes: Int,
        planID: UUID,
        linkedAssignmentID: UUID? = nil,
        linkedMasteryRecordID: UUID? = nil,
        linkedSourceID: UUID? = nil
    ) throws -> StudySession {
        try addPlannedSessions([
            PlannedSessionInput(
                spaceID: spaceID,
                title: title,
                notes: notes,
                scheduledStart: scheduledStart,
                durationMinutes: durationMinutes,
                planID: planID,
                linkedAssignmentID: linkedAssignmentID,
                linkedMasteryRecordID: linkedMasteryRecordID,
                linkedSourceID: linkedSourceID
            )
        ])[0]
    }

    /// Commits all explicitly approved plan blocks with one collection sort,
    /// snapshot encode, and change notification.
    @discardableResult
    public func addPlannedSessions(_ inputs: [PlannedSessionInput]) throws -> [StudySession] {
        try preflightMutation()
        guard !inputs.isEmpty else { return [] }
        let created = inputs.map { input in
            StudySession(
                spaceID: input.spaceID,
                title: input.title.trimmingCharacters(in: .whitespacesAndNewlines),
                notes: input.notes.trimmingCharacters(in: .whitespacesAndNewlines),
                scheduledStart: input.scheduledStart,
                durationMinutes: input.durationMinutes,
                planID: input.planID,
                linkedAssignmentID: input.linkedAssignmentID,
                linkedMasteryRecordID: input.linkedMasteryRecordID,
                linkedSourceID: input.linkedSourceID
            )
        }
        sessions.append(contentsOf: created)
        try saveAndPublishOrThrow()
        return created
    }

    public func linkCalendarEvent(_ identifier: String, calendarName: String, to sessionID: UUID) throws {
        try preflightMutation()
        guard let session = sessions.first(where: { $0.id == sessionID }), session.isPlannedBlock else { return }
        session.calendarEventIdentifier = identifier
        session.calendarName = calendarName
        try saveAndPublishOrThrow()
    }

    public func linkCalendarEventDurably(
        _ identifier: String,
        calendarName: String,
        to sessionID: UUID
    ) throws {
        try preflightDurableWrite()
        try linkCalendarEvent(identifier, calendarName: calendarName, to: sessionID)
    }

    /// Updates an existing approved block after any linked calendar event has
    /// been updated successfully. The stored event identity is never replaced.
    @discardableResult
    public func updatePlannedSession(
        id: UUID,
        title: String,
        notes: String,
        scheduledStart: Date,
        durationMinutes: Int
    ) throws -> Bool {
        try preflightMutation()
        guard let session = sessions.first(where: { $0.id == id }), session.isPlannedBlock else { return false }
        session.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        session.notes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        session.scheduledStart = scheduledStart
        session.plannedDurationMinutes = max(10, min(durationMinutes, 240))
        try saveAndPublishOrThrow()
        return true
    }

    @discardableResult
    public func updatePlannedSessionDurably(
        id: UUID,
        title: String,
        notes: String,
        scheduledStart: Date,
        durationMinutes: Int
    ) throws -> Bool {
        try preflightDurableWrite()
        return try updatePlannedSession(
            id: id,
            title: title,
            notes: notes,
            scheduledStart: scheduledStart,
            durationMinutes: durationMinutes
        )
    }

    public func appendEvidence(_ evidence: AssignmentEvidence, to assignmentID: UUID) throws {
        try preflightMutation()
        guard let assignment = assignments.first(where: { $0.id == assignmentID }) else { return }
        var records = assignment.evidence
        guard !records.contains(where: { $0.kind == evidence.kind && $0.summary == evidence.summary && $0.observedAt == evidence.observedAt }) else { return }
        records.append(evidence)
        assignment.evidence = records
        assignment.evidenceSummary = evidence.summary
        assignment.evidenceObservedAt = evidence.observedAt
        if evidence.kind == .classroomReturned {
            assignment.state = .returned
        } else if evidence.kind == .classroomTurnedIn {
            assignment.state = .verifiedComplete
        }
        try saveAndPublishOrThrow()
    }

    public func createJob(kind: String, payload: Data, state: SyncJobState, idempotencyKey: String = UUID().uuidString) throws {
        try preflightMutation()
        if let existing = jobs.first(where: { $0.idempotencyKey == idempotencyKey }) {
            guard !Self.isTerminal(existing.state) || existing.state == state else { return }
            existing.state = state
            existing.updatedAt = Date()
        } else {
            jobs.append(SyncJob(kind: kind, state: state, payloadData: payload, idempotencyKey: idempotencyKey))
        }
        try saveAndPublishOrThrow()
    }

    public func updateJob(idempotencyKey: String, state: SyncJobState, error: String = "") throws {
        try preflightMutation()
        guard let job = jobs.first(where: { $0.idempotencyKey == idempotencyKey }) else { return }
        guard !Self.isTerminal(job.state) || job.state == state else { return }
        job.state = state
        job.errorMessage = error
        job.updatedAt = Date()
        if state == .failedRetryable { job.retryCount += 1 }
        try saveAndPublishOrThrow()
    }

    public func saveCanvas(_ artifact: CanvasArtifact) throws {
        try preflightMutation()
        if !canvases.contains(where: { $0.id == artifact.id }) { canvases.append(artifact) }
        artifact.updatedAt = Date()
        artifact.lastOpenedAt = Date()
        try saveAndPublishOrThrow()
    }

    public func updateCanvasSpec(id: UUID, spec: StudySceneSpec) throws {
        try preflightMutation()
        guard let index = canvases.firstIndex(where: { $0.id == id }),
              let updated = Self.canvasClone(canvases[index]) else { return }
        updated.spec = spec
        canvases[index] = updated
        try saveAndPublishOrThrow()
    }

    public func restoreCanvas(
        id: UUID,
        snapshot: CanvasVersionSnapshot,
        currentSourceSignature: String
    ) throws {
        try preflightMutation()
        guard let index = canvases.firstIndex(where: { $0.id == id }),
              let updated = Self.canvasClone(canvases[index]) else { return }
        updated.restore(snapshot, currentSourceSignature: currentSourceSignature)
        canvases[index] = updated
        try saveAndPublishOrThrow()
    }

    public func acceptCanvasRefresh(
        id: UUID,
        sourceSignature: String,
        spec: StudySceneSpec,
        title: String
    ) throws {
        try preflightMutation()
        guard let index = canvases.firstIndex(where: { $0.id == id }),
              let updated = Self.canvasClone(canvases[index]) else { return }
        updated.acceptReviewedRefresh(sourceSignature: sourceSignature, updatedSpec: spec)
        updated.title = title
        canvases[index] = updated
        try saveAndPublishOrThrow()
    }

    public func recordProviderRun(_ run: ProviderRun) throws {
        try preflightMutation()
        providerRuns.append(run)
        try saveAndPublishOrThrow()
    }

    public func updateIntegration(id: String, status: String, detail: String? = nil) throws {
        try preflightMutation()
        let migrated = LearningHomeSnapshotPersistence.migrate(snapshot())
        if migrated.integrations.count != integrations.count {
            integrations = migrated.integrations
        }
        guard let integration = integrations.first(where: { $0.id == id }) else { return }
        integration.statusRaw = status
        if let detail { integration.detail = detail }
        integration.lastSyncAt = Date()
        try saveAndPublishOrThrow()
    }

    public func addKhanCheckIn(_ checkIn: KhanCheckIn) throws {
        try preflightMutation()
        khanCheckIns.append(checkIn)
        try saveAndPublishOrThrow()
    }

    public func markCanvasesStale(in spaceID: UUID) {
        canvases.filter { $0.spaceID == spaceID }.forEach { $0.isStale = true }
    }

    public func resetDemoData() throws {
        apply(DemoData.makeSnapshot())
        selectedSpaceID = spaces.first?.id
        persistenceState = storageURL == nil ? .inMemory : .ready
        try saveAndPublishOrThrow()
    }

    public func retryPersistence() throws {
        guard storageURL != nil else { throw LearningHomePersistenceError.notDurable }
        guard case .failed = persistenceState else { return }
        persistenceState = .ready
        do {
            try persist()
            objectWillChange.send()
        } catch {
            persistenceState = .failed(message: error.localizedDescription)
            objectWillChange.send()
            throw error
        }
    }

    public func snapshot() -> LearningHomeSnapshot {
        LearningHomeSnapshot(
            spaces: spaces,
            sources: sources,
            revisions: revisions,
            assignments: assignments,
            canvases: canvases,
            sessions: sessions,
            mastery: mastery,
            providerRuns: providerRuns,
            jobs: jobs,
            integrations: integrations,
            khanCheckIns: khanCheckIns
        )
    }

    public func searchDocuments() -> [SearchDocument] {
        sources.compactMap { source in
            latestRevision(for: source.id).map {
                SearchDocument(sourceID: source.id, revision: $0.revisionNumber, text: $0.extractedText)
            }
        }
    }

    /// Produces the read-oriented private CloudKit payload used by iPhone and iPad.
    /// Local file paths, provider conversations, and execution jobs never leave Mac.
    public func companionSnapshotData() -> Data? {
        let boundedEncoder = JSONEncoder.learningHome(revisionTextLimit: 40_000)
        guard let encoded = try? boundedEncoder.encode(snapshot()),
              var copy = try? JSONDecoder.learningHome.decode(LearningHomeSnapshot.self, from: encoded) else {
            return nil
        }
        copy.providerRuns = []
        for job in copy.jobs {
            job.payloadData = Data()
            job.errorMessage = String(job.errorMessage.prefix(500))
        }
        let latestBySource = Dictionary(copy.sources.map { ($0.id, $0.latestRevision) }, uniquingKeysWith: { first, _ in first })
        copy.revisions = copy.revisions.filter { revision in
            revision.revisionNumber >= (latestBySource[revision.sourceID] ?? revision.revisionNumber) - 1
        }
        for revision in copy.revisions {
            revision.originalFilePath = ""
        }
        return try? boundedEncoder.encode(copy)
    }

    /// Replaces user-visible read models with the newest Mac-authored mirror while
    /// preserving this device's local capture queue and execution-only state.
    public func applyCompanionSnapshotData(_ data: Data) throws {
        try preflightMutation()
        guard let decoded = LearningHomeSnapshotPersistence.decode(data: data) else { return }
        let incoming = LearningHomeSnapshotPersistence.migrate(decoded)
        spaces = incoming.spaces
        sources = incoming.sources
        revisions = incoming.revisions
        assignments = incoming.assignments
        canvases = incoming.canvases
        sessions = incoming.sessions
        mastery = incoming.mastery
        integrations = incoming.integrations
        khanCheckIns = incoming.khanCheckIns
        for incomingJob in incoming.jobs {
            if let local = jobs.first(where: { $0.idempotencyKey == incomingJob.idempotencyKey }) {
                local.state = incomingJob.state
                local.retryCount = incomingJob.retryCount
                local.errorMessage = incomingJob.errorMessage
                local.updatedAt = incomingJob.updatedAt
            } else {
                jobs.append(incomingJob)
            }
        }
        if let selectedSpaceID, !spaces.contains(where: { $0.id == selectedSpaceID }) {
            self.selectedSpaceID = spaces.first?.id
        } else if selectedSpaceID == nil {
            self.selectedSpaceID = spaces.first?.id
        }
        sortCollections()
        try saveAndPublishOrThrow()
    }

    private func apply(_ snapshot: LearningHomeSnapshot) {
        spaces = snapshot.spaces
        sources = snapshot.sources
        revisions = snapshot.revisions
        assignments = snapshot.assignments
        canvases = snapshot.canvases
        sessions = snapshot.sessions
        mastery = snapshot.mastery
        providerRuns = snapshot.providerRuns
        jobs = snapshot.jobs
        integrations = snapshot.integrations
        khanCheckIns = snapshot.khanCheckIns
        sortCollections()
    }

    private func saveAndPublishOrThrow() throws {
        sortCollections()
        do {
            try persist()
            objectWillChange.send()
        } catch {
            if storageURL != nil {
                if case .recoveryRequired = persistenceState {
                    // Keep the recovery state and reject the attempted mutation.
                } else {
                    persistenceState = .failed(message: error.localizedDescription)
                }
                apply(Self.metadataClone(of: lastDurableSnapshot))
            }
            objectWillChange.send()
            throw error
        }
    }

    private func sortCollections() {
        spaces.sort { $0.sortOrder < $1.sortOrder }
        sources.sort { $0.updatedAt > $1.updatedAt }
        revisions.sort {
            if $0.sourceID == $1.sourceID { return $0.revisionNumber > $1.revisionNumber }
            return $0.createdAt > $1.createdAt
        }
        assignments.sort {
            if $0.priority == $1.priority { return $0.dueAt < $1.dueAt }
            return $0.priority > $1.priority
        }
        canvases.sort { $0.lastOpenedAt > $1.lastOpenedAt }
        sessions.sort {
            ($0.scheduledStart ?? $0.startedAt) < ($1.scheduledStart ?? $1.startedAt)
        }
        mastery.sort { $0.nextReviewAt < $1.nextReviewAt }
        jobs.sort { $0.createdAt > $1.createdAt }
        integrations.sort { $0.displayName < $1.displayName }
    }

    private static func normalizedAnchorIndexData(
        _ data: Data,
        sourceID: UUID,
        revisionNumber: Int
    ) -> Data {
        guard var anchors = try? JSONDecoder().decode([SourceAnchor].self, from: data) else {
            return data
        }
        for index in anchors.indices {
            anchors[index].sourceID = sourceID
            anchors[index].revision = revisionNumber
        }
        return (try? JSONEncoder().encode(anchors)) ?? data
    }

    private func persistRevisionTextBeforeCommit(_ revision: SourceRevisionRecord) async throws {
        guard let storageURL else { return }
        try preflightDurableWrite()
        if revision.textStorageKey.isEmpty {
            revision.textStorageKey = "\(revision.id.uuidString).txt"
        }
        let directory = storageURL.deletingLastPathComponent()
            .appendingPathComponent("RevisionText", isDirectory: true)
        let url = try Self.validatedRevisionTextURL(key: revision.textStorageKey, directory: directory)
        try await revisionTextWriter.writeIfMissing(revision.extractedText, to: url)
    }

    private func discardPreparedRevisionText(_ revision: SourceRevisionRecord) async {
        guard let storageURL, !revision.textStorageKey.isEmpty else { return }
        let directory = storageURL.deletingLastPathComponent()
            .appendingPathComponent("RevisionText", isDirectory: true)
        guard let url = try? Self.validatedRevisionTextURL(
            key: revision.textStorageKey,
            directory: directory
        ) else { return }
        await revisionTextWriter.removeIfPresent(url)
    }

    private func handleRevisionTextWriteFailure(
        _ error: Error,
        revision: SourceRevisionRecord
    ) async {
        await discardPreparedRevisionText(revision)
        guard storageURL != nil else { return }
        if case .recoveryRequired = persistenceState {
            // Preserve the stronger recovery state.
        } else {
            persistenceState = .failed(message: error.localizedDescription)
        }
        objectWillChange.send()
    }

    private func persist() throws {
        guard let storageURL else {
            lastDurableSnapshot = Self.metadataClone(of: snapshot())
            return
        }
        try preflightDurableWrite()

        let root = storageURL.deletingLastPathComponent()
        let revisionTextDirectory = root.appendingPathComponent("RevisionText", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: revisionTextDirectory, withIntermediateDirectories: true)

        for revision in revisions {
            if revision.textStorageKey.isEmpty {
                revision.textStorageKey = "\(revision.id.uuidString).txt"
            }
            let textURL = try Self.validatedRevisionTextURL(
                key: revision.textStorageKey,
                directory: revisionTextDirectory
            )
            if !FileManager.default.fileExists(atPath: textURL.path) {
                try Data(revision.extractedText.utf8).write(to: textURL, options: .atomic)
            }
        }

        let data = try JSONEncoder.learningHome(revisionTextLimit: 0).encode(snapshot())
        try data.write(to: storageURL, options: .atomic)
        lastDurableSnapshot = Self.metadataClone(of: snapshot())
        persistenceState = .ready
    }

    private static func defaultStorageURL() -> URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return root.appendingPathComponent("TheDesk", isDirectory: true).appendingPathComponent("library.json")
    }

    private static func legacyStorageURL() -> URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return root.appendingPathComponent("LearningHome", isDirectory: true).appendingPathComponent("library.json")
    }

    private enum SnapshotLoadResult {
        case missing
        case loaded(LearningHomeSnapshot, shouldPersist: Bool)
        case invalid(backupPath: String?)
    }

    private enum FileSnapshotResult {
        case missing
        case valid(LearningHomeSnapshot)
        case invalid
    }

    private enum FilePresence: Equatable {
        case missing
        case present
        case unreadable
    }

    private static func loadSnapshot(from storageURL: URL?, legacyURL: URL?) -> SnapshotLoadResult {
        guard let storageURL else { return .missing }

        switch readSnapshot(at: storageURL) {
        case .missing:
            guard let legacyURL else { return .missing }
            switch readSnapshot(at: legacyURL) {
            case .missing:
                return .missing
            case .invalid:
                return .invalid(backupPath: preserveInvalidStore(at: legacyURL))
            case let .valid(stored):
                return .loaded(LearningHomeSnapshotPersistence.migrate(stored), shouldPersist: true)
            }
        case .invalid:
            return .invalid(backupPath: preserveInvalidStore(at: storageURL))
        case let .valid(stored):
            let needsCalendarMigration = !stored.integrations.contains(where: { $0.id == "calendar" })
            let needsCanvasHistoryMigration = stored.canvases.contains(where: { $0.historyData == nil })
            let needsRevisionTextMigration = stored.revisions.contains(where: { $0.textStorageKey.isEmpty })
            let migrated = LearningHomeSnapshotPersistence.migrate(stored)
            return .loaded(
                migrated,
                shouldPersist: needsCalendarMigration || needsCanvasHistoryMigration || needsRevisionTextMigration
            )
        }
    }

    private static func readSnapshot(at url: URL) -> FileSnapshotResult {
        switch filePresence(at: url) {
        case .missing:
            return .missing
        case .unreadable:
            return .invalid
        case .present:
            guard let data = try? Data(contentsOf: url),
                  let snapshot = LearningHomeSnapshotPersistence.decode(data: data),
                  hydrateRevisionTexts(in: snapshot, metadataURL: url) else {
                return .invalid
            }
            return .valid(snapshot)
        }
    }

    private static func filePresence(at url: URL) -> FilePresence {
        do {
            _ = try FileManager.default.attributesOfItem(atPath: url.path)
            return .present
        } catch let error as CocoaError where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile {
            return .missing
        } catch {
            return .unreadable
        }
    }

    private static func preserveInvalidStore(at url: URL) -> String? {
        guard filePresence(at: url) == .present else { return nil }
        let backupName = "\(url.lastPathComponent).invalid-\(UUID().uuidString).backup"
        let backupURL = url.deletingLastPathComponent().appendingPathComponent(backupName)
        do {
            try FileManager.default.copyItem(at: url, to: backupURL)
            return backupURL.path
        } catch {
            return nil
        }
    }

    private static func hydrateRevisionTexts(
        in snapshot: LearningHomeSnapshot,
        metadataURL: URL
    ) -> Bool {
        let directory = metadataURL.deletingLastPathComponent()
            .appendingPathComponent("RevisionText", isDirectory: true)
        for revision in snapshot.revisions where !revision.textStorageKey.isEmpty {
            if revision.hasInlineTextPayload { continue }
            guard let textURL = try? validatedRevisionTextURL(
                key: revision.textStorageKey,
                directory: directory
            ), let data = try? Data(contentsOf: textURL),
               let text = String(data: data, encoding: .utf8) else {
                return false
            }
            revision.extractedText = text
        }
        return true
    }

    private static func validatedRevisionTextURL(key: String, directory: URL) throws -> URL {
        guard !key.isEmpty,
              key == URL(fileURLWithPath: key).lastPathComponent,
              !key.contains("/"),
              !key.contains("\\"),
              key.hasSuffix(".txt") else {
            throw LearningHomePersistenceError.writeFailed("A revision text key was invalid.")
        }
        let base = directory.standardizedFileURL
        let candidate = directory.appendingPathComponent(key, isDirectory: false).standardizedFileURL
        guard candidate.deletingLastPathComponent() == base else {
            throw LearningHomePersistenceError.writeFailed("A revision text path escaped the library.")
        }
        return candidate
    }

    private static func metadataClone(of snapshot: LearningHomeSnapshot) -> LearningHomeSnapshot {
        let textByID = Dictionary(snapshot.revisions.map { ($0.id, $0.extractedText) }, uniquingKeysWith: { first, _ in first })
        guard let data = try? JSONEncoder.learningHome(revisionTextLimit: 0).encode(snapshot),
              let clone = try? JSONDecoder.learningHome.decode(LearningHomeSnapshot.self, from: data) else {
            return LearningHomeSnapshot()
        }
        for revision in clone.revisions {
            revision.extractedText = textByID[revision.id] ?? ""
        }
        return clone
    }

    private static func canvasClone(_ artifact: CanvasArtifact) -> CanvasArtifact? {
        guard let data = try? JSONEncoder.learningHome.encode(artifact) else { return nil }
        return try? JSONDecoder.learningHome.decode(CanvasArtifact.self, from: data)
    }

    private static func isTerminal(_ state: SyncJobState) -> Bool {
        state == .completed || state == .failedFinal
    }
}

public enum LearningHomeSnapshotLoadKind: Equatable {
    case missing
    case valid
    case invalid
}

public enum LearningHomeSnapshotPersistence {
    public static func classify(data: Data?) -> LearningHomeSnapshotLoadKind {
        guard let data else { return .missing }
        return decode(data: data) == nil ? .invalid : .valid
    }

    public static func decode(data: Data) -> LearningHomeSnapshot? {
        guard let snapshot = try? JSONDecoder.learningHome.decode(LearningHomeSnapshot.self, from: data),
              snapshot.schemaVersion == 1,
              isStructurallyValid(snapshot) else { return nil }
        return snapshot
    }

    private static func isStructurallyValid(_ snapshot: LearningHomeSnapshot) -> Bool {
        func unique<T: Hashable>(_ values: [T]) -> Bool { Set(values).count == values.count }

        guard unique(snapshot.spaces.map(\.id)),
              unique(snapshot.sources.map(\.id)),
              unique(snapshot.revisions.map(\.id)),
              unique(snapshot.assignments.map(\.id)),
              unique(snapshot.canvases.map(\.id)),
              unique(snapshot.sessions.map(\.id)),
              unique(snapshot.mastery.map(\.id)),
              unique(snapshot.providerRuns.map(\.id)),
              unique(snapshot.jobs.map(\.id)),
              unique(snapshot.integrations.map(\.id)),
              unique(snapshot.khanCheckIns.map(\.id)) else { return false }

        let spaceIDs = Set(snapshot.spaces.map(\.id))
        let sourceIDs = Set(snapshot.sources.map(\.id))
        guard snapshot.sources.allSatisfy({ spaceIDs.contains($0.spaceID) }),
              snapshot.revisions.allSatisfy({ sourceIDs.contains($0.sourceID) && $0.revisionNumber > 0 }),
              snapshot.assignments.allSatisfy({ spaceIDs.contains($0.spaceID) }),
              snapshot.canvases.allSatisfy({ spaceIDs.contains($0.spaceID) }),
              snapshot.sessions.allSatisfy({ spaceIDs.contains($0.spaceID) }),
              snapshot.mastery.allSatisfy({ spaceIDs.contains($0.spaceID) }),
              snapshot.khanCheckIns.allSatisfy({ spaceIDs.contains($0.spaceID) }) else { return false }

        let revisionKeys = snapshot.revisions.map { "\($0.sourceID.uuidString):\($0.revisionNumber)" }
        let textKeys = snapshot.revisions.map(\.textStorageKey).filter { !$0.isEmpty }
        guard unique(revisionKeys), unique(textKeys) else { return false }

        for canvas in snapshot.canvases {
            guard let currentSpec = try? JSONDecoder().decode(StudySceneSpec.self, from: canvas.specData),
                  (try? currentSpec.validate()) != nil else { return false }
            switch canvas.decodedHistoryState {
            case .missing:
                continue
            case .invalid:
                return false
            case .valid(let versions):
                guard !versions.isEmpty,
                      unique(versions.map(\.id)),
                      unique(versions.map(\.version)),
                      versions.contains(where: { $0.version == canvas.version }) else { return false }
                for version in versions {
                    guard version.version > 0,
                          let spec = try? JSONDecoder().decode(StudySceneSpec.self, from: version.specData),
                          (try? spec.validate()) != nil else { return false }
                }
            }
        }
        return true
    }

    public static func migrate(_ snapshot: LearningHomeSnapshot) -> LearningHomeSnapshot {
        var migrated = snapshot
        if !migrated.integrations.contains(where: { $0.id == "calendar" }) {
            migrated.integrations.append(
                IntegrationAccount(
                    id: "calendar",
                    displayName: "Apple & Google Calendar",
                    status: "permissionRequired",
                    detail: "Creates only approved study blocks in a selected writable calendar.",
                    isReadOnly: false
                )
            )
        }
        for canvas in migrated.canvases where canvas.historyData == nil {
            canvas.history = [CanvasVersionSnapshot(
                version: canvas.version,
                specData: canvas.specData,
                sourceRevisionSignature: canvas.sourceRevisionSignature,
                savedAt: canvas.updatedAt
            )]
        }
        return migrated
    }
}

public enum SHA256Digest {
    public static func hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    public static func hex(fileURL: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: fileURL)
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            let chunk = try handle.read(upToCount: 1_048_576) ?? Data()
            if chunk.isEmpty { break }
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

private extension JSONEncoder {
    static var learningHome: JSONEncoder { learningHome(revisionTextLimit: nil) }

    static func learningHome(revisionTextLimit: Int?) -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        if let revisionTextLimit {
            encoder.userInfo[.sourceRevisionTextLimit] = revisionTextLimit
        }
        return encoder
    }
}

private extension JSONDecoder {
    static var learningHome: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
