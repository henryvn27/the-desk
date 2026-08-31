import Foundation
#if QUEUE_POLICY_SMOKE

@main
enum CloudQueuePolicySmoke {
    static func main() async {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        precondition(CloudQueuePolicy.retryDelay(afterAttempt: 1) == 15)
        precondition(CloudQueuePolicy.retryDelay(afterAttempt: 2) == 30)
        precondition(CloudQueuePolicy.failureState(afterAttempt: 5) == .failedFinal)
        precondition(!CloudQueuePolicy.isEligible(
            state: .failedRetryable,
            updatedAt: nil,
            nextRetryAt: now.addingTimeInterval(1),
            leaseExpiresAt: nil,
            now: now
        ))
        precondition(CloudQueuePolicy.isEligible(
            state: .processing,
            updatedAt: now,
            nextRetryAt: nil,
            leaseExpiresAt: now.addingTimeInterval(-1),
            now: now
        ))
        precondition(CloudCaptureValidation.kind("studyQuestion") == .studyQuestion)
        precondition(CloudCaptureValidation.kind("runArbitraryCode") == nil)
        precondition(!CloudCaptureValidation.isScoped(
            URL(fileURLWithPath: "/tmp/the-desk-captures/../outside.pdf"),
            inside: URL(fileURLWithPath: "/tmp/the-desk-captures", isDirectory: true)
        ))
        let lease = QueueLeaseMonitor(expiresAt: now.addingTimeInterval(60))
        try! await lease.requireValid(now: now)
        await lease.lose()
        do {
            try await lease.requireValid(now: now)
            preconditionFailure("A lost lease must reject local side effects")
        } catch {}
        print("Cloud queue policy smoke: PASS")
    }
}

#else
import XCTest
#if SWIFT_PACKAGE
@testable import LearningHomeKit
#else
@testable import TheDeskMac
#endif

final class CloudQueuePolicyTests: XCTestCase {
    func testRetryPolicyBacksOffAndStops() {
        XCTAssertEqual(CloudQueuePolicy.retryDelay(afterAttempt: 1), 15)
        XCTAssertEqual(CloudQueuePolicy.retryDelay(afterAttempt: 2), 30)
        XCTAssertEqual(CloudQueuePolicy.failureState(afterAttempt: 4), .failedRetryable)
        XCTAssertEqual(CloudQueuePolicy.failureState(afterAttempt: 5), .failedFinal)
        XCTAssertLessThanOrEqual(CloudQueuePolicy.retryDelay(afterAttempt: 99), 15 * 60)
    }

    func testRetryAndStaleLeaseEligibility() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertFalse(CloudQueuePolicy.isEligible(
            state: .failedRetryable,
            updatedAt: nil,
            nextRetryAt: now.addingTimeInterval(1),
            leaseExpiresAt: nil,
            now: now
        ))
        XCTAssertTrue(CloudQueuePolicy.isEligible(
            state: .failedRetryable,
            updatedAt: nil,
            nextRetryAt: now,
            leaseExpiresAt: nil,
            now: now
        ))
        XCTAssertFalse(CloudQueuePolicy.isEligible(
            state: .processing,
            updatedAt: now,
            nextRetryAt: nil,
            leaseExpiresAt: now.addingTimeInterval(1),
            now: now
        ))
        XCTAssertTrue(CloudQueuePolicy.isEligible(
            state: .processing,
            updatedAt: now,
            nextRetryAt: nil,
            leaseExpiresAt: now.addingTimeInterval(-1),
            now: now
        ))
        XCTAssertTrue(CloudQueuePolicy.isEligible(
            state: .processing,
            updatedAt: now.addingTimeInterval(-CloudQueuePolicy.staleProcessingInterval),
            nextRetryAt: nil,
            leaseExpiresAt: nil,
            now: now
        ))
        XCTAssertFalse(CloudQueuePolicy.isEligible(
            state: .completed,
            updatedAt: nil,
            nextRetryAt: nil,
            leaseExpiresAt: nil,
            now: now
        ))
    }

    func testCloudMetadataIsTypedBoundedAndPathSafe() {
        XCTAssertEqual(CloudCaptureValidation.kind("studyQuestion"), .studyQuestion)
        XCTAssertNil(CloudCaptureValidation.kind("runArbitraryCode"))

        let recordName = String(repeating: "a", count: 64)
        XCTAssertTrue(CloudCaptureValidation.isValidRecordName(recordName))
        XCTAssertFalse(CloudCaptureValidation.isValidRecordName(String(repeating: "A", count: 64)))
        XCTAssertFalse(CloudCaptureValidation.isValidRecordName("../escape"))
        XCTAssertNotNil(CloudCaptureValidation.spaceID("94DCC2CB-285A-4A22-BAF0-00D22EE6FA2B"))
        XCTAssertNil(CloudCaptureValidation.spaceID("../../outside"))
        XCTAssertNotNil(CloudCaptureValidation.idempotencyKey(
            kind: .note,
            spaceID: UUID(uuidString: "94DCC2CB-285A-4A22-BAF0-00D22EE6FA2B")!,
            title: "Notes",
            text: "Bounded text"
        ))
        let operation = UUID()
        let firstQuestion = CloudCaptureValidation.idempotencyKey(
            kind: .studyQuestion,
            spaceID: UUID(uuidString: "94DCC2CB-285A-4A22-BAF0-00D22EE6FA2B")!,
            title: "Question",
            text: "Explain this",
            operationID: operation
        )
        XCTAssertEqual(firstQuestion, CloudCaptureValidation.idempotencyKey(
            kind: .studyQuestion,
            spaceID: UUID(uuidString: "94DCC2CB-285A-4A22-BAF0-00D22EE6FA2B")!,
            title: "Question",
            text: "Explain this",
            operationID: operation
        ))
        XCTAssertNotEqual(firstQuestion, CloudCaptureValidation.idempotencyKey(
            kind: .studyQuestion,
            spaceID: UUID(uuidString: "94DCC2CB-285A-4A22-BAF0-00D22EE6FA2B")!,
            title: "Question",
            text: "Explain this",
            operationID: UUID()
        ))
        XCTAssertNil(CloudCaptureValidation.idempotencyKey(
            kind: .visualizeTask,
            spaceID: UUID(),
            title: "Scene",
            text: "Draw this"
        ))
        XCTAssertTrue(CloudCaptureValidation.isTextWithinBounds(String(repeating: "a", count: 1_000)))
        XCTAssertFalse(CloudCaptureValidation.isTextWithinBounds(
            String(repeating: "a", count: CloudCaptureValidation.maximumTextCharacters + 1)
        ))
        XCTAssertLessThanOrEqual(
            CloudCaptureValidation.title(String(repeating: "x", count: 400)).count,
            CloudCaptureValidation.maximumTitleCharacters
        )
        XCTAssertEqual(
            CloudCaptureValidation.assetFilename(recordName: recordName, title: "../../notes.PDF"),
            "\(recordName).pdf"
        )

        let root = URL(fileURLWithPath: "/tmp/the-desk-captures", isDirectory: true)
        XCTAssertTrue(CloudCaptureValidation.isScoped(root.appendingPathComponent("\(recordName).pdf"), inside: root))
        XCTAssertFalse(CloudCaptureValidation.isScoped(root.appendingPathComponent("../outside.pdf"), inside: root))
    }

    func testLostLeaseRejectsLocalSideEffects() async throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let lease = QueueLeaseMonitor(expiresAt: now.addingTimeInterval(60))
        try await lease.requireValid(now: now)
        await lease.lose()
        do {
            try await lease.requireValid(now: now)
            XCTFail("A lost lease must reject local side effects")
        } catch let error as CloudCaptureError {
            guard case .leaseLost = error else { return XCTFail("Unexpected error: \(error)") }
        }
    }

    func testLegacyActionOutboxPreservesCrashWindowIdentityAndV1RecordsRemainReadable() throws {
        let spaceID = UUID(uuidString: "94DCC2CB-285A-4A22-BAF0-00D22EE6FA2B")!
        let title = "Question"
        let text = "Explain this"
        let legacyID = try XCTUnwrap(CloudCaptureValidation.legacyIdempotencyKey(
            kind: .studyQuestion,
            spaceID: spaceID,
            title: title,
            text: text
        ))
        let legacyJSON = """
        {
          "id":"\(legacyID)",
          "kind":"studyQuestion",
          "spaceID":"\(spaceID.uuidString)",
          "title":"Question",
          "text":"Explain this",
          "createdAt":0
        }
        """
        let item = try JSONDecoder().decode(
            CloudCaptureQueue.OutboxItem.self,
            from: Data(legacyJSON.utf8)
        )
        XCTAssertNil(item.operationID)
        XCTAssertEqual(item.inferredSchemaVersion, 1)
        XCTAssertEqual(item.id, legacyID)
        XCTAssertEqual(CloudCaptureValidation.expectedRecordName(
            schemaVersion: 1,
            kind: .studyQuestion,
            spaceID: spaceID,
            title: title,
            text: text,
            sha256: nil,
            operationID: nil
        ), legacyID)
        let newOperationID = UUID()
        XCTAssertNotEqual(CloudCaptureValidation.expectedRecordName(
            schemaVersion: 2,
            kind: .studyQuestion,
            spaceID: spaceID,
            title: title,
            text: text,
            sha256: nil,
            operationID: newOperationID
        ), item.id)
    }
}
#endif
