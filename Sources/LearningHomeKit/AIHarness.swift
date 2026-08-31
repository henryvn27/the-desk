import Foundation
import Security

public enum StudyTaskKind: String, Codable, CaseIterable, Sendable {
    case explain, tutor, quiz, evaluateAttempt, summarize, visualize, planSession, extractActions
}

public enum AIProviderCapability: String, Codable, Hashable, Sendable {
    case text, vision, structuredOutput, tools, web, longContext
}

public struct ProviderDescriptor: Identifiable, Hashable, Sendable {
    public var id: ProviderIdentifier
    public var title: String
    public var model: String
    public var capabilities: Set<AIProviderCapability>
    public var billingNote: String

    public init(id: ProviderIdentifier, title: String, model: String, capabilities: Set<AIProviderCapability>, billingNote: String) {
        self.id = id
        self.title = title
        self.model = model
        self.capabilities = capabilities
        self.billingNote = billingNote
    }
}

public enum AIProviderCostPolicy: String, Codable, Hashable, Sendable {
    case balanced
    case minimizeSpend
}

public enum AIRoutingMode: String, Codable, Hashable, Sendable {
    case automatic
    case manualOverride
}

public struct AIRouteCandidate: Identifiable, Hashable, Sendable {
    public var id: ProviderIdentifier
    public var isAvailable: Bool
    public var supportsTask: Bool
    public var score: Int?
    public var reason: String
}

public struct AIRoutingDecision: Identifiable, Hashable, Sendable {
    public var id = UUID()
    public var mode: AIRoutingMode
    public var task: StudyTaskKind
    public var provider: ProviderIdentifier
    public var preferredProvider: ProviderIdentifier?
    public var costPolicy: AIProviderCostPolicy
    public var requiredCapabilities: Set<AIProviderCapability>
    public var contextCharacterCount: Int
    public var reason: String
    public var candidates: [AIRouteCandidate]
    public var actualModel: String? = nil
}

public struct AIStudyRequest: Sendable {
    public var spaceID: UUID
    public var task: StudyTaskKind
    public var prompt: String
    public var tutorStyle: TutorStyle
    public var context: String
    public var citations: [StudyCitation]
    public var allowProviderKnowledge: Bool
    public var requestedModel: String?
    public var preferredProvider: ProviderIdentifier?
    public var costPolicy: AIProviderCostPolicy

    public init(
        spaceID: UUID,
        task: StudyTaskKind,
        prompt: String,
        tutorStyle: TutorStyle,
        context: String,
        citations: [StudyCitation],
        allowProviderKnowledge: Bool = true,
        requestedModel: String? = nil,
        preferredProvider: ProviderIdentifier? = nil,
        costPolicy: AIProviderCostPolicy = .balanced
    ) {
        self.spaceID = spaceID
        self.task = task
        self.prompt = prompt
        self.tutorStyle = tutorStyle
        self.context = context
        self.citations = citations
        self.allowProviderKnowledge = allowProviderKnowledge
        self.requestedModel = requestedModel
        self.preferredProvider = preferredProvider
        self.costPolicy = costPolicy
    }
}

public enum AIProviderRouter {
    public static func decide(
        request: AIStudyRequest,
        override: ProviderOverride,
        descriptors: [ProviderDescriptor],
        availability: [ProviderIdentifier: Bool]
    ) throws -> AIRoutingDecision {
        let required = requiredCapabilities(for: request.task)
        let descriptorByID = Dictionary(descriptors.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let candidates = descriptors.map { descriptor in
            candidate(
                descriptor: descriptor,
                request: request,
                required: required,
                isAvailable: availability[descriptor.id] == true
            )
        }

        if case .provider(let identifier) = override {
            guard let descriptor = descriptorByID[identifier], availability[identifier] == true else {
                throw AIHarnessError.unavailable(identifier)
            }
            let missing = required.subtracting(descriptor.capabilities)
            guard missing.isEmpty else { throw AIHarnessError.unsupportedTask(identifier, missing) }
            return AIRoutingDecision(
                mode: .manualOverride,
                task: request.task,
                provider: identifier,
                preferredProvider: request.preferredProvider,
                costPolicy: request.costPolicy,
                requiredCapabilities: required,
                contextCharacterCount: request.context.count,
                reason: "Manual override selected \(descriptor.title); it is available and supports \(capabilityList(required)). No fallback is permitted.",
                candidates: candidates
            )
        }

        let eligible = candidates.filter { $0.isAvailable && $0.supportsTask }
        guard let selected = eligible.sorted(by: outranks).first,
              let descriptor = descriptorByID[selected.id] else {
            throw AIHarnessError.noProvider
        }

        var context = "\(request.context.count) context characters"
        if request.context.count >= largeContextThreshold { context += ", favoring long-context providers" }
        var reason = "\(descriptor.title) selected for \(request.task.rawValue): available, supports \(capabilityList(required)), \(request.costPolicy.rawValue) cost policy, and \(context)."
        if let preferred = request.preferredProvider {
            if preferred == selected.id {
                reason = "Preferred provider \(descriptor.title) selected; it is available and supports \(capabilityList(required))."
            } else if let preferredCandidate = candidates.first(where: { $0.id == preferred }) {
                reason = "Preferred provider \(preferred.title) was not eligible (\(preferredCandidate.reason)); \(reason)"
            } else {
                reason = "Preferred provider \(preferred.title) has no registered adapter; \(reason)"
            }
        }
        return AIRoutingDecision(
            mode: .automatic,
            task: request.task,
            provider: selected.id,
            preferredProvider: request.preferredProvider,
            costPolicy: request.costPolicy,
            requiredCapabilities: required,
            contextCharacterCount: request.context.count,
            reason: reason,
            candidates: candidates
        )
    }

    private static let largeContextThreshold = 24_000
    private static let baseScore: [ProviderIdentifier: Int] = [
        .codex: 500,
        .anthropic: 400,
        .gemini: 300,
        .openAI: 200,
        .localDemo: 100,
    ]

    private static func requiredCapabilities(for task: StudyTaskKind) -> Set<AIProviderCapability> {
        switch task {
        case .visualize, .quiz, .evaluateAttempt, .planSession, .extractActions:
            [.text, .structuredOutput]
        case .explain, .tutor, .summarize:
            [.text]
        }
    }

    private static func candidate(
        descriptor: ProviderDescriptor,
        request: AIStudyRequest,
        required: Set<AIProviderCapability>,
        isAvailable: Bool
    ) -> AIRouteCandidate {
        guard isAvailable else {
            return AIRouteCandidate(id: descriptor.id, isAvailable: false, supportsTask: false, score: nil, reason: "unavailable or not authenticated")
        }
        let missing = required.subtracting(descriptor.capabilities)
        guard missing.isEmpty else {
            return AIRouteCandidate(id: descriptor.id, isAvailable: true, supportsTask: false, score: nil, reason: "missing \(capabilityList(missing))")
        }

        var score = baseScore[descriptor.id] ?? 0
        var factors = ["base \(score)"]
        if request.preferredProvider == descriptor.id {
            score += 10_000
            factors.append("preferred +10000")
        }
        switch request.costPolicy {
        case .balanced:
            if descriptor.id == .codex {
                score += 100
                factors.append("balanced included plan +100")
            } else if descriptor.id != .localDemo {
                score += 25
                factors.append("balanced hosted provider +25")
            }
        case .minimizeSpend:
            if descriptor.id == .localDemo {
                score += 1_000
                factors.append("minimize spend local +1000")
            } else if descriptor.id == .codex {
                score += 400
                factors.append("minimize spend included plan +400")
            }
        }
        if request.context.count >= largeContextThreshold {
            if descriptor.capabilities.contains(.longContext) {
                score += 200
                factors.append("long context +200")
            } else {
                score -= 500
                factors.append("no long context -500")
            }
        }
        return AIRouteCandidate(
            id: descriptor.id,
            isAvailable: true,
            supportsTask: true,
            score: score,
            reason: "eligible: \(factors.joined(separator: ", ")); total \(score)"
        )
    }

    private static func outranks(_ lhs: AIRouteCandidate, _ rhs: AIRouteCandidate) -> Bool {
        if lhs.score != rhs.score { return (lhs.score ?? .min) > (rhs.score ?? .min) }
        return (baseScore[lhs.id] ?? 0) > (baseScore[rhs.id] ?? 0)
    }

    private static func capabilityList(_ capabilities: Set<AIProviderCapability>) -> String {
        capabilities.map(\.rawValue).sorted().joined(separator: ", ")
    }
}

public enum AIEvent: Sendable {
    case status(String)
    case token(String)
    case citations([StudyCitation])
    case completed(provider: ProviderIdentifier, model: String)
}

public struct AIProviderResponse: Sendable {
    public var text: String
    public var model: String

    public init(text: String, model: String) {
        self.text = text
        self.model = model
    }
}

public protocol AIProvider: Sendable {
    var descriptor: ProviderDescriptor { get }
    func isAvailable() async -> Bool
    func answer(_ request: AIStudyRequest) async throws -> AIProviderResponse
}

public enum ProviderOverride: Hashable, Sendable {
    case automatic
    case provider(ProviderIdentifier)
}

public enum AIHarnessError: Error, LocalizedError {
    case unavailable(ProviderIdentifier)
    case unsupportedTask(ProviderIdentifier, Set<AIProviderCapability>)
    case noProvider
    case invalidResponse
    case missingAPIKey(ProviderIdentifier)
    case rateLimited(ProviderIdentifier, retryAfter: TimeInterval?)

    public var errorDescription: String? {
        switch self {
        case .unavailable(let provider): "\(provider.title) is not available on this Mac."
        case .unsupportedTask(let provider, let capabilities): "\(provider.title) cannot run this task because it lacks: \(capabilities.map(\.rawValue).sorted().joined(separator: ", ")). The Desk did not switch providers."
        case .noProvider: "No available AI provider supports this task. Check provider health or choose a compatible provider."
        case .invalidResponse: "The provider returned an unreadable response."
        case .missingAPIKey(let provider): "Add a \(provider.title) key in Integrations before using this provider."
        case .rateLimited(let provider, let retryAfter):
            if let retryAfter {
                "\(provider.title) is rate-limited. Try again in about \(Int(ceil(retryAfter))) seconds; The Desk did not switch providers."
            } else {
                "\(provider.title) is rate-limited. Try again shortly; The Desk did not switch providers."
            }
        }
    }
}

public actor AIHarness {
    public static let shared = AIHarness()

    private let providers: [ProviderIdentifier: any AIProvider]
    private var routingHistory: [AIRoutingDecision] = []

    public init(
        engine: LearningEngineClient = .shared,
        keyStore: APIKeyStore = .shared
    ) {
        providers = [
            .codex: CodexPlanProvider(engine: engine),
            .openAI: HTTPAPIProvider(identifier: .openAI, keyStore: keyStore),
            .anthropic: HTTPAPIProvider(identifier: .anthropic, keyStore: keyStore),
            .gemini: HTTPAPIProvider(identifier: .gemini, keyStore: keyStore),
            .localDemo: LocalPreviewProvider(),
        ]
    }

    init(providers: [ProviderIdentifier: any AIProvider]) {
        self.providers = providers
    }

    public func descriptors() -> [ProviderDescriptor] {
        ProviderIdentifier.allCases.compactMap { providers[$0]?.descriptor }
    }

    public func availability() async -> [ProviderIdentifier: Bool] {
        var result: [ProviderIdentifier: Bool] = [:]
        for identifier in ProviderIdentifier.allCases {
            if let provider = providers[identifier] { result[identifier] = await provider.isAvailable() }
        }
        return result
    }

    public func latestRoutingDecision() -> AIRoutingDecision? { routingHistory.last }

    public func recentRoutingDecisions(limit: Int = 20) -> [AIRoutingDecision] {
        Array(routingHistory.suffix(max(0, min(limit, 50))).reversed())
    }

    public func execute(
        _ request: AIStudyRequest,
        override: ProviderOverride = .automatic
    ) async throws -> (response: AIProviderResponse, provider: ProviderIdentifier) {
        let selection = try await select(request: request, override: override)
        record(selection.decision)
        let response = try await selection.provider.answer(request)
        recordActualModel(response.model, decisionID: selection.decision.id)
        return (response, selection.provider.descriptor.id)
    }

    public func stream(
        _ request: AIStudyRequest,
        override: ProviderOverride = .automatic
    ) async throws -> AsyncThrowingStream<AIEvent, Error> {
        let selection = try await select(request: request, override: override)
        record(selection.decision)
        let provider = selection.provider
        let descriptor = provider.descriptor
        let decisionID = selection.decision.id
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    continuation.yield(.status("Thinking with \(descriptor.title)…"))
                    let response = try await provider.answer(request)
                    guard !response.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                        throw AIHarnessError.invalidResponse
                    }
                    for token in Self.displayTokens(response.text) {
                        if Task.isCancelled { break }
                        continuation.yield(.token(token))
                        try? await Task.sleep(for: .milliseconds(7))
                    }
                    var citations = request.citations
                    if request.allowProviderKnowledge && descriptor.id != .localDemo {
                        citations.append(StudyCitation(
                            label: "Provider-added knowledge may be uncited",
                            origin: .modelKnowledge
                        ))
                    }
                    self.recordActualModel(response.model, decisionID: decisionID)
                    continuation.yield(.citations(citations))
                    continuation.yield(.completed(provider: descriptor.id, model: response.model))
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private struct Selection {
        var provider: any AIProvider
        var decision: AIRoutingDecision
    }

    private func select(request: AIStudyRequest, override: ProviderOverride) async throws -> Selection {
        let health = await availability()
        let decision = try AIProviderRouter.decide(
            request: request,
            override: override,
            descriptors: descriptors(),
            availability: health
        )
        guard let provider = providers[decision.provider] else { throw AIHarnessError.unavailable(decision.provider) }
        return Selection(provider: provider, decision: decision)
    }

    private func record(_ decision: AIRoutingDecision) {
        routingHistory.append(decision)
        if routingHistory.count > 50 { routingHistory.removeFirst(routingHistory.count - 50) }
    }

    private func recordActualModel(_ model: String, decisionID: UUID) {
        guard let index = routingHistory.firstIndex(where: { $0.id == decisionID }) else { return }
        routingHistory[index].actualModel = model
    }

    private static func displayTokens(_ text: String) -> [String] {
        text.split(omittingEmptySubsequences: false, whereSeparator: { $0.isWhitespace })
            .enumerated()
            .map { index, value in index == 0 ? String(value) : " " + value }
    }
}

public struct LocalPreviewProvider: AIProvider {
    public let descriptor = ProviderDescriptor(
        id: .localDemo,
        title: "Local preview",
        model: "source-grounded-demo",
        capabilities: [.text, .structuredOutput],
        billingNote: "Offline and free"
    )

    public init() {}
    public func isAvailable() async -> Bool { true }

    public func answer(_ request: AIStudyRequest) async throws -> AIProviderResponse {
        let source = request.context.trimmingCharacters(in: .whitespacesAndNewlines)
        let grounded = source.isEmpty ? "No class source was retrieved for this question." : source
        let text: String
        switch request.tutorStyle {
        case .coachFirst:
            text = "Before we calculate anything, separate what changes from what stays constant. \(grounded)\n\nWhat would you set equal to zero at the highest point—and what component is still moving?"
        case .explainFirst:
            text = "The key is to treat the axes independently. \(grounded)\n\nUse the vertical equation to find time, then use constant horizontal velocity to find range."
        case .examPractice:
            text = "Exam move: write the known quantities, choose one axis, and commit to an equation before substituting numbers. \(grounded)\n\nTry the next step without looking back at the formula sheet."
        case .custom:
            text = "Here is the source-grounded starting point: \(grounded)\n\nTell me whether you want a hint, a full explanation, or a practice question next."
        }
        return AIProviderResponse(text: text, model: descriptor.model)
    }
}

public struct CodexPlanProvider: AIProvider {
    public let descriptor = ProviderDescriptor(
        id: .codex,
        title: "Codex plan",
        model: "Codex default",
        capabilities: [.text, .structuredOutput, .longContext],
        billingNote: "Uses ChatGPT plan limits"
    )
    private let engine: LearningEngineClient

    public init(engine: LearningEngineClient) { self.engine = engine }

    public func isAvailable() async -> Bool {
        guard let health = try? await engine.health(), health.codex.available else { return false }
        guard let account = try? await engine.codexAccount() else { return false }
        return Self.isAuthenticated(account)
    }

    static func isAuthenticated(_ envelope: CodexAccountEnvelope) -> Bool {
        CodexAccountStatus(envelope).isConnectedWithChatGPT
    }

    public func answer(_ request: AIStudyRequest) async throws -> AIProviderResponse {
        let result = try await engine.askCodex(EngineCodexRequest(
            prompt: request.prompt,
            context: request.context,
            tutorStyle: request.tutorStyle,
            model: request.requestedModel ?? "auto"
        ))
        return AIProviderResponse(text: result.text, model: result.model)
    }
}

public actor HTTPAPIProvider: AIProvider {
    public nonisolated let descriptor: ProviderDescriptor
    private let keyStore: APIKeyStore

    public init(identifier: ProviderIdentifier, keyStore: APIKeyStore) {
        self.keyStore = keyStore
        switch identifier {
        case .openAI:
            descriptor = ProviderDescriptor(id: .openAI, title: "OpenAI API", model: "gpt-5.4-mini", capabilities: [.text, .structuredOutput, .longContext], billingNote: "Separate API billing")
        case .anthropic:
            descriptor = ProviderDescriptor(id: .anthropic, title: "Anthropic", model: "claude-sonnet-5", capabilities: [.text, .structuredOutput, .longContext], billingNote: "Separate API billing")
        case .gemini:
            descriptor = ProviderDescriptor(id: .gemini, title: "Gemini", model: "gemini-2.5-flash", capabilities: [.text, .structuredOutput, .longContext], billingNote: "Separate API billing")
        default:
            descriptor = ProviderDescriptor(id: identifier, title: identifier.title, model: "", capabilities: [.text], billingNote: "")
        }
    }

    public func isAvailable() async -> Bool { keyStore.value(for: descriptor.id) != nil }

    public func answer(_ request: AIStudyRequest) async throws -> AIProviderResponse {
        guard let key = keyStore.value(for: descriptor.id) else { throw AIHarnessError.missingAPIKey(descriptor.id) }
        let prompt = Self.prompt(for: request)
        let model = request.requestedModel ?? descriptor.model
        switch descriptor.id {
        case .openAI: return try await askOpenAI(prompt: prompt, key: key, model: model)
        case .anthropic: return try await askAnthropic(prompt: prompt, key: key, model: model)
        case .gemini: return try await askGemini(prompt: prompt, key: key, model: model)
        default: throw AIHarnessError.unavailable(descriptor.id)
        }
    }

    private static func prompt(for request: AIStudyRequest) -> String {
        """
        You are the tutor inside The Desk. Tutor style: \(request.tutorStyle.title).
        Use class material first. Clearly label any outside knowledge. Never claim an assignment was submitted or completed without external evidence.

        CLASS MATERIAL
        \(request.context.isEmpty ? "No class source was retrieved." : request.context)

        STUDENT REQUEST
        \(request.prompt)
        """
    }

    private func askOpenAI(prompt: String, key: String, model: String) async throws -> AIProviderResponse {
        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/responses")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "model": model,
            "input": prompt,
            "max_output_tokens": 2_048,
        ])
        let object = try await send(request)
        let actualModel = object["model"] as? String ?? model
        if let text = object["output_text"] as? String { return AIProviderResponse(text: text, model: actualModel) }
        let output = object["output"] as? [[String: Any]] ?? []
        let text = output.flatMap { $0["content"] as? [[String: Any]] ?? [] }.compactMap { $0["text"] as? String }.joined(separator: "\n")
        return AIProviderResponse(text: text, model: actualModel)
    }

    private func askAnthropic(prompt: String, key: String, model: String) async throws -> AIProviderResponse {
        var request = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        request.httpMethod = "POST"
        request.setValue(key, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "model": model,
            "max_tokens": 2_048,
            "messages": [["role": "user", "content": prompt]],
        ])
        let object = try await send(request)
        let content = object["content"] as? [[String: Any]] ?? []
        let text = content.compactMap { $0["text"] as? String }.joined(separator: "\n")
        return AIProviderResponse(text: text, model: object["model"] as? String ?? model)
    }

    private func askGemini(prompt: String, key: String, model: String) async throws -> AIProviderResponse {
        let encodedModel = model.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? model
        let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/\(encodedModel):generateContent")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(key, forHTTPHeaderField: "x-goog-api-key")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "contents": [["parts": [["text": prompt]]]],
            "generationConfig": ["maxOutputTokens": 2_048],
        ])
        let object = try await send(request)
        let candidates = object["candidates"] as? [[String: Any]] ?? []
        let content = candidates.first?["content"] as? [String: Any]
        let parts = content?["parts"] as? [[String: Any]] ?? []
        let text = parts.compactMap { $0["text"] as? String }.joined(separator: "\n")
        return AIProviderResponse(text: text, model: object["modelVersion"] as? String ?? model)
    }

    private func send(_ request: URLRequest) async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AIHarnessError.invalidResponse }
        if http.statusCode == 429 {
            let retryAfter = http.value(forHTTPHeaderField: "Retry-After").flatMap(TimeInterval.init)
            throw AIHarnessError.rateLimited(descriptor.id, retryAfter: retryAfter)
        }
        guard 200..<300 ~= http.statusCode else {
            let message = String(data: data, encoding: .utf8) ?? "Provider request failed"
            throw AIHarnessError.invalidResponseWithContext(message)
        }
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw AIHarnessError.invalidResponse
        }
        return object
    }
}

public final class APIKeyStore: @unchecked Sendable {
    public static let shared = APIKeyStore()
    private let service: String

    public init(service: String? = nil) {
        self.service = service
            ?? Bundle.main.object(forInfoDictionaryKey: "TheDeskKeychainService") as? String
            ?? "com.example.thedesk.providers"
    }

    public func value(for provider: ProviderIdentifier) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: provider.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8),
              !value.isEmpty else { return nil }
        return value
    }

    public func set(_ value: String, for provider: ProviderIdentifier) throws {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let identity: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: provider.rawValue,
        ]
        let updateStatus = SecItemUpdate(
            identity as CFDictionary,
            [kSecValueData as String: Data(normalized.utf8)] as CFDictionary
        )
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else { throw KeychainError.status(updateStatus) }

        let status = SecItemAdd(identity.merging([
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: Data(normalized.utf8),
        ]) { _, new in new } as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.status(status) }
    }

    public func remove(_ provider: ProviderIdentifier) {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: provider.rawValue,
        ] as CFDictionary)
    }
}

public enum KeychainError: Error { case status(OSStatus) }

private extension AIHarnessError {
    static func invalidResponseWithContext(_ context: String) -> Error {
        NSError(domain: "TheDesk.Provider", code: 1, userInfo: [NSLocalizedDescriptionKey: context])
    }
}
