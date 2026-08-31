import Foundation

@main
struct CoreSmoke {
    @MainActor
    static func main() async throws {
        let invalidScene = StudySceneSpec(
            kind: .conceptMap,
            title: "Invalid",
            summary: "",
            nodes: [SceneNode(id: "a", title: "A", detail: "", x: 0.2, y: 0.2)],
            connections: [SceneConnection(from: "a", to: "missing", label: "")],
            accessibilitySummary: "Invalid test scene"
        )
        do {
            try invalidScene.validate()
            fatalError("Dangling scene connection was accepted")
        } catch StudySceneValidationError.invalidConnection {}

        let unsafeScene = StudySceneSpec(
            kind: .process,
            title: "Unsafe",
            summary: "",
            nodes: [SceneNode(id: "a", title: "A", detail: "", x: 1.2, y: 0.2)],
            accessibilitySummary: "Invalid coordinate test scene"
        )
        do {
            try unsafeScene.validate()
            fatalError("Out-of-bounds scene node was accepted")
        } catch StudySceneValidationError.invalidNode {}

        let validCue = OverlayCue(kind: .highlight, region: NormalizedRect(x: 0.1, y: 0.1, width: 0.4, height: 0.2), label: "Valid")
        let invalidCue = OverlayCue(kind: .arrow, region: NormalizedRect(x: 0.9, y: 0.1, width: 0.4, height: 0.2), label: "Invalid")
        precondition(OverlayCueSpec(cues: [validCue]).validate())
        precondition(!OverlayCueSpec(cues: [invalidCue]).validate())

        let store = LearningHomeStore(inMemory: true)
        precondition(store.spaces.count == 4)

        let missingStoreRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("TheDeskMissingStoreSmoke-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: missingStoreRoot) }
        let missingStoreURL = missingStoreRoot.appendingPathComponent("library.json")
        let bootstrappedStore = LearningHomeStore(inMemory: false, storageURL: missingStoreURL)
        precondition(bootstrappedStore.spaces.count == 4)
        precondition(FileManager.default.fileExists(atPath: missingStoreURL.path))
        let persistedMetadata = String(decoding: try Data(contentsOf: missingStoreURL), as: UTF8.self)
        precondition(!persistedMetadata.contains("\"extractedText\""))
        let revisionTextDirectory = missingStoreRoot.appendingPathComponent("RevisionText", isDirectory: true)
        let revisionTextFiles = try FileManager.default.contentsOfDirectory(at: revisionTextDirectory, includingPropertiesForKeys: nil)
        precondition(revisionTextFiles.count == bootstrappedStore.revisions.count)
        let reloadedStore = LearningHomeStore(inMemory: false, storageURL: missingStoreURL)
        precondition(reloadedStore.revisions.first?.extractedText == bootstrappedStore.revisions.first?.extractedText)

        let placeholderAnchor = SourceAnchor(
            sourceID: UUID(),
            revision: 99,
            page: 17,
            excerpt: "A durable citation"
        )
        let citedSource = try await bootstrappedStore.addSource(
            to: bootstrappedStore.spaces[0].id,
            title: "Citation durability",
            kind: .note,
            filename: "citation.txt",
            sha256: SHA256Digest.hex(Data("citation durability".utf8)),
            extractedText: "[[page:17]]\nA durable citation",
            anchorIndexData: try JSONEncoder().encode([placeholderAnchor])
        )
        let citationReload = LearningHomeStore(inMemory: false, storageURL: missingStoreURL)
        let persistedCitationRevision = citationReload.latestRevision(for: citedSource.id)
        let persistedAnchors = try JSONDecoder().decode(
            [SourceAnchor].self,
            from: persistedCitationRevision?.anchorIndexData ?? Data()
        )
        precondition(persistedAnchors.first?.sourceID == citedSource.id)
        precondition(persistedAnchors.first?.revision == 1)

        let legacyRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("TheDeskLegacyTextSmoke-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: legacyRoot) }
        try FileManager.default.createDirectory(at: legacyRoot, withIntermediateDirectories: true)
        let legacyURL = legacyRoot.appendingPathComponent("library.json")
        let legacyEncoder = JSONEncoder()
        legacyEncoder.dateEncodingStrategy = .iso8601
        let legacyEncoded = try legacyEncoder.encode(DemoData.makeSnapshot())
        var legacyObject = try JSONSerialization.jsonObject(with: legacyEncoded) as! [String: Any]
        var legacyRevisions = legacyObject["revisions"] as! [[String: Any]]
        for index in legacyRevisions.indices { legacyRevisions[index].removeValue(forKey: "textStorageKey") }
        legacyObject["revisions"] = legacyRevisions
        try JSONSerialization.data(withJSONObject: legacyObject).write(to: legacyURL)
        let migratedLegacyStore = LearningHomeStore(inMemory: false, storageURL: legacyURL)
        precondition(migratedLegacyStore.persistenceState == .ready)
        precondition(!(migratedLegacyStore.revisions.first?.extractedText.isEmpty ?? true))
        let migratedMetadata = String(decoding: try Data(contentsOf: legacyURL), as: UTF8.self)
        precondition(!migratedMetadata.contains("\"extractedText\""))

        if !TheDeskCloudConfiguration.hasContainerEntitlement {
            do {
                _ = try await CloudCaptureQueue().fetchPending(limit: 1)
                fatalError("Unsigned build unexpectedly created a CloudKit database")
            } catch CloudCaptureError.notConfigured {
                // Expected: local builds stay usable and queue offline.
            }
        }
        let addedSpace = try store.addSpace(kind: .track, title: "  Calculus Review  ", subtitle: "  Fall plan  ", colorHex: "#356B58", tutorStyle: .examPractice)
        precondition(addedSpace.title == "Calculus Review")
        precondition(store.selectedSpaceID == addedSpace.id)
        let digest = SHA256Digest.hex(Data("deduplicate me".utf8))
        let first = try await store.addSource(to: store.spaces[0].id, title: "First", kind: .note, filename: "first.txt", sha256: digest, extractedText: "deduplicate me")
        let duplicate = try await store.addSource(to: store.spaces[0].id, title: "Again", kind: .note, filename: "again.txt", sha256: digest, extractedText: "deduplicate me")
        let shared = try await store.addSource(to: store.spaces[1].id, title: "Second", kind: .note, filename: "second.txt", sha256: digest, extractedText: "deduplicate me")
        precondition(first.id == duplicate.id)
        precondition(first.id != shared.id)
        precondition(shared.spaceID == store.spaces[1].id)

        guard let assignment = store.assignments.first else { fatalError("Missing assignment fixture") }
        try store.appendEvidence(AssignmentEvidence(kind: .reminderCompleted, summary: "Checked reminder"), to: assignment.id)
        try store.setAssignmentState(.verifiedComplete, assignmentID: assignment.id)
        precondition(assignment.state != .verifiedComplete)
        try store.appendEvidence(AssignmentEvidence(kind: .classroomTurnedIn, summary: "TURNED_IN"), to: assignment.id)
        precondition(assignment.state == .verifiedComplete)

        let index = try LocalSearchIndex()
        let sourceID = UUID()
        try index.index(sourceID: sourceID, revision: 3, text: "[[page:74]]\nHorizontal acceleration remains zero during ideal projectile motion.")
        let result = try index.search("horizontal acceleration")
        precondition(result.first?.sourceID == sourceID)
        precondition(result.first?.page == 74)

        let filteredIndex = try LocalSearchIndex()
        let allowedSourceID = UUID()
        for page in 1...24 {
            try filteredIndex.index(
                sourceID: UUID(),
                revision: 1,
                text: "[[page:\(page)]]\nhorizontal acceleration horizontal acceleration unrelated class"
            )
        }
        try filteredIndex.index(
            sourceID: allowedSourceID,
            revision: 4,
            text: "[[page:91]]\nhorizontal acceleration appears in the selected class source"
        )
        let filteredHits = try filteredIndex.search("horizontal acceleration", sourceIDs: [allowedSourceID], limit: 1)
        precondition(filteredHits.count == 1)
        precondition(filteredHits[0].sourceID == allowedSourceID)
        precondition(filteredHits[0].page == 91)

        guard let canvas = store.canvases.first else { fatalError("Missing canvas fixture") }
        let previous = canvas.version
        canvas.isStale = true
        canvas.acceptReviewedRefresh(sourceSignature: "physics:2")
        precondition(canvas.version == previous + 1)
        precondition(!canvas.isStale)
        precondition(canvas.history.count >= 2)
        if let historical = canvas.history.first {
            try store.restoreCanvas(
                id: canvas.id,
                snapshot: historical,
                currentSourceSignature: "newer-source:9"
            )
            let restored = store.canvases.first(where: { $0.id == canvas.id })!
            precondition(restored.sourceRevisionSignature == historical.sourceRevisionSignature)
            precondition(restored.isStale)
        }

        guard let companionData = store.companionSnapshotData() else { fatalError("Missing companion snapshot") }
        let companionStore = LearningHomeStore(inMemory: true)
        try companionStore.applyCompanionSnapshotData(companionData)
        precondition(companionStore.spaces.count == store.spaces.count)
        precondition(companionStore.revisions.allSatisfy { $0.originalFilePath.isEmpty })
        precondition(companionStore.providerRuns.isEmpty)
        precondition(companionStore.jobs.allSatisfy { $0.payloadData.isEmpty })
        precondition(!IntegrationSafetyPolicy.classroomCanSubmit)
        precondition(IntegrationSafetyPolicy.classroomOAuthScopes.allSatisfy { $0.hasSuffix("readonly") })
        precondition(IntegrationSafetyPolicy.wisprIsReadOnly)
        precondition(!IntegrationSafetyPolicy.khanScrapingEnabled)

        precondition(LearningHomeSnapshotPersistence.classify(data: nil) == .missing)
        let validSnapshotData = try JSONEncoder().encode(LearningHomeSnapshot())
        precondition(LearningHomeSnapshotPersistence.classify(data: validSnapshotData) == .valid)
        var unsupportedSnapshot = LearningHomeSnapshot()
        unsupportedSnapshot.schemaVersion = 2
        let unsupportedSnapshotData = try JSONEncoder().encode(unsupportedSnapshot)
        precondition(LearningHomeSnapshotPersistence.classify(data: unsupportedSnapshotData) == .invalid)
        var duplicateSnapshot = DemoData.makeSnapshot()
        duplicateSnapshot.revisions.append(duplicateSnapshot.revisions[0])
        let duplicateSnapshotData = try JSONEncoder().encode(duplicateSnapshot)
        precondition(LearningHomeSnapshotPersistence.classify(data: duplicateSnapshotData) == .invalid)
        let duplicateRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("TheDeskDuplicateSnapshot-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: duplicateRoot) }
        try FileManager.default.createDirectory(at: duplicateRoot, withIntermediateDirectories: true)
        let duplicateURL = duplicateRoot.appendingPathComponent("library.json")
        try duplicateSnapshotData.write(to: duplicateURL)
        let duplicateStore = LearningHomeStore(inMemory: false, storageURL: duplicateURL)
        if case .recoveryRequired = duplicateStore.persistenceState {
            // Expected: a corrupt duplicate-ID library is preserved, never trapped.
        } else {
            fatalError("Duplicate-ID library did not enter recovery")
        }
        let corruptCanvasRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("TheDeskCorruptCanvasHistory-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: corruptCanvasRoot) }
        try FileManager.default.createDirectory(at: corruptCanvasRoot, withIntermediateDirectories: true)
        let corruptCanvasURL = corruptCanvasRoot.appendingPathComponent("library.json")
        let canvasSpace = StudySpace(kind: .class, title: "History", subtitle: "", colorHex: "#356B58", symbolName: "book", tutorStyle: .coachFirst, sortOrder: 0)
        let canvasSpec = StudySceneSpec(
            kind: .conceptMap,
            title: "History",
            summary: "History integrity",
            nodes: [SceneNode(id: "one", title: "One", detail: "", x: 0.5, y: 0.5)],
            accessibilitySummary: "One history node."
        )
        let corruptCanvas = CanvasArtifact(spaceID: canvasSpace.id, title: "Corrupt", spec: canvasSpec, sourceRevisionSignature: "source:1")
        corruptCanvas.historyData = Data("corrupt-history".utf8)
        let corruptCanvasData = try JSONEncoder().encode(LearningHomeSnapshot(spaces: [canvasSpace], canvases: [corruptCanvas]))
        try corruptCanvasData.write(to: corruptCanvasURL)
        let corruptCanvasStore = LearningHomeStore(inMemory: false, storageURL: corruptCanvasURL)
        if case .recoveryRequired = corruptCanvasStore.persistenceState {
            let preservedCanvasData = try Data(contentsOf: corruptCanvasURL)
            precondition(preservedCanvasData == corruptCanvasData)
        } else {
            fatalError("Malformed Canvas history did not enter recovery")
        }
        let legacySnapshot = LearningHomeSnapshot(integrations: [
            IntegrationAccount(id: "reminders", displayName: "Apple Reminders", status: "ready", detail: "Legacy", isReadOnly: false)
        ])
        let migratedSnapshot = LearningHomeSnapshotPersistence.migrate(legacySnapshot)
        precondition(migratedSnapshot.integrations.filter { $0.id == "calendar" }.count == 1)

        try store.createJob(kind: "noteCapture", payload: Data(), state: .completed, idempotencyKey: "terminal-smoke")
        try store.updateJob(idempotencyKey: "terminal-smoke", state: .processing)
        precondition(store.jobs.first(where: { $0.idempotencyKey == "terminal-smoke" })?.state == .completed)

        let concurrentText = String(repeating: "concurrent textbook text ", count: 4_000)
        let concurrentDigest = SHA256Digest.hex(Data(concurrentText.utf8))
        let concurrentSpaceID = bootstrappedStore.spaces[0].id
        async let concurrentA = bootstrappedStore.addSource(
            to: concurrentSpaceID,
            title: "Concurrent A",
            kind: .note,
            filename: "a.txt",
            sha256: concurrentDigest,
            extractedText: concurrentText
        )
        async let concurrentB = bootstrappedStore.addSource(
            to: concurrentSpaceID,
            title: "Concurrent B",
            kind: .note,
            filename: "b.txt",
            sha256: concurrentDigest,
            extractedText: concurrentText
        )
        let concurrentSourceA = try await concurrentA
        let concurrentSourceB = try await concurrentB
        precondition(concurrentSourceA.id == concurrentSourceB.id)
        precondition(bootstrappedStore.revisions.filter { $0.sha256 == concurrentDigest }.count == 1)

        let revisionSource = try await bootstrappedStore.addSource(
            to: concurrentSpaceID,
            title: "Concurrent revisions",
            kind: .note,
            filename: "revision-base.txt",
            sha256: SHA256Digest.hex(Data("revision base".utf8)),
            extractedText: "revision base",
            anchorIndexData: try JSONEncoder().encode([placeholderAnchor])
        )
        let revisionTextA = String(repeating: "revision A ", count: 100_000)
        let revisionTextB = String(repeating: "revision B ", count: 100_000)
        async let revisionA = bootstrappedStore.addRevision(
            to: revisionSource.id,
            sha256: SHA256Digest.hex(Data(revisionTextA.utf8)),
            extractedText: revisionTextA,
            anchorIndexData: try JSONEncoder().encode([placeholderAnchor]),
            originalFilePath: "",
            pageCount: 1,
            duration: 0
        )
        async let revisionB = bootstrappedStore.addRevision(
            to: revisionSource.id,
            sha256: SHA256Digest.hex(Data(revisionTextB.utf8)),
            extractedText: revisionTextB,
            anchorIndexData: try JSONEncoder().encode([placeholderAnchor]),
            originalFilePath: "",
            pageCount: 1,
            duration: 0
        )
        _ = try await (revisionA, revisionB)
        let concurrentRevisions = bootstrappedStore.revisions
            .filter { $0.sourceID == revisionSource.id }
            .sorted { $0.revisionNumber < $1.revisionNumber }
        precondition(concurrentRevisions.map(\.revisionNumber) == [1, 2, 3])
        for revision in concurrentRevisions {
            let anchors = try JSONDecoder().decode([SourceAnchor].self, from: revision.anchorIndexData)
            if let anchor = anchors.first {
                precondition(anchor.sourceID == revisionSource.id)
                precondition(anchor.revision == revision.revisionNumber)
            }
        }

        let failedWriteRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("TheDeskRevisionWriteFailure-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: failedWriteRoot) }
        let failedWriteURL = failedWriteRoot.appendingPathComponent("library.json")
        let failedWriteStore = LearningHomeStore(inMemory: false, storageURL: failedWriteURL)
        let failedRevisionTextDirectory = failedWriteRoot.appendingPathComponent("RevisionText", isDirectory: true)
        try FileManager.default.removeItem(at: failedRevisionTextDirectory)
        try Data("not a directory".utf8).write(to: failedRevisionTextDirectory)
        do {
            _ = try await failedWriteStore.addSource(
                to: failedWriteStore.spaces[0].id,
                title: "Must fail safely",
                kind: .note,
                filename: "failure.txt",
                sha256: SHA256Digest.hex(Data("must fail safely".utf8)),
                extractedText: "must fail safely"
            )
            fatalError("Revision-text failure was accepted")
        } catch {
            if case .failed = failedWriteStore.persistenceState {
                // Expected: external writes are now blocked until retry succeeds.
            } else {
                fatalError("Revision-text failure did not lock durable writes")
            }
        }

        let planStart = Date(timeIntervalSince1970: 1_800_000_000)
        let drafts = StudyPlanBuilder.build(
            spaces: store.spaces,
            assignments: store.assignments,
            mastery: store.mastery,
            sources: store.sources,
            startingAt: planStart,
            days: 2,
            sessionsPerDay: 2,
            durationMinutes: 45
        )
        precondition(!drafts.isEmpty)
        let firstDraft = drafts[0]
        precondition(firstDraft.linkedAssignmentID != nil || firstDraft.linkedMasteryRecordID != nil || firstDraft.linkedSourceID != nil)
        let planned = try store.addPlannedSessions([
            PlannedSessionInput(
                spaceID: firstDraft.spaceID,
                title: firstDraft.title,
                notes: firstDraft.detail,
                scheduledStart: firstDraft.start,
                durationMinutes: firstDraft.durationMinutes,
                planID: UUID(),
                linkedAssignmentID: firstDraft.linkedAssignmentID,
                linkedMasteryRecordID: firstDraft.linkedMasteryRecordID,
                linkedSourceID: firstDraft.linkedSourceID
            )
        ])[0]
        precondition(planned.calendarEventIdentifier == nil)
        precondition(planned.linkedAssignmentID == firstDraft.linkedAssignmentID)
        try store.linkCalendarEvent("event-123", calendarName: "Google Calendar · School", to: planned.id)
        let revisedStart = planStart.addingTimeInterval(3_600)
        let didUpdatePlannedSession = try store.updatePlannedSession(
            id: planned.id,
            title: "Revised study block",
            notes: "Revised notes",
            scheduledStart: revisedStart,
            durationMinutes: 60
        )
        precondition(didUpdatePlannedSession)
        precondition(planned.scheduledStart == revisedStart)
        precondition(planned.plannedDurationMinutes == 60)
        precondition(planned.calendarEventIdentifier == "event-123")
        let ics = String(decoding: StudyCalendarICS.data(sessions: [planned], spaceTitles: [planned.spaceID: "Test Class"]), as: UTF8.self)
        precondition(ics.contains("BEGIN:VCALENDAR"))
        precondition(ics.contains(planned.id.uuidString))
        precondition(ics.contains("DESCRIPTION:The Desk · Test Class\\n"))
        precondition(!ics.contains("Test Class\\\\n"))
        precondition(ics.components(separatedBy: "\r\n").allSatisfy { $0.utf8.count <= 75 })
        precondition(StudyCalendarConnector.ownsLinkedEvent(notes: "Study block ID: \(planned.id.uuidString)", sessionID: planned.id))
        precondition(!StudyCalendarConnector.ownsLinkedEvent(notes: "Unrelated event", sessionID: planned.id))

        let actionAnchor = SourceAnchor(sourceID: store.sources[0].id, revision: 1, page: 3, excerpt: "Submit the graph corrections.")
        let approvedAssignments = try store.addAssignments([
            AssignmentInput(
                spaceID: store.spaces[0].id,
                title: "Submit graph corrections",
                detail: "Use the source-grounded note.",
                dueAt: planStart,
                priority: 2,
                sourceName: "Suggested from source",
                sourceAnchor: actionAnchor,
                originatingProvider: .localDemo,
                originatingModel: "local-action-scanner"
            )
        ])
        precondition(approvedAssignments.count == 1)
        precondition(approvedAssignments[0].sourceAnchor == actionAnchor)
        precondition(approvedAssignments[0].originatingProvider == .localDemo)
        precondition(approvedAssignments[0].originatingModel == "local-action-scanner")

        let lateText = Array(repeating: "Lecture discussion without follow-up.", count: 1_200).joined(separator: "\n")
            + "\n[[time:3672]]\nTODO submit the corrected lab graph before class."
        let lateSource = try await store.addSource(
            to: store.spaces[0].id,
            title: "Long Wispr meeting",
            kind: .wispr,
            filename: "wispr.txt",
            sha256: SHA256Digest.hex(Data(lateText.utf8)),
            extractedText: lateText,
            connector: "Wispr Flow"
        )
        guard let lateRevision = store.latestRevision(for: lateSource.id) else { fatalError("Missing late-action revision") }
        let extractor = StudyActionExtractor(harness: AIHarness(providers: [.localDemo: LocalPreviewProvider()]))
        let extracted = try await extractor.extract(
            source: lateSource,
            revision: lateRevision,
            space: store.spaces[0],
            override: .provider(.localDemo)
        )
        let lateAction = extracted.actions.first { $0.title.localizedCaseInsensitiveContains("submit") }
        precondition(lateAction?.sourceAnchor?.timestamp == 3_672)
        precondition(lateAction?.sourceAnchor?.revision == lateRevision.revisionNumber)

        print("The Desk core smoke: PASS")
    }
}
