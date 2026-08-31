import XCTest
#if SWIFT_PACKAGE
@testable import LearningHomeKit
#else
@testable import TheDeskMac
#endif

@MainActor
final class AIProviderRouterTests: XCTestCase {
    func testPreferredHealthyProviderWinsAutomaticRoute() throws {
        let decision = try AIProviderRouter.decide(
            request: request(preferredProvider: .gemini),
            override: .automatic,
            descriptors: descriptors,
            availability: availableProviders
        )

        XCTAssertEqual(decision.provider, .gemini)
        XCTAssertEqual(decision.mode, .automatic)
        XCTAssertTrue(decision.reason.contains("Preferred provider"))
    }

    func testUnavailablePreferenceFallsBackButManualOverrideDoesNot() throws {
        var availability = availableProviders
        availability[.anthropic] = false
        let automatic = try AIProviderRouter.decide(
            request: request(preferredProvider: .anthropic),
            override: .automatic,
            descriptors: descriptors,
            availability: availability
        )
        XCTAssertEqual(automatic.provider, .codex)
        XCTAssertTrue(automatic.reason.contains("was not eligible"))

        XCTAssertThrowsError(try AIProviderRouter.decide(
            request: request(),
            override: .provider(.anthropic),
            descriptors: descriptors,
            availability: availability
        )) { error in
            guard let harnessError = error as? AIHarnessError,
                  case .unavailable(.anthropic) = harnessError else {
                return XCTFail("Expected a fail-closed unavailable error, got \(error)")
            }
        }
    }

    func testTaskCapabilitiesAndContextSizeAffectRoute() throws {
        let textOnly = ProviderDescriptor(
            id: .openAI,
            title: "Text only",
            model: "test",
            capabilities: [.text],
            billingNote: "test"
        )
        XCTAssertThrowsError(try AIProviderRouter.decide(
            request: request(task: .visualize),
            override: .provider(.openAI),
            descriptors: [textOnly],
            availability: [.openAI: true]
        )) { error in
            guard let harnessError = error as? AIHarnessError,
                  case .unsupportedTask(.openAI, let missing) = harnessError else {
                return XCTFail("Expected a capability error, got \(error)")
            }
            XCTAssertEqual(missing, [.structuredOutput])
        }

        let cheap = try AIProviderRouter.decide(
            request: request(costPolicy: .minimizeSpend),
            override: .automatic,
            descriptors: descriptors.filter { $0.id == .codex || $0.id == .localDemo },
            availability: availableProviders
        )
        XCTAssertEqual(cheap.provider, .localDemo)

        let large = try AIProviderRouter.decide(
            request: request(context: String(repeating: "x", count: 24_001), costPolicy: .minimizeSpend),
            override: .automatic,
            descriptors: descriptors.filter { $0.id == .codex || $0.id == .localDemo },
            availability: availableProviders
        )
        XCTAssertEqual(large.provider, .codex)
        XCTAssertTrue(large.reason.contains("favoring long-context providers"))
    }

    func testHarnessRecordsReasonAndActualProviderModel() async throws {
        let provider = StubProvider(
            descriptor: descriptors.first(where: { $0.id == .gemini })!,
            response: AIProviderResponse(text: "Grounded answer", model: "gemini-actual-test")
        )
        let harness = AIHarness(providers: [.gemini: provider])
        let result = try await harness.execute(request(preferredProvider: .gemini))
        let route = await harness.latestRoutingDecision()

        XCTAssertEqual(result.provider, .gemini)
        XCTAssertEqual(result.response.model, "gemini-actual-test")
        XCTAssertEqual(route?.provider, .gemini)
        XCTAssertEqual(route?.actualModel, "gemini-actual-test")
        XCTAssertFalse(route?.reason.isEmpty ?? true)
    }

    func testSignedOutCodexIsNotAnAvailableAutomaticRoute() throws {
        let signedOut = CodexAccountEnvelope(ok: true, account: .object([:]))
        XCTAssertFalse(CodexPlanProvider.isAuthenticated(signedOut))

        var availability = availableProviders
        availability[.codex] = CodexPlanProvider.isAuthenticated(signedOut)
        let automatic = try AIProviderRouter.decide(
            request: request(),
            override: .automatic,
            descriptors: descriptors,
            availability: availability
        )
        XCTAssertNotEqual(automatic.provider, .codex)
        XCTAssertThrowsError(try AIProviderRouter.decide(
            request: request(),
            override: .provider(.codex),
            descriptors: descriptors,
            availability: availability
        ))
    }

    private func request(
        task: StudyTaskKind = .tutor,
        context: String = "Class context",
        preferredProvider: ProviderIdentifier? = nil,
        costPolicy: AIProviderCostPolicy = .balanced
    ) -> AIStudyRequest {
        AIStudyRequest(
            spaceID: UUID(),
            task: task,
            prompt: "Help",
            tutorStyle: .coachFirst,
            context: context,
            citations: [],
            preferredProvider: preferredProvider,
            costPolicy: costPolicy
        )
    }

    private var availableProviders: [ProviderIdentifier: Bool] {
        Dictionary(uniqueKeysWithValues: ProviderIdentifier.allCases.map { ($0, true) })
    }

    private var descriptors: [ProviderDescriptor] {
        [
            ProviderDescriptor(id: .codex, title: "Codex plan", model: "auto", capabilities: [.text, .structuredOutput, .longContext], billingNote: "included"),
            ProviderDescriptor(id: .openAI, title: "OpenAI API", model: "test", capabilities: [.text, .structuredOutput, .longContext], billingNote: "metered"),
            ProviderDescriptor(id: .anthropic, title: "Anthropic", model: "test", capabilities: [.text, .structuredOutput, .longContext], billingNote: "metered"),
            ProviderDescriptor(id: .gemini, title: "Gemini", model: "test", capabilities: [.text, .structuredOutput, .longContext], billingNote: "metered"),
            ProviderDescriptor(id: .localDemo, title: "Local preview", model: "local", capabilities: [.text, .structuredOutput], billingNote: "free"),
        ]
    }
}

private struct StubProvider: AIProvider {
    let descriptor: ProviderDescriptor
    let response: AIProviderResponse

    func isAvailable() async -> Bool { true }
    func answer(_ request: AIStudyRequest) async throws -> AIProviderResponse { response }
}
