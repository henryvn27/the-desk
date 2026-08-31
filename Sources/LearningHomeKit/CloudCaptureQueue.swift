@preconcurrency import CloudKit
import Foundation
import Security

public enum CloudCaptureKind: String, Codable, CaseIterable, Sendable {
    case note, url, file, studyQuestion, visualizeTask
}

public struct CloudQueuedCapture: Identifiable, Sendable {
    public var id: String
    public var kind: CloudCaptureKind
    public var spaceID: UUID
    public var title: String
    public var text: String
    public var fileURL: URL?
    public var createdAt: Date
}

struct CloudCaptureLease: Sendable {
    var captureID: String
    var token: String
    var expiresAt: Date
}

enum CloudQueuePolicy {
    static let maximumAttempts = 5
    static let leaseDuration: TimeInterval = 5 * 60
    static let staleProcessingInterval: TimeInterval = 10 * 60
    static let heartbeatInterval: TimeInterval = 60
    private static let baseRetryDelay: TimeInterval = 15
    private static let maximumRetryDelay: TimeInterval = 15 * 60

    static func retryDelay(afterAttempt attempt: Int) -> TimeInterval {
        let boundedAttempt = max(1, min(attempt, maximumAttempts))
        return min(baseRetryDelay * pow(2, Double(boundedAttempt - 1)), maximumRetryDelay)
    }

    static func isEligible(
        state: SyncJobState,
        updatedAt: Date?,
        nextRetryAt: Date?,
        leaseExpiresAt: Date?,
        now: Date
    ) -> Bool {
        switch state {
        case .queued, .waitingForMac:
            return true
        case .failedRetryable:
            return nextRetryAt.map { $0 <= now } ?? true
        case .processing:
            if let leaseExpiresAt { return leaseExpiresAt <= now }
            return updatedAt.map { $0 <= now.addingTimeInterval(-staleProcessingInterval) } ?? true
        case .needsAuthentication, .failedFinal, .completed:
            return false
        }
    }

    static func failureState(afterAttempt attempt: Int) -> SyncJobState {
        attempt >= maximumAttempts ? .failedFinal : .failedRetryable
    }
}

enum CloudCaptureValidation {
    static let maximumTitleCharacters = 240
    static let maximumTextCharacters = 200_000
    static let maximumTextBytes = 750 * 1_024
    static let maximumFileBytes: Int64 = 200 * 1_024 * 1_024

    static func kind(_ rawValue: String) -> CloudCaptureKind? {
        CloudCaptureKind(rawValue: rawValue)
    }

    static func title(_ value: String) -> String {
        let cleaned = value
            .components(separatedBy: .controlCharacters)
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let bounded = String(cleaned.prefix(maximumTitleCharacters))
        return bounded.isEmpty ? "Untitled capture" : bounded
    }

    static func isValidRecordName(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy {
            (48...57).contains($0) || (97...102).contains($0)
        }
    }

    static func spaceID(_ value: String) -> UUID? {
        guard value.count == 36, let id = UUID(uuidString: value), id.uuidString == value.uppercased() else {
            return nil
        }
        return id
    }

    static func idempotencyKey(
        kind: CloudCaptureKind,
        spaceID: UUID,
        title: String,
        text: String,
        sha256: String? = nil,
        operationID: UUID? = nil
    ) -> String? {
        if kind == .file {
            guard let sha256, isValidRecordName(sha256) else { return nil }
            return SHA256Digest.hex(Data("\(spaceID.uuidString)|file|\(sha256)".utf8))
        }
        if kind == .studyQuestion || kind == .visualizeTask {
            guard let operationID else { return nil }
            return SHA256Digest.hex(Data("\(spaceID.uuidString)|\(kind.rawValue)|\(operationID.uuidString)|\(title)|\(text)".utf8))
        }
        return SHA256Digest.hex(Data("\(spaceID.uuidString)|\(kind.rawValue)|\(title)|\(text)".utf8))
    }

    static func legacyIdempotencyKey(
        kind: CloudCaptureKind,
        spaceID: UUID,
        title: String,
        text: String,
        sha256: String? = nil
    ) -> String? {
        if kind == .file {
            guard let sha256, isValidRecordName(sha256) else { return nil }
            return SHA256Digest.hex(Data("\(spaceID.uuidString)|file|\(sha256)".utf8))
        }
        return SHA256Digest.hex(Data("\(spaceID.uuidString)|\(kind.rawValue)|\(title)|\(text)".utf8))
    }

    static func expectedRecordName(
        schemaVersion: Int,
        kind: CloudCaptureKind,
        spaceID: UUID,
        title: String,
        text: String,
        sha256: String?,
        operationID: UUID?
    ) -> String? {
        if schemaVersion == 1 {
            return legacyIdempotencyKey(
                kind: kind,
                spaceID: spaceID,
                title: title,
                text: text,
                sha256: sha256
            )
        }
        guard schemaVersion == 2 else { return nil }
        return idempotencyKey(
            kind: kind,
            spaceID: spaceID,
            title: title,
            text: text,
            sha256: sha256,
            operationID: operationID
        )
    }

    static func isTextWithinBounds(_ text: String) -> Bool {
        text.count <= maximumTextCharacters && text.utf8.count <= maximumTextBytes
    }

    static func assetFilename(recordName: String, title: String) -> String {
        let rawExtension = URL(fileURLWithPath: title).pathExtension.lowercased()
        let safeExtension = rawExtension.count <= 12 && rawExtension.utf8.allSatisfy {
            (48...57).contains($0) || (97...122).contains($0)
        }
            ? rawExtension
            : ""
        return safeExtension.isEmpty ? recordName : "\(recordName).\(safeExtension)"
    }

    static func isScoped(_ candidate: URL, inside root: URL) -> Bool {
        let rootPath = root.standardizedFileURL.resolvingSymlinksInPath().path
        let candidatePath = candidate.standardizedFileURL.resolvingSymlinksInPath().path
        return candidatePath == rootPath || candidatePath.hasPrefix(rootPath + "/")
    }
}

public enum CloudCaptureError: Error, LocalizedError {
    case fileTooLarge
    case textTooLarge
    case invalidRecord
    case invalidKind
    case leaseLost
    case notConfigured

    public var errorDescription: String? {
        switch self {
        case .fileTooLarge: "This capture exceeds the 200 MB companion-upload limit. Import it on the Mac instead."
        case .textTooLarge: "This text capture is too large to queue safely. Save it as a file and upload the file instead."
        case .invalidRecord: "A queued capture was missing required metadata."
        case .invalidKind: "This capture type is not supported."
        case .leaseLost: "This queued capture's processing lease was lost. It will retry safely."
        case .notConfigured: "Private iCloud sync is not configured for this build. Captures remain safely queued on this device."
        }
    }
}

public enum TheDeskCloudConfiguration {
    public static var containerIdentifier: String {
        Bundle.main.object(forInfoDictionaryKey: "TheDeskCloudContainerIdentifier") as? String
            ?? "iCloud.com.example.thedesk"
    }

    /// CloudKit raises an Objective-C exception—not a Swift error—when a process
    /// constructs a container without the matching signed entitlement. Check the
    /// code signature first so local/ad-hoc builds remain usable and offline.
    public static func entitledContainer() -> CKContainer? {
        guard hasContainerEntitlement else { return nil }
        return CKContainer(identifier: containerIdentifier)
    }

    public static var hasContainerEntitlement: Bool {
        guard let task = SecTaskCreateFromSelf(nil) else { return false }
        let key: CFString = "com.apple.developer.icloud-container-identifiers" as NSString
        guard let values = SecTaskCopyValueForEntitlement(task, key, nil) as? [String] else { return false }
        return values.contains(containerIdentifier)
    }
}

/// A typed private-CloudKit queue. It stores capture commands and assets, never executable code.
public actor CloudCaptureQueue {
    public static let shared = CloudCaptureQueue()

    private let database: CKDatabase?
    private let recordType = "TheDeskSyncJob"

    struct OutboxItem: Codable, Sendable {
        var id: String
        var kind: String
        var spaceID: UUID
        var title: String
        var text: String
        var sha256: String?
        var assetPath: String?
        var operationID: UUID?
        var createdAt: Date

        var inferredSchemaVersion: Int {
            guard let captureKind = CloudCaptureValidation.kind(kind) else { return 0 }
            if captureKind == .studyQuestion || captureKind == .visualizeTask {
                return operationID == nil ? 1 : 2
            }
            return 1
        }
    }

    public init(container: CKContainer? = TheDeskCloudConfiguration.entitledContainer()) {
        database = container?.privateCloudDatabase
    }

    @discardableResult
    public func enqueueText(_ text: String, title: String, spaceID: UUID, kind: String) async throws -> String {
        guard let captureKind = CloudCaptureValidation.kind(kind), captureKind != .file else {
            throw CloudCaptureError.invalidKind
        }
        let safeTitle = CloudCaptureValidation.title(title)
        guard CloudCaptureValidation.isTextWithinBounds(text) else { throw CloudCaptureError.textTooLarge }
        let operationID = captureKind == .studyQuestion || captureKind == .visualizeTask ? UUID() : nil
        guard let idempotencyKey = CloudCaptureValidation.idempotencyKey(
            kind: captureKind,
            spaceID: spaceID,
            title: safeTitle,
            text: text,
            operationID: operationID
        ) else { throw CloudCaptureError.invalidRecord }
        try stage(OutboxItem(
            id: idempotencyKey,
            kind: captureKind.rawValue,
            spaceID: spaceID,
            title: safeTitle,
            text: text,
            operationID: operationID,
            createdAt: Date()
        ))
        _ = await flushLocalOutbox()
        return idempotencyKey
    }

    @discardableResult
    public func enqueueFile(_ url: URL, spaceID: UUID) async throws -> String {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        let size = try regularFileSize(at: url)
        guard size <= CloudCaptureValidation.maximumFileBytes else { throw CloudCaptureError.fileTooLarge }

        let digest = try SHA256Digest.hex(fileURL: url)
        guard let idempotencyKey = CloudCaptureValidation.idempotencyKey(
            kind: .file,
            spaceID: spaceID,
            title: "",
            text: "",
            sha256: digest
        ) else { throw CloudCaptureError.invalidRecord }
        let assetURL = try outboxAssetURL(id: idempotencyKey, source: url)
        if FileManager.default.fileExists(atPath: assetURL.path),
           (try? regularFileSize(at: assetURL)) != size || (try? SHA256Digest.hex(fileURL: assetURL)) != digest {
            try FileManager.default.removeItem(at: assetURL)
        }
        if !FileManager.default.fileExists(atPath: assetURL.path) {
            try FileManager.default.copyItem(at: url, to: assetURL)
        }
        do {
            guard try regularFileSize(at: assetURL) == size,
                  size <= CloudCaptureValidation.maximumFileBytes,
                  try SHA256Digest.hex(fileURL: assetURL) == digest else {
                throw CloudCaptureError.invalidRecord
            }
        } catch {
            try? FileManager.default.removeItem(at: assetURL)
            throw error
        }
        try stage(OutboxItem(
            id: idempotencyKey,
            kind: CloudCaptureKind.file.rawValue,
            spaceID: spaceID,
            title: CloudCaptureValidation.title(url.lastPathComponent),
            text: "",
            sha256: digest,
            assetPath: assetURL.path,
            createdAt: Date()
        ))
        _ = await flushLocalOutbox()
        return idempotencyKey
    }

    /// Uploads captures staged on this device. Failed uploads remain durable and
    /// retry the next time the companion opens or another capture is made.
    @discardableResult
    public func flushLocalOutbox() async -> Int {
        var items = (try? readOutbox()) ?? []
        var uploaded = 0
        for item in items {
            do {
                try await upload(item)
                items.removeAll { $0.id == item.id }
                try writeOutbox(items)
                if let assetPath = item.assetPath { try? FileManager.default.removeItem(atPath: assetPath) }
                uploaded += 1
            } catch {
                // CloudKit authentication and connectivity can recover later. The
                // local command and its asset remain intact until an upload succeeds.
            }
        }
        return uploaded
    }

    public func fetchPending(limit: Int = 25) async throws -> [CloudQueuedCapture] {
        guard let database else { throw CloudCaptureError.notConfigured }
        let predicate = NSPredicate(format: "state IN %@", [
            SyncJobState.queued.rawValue,
            SyncJobState.waitingForMac.rawValue,
            SyncJobState.failedRetryable.rawValue,
            SyncJobState.processing.rawValue,
        ])
        let query = CKQuery(recordType: recordType, predicate: predicate)
        query.sortDescriptors = [NSSortDescriptor(key: "createdAt", ascending: true)]
        let requestedLimit = max(1, min(limit, 100))
        var page = try await database.records(matching: query, resultsLimit: 100)
        var captures: [CloudQueuedCapture] = []
        let now = Date()
        while true {
            for (_, recordResult) in page.matchResults {
                guard case .success(let record) = recordResult else { continue }
                guard captures.count < requestedLimit else { break }
                guard CloudCaptureValidation.isValidRecordName(record.recordID.recordName),
                      [1, 2].contains(integer(record["schemaVersion"])),
                      record["idempotencyKey"] as? String == record.recordID.recordName,
                      let rawKind = record["kind"] as? String,
                      let kind = CloudCaptureValidation.kind(rawKind),
                      let rawSpaceID = record["spaceID"] as? String,
                      let spaceID = CloudCaptureValidation.spaceID(rawSpaceID),
                      let rawTitle = record["title"] as? String,
                      let createdAt = record["createdAt"] as? Date,
                      let rawState = record["state"] as? String,
                      let state = SyncJobState(rawValue: rawState),
                      CloudQueuePolicy.isEligible(
                        state: state,
                        updatedAt: record["updatedAt"] as? Date,
                        nextRetryAt: record["nextRetryAt"] as? Date,
                        leaseExpiresAt: record["leaseExpiresAt"] as? Date,
                        now: now
                      ) else { continue }

                let title = CloudCaptureValidation.title(rawTitle)
                let text = record["text"] as? String ?? ""
                guard CloudCaptureValidation.isTextWithinBounds(text) else { continue }
                let operationID = (record["operationID"] as? String).flatMap(UUID.init(uuidString:))
                let schemaVersion = integer(record["schemaVersion"])
                guard CloudCaptureValidation.expectedRecordName(
                    schemaVersion: schemaVersion,
                    kind: kind,
                    spaceID: spaceID,
                    title: title,
                    text: text,
                    sha256: record["sha256"] as? String,
                    operationID: operationID
                ) == record.recordID.recordName else { continue }

                var localFile: URL?
                if kind == .file {
                    do { localFile = try materializeAsset(from: record, title: title) }
                    catch { continue }
                } else if record["asset"] != nil {
                    continue
                }
                captures.append(CloudQueuedCapture(
                    id: record.recordID.recordName,
                    kind: kind,
                    spaceID: spaceID,
                    title: title,
                    text: text,
                    fileURL: localFile,
                    createdAt: createdAt
                ))
            }
            guard captures.count < requestedLimit, let cursor = page.queryCursor else { break }
            page = try await database.records(continuingMatchFrom: cursor, resultsLimit: 100)
        }
        return captures
    }

    func claim(_ captureID: String, now: Date = Date()) async throws -> CloudCaptureLease? {
        guard CloudCaptureValidation.isValidRecordName(captureID) else { throw CloudCaptureError.invalidRecord }
        guard let database else { throw CloudCaptureError.notConfigured }
        let id = CKRecord.ID(recordName: captureID)
        let record = try await database.record(for: id)
        guard let rawState = record["state"] as? String,
              let state = SyncJobState(rawValue: rawState),
              CloudQueuePolicy.isEligible(
                state: state,
                updatedAt: record["updatedAt"] as? Date,
                nextRetryAt: record["nextRetryAt"] as? Date,
                leaseExpiresAt: record["leaseExpiresAt"] as? Date,
                now: now
              ) else { return nil }

        let priorAttempt = max(0, min(integer(record["attemptCount"]), CloudQueuePolicy.maximumAttempts))
        let attempt = priorAttempt + 1
        guard attempt <= CloudQueuePolicy.maximumAttempts else {
            record["state"] = SyncJobState.failedFinal.rawValue as CKRecordValue
            record["updatedAt"] = now as CKRecordValue
            record["error"] = "Retry limit reached." as CKRecordValue
            record["leaseToken"] = nil
            record["leaseExpiresAt"] = nil
            _ = try await database.save(record)
            return nil
        }

        let token = UUID().uuidString
        let expiresAt = now.addingTimeInterval(CloudQueuePolicy.leaseDuration)
        record["state"] = SyncJobState.processing.rawValue as CKRecordValue
        record["attemptCount"] = Int64(attempt) as CKRecordValue
        record["leaseToken"] = token as CKRecordValue
        record["leaseExpiresAt"] = expiresAt as CKRecordValue
        record["updatedAt"] = now as CKRecordValue
        record["nextRetryAt"] = nil
        record["error"] = "" as CKRecordValue
        do {
            _ = try await database.save(record)
            return CloudCaptureLease(captureID: captureID, token: token, expiresAt: expiresAt)
        } catch let error as CKError where error.code == .serverRecordChanged {
            return nil
        }
    }

    func heartbeat(_ lease: CloudCaptureLease, now: Date = Date()) async throws -> Date? {
        guard let database else { throw CloudCaptureError.notConfigured }
        let record = try await database.record(for: CKRecord.ID(recordName: lease.captureID))
        guard record["state"] as? String == SyncJobState.processing.rawValue,
              record["leaseToken"] as? String == lease.token else { return nil }
        let expiresAt = now.addingTimeInterval(CloudQueuePolicy.leaseDuration)
        record["leaseExpiresAt"] = expiresAt as CKRecordValue
        record["updatedAt"] = now as CKRecordValue
        do {
            _ = try await database.save(record)
            return expiresAt
        } catch let error as CKError where error.code == .serverRecordChanged {
            return nil
        }
    }

    func complete(_ lease: CloudCaptureLease, now: Date = Date()) async throws -> Bool {
        guard let database else { throw CloudCaptureError.notConfigured }
        let record = try await database.record(for: CKRecord.ID(recordName: lease.captureID))
        if record["state"] as? String == SyncJobState.completed.rawValue { return true }
        guard record["state"] as? String == SyncJobState.processing.rawValue,
              record["leaseToken"] as? String == lease.token else { return false }
        applyCompletedState(to: record, now: now)
        do {
            _ = try await database.save(record)
            return true
        } catch let error as CKError where error.code == .serverRecordChanged {
            return false
        }
    }

    func fail(_ lease: CloudCaptureLease, error: String, now: Date = Date()) async throws -> SyncJobState? {
        guard let database else { throw CloudCaptureError.notConfigured }
        let record = try await database.record(for: CKRecord.ID(recordName: lease.captureID))
        guard record["state"] as? String == SyncJobState.processing.rawValue,
              record["leaseToken"] as? String == lease.token else { return nil }
        let attempt = max(1, min(integer(record["attemptCount"]), CloudQueuePolicy.maximumAttempts))
        let state = CloudQueuePolicy.failureState(afterAttempt: attempt)
        record["state"] = state.rawValue as CKRecordValue
        record["updatedAt"] = now as CKRecordValue
        record["error"] = String(error.prefix(2_000)) as CKRecordValue
        record["leaseToken"] = nil
        record["leaseExpiresAt"] = nil
        record["nextRetryAt"] = state == .failedRetryable
            ? now.addingTimeInterval(CloudQueuePolicy.retryDelay(afterAttempt: attempt)) as CKRecordValue
            : nil
        do {
            _ = try await database.save(record)
            return state
        } catch let cloudError as CKError where cloudError.code == .serverRecordChanged {
            return nil
        }
    }

    /// Reconciles a CloudKit redelivery after the canonical Mac store already
    /// committed the job. A completed job is terminal and can never regress.
    func acknowledgeLocallyCompleted(_ captureID: String, now: Date = Date()) async throws -> Bool {
        guard CloudCaptureValidation.isValidRecordName(captureID) else { throw CloudCaptureError.invalidRecord }
        guard let database else { throw CloudCaptureError.notConfigured }
        let record = try await database.record(for: CKRecord.ID(recordName: captureID))
        if record["state"] as? String == SyncJobState.completed.rawValue { return true }
        if record["state"] as? String == SyncJobState.processing.rawValue,
           !CloudQueuePolicy.isEligible(
            state: .processing,
            updatedAt: record["updatedAt"] as? Date,
            nextRetryAt: nil,
            leaseExpiresAt: record["leaseExpiresAt"] as? Date,
            now: now
           ) {
            return false
        }
        applyCompletedState(to: record, now: now)
        do {
            _ = try await database.save(record)
            return true
        } catch let error as CKError where error.code == .serverRecordChanged {
            return false
        }
    }

    func removeDownloadedAsset(for capture: CloudQueuedCapture) throws {
        guard let fileURL = capture.fileURL else { return }
        let root = try downloadedAssetRoot()
        guard CloudCaptureValidation.isScoped(fileURL, inside: root),
              fileURL.lastPathComponent == CloudCaptureValidation.assetFilename(
                recordName: capture.id,
                title: capture.title
              ) else {
            throw CloudCaptureError.invalidRecord
        }
        if FileManager.default.fileExists(atPath: fileURL.path) {
            try FileManager.default.removeItem(at: fileURL)
        }
    }

    private func baseRecord(
        idempotencyKey: String,
        schemaVersion: Int,
        kind: String,
        spaceID: UUID,
        title: String
    ) -> CKRecord {
        let record = CKRecord(recordType: recordType, recordID: CKRecord.ID(recordName: idempotencyKey))
        record["schemaVersion"] = schemaVersion as CKRecordValue
        record["idempotencyKey"] = idempotencyKey as CKRecordValue
        record["kind"] = kind as CKRecordValue
        record["spaceID"] = spaceID.uuidString as CKRecordValue
        record["title"] = title as CKRecordValue
        record["state"] = SyncJobState.waitingForMac.rawValue as CKRecordValue
        record["attemptCount"] = 0 as CKRecordValue
        record["createdAt"] = Date() as CKRecordValue
        record["updatedAt"] = Date() as CKRecordValue
        return record
    }

    private func upload(_ item: OutboxItem) async throws {
        guard let database else { throw CloudCaptureError.notConfigured }
        guard CloudCaptureValidation.isValidRecordName(item.id),
              let kind = CloudCaptureValidation.kind(item.kind),
              CloudCaptureValidation.isTextWithinBounds(item.text),
              CloudCaptureValidation.expectedRecordName(
                schemaVersion: item.inferredSchemaVersion,
                kind: kind,
                spaceID: item.spaceID,
                title: CloudCaptureValidation.title(item.title),
                text: item.text,
                sha256: item.sha256,
                operationID: item.operationID
              ) == item.id else { throw CloudCaptureError.invalidRecord }
        let schemaVersion = item.inferredSchemaVersion
        let record = baseRecord(
            idempotencyKey: item.id,
            schemaVersion: schemaVersion,
            kind: kind.rawValue,
            spaceID: item.spaceID,
            title: CloudCaptureValidation.title(item.title)
        )
        record["createdAt"] = item.createdAt as CKRecordValue
        if !item.text.isEmpty { record["text"] = item.text as CKRecordValue }
        if let sha256 = item.sha256 { record["sha256"] = sha256 as CKRecordValue }
        if let operationID = item.operationID { record["operationID"] = operationID.uuidString as CKRecordValue }
        if let assetPath = item.assetPath {
            guard FileManager.default.fileExists(atPath: assetPath) else { throw CloudCaptureError.invalidRecord }
            record["asset"] = CKAsset(fileURL: URL(fileURLWithPath: assetPath))
        }
        do {
            _ = try await database.save(record)
        } catch let error as CKError where error.code == .serverRecordChanged {
            let existing = try await database.record(for: record.recordID)
            guard integer(existing["schemaVersion"]) == schemaVersion,
                  existing["idempotencyKey"] as? String == item.id,
                  existing["kind"] as? String == kind.rawValue,
                  existing["spaceID"] as? String == item.spaceID.uuidString,
                  existing["title"] as? String == CloudCaptureValidation.title(item.title),
                  (existing["text"] as? String ?? "") == item.text,
                  existing["sha256"] as? String == item.sha256,
                  existing["operationID"] as? String == item.operationID?.uuidString else {
                throw CloudCaptureError.invalidRecord
            }
            // A matching deterministic record is a successful idempotent redelivery.
        }
    }

    private func stage(_ item: OutboxItem) throws {
        var items = try readOutbox()
        guard !items.contains(where: { $0.id == item.id }) else { return }
        items.append(item)
        try writeOutbox(items)
    }

    private func readOutbox() throws -> [OutboxItem] {
        let url = try outboxRoot().appendingPathComponent("outbox.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        return try JSONDecoder().decode([OutboxItem].self, from: Data(contentsOf: url))
    }

    private func writeOutbox(_ items: [OutboxItem]) throws {
        let url = try outboxRoot().appendingPathComponent("outbox.json")
        let data = try JSONEncoder().encode(items)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
    }

    private func outboxAssetURL(id: String, source: URL) throws -> URL {
        let root = try outboxRoot().appendingPathComponent("Assets", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let suffix = source.pathExtension.isEmpty ? "" : ".\(source.pathExtension.lowercased())"
        return root.appendingPathComponent("\(id)\(suffix)")
    }

    private func outboxRoot() throws -> URL {
        guard let applicationSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw CloudCaptureError.invalidRecord
        }
        let root = applicationSupport.appendingPathComponent("TheDesk/CloudOutbox", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private func downloadedAssetRoot() throws -> URL {
        guard let applicationSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw CloudCaptureError.invalidRecord
        }
        return applicationSupport.appendingPathComponent("TheDesk/CloudQueue", isDirectory: true)
    }

    private func materializeAsset(from record: CKRecord, title: String) throws -> URL {
        guard let expectedDigest = record["sha256"] as? String,
              CloudCaptureValidation.isValidRecordName(expectedDigest),
              let asset = record["asset"] as? CKAsset,
              let assetURL = asset.fileURL else { throw CloudCaptureError.invalidRecord }
        let size = try regularFileSize(at: assetURL)
        guard size <= CloudCaptureValidation.maximumFileBytes else { throw CloudCaptureError.fileTooLarge }

        let root = try downloadedAssetRoot()
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let destination = root.appendingPathComponent(
            CloudCaptureValidation.assetFilename(recordName: record.recordID.recordName, title: title),
            isDirectory: false
        )
        guard CloudCaptureValidation.isScoped(destination, inside: root) else { throw CloudCaptureError.invalidRecord }

        if FileManager.default.fileExists(atPath: destination.path),
           (try? regularFileSize(at: destination)) == size,
           (try? SHA256Digest.hex(fileURL: destination)) == expectedDigest {
            return destination
        }
        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }

        let staging = root.appendingPathComponent("\(record.recordID.recordName).\(UUID().uuidString).partial")
        guard CloudCaptureValidation.isScoped(staging, inside: root) else { throw CloudCaptureError.invalidRecord }
        defer { try? FileManager.default.removeItem(at: staging) }
        try FileManager.default.copyItem(at: assetURL, to: staging)
        guard try regularFileSize(at: staging) == size,
              size <= CloudCaptureValidation.maximumFileBytes,
              try SHA256Digest.hex(fileURL: staging) == expectedDigest else {
            throw CloudCaptureError.invalidRecord
        }
        try FileManager.default.moveItem(at: staging, to: destination)
        return destination
    }

    private func regularFileSize(at url: URL) throws -> Int64 {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              let size = attributes[.size] as? NSNumber else {
            throw CloudCaptureError.invalidRecord
        }
        return size.int64Value
    }

    private func integer(_ value: Any?) -> Int {
        if let value = value as? NSNumber { return value.intValue }
        if let value = value as? Int { return value }
        return 0
    }

    private func applyCompletedState(to record: CKRecord, now: Date) {
        record["state"] = SyncJobState.completed.rawValue as CKRecordValue
        record["updatedAt"] = now as CKRecordValue
        record["error"] = "" as CKRecordValue
        record["leaseToken"] = nil
        record["leaseExpiresAt"] = nil
        record["nextRetryAt"] = nil
    }
}
