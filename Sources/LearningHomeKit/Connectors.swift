import Foundation

public enum ConnectorHealthState: String, Codable, Sendable {
    case ready, disconnected, needsAuthentication, degraded, unavailable
    case managedRuntimeMissing, packageMissing, transientFailure
}

public struct ConnectorHealth: Sendable {
    public var state: ConnectorHealthState
    public var detail: String
    public var checkedAt: Date
    public var recoveryCommand: String?

    public init(state: ConnectorHealthState, detail: String, checkedAt: Date = Date(), recoveryCommand: String? = nil) {
        self.state = state
        self.detail = detail
        self.checkedAt = checkedAt
        self.recoveryCommand = recoveryCommand
    }
}

public struct ConnectorItem: Identifiable, Sendable {
    public var id: String
    public var title: String
    public var detail: String
    public var sourceURL: URL?
    public var isPending: Bool

    public init(id: String, title: String, detail: String, sourceURL: URL? = nil, isPending: Bool = false) {
        self.id = id
        self.title = title
        self.detail = detail
        self.sourceURL = sourceURL
        self.isPending = isPending
    }
}

/// Public connector boundary. Implementations are isolated so one outage cannot block local study.
public protocol SourceConnector: Sendable {
    var identifier: String { get }
    var isReadOnly: Bool { get }
    func authorize() async throws
    func health() async -> ConnectorHealth
    func list() async throws -> [ConnectorItem]
    func importItem(id: String, into spaceID: UUID) async throws -> PreparedSource
    func export(sourceID: UUID) async throws
    func reauthenticate() async throws
}

public struct KhanLinkConnector: Sendable {
    public init() {}

    public func checkIn(spaceID: UUID, title: String, url: URL, score: Double, confidence: Int, nextStep: String) -> KhanCheckIn {
        KhanCheckIn(spaceID: spaceID, title: title, url: url, score: max(0, min(score, 1)), confidence: max(1, min(confidence, 5)), nextStep: nextStep)
    }
}

public enum IntegrationSafetyPolicy {
    /// Deliberately omits every Classroom write and submission scope.
    public static let classroomOAuthScopes = [
        "https://www.googleapis.com/auth/classroom.courses.readonly",
        "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
        "https://www.googleapis.com/auth/classroom.student-submissions.me.readonly",
    ]
    public static let classroomCanSubmit = false
    public static let wisprIsReadOnly = true
    public static let khanScrapingEnabled = false
}

public struct NotebookLMSecondaryConnector: Sendable {
    public static let pinnedPackageVersion = "0.8.1"
    public static let pythonRuntimeDownloadURL = URL(string: "https://www.python.org/downloads/macos/")!
    public static var pythonRuntimeSetupCommand: String {
        "open -g '\(pythonRuntimeDownloadURL.absoluteString)'"
    }
    public static var installCommand: String {
        """
        python3.14 -m venv "$HOME/Library/Application Support/TheDesk/Engine/runtime" && \
        "$HOME/Library/Application Support/TheDesk/Engine/runtime/bin/python3" -m pip install "notebooklm-py[browser]==\(pinnedPackageVersion)"
        """
    }
    private let engine: LearningEngineClient
    public init(engine: LearningEngineClient = .shared) { self.engine = engine }

    public func health() async -> ConnectorHealth {
        do {
            let result = try await engine.notebookLMHealth()
            if result.authenticated {
                return ConnectorHealth(state: .ready, detail: result.detail)
            }
            if !result.available {
                return ConnectorHealth(
                    state: .packageMissing,
                    detail: result.detail,
                    recoveryCommand: Self.installCommand
                )
            }
            if result.detail.localizedCaseInsensitiveContains("could not")
                || result.detail.localizedCaseInsensitiveContains("passive Google check") {
                return ConnectorHealth(state: .transientFailure, detail: result.detail)
            }
            return ConnectorHealth(
                state: .needsAuthentication,
                detail: result.detail,
                recoveryCommand: result.cli.map { "\(Self.shellQuoted($0)) login" }
            )
        } catch EngineClientError.pythonMissing {
            return ConnectorHealth(
                state: .managedRuntimeMissing,
                detail: "Python 3.14 is not installed. Use the copied command to open Python's official macOS downloads in the background, install Python 3.14, then check again. NotebookLM stays optional and local study remains available.",
                recoveryCommand: Self.pythonRuntimeSetupCommand
            )
        } catch EngineClientError.engineMissing {
            return ConnectorHealth(
                state: .managedRuntimeMissing,
                detail: "The Desk's Mac learning engine is missing from this build. NotebookLM stays optional and local study is still available."
            )
        } catch EngineClientError.failed(let message) where message.localizedCaseInsensitiveContains("pinned Python") {
            return ConnectorHealth(
                state: .managedRuntimeMissing,
                detail: "The Desk needs Python 3.14 before NotebookLM can be configured. Use the copied command to open Python's official macOS downloads in the background, install Python 3.14, then check again.",
                recoveryCommand: Self.pythonRuntimeSetupCommand
            )
        } catch {
            return ConnectorHealth(
                state: .transientFailure,
                detail: "NotebookLM could not be checked just now. Local study is unaffected; try again."
            )
        }
    }

    public func listNotebooks() async throws -> JSONValue {
        try await engine.listNotebookLMNotebooks().result
    }

    public func createNotebook(title: String) async throws -> JSONValue {
        try await engine.createNotebookLMNotebook(title: "The Desk · \(title)").result
    }

    public func mirror(fileURL: URL?, notebookID: String) async throws -> JSONValue {
        guard let fileURL else {
            throw ConnectorOperationError.sourceUnavailable
        }
        return try await engine.mirrorSourceToNotebookLM(
            notebookID: notebookID,
            fileURL: fileURL
        ).result
    }

    public func ask(notebookID: String, prompt: String, sourceIDs: [String] = []) async throws -> JSONValue {
        try await engine.askNotebookLM(notebookID: notebookID, prompt: prompt, sourceIDs: sourceIDs).result
    }

    private static func shellQuoted(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}

public enum ConnectorOperationError: Error, LocalizedError {
    case sourceUnavailable

    public var errorDescription: String? {
        "The original source file is unavailable on this Mac and cannot be mirrored."
    }
}
