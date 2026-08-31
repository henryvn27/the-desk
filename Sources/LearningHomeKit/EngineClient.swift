import Foundation
import Darwin

public struct EmptyEnginePayload: Codable, Sendable {
    public init() {}
}

public struct EngineHealth: Codable, Sendable {
    public struct Codex: Codable, Sendable {
        public var available: Bool
        public var path: String?
        public var version: String?
    }

    public struct NotebookLM: Codable, Sendable {
        public var ok: Bool
        public var available: Bool
        public var authenticated: Bool
        public var module: String?
        public var cli: String?
        public var state: NotebookLMEngineState
        public var version: String?
        public var requiredVersion: String
        public var detail: String
    }

    public var ok: Bool
    public var python: String
    public var codex: Codex
    public var notebooklm: NotebookLM
}

public enum NotebookLMEngineState: String, Codable, Sendable {
    case packageMissing
    case authenticationRequired
    case healthy
    case transientFailure
}

public struct CodexAccountEnvelope: Codable, Sendable {
    public var ok: Bool
    public var account: JSONValue
}

public struct CodexDeviceLogin: Codable, Equatable, Sendable {
    public var ok: Bool
    public var loginId: String?
    public var verificationUrl: String?
    public var userCode: String?
    public var note: String?

    public var isActionable: Bool {
        ok
            && loginId?.isEmpty == false
            && userCode?.isEmpty == false
            && verificationURL != nil
    }

    public var verificationURL: URL? {
        guard let verificationUrl,
              let url = URL(string: verificationUrl),
              url.scheme?.lowercased() == "https",
              url.host?.isEmpty == false,
              url.user == nil,
              url.password == nil else { return nil }
        return url
    }
}

public struct CodexLoginCompletion: Equatable, Sendable {
    public var loginID: String
    public var success: Bool
    public var error: String?
}

public enum CodexLoginEvent: Equatable, Sendable {
    case started(CodexDeviceLogin)
    case completed(CodexLoginCompletion)
}

public struct CodexLoginEventStream: AsyncSequence, Sendable {
    public typealias Element = CodexLoginEvent

    private let stream: AsyncThrowingStream<CodexLoginEvent, Error>
    private let controller: CodexLoginProcessController

    fileprivate init(
        stream: AsyncThrowingStream<CodexLoginEvent, Error>,
        controller: CodexLoginProcessController
    ) {
        self.stream = stream
        self.controller = controller
    }

    public func makeAsyncIterator() -> AsyncIterator {
        AsyncIterator(
            storage: CodexLoginIteratorStorage(stream.makeAsyncIterator()),
            controller: controller
        )
    }

    public struct AsyncIterator: AsyncIteratorProtocol {
        fileprivate let storage: CodexLoginIteratorStorage
        fileprivate let controller: CodexLoginProcessController

        public mutating func next() async throws -> CodexLoginEvent? {
            let storage = self.storage
            let controller = self.controller
            return try await withTaskCancellationHandler {
                try await storage.next()
            } onCancel: {
                controller.cancel()
            }
        }
    }
}

private final class CodexLoginIteratorStorage: @unchecked Sendable {
    private let lock = NSLock()
    private var iterator: AsyncThrowingStream<CodexLoginEvent, Error>.AsyncIterator?

    init(_ iterator: AsyncThrowingStream<CodexLoginEvent, Error>.AsyncIterator) {
        self.iterator = iterator
    }

    func next() async throws -> CodexLoginEvent? {
        guard var current = lock.withLock({ () -> AsyncThrowingStream<CodexLoginEvent, Error>.AsyncIterator? in
            defer { iterator = nil }
            return iterator
        }) else {
            throw EngineClientError.invalidResponse
        }
        do {
            let value = try await current.next()
            lock.withLock { iterator = current }
            return value
        } catch {
            lock.withLock { iterator = current }
            throw error
        }
    }
}

/// A privacy-preserving projection of Codex's `account/read` result. The UI
/// intentionally does not expose the account email returned by app-server.
public struct CodexAccountStatus: Equatable, Sendable {
    public let accountType: String?
    public let planType: String?

    public init(_ envelope: CodexAccountEnvelope) {
        guard envelope.ok else {
            accountType = nil
            planType = nil
            return
        }
        accountType = envelope.account.string(at: ["account", "type"])
            ?? envelope.account.string(at: "accountType")
            ?? envelope.account.string(at: "type")
        planType = envelope.account.string(at: ["account", "planType"])
            ?? envelope.account.string(at: "planType")
    }

    public var isConnectedWithChatGPT: Bool { accountType == "chatgpt" }

    public var summary: String {
        if isConnectedWithChatGPT {
            guard let planType, !planType.isEmpty else { return "Connected to ChatGPT" }
            return "Connected to ChatGPT \(Self.displayName(for: planType))"
        }
        if let accountType, !accountType.isEmpty {
            return "Codex is using \(Self.displayName(for: accountType)) authentication. The Desk requires ChatGPT sign-in."
        }
        return "ChatGPT sign-in required"
    }

    private static func displayName(for rawValue: String) -> String {
        if rawValue == "apiKey" { return "API key" }
        return rawValue
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "chatgpt", with: "ChatGPT", options: .caseInsensitive)
            .split(separator: " ")
            .map { part in
                let value = String(part)
                return value == "ChatGPT" ? value : value.capitalized
            }
            .joined(separator: " ")
    }
}

public enum CodexLoginPolicy {
    public static let timeoutDescription = "five minutes"
}

public struct EngineCodexRequest: Codable, Sendable {
    public var prompt: String
    public var context: String
    public var tutorStyle: String
    public var model: String

    public init(prompt: String, context: String, tutorStyle: TutorStyle, model: String = "auto") {
        self.prompt = prompt
        self.context = context
        self.tutorStyle = tutorStyle.rawValue
        self.model = model
    }
}

public struct EngineCodexAnswer: Codable, Sendable {
    public var ok: Bool
    public var text: String
    public var model: String
    public var threadId: String
}

public struct EngineExtractionRequest: Codable, Sendable {
    public var path: String
    public init(path: String) { self.path = path }
}

public struct EngineExtraction: Codable, Sendable {
    public var ok: Bool
    public var text: String
    public var pageCount: Int
}

public struct NotebookLMCreateRequest: Codable, Sendable {
    public var title: String
    public init(title: String) { self.title = title }
}

public struct NotebookLMSourceRequest: Codable, Sendable {
    public var notebookID: String
    public var path: String
    public init(notebookID: String, path: String) {
        self.notebookID = notebookID
        self.path = path
    }
}

public struct NotebookLMAskRequest: Codable, Sendable {
    public var notebookID: String
    public var prompt: String
    public var sourceIDs: [String]
    public init(notebookID: String, prompt: String, sourceIDs: [String] = []) {
        self.notebookID = notebookID
        self.prompt = prompt
        self.sourceIDs = sourceIDs
    }
}

public struct NotebookLMResult: Codable, Sendable {
    public var ok: Bool
    public var result: JSONValue
}

public enum JSONValue: Codable, Hashable, Sendable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([String: JSONValue].self) { self = .object(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value") }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    public func string(at key: String) -> String? {
        guard case .object(let object) = self, case .some(.string(let value)) = object[key] else { return nil }
        return value
    }

    public func value(at path: [String]) -> JSONValue? {
        path.reduce(Optional(self)) { value, key in
            guard case .some(.object(let object)) = value else { return nil }
            return object[key]
        }
    }

    public func string(at path: [String]) -> String? {
        guard case .some(.string(let value)) = value(at: path) else { return nil }
        return value
    }
}

public enum EngineClientError: Error, LocalizedError {
    case engineMissing
    case pythonMissing
    case timedOut
    case outputTooLarge
    case failed(String)
    case invalidResponse

    public var errorDescription: String? {
        switch self {
        case .engineMissing: "The bundled The Desk engine could not be found."
        case .pythonMissing: "The Desk requires its managed Python 3.14 runtime on this Mac, but no compatible runtime was found."
        case .timedOut: "The Desk's local engine exceeded its bounded execution time and was stopped."
        case .outputTooLarge: "The Desk's local engine returned more data than its safety limit allows."
        case .failed(let message): message
        case .invalidResponse: "The Desk's local engine returned an invalid response."
        }
    }
}

private struct CodexLoginWireEvent: Decodable {
    var event: String?
    var ok: Bool
    var loginId: String?
    var verificationUrl: String?
    var userCode: String?
    var note: String?
    var success: Bool?
    var error: String?
}

public actor LearningEngineClient {
    public static let shared = LearningEngineClient()

    private let scriptURL: URL?
    private let pythonURL: URL?

    public init(scriptURL: URL? = nil, pythonURL: URL? = nil) {
        self.scriptURL = scriptURL ?? Self.locateEngine()
        self.pythonURL = pythonURL ?? Self.locatePython()
    }

    public func health() async throws -> EngineHealth {
        try run("health", payload: EmptyEnginePayload(), as: EngineHealth.self)
    }

    public func codexAccount() async throws -> CodexAccountEnvelope {
        try run("codex-account", payload: EmptyEnginePayload(), as: CodexAccountEnvelope.self)
    }

    public func codexDeviceLoginEvents() throws -> CodexLoginEventStream {
        #if os(macOS)
        guard let scriptURL else { throw EngineClientError.engineMissing }
        guard let pythonURL else { throw EngineClientError.pythonMissing }
        let controller = CodexLoginProcessController()
        let stream = AsyncThrowingStream<CodexLoginEvent, Error> { continuation in
            let worker = Task.detached(priority: .userInitiated) {
                do {
                    let completion = try Self.runCodexDeviceLoginSession(
                        scriptURL: scriptURL,
                        pythonURL: pythonURL,
                        controller: controller,
                        onStarted: { continuation.yield(.started($0)) }
                    )
                    continuation.yield(.completed(completion))
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish(throwing: CancellationError())
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { @Sendable _ in
                controller.cancel()
                worker.cancel()
            }
        }
        return CodexLoginEventStream(stream: stream, controller: controller)
        #else
        throw EngineClientError.engineMissing
        #endif
    }

    public func askCodex(_ request: EngineCodexRequest) async throws -> EngineCodexAnswer {
        try run("ask-codex", payload: request, as: EngineCodexAnswer.self)
    }

    public func extract(fileURL: URL) async throws -> EngineExtraction {
        try run("extract", payload: EngineExtractionRequest(path: fileURL.path), as: EngineExtraction.self)
    }

    public func notebookLMHealth() async throws -> EngineHealth.NotebookLM {
        struct Result: Codable, Sendable {
            var ok: Bool
            var available: Bool
            var authenticated: Bool
            var module: String?
            var cli: String?
            var state: NotebookLMEngineState
            var version: String?
            var requiredVersion: String
            var detail: String
        }
        let result = try run("notebooklm-health", payload: EmptyEnginePayload(), as: Result.self)
        return EngineHealth.NotebookLM(
            ok: result.ok,
            available: result.available,
            authenticated: result.authenticated,
            module: result.module,
            cli: result.cli,
            state: result.state,
            version: result.version,
            requiredVersion: result.requiredVersion,
            detail: result.detail
        )
    }

    public func listNotebookLMNotebooks() async throws -> NotebookLMResult {
        try run("notebooklm-list", payload: EmptyEnginePayload(), as: NotebookLMResult.self)
    }

    public func createNotebookLMNotebook(title: String) async throws -> NotebookLMResult {
        try run("notebooklm-create", payload: NotebookLMCreateRequest(title: title), as: NotebookLMResult.self)
    }

    public func mirrorSourceToNotebookLM(notebookID: String, fileURL: URL) async throws -> NotebookLMResult {
        try run("notebooklm-add-source", payload: NotebookLMSourceRequest(notebookID: notebookID, path: fileURL.path), as: NotebookLMResult.self)
    }

    public func askNotebookLM(notebookID: String, prompt: String, sourceIDs: [String] = []) async throws -> NotebookLMResult {
        try run("notebooklm-ask", payload: NotebookLMAskRequest(notebookID: notebookID, prompt: prompt, sourceIDs: sourceIDs), as: NotebookLMResult.self)
    }

    private func run<Input: Encodable, Output: Decodable>(
        _ command: String,
        payload: Input,
        as outputType: Output.Type
    ) throws -> Output {
        #if os(macOS)
        guard let scriptURL else { throw EngineClientError.engineMissing }
        guard let pythonURL else { throw EngineClientError.pythonMissing }
        let process = Process()
        process.executableURL = pythonURL
        process.arguments = [scriptURL.path, command]
        process.currentDirectoryURL = scriptURL.deletingLastPathComponent().deletingLastPathComponent()
        process.environment = Self.engineEnvironment()

        let input = Pipe()
        let output = Pipe()
        let error = Pipe()
        process.standardInput = input
        process.standardOutput = output
        process.standardError = error

        let stopForOverflow = {
            if process.isRunning { process.terminate() }
        }
        let outputReader = BoundedProcessOutput(limit: 16 * 1_024 * 1_024, onOverflow: stopForOverflow)
        let errorReader = BoundedProcessOutput(limit: 2 * 1_024 * 1_024, onOverflow: stopForOverflow)
        let readers = DispatchGroup()
        let terminated = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in terminated.signal() }

        do { try process.run() }
        catch { throw EngineClientError.pythonMissing }

        readers.enter()
        DispatchQueue.global(qos: .utility).async {
            outputReader.drain(output.fileHandleForReading)
            readers.leave()
        }
        readers.enter()
        DispatchQueue.global(qos: .utility).async {
            errorReader.drain(error.fileHandleForReading)
            readers.leave()
        }

        let data = try JSONEncoder().encode(payload)
        try input.fileHandleForWriting.write(contentsOf: data)
        try? input.fileHandleForWriting.close()
        let deadline = Date().addingTimeInterval(Self.timeout(for: command))
        var cancellation: Error?
        while terminated.wait(timeout: .now() + .milliseconds(100)) == .timedOut {
            if withUnsafeCurrentTask(body: { $0?.isCancelled ?? false }) {
                cancellation = CancellationError()
                break
            }
            if Date() >= deadline {
                cancellation = EngineClientError.timedOut
                break
            }
        }
        if let cancellation {
            process.terminate()
            if terminated.wait(timeout: .now() + 2) == .timedOut, process.isRunning {
                Darwin.kill(process.processIdentifier, SIGKILL)
                _ = terminated.wait(timeout: .now() + 2)
            }
            _ = readers.wait(timeout: .now() + 3)
            throw cancellation
        }
        _ = readers.wait(timeout: .now() + 3)

        let outputData = outputReader.snapshot()
        let errorData = errorReader.snapshot()
        guard !outputReader.didExceedLimit(), !errorReader.didExceedLimit() else {
            throw EngineClientError.outputTooLarge
        }
        if process.terminationStatus != 0 {
            if let envelope = try? JSONDecoder().decode(EngineErrorEnvelope.self, from: outputData),
               let message = envelope.error {
                throw EngineClientError.failed(message)
            }
            let message = String(data: errorData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            throw EngineClientError.failed(message?.isEmpty == false ? message! : "The local engine failed.")
        }
        guard let decoded = try? JSONDecoder().decode(outputType, from: outputData) else {
            throw EngineClientError.invalidResponse
        }
        return decoded
        #else
        throw EngineClientError.engineMissing
        #endif
    }

    #if os(macOS)
    private static func runCodexDeviceLoginSession(
        scriptURL: URL,
        pythonURL: URL,
        controller: CodexLoginProcessController,
        onStarted: @escaping @Sendable (CodexDeviceLogin) -> Void
    ) throws -> CodexLoginCompletion {
        let process = Process()
        process.executableURL = pythonURL
        process.arguments = [scriptURL.path, "codex-device-login-session"]
        process.currentDirectoryURL = scriptURL.deletingLastPathComponent().deletingLastPathComponent()
        process.environment = engineEnvironment()

        let input = Pipe()
        let output = Pipe()
        let error = Pipe()
        process.standardInput = input
        process.standardOutput = output
        process.standardError = error

        let errorReader = BoundedProcessOutput(
            limit: 2 * 1_024 * 1_024,
            onOverflow: { controller.forceTerminate() }
        )
        let readers = DispatchGroup()
        readers.enter()
        DispatchQueue.global(qos: .utility).async {
            errorReader.drain(error.fileHandleForReading)
            readers.leave()
        }

        do { try process.run() }
        catch {
            try? input.fileHandleForWriting.close()
            throw EngineClientError.pythonMissing
        }
        controller.attach(process: process, input: input.fileHandleForWriting)
        defer {
            controller.detach()
            try? input.fileHandleForWriting.close()
            Self.stop(process, grace: 1)
            _ = readers.wait(timeout: .now() + 3)
        }

        var pending = Data()
        var totalOutputBytes = 0
        var startedLoginID: String?
        var completion: CodexLoginCompletion?
        var wireFailure: String?
        var wasCanceled = false
        let outputDescriptor = output.fileHandleForReading.fileDescriptor
        var readBuffer = [UInt8](repeating: 0, count: 64 * 1_024)

        while true {
            if withUnsafeCurrentTask(body: { $0?.isCancelled ?? false }) {
                controller.cancel()
            }
            if errorReader.didExceedLimit() {
                controller.forceTerminate()
                throw EngineClientError.outputTooLarge
            }
            var descriptor = pollfd(
                fd: outputDescriptor,
                events: Int16(POLLIN | POLLHUP),
                revents: 0
            )
            let ready = Darwin.poll(&descriptor, 1, 100)
            if ready == 0 { continue }
            if ready < 0 {
                if errno == EINTR { continue }
                throw EngineClientError.failed("The local login engine output could not be read.")
            }
            if descriptor.revents & Int16(POLLERR | POLLNVAL) != 0 {
                throw EngineClientError.failed("The local login engine output pipe failed.")
            }
            let count = readBuffer.withUnsafeMutableBytes { bytes in
                Darwin.read(outputDescriptor, bytes.baseAddress, bytes.count)
            }
            if count == 0 { break }
            if count < 0 {
                if errno == EINTR { continue }
                throw EngineClientError.failed("The local login engine output could not be read.")
            }
            let chunk = Data(readBuffer.prefix(count))
            totalOutputBytes += chunk.count
            guard totalOutputBytes <= 1 * 1_024 * 1_024 else {
                controller.forceTerminate()
                throw EngineClientError.outputTooLarge
            }
            pending.append(chunk)

            while let newline = pending.firstIndex(of: 0x0A) {
                let line = Data(pending[..<newline])
                pending.removeSubrange(...newline)
                guard !line.isEmpty else { continue }
                let event = try JSONDecoder().decode(CodexLoginWireEvent.self, from: line)
                switch event.event {
                case "started":
                    let login = CodexDeviceLogin(
                        ok: event.ok,
                        loginId: event.loginId,
                        verificationUrl: event.verificationUrl,
                        userCode: event.userCode,
                        note: event.note
                    )
                    guard login.isActionable, let loginID = login.loginId else {
                        throw EngineClientError.invalidResponse
                    }
                    startedLoginID = loginID
                    controller.setLoginID(loginID)
                    onStarted(login)
                case "completed":
                    guard let loginID = event.loginId ?? startedLoginID else {
                        throw EngineClientError.invalidResponse
                    }
                    completion = CodexLoginCompletion(
                        loginID: loginID,
                        success: event.success == true,
                        error: event.error
                    )
                case "canceled":
                    wasCanceled = true
                case "timedOut":
                    guard let loginID = event.loginId ?? startedLoginID else {
                        throw EngineClientError.invalidResponse
                    }
                    completion = CodexLoginCompletion(loginID: loginID, success: false, error: event.error)
                case nil:
                    if !event.ok { wireFailure = event.error ?? "The local engine failed." }
                default:
                    throw EngineClientError.invalidResponse
                }
            }
        }

        process.waitUntilExit()
        guard pending.isEmpty else { throw EngineClientError.invalidResponse }
        guard !errorReader.didExceedLimit() else { throw EngineClientError.outputTooLarge }
        if controller.isCancellationRequested || wasCanceled { throw CancellationError() }
        if process.terminationStatus != 0 {
            let detail = wireFailure
                ?? String(data: errorReader.snapshot(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            throw EngineClientError.failed(detail?.isEmpty == false ? detail! : "The local engine failed.")
        }
        if let wireFailure { throw EngineClientError.failed(wireFailure) }
        guard let completion else { throw EngineClientError.invalidResponse }
        return completion
    }
    #endif

    private static func timeout(for command: String) -> TimeInterval {
        switch command {
        case "notebooklm-add-source": 360
        case "ask-codex", "notebooklm-ask", "extract": 300
        default: 60
        }
    }

    private static func engineEnvironment() -> [String: String] {
        let inherited = ProcessInfo.processInfo.environment
        var environment = [
            "HOME": NSHomeDirectory(),
            "TMPDIR": NSTemporaryDirectory(),
            "LANG": "en_US.UTF-8",
            "LC_ALL": "en_US.UTF-8",
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "PYTHONNOUSERSITE": "1",
            "PYTHONUNBUFFERED": "1",
        ]
        // Only reviewed absolute tool overrides cross the process boundary. In
        // particular, loader, shell, proxy, and arbitrary PATH state are omitted.
        for key in ["THE_DESK_CODEX", "THE_DESK_NOTEBOOKLM"] {
            guard let value = inherited[key], value.hasPrefix("/") else { continue }
            environment[key] = value
        }
        return environment
    }

    private static func locateEngine() -> URL? {
        let manager = FileManager.default
        let canonical = Bundle.main.url(forResource: "learning_engine", withExtension: "py")
        #if !DEBUG
        return canonical
        #else
        if let explicit = ProcessInfo.processInfo.environment["THE_DESK_ENGINE_PATH"]
            ?? ProcessInfo.processInfo.environment["LEARNING_HOME_ENGINE_PATH"] {
            let url = URL(fileURLWithPath: explicit)
            if manager.fileExists(atPath: url.path) { return url }
        }
        if let canonical { return canonical }
        if let bundled = Bundle.main.url(forResource: "learning_engine", withExtension: "py", subdirectory: "Engine") {
            return bundled
        }
        let sourceRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let development = sourceRoot.appendingPathComponent("Engine/learning_engine.py")
        if manager.fileExists(atPath: development.path) { return development }
        let current = URL(fileURLWithPath: manager.currentDirectoryPath).appendingPathComponent("Engine/learning_engine.py")
        return manager.fileExists(atPath: current.path) ? current : nil
        #endif
    }

    private static func locatePython() -> URL? {
        #if os(macOS)
        let candidates = orderedPythonCandidates(
            homeDirectory: URL(fileURLWithPath: NSHomeDirectory()),
            explicit: ProcessInfo.processInfo.environment["THE_DESK_PYTHON"],
            bundled: Bundle.main.url(forResource: "python3", withExtension: nil, subdirectory: "Engine/runtime/bin")
        )
        return firstPinnedPython(in: candidates)
        #else
        return nil
        #endif
    }

    #if os(macOS)
    static func orderedPythonCandidates(homeDirectory: URL, explicit: String?, bundled: URL?) -> [URL] {
        var candidates = [
            homeDirectory.appendingPathComponent("Library/Application Support/TheDesk/Engine/runtime/bin/python3"),
        ]
        if let explicit, explicit.hasPrefix("/") {
            candidates.append(URL(fileURLWithPath: explicit))
        }
        if let bundled { candidates.append(bundled) }
        candidates += [
            URL(fileURLWithPath: "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3"),
            URL(fileURLWithPath: "/opt/homebrew/bin/python3"),
            URL(fileURLWithPath: "/usr/local/bin/python3"),
        ]
        return candidates
    }

    static func firstPinnedPython(in candidates: [URL]) -> URL? {
        let manager = FileManager.default
        var visited = Set<String>()
        for candidate in candidates {
            let resolved = candidate.resolvingSymlinksInPath()
            guard visited.insert(resolved.path).inserted,
                  manager.isExecutableFile(atPath: resolved.path),
                  isPinnedPython(resolved) else { continue }
            return resolved
        }
        return nil
    }

    private static func isPinnedPython(_ candidate: URL) -> Bool {
        let process = Process()
        process.executableURL = candidate
        process.arguments = ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"]
        process.environment = [
            "HOME": NSHomeDirectory(),
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "PYTHONNOUSERSITE": "1",
        ]
        process.standardInput = FileHandle.nullDevice
        let output = Pipe()
        let error = Pipe()
        process.standardOutput = output
        process.standardError = error
        let terminated = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in terminated.signal() }
        let stopForOverflow = {
            if process.isRunning { process.terminate() }
        }
        let stdout = BoundedProcessOutput(limit: 1_024, onOverflow: stopForOverflow)
        let stderr = BoundedProcessOutput(limit: 1_024, onOverflow: stopForOverflow)
        let readers = DispatchGroup()
        do { try process.run() }
        catch { return false }
        readers.enter()
        DispatchQueue.global(qos: .utility).async {
            stdout.drain(output.fileHandleForReading)
            readers.leave()
        }
        readers.enter()
        DispatchQueue.global(qos: .utility).async {
            stderr.drain(error.fileHandleForReading)
            readers.leave()
        }
        if terminated.wait(timeout: .now() + 3) == .timedOut {
            stop(process, grace: 0.5)
        }
        _ = readers.wait(timeout: .now() + 1)
        guard process.terminationStatus == 0,
              !stdout.didExceedLimit(),
              !stderr.didExceedLimit() else { return false }
        return String(data: stdout.snapshot(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) == "3.14"
    }

    private static func stop(_ process: Process, grace: TimeInterval) {
        guard process.isRunning else { return }
        process.terminate()
        let deadline = Date().addingTimeInterval(grace)
        while process.isRunning, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.02)
        }
        if process.isRunning {
            Darwin.kill(process.processIdentifier, SIGKILL)
            let killDeadline = Date().addingTimeInterval(grace)
            while process.isRunning, Date() < killDeadline {
                Thread.sleep(forTimeInterval: 0.02)
            }
        }
    }
    #endif
}

private final class BoundedProcessOutput: @unchecked Sendable {
    private let limit: Int
    private let onOverflow: (() -> Void)?
    private let lock = NSLock()
    private var data = Data()
    private var exceededLimit = false

    init(limit: Int, onOverflow: (() -> Void)? = nil) {
        self.limit = limit
        self.onOverflow = onOverflow
    }

    func drain(_ handle: FileHandle) {
        while true {
            let chunk: Data
            do { chunk = try handle.read(upToCount: 64 * 1_024) ?? Data() }
            catch { return }
            guard !chunk.isEmpty else { return }
            lock.lock()
            let remaining = max(0, limit - data.count)
            if remaining > 0 { data.append(chunk.prefix(remaining)) }
            let overflowedNow = chunk.count > remaining && !exceededLimit
            if chunk.count > remaining { exceededLimit = true }
            lock.unlock()
            if overflowedNow { onOverflow?() }
        }
    }

    func snapshot() -> Data {
        lock.lock()
        defer { lock.unlock() }
        return data
    }

    func didExceedLimit() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return exceededLimit
    }
}

private final class CodexLoginProcessController: @unchecked Sendable {
    private let lock = NSLock()
    private var process: Process?
    private var input: FileHandle?
    private var loginID: String?
    private var cancellationRequested = false
    private var cancelWasSent = false
    private var shutdownScheduled = false

    var isCancellationRequested: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancellationRequested
    }

    func attach(process: Process, input: FileHandle) {
        lock.lock()
        self.process = process
        self.input = input
        let shouldCancel = cancellationRequested && !cancelWasSent
        if shouldCancel { cancelWasSent = true }
        let shouldScheduleShutdown = cancellationRequested && !shutdownScheduled
        if shouldScheduleShutdown { shutdownScheduled = true }
        let loginID = self.loginID
        lock.unlock()
        if shouldCancel { sendCancel(to: input, process: process, loginID: loginID) }
        if shouldScheduleShutdown { scheduleStop(process, gracefulDelay: 0.75) }
    }

    func setLoginID(_ loginID: String) {
        lock.lock()
        self.loginID = loginID
        lock.unlock()
    }

    func cancel() {
        lock.lock()
        cancellationRequested = true
        let input = self.input
        let process = self.process
        let shouldSend = input != nil && process != nil && !cancelWasSent
        if shouldSend { cancelWasSent = true }
        let shouldScheduleShutdown = process != nil && !shutdownScheduled
        if shouldScheduleShutdown { shutdownScheduled = true }
        let loginID = self.loginID
        lock.unlock()
        if shouldSend, let input, let process {
            sendCancel(to: input, process: process, loginID: loginID)
        }
        if shouldScheduleShutdown, let process {
            scheduleStop(process, gracefulDelay: 0.75)
        }
    }

    func forceTerminate() {
        lock.lock()
        guard let process else {
            lock.unlock()
            return
        }
        let shouldScheduleShutdown = !shutdownScheduled
        if shouldScheduleShutdown { shutdownScheduled = true }
        lock.unlock()
        if shouldScheduleShutdown { scheduleStop(process, gracefulDelay: 0) }
    }

    func detach() {
        lock.lock()
        process = nil
        input = nil
        lock.unlock()
    }

    private func sendCancel(to input: FileHandle, process: Process, loginID: String?) {
        var value: [String: String] = ["action": "cancel"]
        if let loginID { value["loginId"] = loginID }
        guard var data = try? JSONEncoder().encode(value) else { return }
        data.append(0x0A)
        do { try input.write(contentsOf: data) }
        catch {
            scheduleStop(process, gracefulDelay: 0)
        }
    }

    private func scheduleStop(_ process: Process, gracefulDelay: TimeInterval) {
        DispatchQueue.global(qos: .userInitiated).async {
            if gracefulDelay > 0 { Thread.sleep(forTimeInterval: gracefulDelay) }
            guard process.isRunning else { return }
            process.terminate()
            let termDeadline = Date().addingTimeInterval(1)
            while process.isRunning, Date() < termDeadline {
                Thread.sleep(forTimeInterval: 0.02)
            }
            guard process.isRunning else { return }
            Darwin.kill(process.processIdentifier, SIGKILL)
            let killDeadline = Date().addingTimeInterval(1)
            while process.isRunning, Date() < killDeadline {
                Thread.sleep(forTimeInterval: 0.02)
            }
        }
    }
}

private struct EngineErrorEnvelope: Codable {
    var ok: Bool?
    var error: String?
}
