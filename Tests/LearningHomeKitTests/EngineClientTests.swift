import Darwin
import Foundation
import XCTest
#if SWIFT_PACKAGE
@testable import LearningHomeKit
#else
@testable import TheDeskMac
#endif

final class EngineClientTests: XCTestCase {
    func testManagedPythonIsFirstAndEveryCandidateIsVersionChecked() throws {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("TheDesk-EngineClientTests-(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let managed = root.appendingPathComponent("Library/Application Support/TheDesk/Engine/runtime/bin/python3")
        let explicit = root.appendingPathComponent("explicit-python")
        let bundled = root.appendingPathComponent("bundled-python")
        let ordered = LearningEngineClient.orderedPythonCandidates(
            homeDirectory: root,
            explicit: explicit.path,
            bundled: bundled
        )
        XCTAssertEqual(ordered.first, managed)
        XCTAssertEqual(Array(ordered.dropFirst(1).prefix(2)), [explicit, bundled])

        try writeExecutable(explicit, output: "3.13")
        try writeExecutable(bundled, output: "3.14")
        XCTAssertEqual(
            LearningEngineClient.firstPinnedPython(in: [explicit, bundled]),
            bundled.resolvingSymlinksInPath()
        )
    }

    func testCancelingDeviceLoginKillsAnUncooperativeEngineWithoutBlockingRead() async throws {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("TheDesk-LoginCancelTests-(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let pidURL = root.appendingPathComponent("engine.pid")
        let scriptURL = root.appendingPathComponent("fake_engine.py")
        let script = """
        import json, os, signal, sys, time
        open(\(String(reflecting: pidURL.path)), "w").write(str(os.getpid()))
        print(json.dumps({
            "event": "started",
            "ok": True,
            "loginId": "login-1",
            "verificationUrl": "https://example.com/device",
            "userCode": "ABCD-EFGH"
        }), flush=True)
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        while True:
            time.sleep(1)
        """
        try script.write(to: scriptURL, atomically: true, encoding: .utf8)
        let pythonURL = URL(fileURLWithPath: "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3")
        let client = LearningEngineClient(scriptURL: scriptURL, pythonURL: pythonURL)
        let stream = try await client.codexDeviceLoginEvents()
        let started = expectation(description: "device code emitted")
        let consumer = Task<Void, Never> {
            do {
                for try await event in stream {
                    if case .started = event { started.fulfill() }
                }
            } catch {
                // Cancellation is the expected terminal state.
            }
        }
        await fulfillment(of: [started], timeout: 3)
        let beganCancel = Date()
        consumer.cancel()
        await consumer.value

        let pid = try XCTUnwrap(Int32(String(contentsOf: pidURL, encoding: .utf8)))
        while Darwin.kill(pid, 0) == 0, Date().timeIntervalSince(beganCancel) < 3 {
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertLessThan(Date().timeIntervalSince(beganCancel), 3)
        XCTAssertEqual(Darwin.kill(pid, 0), -1)
        XCTAssertEqual(errno, ESRCH)
    }

    private func writeExecutable(_ url: URL, output: String) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "#!/bin/sh\nprintf '\(output)\\n'\n".write(to: url, atomically: true, encoding: .utf8)
        XCTAssertEqual(chmod(url.path, 0o755), 0)
    }
}
