import Foundation
import XCTest
#if SWIFT_PACKAGE
@testable import LearningHomeKit
#else
@testable import TheDeskMac
#endif

@MainActor
final class LearningHomeCoreTests: XCTestCase {
    func testStudyBuddyListeningGenerationRejectsClosedSession() {
        #if os(macOS)
        let started = UUID()
        XCTAssertTrue(StudyBuddyModel.canContinueListening(
            startedGeneration: started,
            currentGeneration: started,
            isCancelled: false
        ))
        XCTAssertFalse(StudyBuddyModel.canContinueListening(
            startedGeneration: started,
            currentGeneration: UUID(),
            isCancelled: false
        ))
        XCTAssertFalse(StudyBuddyModel.canContinueListening(
            startedGeneration: started,
            currentGeneration: started,
            isCancelled: true
        ))
        #endif
    }

    func testStudyBuddyPurgeClearsRetainedCaptureData() {
        #if os(macOS)
        let model = StudyBuddyModel()
        model.ocrText = "Private worksheet text"
        model.answer = "Private grounded answer"
        model.cues = [OverlayCue(
            kind: .highlight,
            region: NormalizedRect(x: 0.1, y: 0.1, width: 0.2, height: 0.2),
            label: "Private cue"
        )]
        model.purgeCaptureSession()
        XCTAssertNil(model.image)
        XCTAssertTrue(model.ocrText.isEmpty)
        XCTAssertTrue(model.answer.isEmpty)
        XCTAssertTrue(model.cues.isEmpty)
        #endif
    }

    func testSceneValidationRejectsDanglingConnection() throws {
        let spec = StudySceneSpec(
            kind: .conceptMap,
            title: "Forces",
            summary: "",
            nodes: [SceneNode(id: "force", title: "Force", detail: "", x: 0.5, y: 0.5)],
            connections: [SceneConnection(from: "force", to: "missing", label: "causes")],
            accessibilitySummary: "A force concept map."
        )
        XCTAssertThrowsError(try spec.validate()) { error in
            XCTAssertEqual(error as? StudySceneValidationError, .invalidConnection)
        }
    }

    func testSceneValidationRejectsUnsafeCoordinatesAndInteractionTargets() {
        let outOfBounds = StudySceneSpec(
            kind: .annotatedDiagram,
            title: "Unsafe coordinates",
            summary: "",
            nodes: [SceneNode(id: "outside", title: "Outside", detail: "", x: 1.2, y: 0.5)],
            accessibilitySummary: "An invalid scene."
        )
        XCTAssertThrowsError(try outOfBounds.validate()) { error in
            XCTAssertEqual(error as? StudySceneValidationError, .invalidNode)
        }

        let unknownTarget = StudySceneSpec(
            kind: .process,
            title: "Unsafe interaction",
            summary: "",
            nodes: [SceneNode(id: "known", title: "Known", detail: "", x: 0.5, y: 0.5)],
            interactions: [SceneInteraction(kind: .reveal, label: "Reveal", targetNodeIDs: ["missing"])],
            accessibilitySummary: "Another invalid scene."
        )
        XCTAssertThrowsError(try unknownTarget.validate()) { error in
            XCTAssertEqual(error as? StudySceneValidationError, .invalidInteraction)
        }
    }

    func testOverlayRejectsOutOfBoundsCue() {
        let valid = OverlayCue(kind: .highlight, region: NormalizedRect(x: 0.1, y: 0.2, width: 0.3, height: 0.2), label: "Graph vertex")
        let invalid = OverlayCue(kind: .arrow, region: NormalizedRect(x: 0.9, y: 0.1, width: 0.3, height: 0.2), label: "Outside")
        XCTAssertTrue(OverlayCueSpec(cues: [valid]).validate())
        XCTAssertFalse(OverlayCueSpec(cues: [invalid]).validate())
    }

    func testSourceHashDeduplicatesWithoutLosingSpaceAssignment() async throws {
        let store = LearningHomeStore(inMemory: true)
        let spaces = store.spaces
        XCTAssertGreaterThanOrEqual(spaces.count, 2)
        let digest = SHA256Digest.hex(Data("same notes".utf8))
        let first = try await store.addSource(to: spaces[0].id, title: "Notes", kind: .note, filename: "notes.txt", sha256: digest, extractedText: "same notes")
        let sameSpace = try await store.addSource(to: spaces[0].id, title: "Duplicate", kind: .note, filename: "copy.txt", sha256: digest, extractedText: "same notes")
        let otherSpace = try await store.addSource(to: spaces[1].id, title: "Shared notes", kind: .note, filename: "shared.txt", sha256: digest, extractedText: "same notes")
        XCTAssertEqual(first.id, sameSpace.id)
        XCTAssertNotEqual(first.id, otherSpace.id)
        XCTAssertEqual(otherSpace.spaceID, spaces[1].id)
        XCTAssertEqual(store.revisions.filter { $0.sha256 == digest }.count, 2)
    }

    func testCreatesAndSelectsAStudySpace() throws {
        let store = LearningHomeStore(inMemory: true)
        let originalCount = store.spaces.count
        let created = try store.addSpace(
            kind: .track,
            title: "  Calculus Review  ",
            subtitle: "  Fall plan  ",
            colorHex: "#356B58",
            tutorStyle: .examPractice
        )

        XCTAssertEqual(store.spaces.count, originalCount + 1)
        XCTAssertEqual(created.title, "Calculus Review")
        XCTAssertEqual(created.subtitle, "Fall plan")
        XCTAssertEqual(created.kind, .track)
        XCTAssertEqual(created.tutorStyle, .examPractice)
        XCTAssertEqual(store.selectedSpaceID, created.id)
    }

    func testApprovedBatchesPreserveAssignmentsAndProvenance() throws {
        let store = LearningHomeStore(inMemory: true)
        let spaceID = try XCTUnwrap(store.spaces.first?.id)
        let planID = UUID()
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let sessions = try store.addPlannedSessions([
            PlannedSessionInput(
                spaceID: spaceID,
                title: "Review vectors",
                notes: "Practice retrieval",
                scheduledStart: start,
                durationMinutes: 45,
                planID: planID
            ),
            PlannedSessionInput(
                spaceID: spaceID,
                title: "Check graphs",
                notes: "Explain the axes",
                scheduledStart: start.addingTimeInterval(3_300),
                durationMinutes: 35,
                planID: planID
            ),
        ])
        XCTAssertEqual(sessions.count, 2)
        XCTAssertEqual(store.sessions.filter { $0.planID == planID }.count, 2)

        let anchor = SourceAnchor(sourceID: spaceID, revision: 3, page: 12, excerpt: "Submit the graph corrections.")
        let assignments = try store.addAssignments([
            AssignmentInput(
                spaceID: spaceID,
                title: "Submit graph corrections",
                detail: "Use the attached source note.",
                dueAt: start,
                priority: 3,
                sourceName: "Suggested from Physics notes",
                sourceAnchor: anchor,
                originatingProvider: .openAI,
                originatingModel: "study-model"
            ),
            AssignmentInput(
                spaceID: spaceID,
                title: "Practice one free response",
                detail: "",
                dueAt: start.addingTimeInterval(86_400),
                priority: 1,
                sourceName: "Suggested from Physics notes",
                sourceAnchor: anchor,
                originatingProvider: .openAI,
                originatingModel: "study-model"
            ),
        ])
        XCTAssertEqual(assignments.count, 2)
        XCTAssertEqual(assignments.first?.sourceAnchor, anchor)
        XCTAssertEqual(assignments.first?.originatingProvider, .openAI)
        XCTAssertEqual(assignments.first?.originatingModel, "study-model")
        XCTAssertEqual(assignments.first?.sourceName, "Suggested from Physics notes")
    }

    func testReminderEvidenceDoesNotVerifySubmission() throws {
        let store = LearningHomeStore(inMemory: true)
        guard let assignment = store.assignments.first else { return XCTFail("Demo assignment missing") }
        try store.appendEvidence(
            AssignmentEvidence(kind: .reminderCompleted, summary: "Reminder checked"),
            to: assignment.id
        )
        try store.setAssignmentState(.verifiedComplete, assignmentID: assignment.id)
        XCTAssertNotEqual(assignment.state, .verifiedComplete)
        XCTAssertFalse(assignment.evidence.contains(where: \.provesSubmission))

        try store.appendEvidence(
            AssignmentEvidence(kind: .classroomTurnedIn, summary: "Classroom reports TURNED_IN"),
            to: assignment.id
        )
        XCTAssertEqual(assignment.state, .verifiedComplete)
        XCTAssertTrue(assignment.evidence.contains(where: \.provesSubmission))
    }

    func testFTSReturnsPageAnchor() throws {
        let sourceID = UUID()
        let index = try LocalSearchIndex()
        try index.index(sourceID: sourceID, revision: 2, text: "[[page:74]]\nHorizontal acceleration is zero while gravity changes vertical velocity.")
        let hits = try index.search("horizontal acceleration")
        XCTAssertEqual(hits.first?.sourceID, sourceID)
        XCTAssertEqual(hits.first?.revision, 2)
        XCTAssertEqual(hits.first?.page, 74)
    }

    func testFTSSourceFilterRunsBeforeLimit() throws {
        let index = try LocalSearchIndex()
        let allowed = UUID()
        for page in 1...24 {
            try index.index(
                sourceID: UUID(),
                revision: 1,
                text: "[[page:\(page)]]\nhorizontal acceleration horizontal acceleration unrelated class"
            )
        }
        try index.index(
            sourceID: allowed,
            revision: 4,
            text: "[[page:91]]\nhorizontal acceleration appears in the selected class source"
        )

        let hits = try index.search("horizontal acceleration", sourceIDs: [allowed], limit: 1)

        XCTAssertEqual(hits.count, 1)
        XCTAssertEqual(hits.first?.sourceID, allowed)
        XCTAssertEqual(hits.first?.page, 91)
    }

    func testLateTranscriptActionKeepsItsAnchor() async throws {
        let store = LearningHomeStore(inMemory: true)
        let space = try XCTUnwrap(store.spaces.first)
        let filler = Array(repeating: "Lecture discussion without follow-up.", count: 1_200).joined(separator: "\n")
        let text = "\(filler)\n[[time:3672]]\nTODO submit the corrected lab graph before class."
        let source = try await store.addSource(
            to: space.id,
            title: "Long Wispr meeting",
            kind: .wispr,
            filename: "wispr.txt",
            sha256: SHA256Digest.hex(Data(text.utf8)),
            extractedText: text,
            connector: "Wispr Flow"
        )
        let revision = try XCTUnwrap(store.latestRevision(for: source.id))

        let extractor = StudyActionExtractor(harness: AIHarness(providers: [.localDemo: LocalPreviewProvider()]))
        let result = try await extractor.extract(
            source: source,
            revision: revision,
            space: space,
            override: .provider(.localDemo)
        )

        let action = try XCTUnwrap(result.actions.first { $0.title.localizedCaseInsensitiveContains("submit") })
        XCTAssertEqual(action.sourceAnchor?.timestamp, 3_672)
        XCTAssertEqual(action.sourceAnchor?.revision, revision.revisionNumber)
    }

    func testEditingPlannedSessionPreservesCalendarIdentity() throws {
        let store = LearningHomeStore(inMemory: true)
        let spaceID = try XCTUnwrap(store.spaces.first?.id)
        let session = try store.addPlannedSession(
            spaceID: spaceID,
            title: "Original block",
            notes: "Original notes",
            scheduledStart: Date(timeIntervalSince1970: 1_800_000_000),
            durationMinutes: 45,
            planID: UUID()
        )
        try store.linkCalendarEvent("event-123", calendarName: "Google Calendar · School", to: session.id)
        let revisedStart = Date(timeIntervalSince1970: 1_800_003_600)

        let didUpdate = try store.updatePlannedSession(
            id: session.id,
            title: "Revised block",
            notes: "Revised notes",
            scheduledStart: revisedStart,
            durationMinutes: 60
        )
        XCTAssertTrue(didUpdate)
        XCTAssertEqual(session.title, "Revised block")
        XCTAssertEqual(session.scheduledStart, revisedStart)
        XCTAssertEqual(session.plannedDurationMinutes, 60)
        XCTAssertEqual(session.calendarEventIdentifier, "event-123")
        XCTAssertEqual(session.calendarName, "Google Calendar · School")
    }

    func testCompanionSnapshotRedactsMacOnlyState() throws {
        let store = LearningHomeStore(inMemory: true)
        guard let data = store.companionSnapshotData() else { return XCTFail("Snapshot encoding failed") }
        let companion = LearningHomeStore(inMemory: true)
        try companion.applyCompanionSnapshotData(data)
        XCTAssertEqual(companion.spaces.count, store.spaces.count)
        XCTAssertTrue(companion.revisions.allSatisfy { $0.originalFilePath.isEmpty })
        XCTAssertTrue(companion.providerRuns.isEmpty)
        XCTAssertTrue(companion.jobs.allSatisfy { $0.payloadData.isEmpty })
    }

    func testExternalConnectorPoliciesRemainReadOnly() {
        XCTAssertFalse(IntegrationSafetyPolicy.classroomCanSubmit)
        XCTAssertTrue(IntegrationSafetyPolicy.classroomOAuthScopes.allSatisfy { $0.hasSuffix("readonly") })
        XCTAssertTrue(IntegrationSafetyPolicy.wisprIsReadOnly)
        XCTAssertFalse(IntegrationSafetyPolicy.khanScrapingEnabled)
    }

    func testSnapshotLoadClassificationDistinguishesMissingValidAndInvalid() throws {
        XCTAssertEqual(LearningHomeSnapshotPersistence.classify(data: nil), .missing)

        let validData = try JSONEncoder().encode(LearningHomeSnapshot())
        XCTAssertEqual(LearningHomeSnapshotPersistence.classify(data: validData), .valid)

        var unsupported = LearningHomeSnapshot()
        unsupported.schemaVersion = 2
        let unsupportedData = try JSONEncoder().encode(unsupported)
        XCTAssertEqual(LearningHomeSnapshotPersistence.classify(data: unsupportedData), .invalid)
        XCTAssertEqual(
            LearningHomeSnapshotPersistence.classify(data: Data("not-json".utf8)),
            .invalid
        )
    }

    func testMissingStoreBootstrapsDemoInsteadOfEnteringRecoveryMode() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("TheDeskMissingStoreTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let storageURL = root.appendingPathComponent("library.json")

        let store = LearningHomeStore(inMemory: false, storageURL: storageURL)

        XCTAssertEqual(store.spaces.count, DemoData.makeSnapshot().spaces.count)
        XCTAssertTrue(FileManager.default.fileExists(atPath: storageURL.path))
        let persisted = try XCTUnwrap(LearningHomeSnapshotPersistence.decode(data: Data(contentsOf: storageURL)))
        XCTAssertEqual(persisted.spaces.count, store.spaces.count)
    }

    func testLegacyCanvasWithoutHistorySeedsFirstVersionDuringMigration() throws {
        let snapshot = DemoData.makeSnapshot()
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let encoded = try encoder.encode(snapshot)
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        var canvases = try XCTUnwrap(object["canvases"] as? [[String: Any]])
        XCTAssertFalse(canvases.isEmpty)
        canvases[0].removeValue(forKey: "historyData")
        object["canvases"] = canvases
        let legacyData = try JSONSerialization.data(withJSONObject: object)

        let decoded = try XCTUnwrap(LearningHomeSnapshotPersistence.decode(data: legacyData))
        XCTAssertTrue(decoded.canvases[0].history.isEmpty)
        let migrated = LearningHomeSnapshotPersistence.migrate(decoded)

        XCTAssertEqual(migrated.canvases[0].history.count, 1)
        XCTAssertEqual(migrated.canvases[0].history[0].version, migrated.canvases[0].version)
    }

    func testInvalidStoreIsPreservedAndNeverReplacedByDemoData() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("TheDeskPersistenceTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let storageURL = root.appendingPathComponent("library.json")
        let invalidData = Data("{ definitely not a snapshot".utf8)
        try invalidData.write(to: storageURL)

        let store = LearningHomeStore(inMemory: false, storageURL: storageURL)

        XCTAssertTrue(store.spaces.isEmpty)
        XCTAssertTrue(store.sources.isEmpty)
        XCTAssertTrue(store.assignments.isEmpty)
        XCTAssertEqual(try Data(contentsOf: storageURL), invalidData)
        if case .recoveryRequired(let backupPath) = store.persistenceState {
            XCTAssertNotNil(backupPath)
        } else {
            XCTFail("Invalid store did not enter recovery mode")
        }

        let backups = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasPrefix("library.json.invalid-") }
        XCTAssertEqual(backups.count, 1)
        XCTAssertEqual(try Data(contentsOf: try XCTUnwrap(backups.first)), invalidData)

        XCTAssertThrowsError(try store.addSpace(
            kind: .track,
            title: "Should not overwrite recovery source",
            subtitle: "",
            colorHex: "#356B58",
            tutorStyle: .coachFirst
        ))
        XCTAssertTrue(store.spaces.isEmpty)
        XCTAssertEqual(try Data(contentsOf: storageURL), invalidData)
    }

    func testLegacyInlineRevisionMigratesToExternalTextAndReloads() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("TheDeskLegacyTextTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let storageURL = root.appendingPathComponent("library.json")
        let original = DemoData.makeSnapshot()
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoder.encode(original)) as? [String: Any])
        var revisions = try XCTUnwrap(object["revisions"] as? [[String: Any]])
        for index in revisions.indices { revisions[index].removeValue(forKey: "textStorageKey") }
        object["revisions"] = revisions
        try JSONSerialization.data(withJSONObject: object).write(to: storageURL)

        let migrated = LearningHomeStore(inMemory: false, storageURL: storageURL)
        XCTAssertEqual(migrated.persistenceState, .ready)
        XCTAssertEqual(migrated.revisions.first?.extractedText, original.revisions.first?.extractedText)
        let metadata = String(decoding: try Data(contentsOf: storageURL), as: UTF8.self)
        XCTAssertFalse(metadata.contains("\"extractedText\""))
        let textDirectory = root.appendingPathComponent("RevisionText", isDirectory: true)
        XCTAssertEqual(
            try FileManager.default.contentsOfDirectory(at: textDirectory, includingPropertiesForKeys: nil).count,
            migrated.revisions.count
        )

        let reloaded = LearningHomeStore(inMemory: false, storageURL: storageURL)
        XCTAssertEqual(reloaded.revisions.first?.extractedText, original.revisions.first?.extractedText)
    }

    func testFailedMetadataWriteThrowsAndRollsBackMutation() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("TheDeskWriteFailureTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let storageURL = root.appendingPathComponent("library.json")
        let store = LearningHomeStore(inMemory: false, storageURL: storageURL)
        let originalCount = store.spaces.count
        try FileManager.default.removeItem(at: storageURL)
        try FileManager.default.createDirectory(at: storageURL, withIntermediateDirectories: true)

        XCTAssertThrowsError(try store.addSpace(
            kind: .track,
            title: "Must roll back",
            subtitle: "",
            colorHex: "#356B58",
            tutorStyle: .coachFirst
        ))
        XCTAssertEqual(store.spaces.count, originalCount)
        if case .failed = store.persistenceState {} else { XCTFail("Write failure was not published") }
    }

    func testConcurrentSameHashImportCreatesOneRevision() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("TheDeskConcurrentImportTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = LearningHomeStore(inMemory: false, storageURL: root.appendingPathComponent("library.json"))
        let spaceID = try XCTUnwrap(store.spaces.first?.id)
        let text = String(repeating: "bounded concurrent text ", count: 4_000)
        let digest = SHA256Digest.hex(Data(text.utf8))

        async let first = store.addSource(to: spaceID, title: "A", kind: .note, filename: "a.txt", sha256: digest, extractedText: text)
        async let second = store.addSource(to: spaceID, title: "B", kind: .note, filename: "b.txt", sha256: digest, extractedText: text)
        let firstSource = try await first
        let secondSource = try await second

        XCTAssertEqual(firstSource.id, secondSource.id)
        XCTAssertEqual(store.revisions.filter { $0.sha256 == digest }.count, 1)
    }

    func testImportedAnchorsSurviveReloadWithCanonicalIDs() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("TheDeskAnchorReloadTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let storageURL = root.appendingPathComponent("library.json")
        let store = LearningHomeStore(inMemory: false, storageURL: storageURL)
        let spaceID = try XCTUnwrap(store.spaces.first?.id)
        let placeholder = SourceAnchor(sourceID: UUID(), revision: 99, page: 7, excerpt: "Durable page")
        let source = try await store.addSource(
            to: spaceID,
            title: "Durable anchors",
            kind: .note,
            filename: "anchors.txt",
            sha256: SHA256Digest.hex(Data("durable anchors".utf8)),
            extractedText: "[[page:7]]\nDurable page",
            anchorIndexData: try JSONEncoder().encode([placeholder])
        )

        let reloaded = LearningHomeStore(inMemory: false, storageURL: storageURL)
        let revision = try XCTUnwrap(reloaded.latestRevision(for: source.id))
        let anchors = try JSONDecoder().decode([SourceAnchor].self, from: revision.anchorIndexData)
        XCTAssertEqual(anchors.first?.sourceID, source.id)
        XCTAssertEqual(anchors.first?.revision, 1)
    }

    func testConcurrentDifferentHashRevisionsGetUniqueSequenceNumbers() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("TheDeskConcurrentRevisionTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = LearningHomeStore(inMemory: false, storageURL: root.appendingPathComponent("library.json"))
        let spaceID = try XCTUnwrap(store.spaces.first?.id)
        let source = try await store.addSource(
            to: spaceID,
            title: "Revision source",
            kind: .note,
            filename: "base.txt",
            sha256: SHA256Digest.hex(Data("base".utf8)),
            extractedText: "base"
        )
        let textA = String(repeating: "A", count: 1_000_000)
        let textB = String(repeating: "B", count: 1_000_000)
        async let first = store.addRevision(
            to: source.id,
            sha256: SHA256Digest.hex(Data(textA.utf8)),
            extractedText: textA,
            anchorIndexData: Data(),
            originalFilePath: "",
            pageCount: 1,
            duration: 0
        )
        async let second = store.addRevision(
            to: source.id,
            sha256: SHA256Digest.hex(Data(textB.utf8)),
            extractedText: textB,
            anchorIndexData: Data(),
            originalFilePath: "",
            pageCount: 1,
            duration: 0
        )
        _ = try await (first, second)

        let numbers = store.revisions
            .filter { $0.sourceID == source.id }
            .map(\.revisionNumber)
            .sorted()
        XCTAssertEqual(numbers, [1, 2, 3])
    }

    func testRevisionTextWriteFailureLocksDurableWrites() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("TheDeskRevisionWriteFailureTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = LearningHomeStore(inMemory: false, storageURL: root.appendingPathComponent("library.json"))
        let textDirectory = root.appendingPathComponent("RevisionText", isDirectory: true)
        try FileManager.default.removeItem(at: textDirectory)
        try Data("not a directory".utf8).write(to: textDirectory)

        do {
            _ = try await store.addSource(
                to: try XCTUnwrap(store.spaces.first?.id),
                title: "Must fail safely",
                kind: .note,
                filename: "failure.txt",
                sha256: SHA256Digest.hex(Data("failure".utf8)),
                extractedText: "failure"
            )
            XCTFail("Revision-text write unexpectedly succeeded")
        } catch {}
        if case .failed = store.persistenceState {} else { XCTFail("Revision write failure was not published") }
    }

    func testCanvasRestoreUsesHistoricalSignatureAndStaleness() throws {
        let store = LearningHomeStore(inMemory: true)
        let canvas = try XCTUnwrap(store.canvases.first)
        let historical = try XCTUnwrap(canvas.history.first)

        try store.restoreCanvas(
            id: canvas.id,
            snapshot: historical,
            currentSourceSignature: "newer:2"
        )

        let restored = try XCTUnwrap(store.canvases.first(where: { $0.id == canvas.id }))
        XCTAssertEqual(restored.sourceRevisionSignature, historical.sourceRevisionSignature)
        XCTAssertTrue(restored.isStale)
    }

    func testMalformedCanvasHistoryEntersRecoveryWithoutOverwrite() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("TheDeskCorruptCanvasHistoryTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let storageURL = root.appendingPathComponent("library.json")
        let space = StudySpace(
            kind: .class,
            title: "History",
            subtitle: "",
            colorHex: "#356B58",
            symbolName: "book",
            tutorStyle: .coachFirst,
            sortOrder: 0
        )
        let spec = StudySceneSpec(
            kind: .conceptMap,
            title: "History",
            summary: "History integrity",
            nodes: [SceneNode(id: "one", title: "One", detail: "", x: 0.5, y: 0.5)],
            accessibilitySummary: "One history node."
        )
        let canvas = CanvasArtifact(spaceID: space.id, title: "Corrupt", spec: spec, sourceRevisionSignature: "source:1")
        canvas.historyData = Data("corrupt-history".utf8)
        let original = try JSONEncoder().encode(LearningHomeSnapshot(spaces: [space], canvases: [canvas]))
        try original.write(to: storageURL)

        let store = LearningHomeStore(inMemory: false, storageURL: storageURL)
        if case .recoveryRequired = store.persistenceState {} else { XCTFail("Malformed Canvas history was accepted") }
        XCTAssertEqual(try Data(contentsOf: storageURL), original)
    }

    func testUnsupportedSchemaStoreIsPreservedWithoutDemoBootstrap() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("TheDeskSchemaTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let storageURL = root.appendingPathComponent("library.json")
        var unsupported = LearningHomeSnapshot()
        unsupported.schemaVersion = 2
        let unsupportedData = try JSONEncoder().encode(unsupported)
        try unsupportedData.write(to: storageURL)

        let store = LearningHomeStore(inMemory: false, storageURL: storageURL)

        XCTAssertTrue(store.spaces.isEmpty)
        XCTAssertEqual(try Data(contentsOf: storageURL), unsupportedData)
        let backups = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasPrefix("library.json.invalid-") }
        XCTAssertEqual(backups.count, 1)
        XCTAssertEqual(try Data(contentsOf: try XCTUnwrap(backups.first)), unsupportedData)
    }

    func testUnreadableStorePathIsPreservedWithoutDemoBootstrap() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("TheDeskReadTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let storageURL = root.appendingPathComponent("library.json", isDirectory: true)
        try FileManager.default.createDirectory(at: storageURL, withIntermediateDirectories: true)

        let store = LearningHomeStore(inMemory: false, storageURL: storageURL)

        XCTAssertTrue(store.spaces.isEmpty)
        var isDirectory = false
        XCTAssertTrue(FileManager.default.fileExists(atPath: storageURL.path, isDirectory: &isDirectory))
        XCTAssertTrue(isDirectory)
        let backups = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasPrefix("library.json.invalid-") }
        XCTAssertEqual(backups.count, 1)
        var backupIsDirectory = false
        XCTAssertTrue(FileManager.default.fileExists(atPath: try XCTUnwrap(backups.first).path, isDirectory: &backupIsDirectory))
        XCTAssertTrue(backupIsDirectory)
    }

    func testLegacySnapshotAddsCalendarIntegrationBeforeUpdate() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("TheDeskMigrationTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let storageURL = root.appendingPathComponent("library.json")
        let legacy = LearningHomeSnapshot(integrations: [
            IntegrationAccount(
                id: "reminders",
                displayName: "Apple Reminders",
                status: "permissionRequired",
                detail: "Legacy integration",
                isReadOnly: false
            )
        ])
        try JSONEncoder().encode(legacy).write(to: storageURL)

        let store = LearningHomeStore(inMemory: false, storageURL: storageURL)
        let calendar = try XCTUnwrap(store.integrations.first(where: { $0.id == "calendar" }))
        XCTAssertEqual(calendar.statusRaw, "permissionRequired")
        XCTAssertEqual(store.integrations.filter { $0.id == "calendar" }.count, 1)

        try store.updateIntegration(id: "calendar", status: "ready", detail: "Writable calendar found")
        XCTAssertEqual(calendar.statusRaw, "ready")
        XCTAssertEqual(calendar.detail, "Writable calendar found")

        let persisted = try XCTUnwrap(LearningHomeSnapshotPersistence.decode(data: Data(contentsOf: storageURL)))
        let persistedCalendar = try XCTUnwrap(persisted.integrations.first(where: { $0.id == "calendar" }))
        XCTAssertEqual(persistedCalendar.statusRaw, "ready")
        XCTAssertEqual(persisted.integrations.filter { $0.id == "calendar" }.count, 1)
    }

    func testStudyPlanRequiresApprovalBeforePersistenceAndExportsPortableCalendar() throws {
        let store = LearningHomeStore(inMemory: true)
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let drafts = StudyPlanBuilder.build(
            spaces: store.spaces,
            assignments: store.assignments,
            mastery: store.mastery,
            sources: store.sources,
            startingAt: start,
            days: 2,
            sessionsPerDay: 2,
            durationMinutes: 45
        )
        XCTAssertFalse(drafts.isEmpty)
        XCTAssertTrue(store.sessions.isEmpty)

        let planID = UUID()
        let draft = try XCTUnwrap(drafts.first)
        XCTAssertNotNil(draft.linkedAssignmentID ?? draft.linkedMasteryRecordID ?? draft.linkedSourceID)
        let session = try store.addPlannedSession(
            spaceID: draft.spaceID,
            title: draft.title,
            notes: draft.detail,
            scheduledStart: draft.start,
            durationMinutes: draft.durationMinutes,
            planID: planID,
            linkedAssignmentID: draft.linkedAssignmentID,
            linkedMasteryRecordID: draft.linkedMasteryRecordID,
            linkedSourceID: draft.linkedSourceID
        )
        XCTAssertEqual(store.sessions.count, 1)
        XCTAssertEqual(session.planState, .planned)
        XCTAssertEqual(session.linkedAssignmentID, draft.linkedAssignmentID)
        XCTAssertNil(session.calendarEventIdentifier)

        let calendar = String(decoding: StudyCalendarICS.data(
            sessions: [session],
            spaceTitles: [draft.spaceID: "Test Class"]
        ), as: UTF8.self)
        XCTAssertTrue(calendar.contains("BEGIN:VCALENDAR"))
        XCTAssertTrue(calendar.contains("UID:\(session.id.uuidString)@thedesk.local"))
        XCTAssertTrue(calendar.contains("SUMMARY:"))
        XCTAssertTrue(calendar.contains("DESCRIPTION:The Desk · Test Class\\n"))
        XCTAssertFalse(calendar.contains("Test Class\\\\n"))
        XCTAssertTrue(calendar.components(separatedBy: "\r\n").allSatisfy { $0.utf8.count <= 75 })
        XCTAssertTrue(StudyCalendarConnector.ownsLinkedEvent(notes: "Study block ID: \(session.id.uuidString)", sessionID: session.id))
        XCTAssertFalse(StudyCalendarConnector.ownsLinkedEvent(notes: "Unrelated event", sessionID: session.id))
    }
}
