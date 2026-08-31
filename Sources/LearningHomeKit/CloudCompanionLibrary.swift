@preconcurrency import CloudKit
import Foundation

/// Mirrors a privacy-filtered, read-oriented library snapshot through the user's
/// private CloudKit database. The Mac publishes; companion devices cache and view.
public actor CloudCompanionLibrary {
    public static let shared = CloudCompanionLibrary()

    private let database: CKDatabase?
    private let recordID = CKRecord.ID(recordName: "current-library-v1")
    private let recordType = "TheDeskLibraryMirror"

    public init(container: CKContainer? = TheDeskCloudConfiguration.entitledContainer()) {
        database = container?.privateCloudDatabase
    }

    public func publish(snapshotData: Data) async throws {
        guard !snapshotData.isEmpty else { return }
        guard let database else { throw CloudCaptureError.notConfigured }
        let digest = SHA256Digest.hex(snapshotData)
        let existing = try? await database.record(for: recordID)
        if existing?["sha256"] as? String == digest { return }
        let staging = FileManager.default.temporaryDirectory
            .appendingPathComponent("TheDeskLibraryMirror", isDirectory: true)
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        let assetURL = staging.appendingPathComponent("\(UUID().uuidString).json")
        try snapshotData.write(to: assetURL, options: [.atomic, .completeFileProtectionUnlessOpen])
        defer { try? FileManager.default.removeItem(at: assetURL) }

        let record = existing ?? CKRecord(recordType: recordType, recordID: recordID)
        record["schemaVersion"] = 1 as CKRecordValue
        record["updatedAt"] = Date() as CKRecordValue
        record["sha256"] = digest as CKRecordValue
        record["snapshot"] = CKAsset(fileURL: assetURL)
        _ = try await database.save(record)
    }

    public func fetchLatestData() async -> Data? {
        guard let database else { return cachedData() }
        do {
            let record = try await database.record(for: recordID)
            guard let asset = record["snapshot"] as? CKAsset,
                  let url = asset.fileURL else { return cachedData() }
            let data = try Data(contentsOf: url)
            try cache(data)
            return data
        } catch {
            return cachedData()
        }
    }

    private func cache(_ data: Data) throws {
        let url = try cacheURL()
        try data.write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
    }

    private func cachedData() -> Data? {
        guard let url = try? cacheURL() else { return nil }
        return try? Data(contentsOf: url)
    }

    private func cacheURL() throws -> URL {
        guard let applicationSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw CloudCaptureError.invalidRecord
        }
        let root = applicationSupport.appendingPathComponent("TheDesk/CompanionCache", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root.appendingPathComponent("library.json")
    }
}
