import Foundation

public struct QueueDrainSummary: Sendable {
    public var processed: Int
    public var failed: Int
}

actor QueueLeaseMonitor {
    private var expiresAt: Date
    private var isLost = false

    init(expiresAt: Date) {
        self.expiresAt = expiresAt
    }

    func renew(until expiresAt: Date) {
        guard !isLost else { return }
        self.expiresAt = expiresAt
    }

    func lose() {
        isLost = true
    }

    func requireValid(now: Date = Date()) throws {
        guard !isLost, expiresAt > now.addingTimeInterval(5) else {
            throw CloudCaptureError.leaseLost
        }
    }
}

/// Pulls typed companion jobs from private CloudKit. Deduplication is enforced both
/// by the CloudKit record name and by the source SHA-256 revision index.
@MainActor
public final class MacQueueProcessor {
    public static let shared = MacQueueProcessor()
    private var isDraining = false

    @discardableResult
    public func drain(into store: LearningHomeStore) async -> QueueDrainSummary {
        guard !isDraining else { return QueueDrainSummary(processed: 0, failed: 0) }
        isDraining = true
        defer { isDraining = false }

        do { try store.preflightDurableWrite() }
        catch { return QueueDrainSummary(processed: 0, failed: 0) }

        let queue = CloudCaptureQueue.shared
        let captures: [CloudQueuedCapture]
        do { captures = try await queue.fetchPending() }
        catch { return QueueDrainSummary(processed: 0, failed: 0) }

        var processed = 0
        var failed = 0
        for capture in captures {
            if store.jobs.first(where: { $0.idempotencyKey == capture.id })?.state == .completed {
                do {
                    try await queue.removeDownloadedAsset(for: capture)
                    _ = try await queue.acknowledgeLocallyCompleted(capture.id)
                } catch {
                    // Keep the Cloud record retryable until both reconciliation
                    // and local cleanup can be verified on a later drain.
                }
                continue
            }

            let lease: CloudCaptureLease
            do {
                guard let claimed = try await queue.claim(capture.id) else { continue }
                lease = claimed
            } catch {
                failed += 1
                continue
            }

            do {
                if store.jobs.contains(where: { $0.idempotencyKey == capture.id }) {
                    try store.updateJob(idempotencyKey: capture.id, state: .processing)
                } else {
                    try store.createJob(
                        kind: capture.kind.rawValue,
                        payload: Data(),
                        state: .processing,
                        idempotencyKey: capture.id
                    )
                }
            } catch {
                _ = await fail(lease, through: queue, message: error.localizedDescription)
                failed += 1
                continue
            }

            let leaseMonitor = QueueLeaseMonitor(expiresAt: lease.expiresAt)
            let work = Task { @MainActor in
                try await self.process(capture, store: store, leaseMonitor: leaseMonitor)
            }
            let heartbeat = Task<Void, Never> {
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(CloudQueuePolicy.heartbeatInterval)) }
                    catch { return }
                    do {
                        guard let expiresAt = try await queue.heartbeat(lease) else {
                            await leaseMonitor.lose()
                            work.cancel()
                            return
                        }
                        await leaseMonitor.renew(until: expiresAt)
                    } catch {
                        await leaseMonitor.lose()
                        work.cancel()
                        return
                    }
                }
            }

            let result = await work.result
            heartbeat.cancel()
            await heartbeat.value
            if case .failure(let error) = result {
                let cloudState = await fail(lease, through: queue, message: error.localizedDescription)
                do {
                    try store.updateJob(
                        idempotencyKey: capture.id,
                        state: cloudState,
                        error: error.localizedDescription
                    )
                } catch {
                    // The Cloud lease still carries the retry/final state. A
                    // local persistence recovery must succeed before work resumes.
                }
                failed += 1
                continue
            }

            // Commit the local terminal state before acknowledging CloudKit.
            // If the network drops here, redelivery is reconciled above without
            // rerunning any source, provider, or canvas side effect.
            do {
                guard let expiresAt = try await queue.heartbeat(lease) else {
                    throw CloudCaptureError.leaseLost
                }
                await leaseMonitor.renew(until: expiresAt)
                try store.updateJob(idempotencyKey: capture.id, state: .completed)
            } catch {
                let message = "Queue completion could not be committed safely: \(error.localizedDescription)"
                let cloudState = await fail(
                    lease,
                    through: queue,
                    message: message
                )
                do { try store.updateJob(idempotencyKey: capture.id, state: cloudState, error: message) }
                catch { /* CloudKit retains the authoritative retry state. */ }
                failed += 1
                continue
            }
            do {
                try await queue.removeDownloadedAsset(for: capture)
                _ = try await queue.complete(lease)
            } catch {
                // The durable completed marker makes the next delivery an ack-only pass.
            }
            processed += 1
        }
        return QueueDrainSummary(processed: processed, failed: failed)
    }

    private func process(
        _ capture: CloudQueuedCapture,
        store: LearningHomeStore,
        leaseMonitor: QueueLeaseMonitor
    ) async throws {
        try Task.checkCancellation()
        try await leaseMonitor.requireValid()
        guard store.space(id: capture.spaceID) != nil else { throw CloudCaptureError.invalidRecord }
        switch capture.kind {
        case .studyQuestion:
            try await processStudyQuestion(capture, store: store, leaseMonitor: leaseMonitor)
        case .visualizeTask:
            try await processVisualization(capture, store: store, leaseMonitor: leaseMonitor)
        case .file:
            guard let fileURL = capture.fileURL else { throw CloudCaptureError.invalidRecord }
            let prepared = try await SourceIngestionService.shared.prepare(fileURL)
            try Task.checkCancellation()
            try await leaseMonitor.requireValid()
            _ = try await store.importPreparedSource(prepared, into: capture.spaceID, connector: "iPhone capture")
        case .note, .url:
            try Task.checkCancellation()
            try await leaseMonitor.requireValid()
            let kind: SourceKind = capture.kind == .url ? .url : .note
            _ = try await store.addSource(
                to: capture.spaceID,
                title: capture.title,
                kind: kind,
                filename: kind == .url ? "link.url" : "capture.txt",
                sha256: SHA256Digest.hex(Data(capture.text.utf8)),
                extractedText: capture.text,
                connector: "iPhone capture"
            )
        }
    }

    private func processStudyQuestion(
        _ capture: CloudQueuedCapture,
        store: LearningHomeStore,
        leaseMonitor: QueueLeaseMonitor
    ) async throws {
        guard let space = store.space(id: capture.spaceID) else { throw CloudCaptureError.invalidRecord }
        let outputFilename = "study-answer-\(capture.id).txt"
        guard !store.sources(in: capture.spaceID).contains(where: { $0.originalFilename == outputFilename }) else {
            return
        }
        try Task.checkCancellation()
        try await leaseMonitor.requireValid()
        let grounding = await grounding(query: capture.text, spaceID: capture.spaceID, store: store)
        let request = AIStudyRequest(
            spaceID: capture.spaceID,
            task: .tutor,
            prompt: capture.text,
            tutorStyle: space.tutorStyle,
            context: grounding.context,
            citations: grounding.citations,
            allowProviderKnowledge: true
        )
        let result = try await AIHarness.shared.execute(request)
        try Task.checkCancellation()
        try await leaseMonitor.requireValid()
        let body = """
        QUESTION
        \(capture.text)

        ANSWER
        \(result.response.text)

        PROVIDER
        \(result.provider.title) · \(result.response.model)
        """
        _ = try await store.addSource(
            to: capture.spaceID,
            title: capture.title.replacingOccurrences(of: "Question · ", with: "Answer · "),
            kind: .note,
            filename: outputFilename,
            sha256: SHA256Digest.hex(Data(body.utf8)),
            extractedText: body,
            connector: "The Desk tutor"
        )
        let run = ProviderRun(spaceID: capture.spaceID, provider: result.provider, modelName: result.response.model, task: StudyTaskKind.tutor.rawValue, prompt: capture.text)
        run.response = result.response.text
        run.citationsData = (try? JSONEncoder().encode(grounding.citations)) ?? Data()
        try Task.checkCancellation()
        try await leaseMonitor.requireValid()
        try store.recordProviderRun(run)
    }

    private func processVisualization(
        _ capture: CloudQueuedCapture,
        store: LearningHomeStore,
        leaseMonitor: QueueLeaseMonitor
    ) async throws {
        guard let space = store.space(id: capture.spaceID) else { throw CloudCaptureError.invalidRecord }
        guard let artifactID = deterministicArtifactID(for: capture.id) else { throw CloudCaptureError.invalidRecord }
        guard !store.canvases(in: capture.spaceID).contains(where: { $0.id == artifactID }) else { return }
        try Task.checkCancellation()
        try await leaseMonitor.requireValid()
        let grounding = await grounding(query: capture.text, spaceID: capture.spaceID, store: store)
        let request = AIStudyRequest(
            spaceID: capture.spaceID,
            task: .visualize,
            prompt: capture.text,
            tutorStyle: space.tutorStyle,
            context: grounding.context,
            citations: grounding.citations,
            allowProviderKnowledge: true
        )
        let result = try await StudySceneGenerator.shared.generate(request: request)
        try Task.checkCancellation()
        try await leaseMonitor.requireValid()
        let signature = store.sources(in: capture.spaceID).compactMap { source in
            store.latestRevision(for: source.id).map { "\(source.id.uuidString.prefix(8)):\($0.revisionNumber)" }
        }.sorted().joined(separator: ",")
        let artifact = CanvasArtifact(
            id: artifactID,
            spaceID: capture.spaceID,
            title: result.spec.title,
            spec: result.spec,
            sourceRevisionSignature: signature
        )
        try store.saveCanvas(artifact)
        let run = ProviderRun(spaceID: capture.spaceID, provider: result.provider, modelName: result.model, task: StudyTaskKind.visualize.rawValue, prompt: capture.text)
        run.response = "Created canvas \(result.spec.title)"
        run.citationsData = (try? JSONEncoder().encode(result.spec.citations)) ?? Data()
        try Task.checkCancellation()
        try await leaseMonitor.requireValid()
        try store.recordProviderRun(run)
    }

    private func fail(
        _ lease: CloudCaptureLease,
        through queue: CloudCaptureQueue,
        message: String
    ) async -> SyncJobState {
        do {
            return try await queue.fail(lease, error: message) ?? .failedRetryable
        } catch {
            return .failedRetryable
        }
    }

    private func deterministicArtifactID(for captureID: String) -> UUID? {
        guard CloudCaptureValidation.isValidRecordName(captureID) else { return nil }
        let value = String(captureID.prefix(32))
        let formatted = "\(value.prefix(8))-\(value.dropFirst(8).prefix(4))-\(value.dropFirst(12).prefix(4))-\(value.dropFirst(16).prefix(4))-\(value.dropFirst(20).prefix(12))"
        return UUID(uuidString: formatted)
    }

    private struct Grounding {
        var context: String
        var citations: [StudyCitation]
    }

    private func grounding(query: String, spaceID: UUID, store: LearningHomeStore) async -> Grounding {
        let sources = store.sources(in: spaceID)
        let hits = (try? await StudySearchService.shared.search(query, sourceIDs: Set(sources.map(\.id)), limit: 6)) ?? []
        if !hits.isEmpty {
            let context = hits.compactMap { hit -> String? in
                guard let source = sources.first(where: { $0.id == hit.sourceID }) else { return nil }
                let location = hit.page.map { "page \($0)" } ?? hit.timestamp.map { "time \(Int($0))s" } ?? "source excerpt"
                return "SOURCE: \(source.title) · \(location)\n\(hit.excerpt)"
            }.joined(separator: "\n\n")
            let citations = hits.compactMap { hit -> StudyCitation? in
                guard let source = sources.first(where: { $0.id == hit.sourceID }) else { return nil }
                return StudyCitation(
                    label: source.title,
                    origin: source.connectorName == "Local" ? .classSource : .connector,
                    anchor: SourceAnchor(sourceID: source.id, revision: hit.revision, page: hit.page, timestamp: hit.timestamp, excerpt: hit.excerpt)
                )
            }
            return Grounding(context: context, citations: citations)
        }

        return Grounding(
            context: "No relevant class passage matched this queued request. Any answer must be labeled as provider knowledge, not class-grounded evidence.",
            citations: [StudyCitation(label: "No matching class passage; provider knowledge may be uncited", origin: .modelKnowledge)]
        )
    }
}
