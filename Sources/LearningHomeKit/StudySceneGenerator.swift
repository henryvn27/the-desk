import Foundation

public struct StudySceneGenerationResult: Sendable {
    public var spec: StudySceneSpec
    public var provider: ProviderIdentifier
    public var model: String
}

public enum StudySceneGenerationError: Error, LocalizedError {
    case invalidScene

    public var errorDescription: String? {
        "The provider did not return a safe Study Canvas scene. Try a narrower topic or another provider."
    }
}

public actor StudySceneGenerator {
    public static let shared = StudySceneGenerator()
    private let harness: AIHarness

    public init(harness: AIHarness = .shared) { self.harness = harness }

    public func generate(
        request: AIStudyRequest,
        override: ProviderOverride = .automatic
    ) async throws -> StudySceneGenerationResult {
        let structuredRequest = AIStudyRequest(
            spaceID: request.spaceID,
            task: .visualize,
            prompt: Self.scenePrompt(topic: request.prompt),
            tutorStyle: request.tutorStyle,
            context: request.context,
            citations: request.citations,
            allowProviderKnowledge: request.allowProviderKnowledge,
            requestedModel: request.requestedModel,
            preferredProvider: request.preferredProvider,
            costPolicy: request.costPolicy
        )
        let executed = try await harness.execute(structuredRequest, override: override)
        var groundedCitations = request.citations
        if request.allowProviderKnowledge && executed.provider != .localDemo {
            groundedCitations.append(StudyCitation(label: "Provider-added knowledge may be uncited", origin: .modelKnowledge))
        }
        let spec: StudySceneSpec
        if executed.provider == .localDemo {
            spec = Self.localScene(topic: request.prompt, citations: groundedCitations)
        } else {
            guard let data = Self.jsonData(from: executed.response.text),
                  let generated = try? JSONDecoder().decode(GeneratedScene.self, from: data) else {
                throw StudySceneGenerationError.invalidScene
            }
            spec = generated.scene(citations: groundedCitations)
        }
        do { try spec.validate() }
        catch { throw StudySceneGenerationError.invalidScene }
        return StudySceneGenerationResult(spec: spec, provider: executed.provider, model: executed.response.model)
    }

    private static func scenePrompt(topic: String) -> String {
        """
        Create a compact, source-grounded interactive study scene for this topic: \(topic)

        Return only one JSON object with this exact shape and no Markdown fence:
        {
          "kind": "conceptMap|timeline|process|comparison|annotatedDiagram|equationGraph|parameterLab",
          "title": "short title",
          "summary": "two sentence learning summary",
          "nodes": [{"id":"unique-short-id","title":"label","detail":"concise explanation","role":"concept|input|result","x":0.0,"y":0.0}],
          "connections": [{"from":"node-id","to":"node-id","label":"relationship"}],
          "interactions": [{"kind":"reveal|hideLabels|reorder|parameter|prediction|explainAloud","label":"student action","targetNodeIDs":["node-id"]}],
          "accessibilitySummary": "complete text description of the visual"
        }

        Use 3 to 8 nodes. Coordinates must be between 0 and 1. Every connection must reference existing node IDs. Put source-specific claims in node details; The Desk attaches the verified source anchors after validation. Do not emit code, HTML, scripts, actions, or UI commands.
        """
    }

    private static func jsonData(from text: String) -> Data? {
        guard let start = text.firstIndex(of: "{"), let end = text.lastIndex(of: "}"), start <= end else { return nil }
        return String(text[start...end]).data(using: .utf8)
    }

    private static func localScene(topic: String, citations: [StudyCitation]) -> StudySceneSpec {
        let sourceTitle = citations.first?.label ?? "Class sources"
        return StudySceneSpec(
            kind: .conceptMap,
            title: topic.isEmpty ? "Study scene" : String(topic.prefix(72)),
            summary: "A source-grounded map that separates what to notice, what it means, and what to try next.",
            nodes: [
                SceneNode(id: "notice", title: "Notice", detail: sourceTitle, role: "input", x: 0.18, y: 0.5),
                SceneNode(id: "explain", title: "Explain", detail: "State the rule in your own words and name its assumptions.", x: 0.5, y: 0.28),
                SceneNode(id: "apply", title: "Apply", detail: "Use the rule on one new example before revealing the answer.", role: "result", x: 0.82, y: 0.55),
            ],
            connections: [
                SceneConnection(from: "notice", to: "explain", label: "interpret"),
                SceneConnection(from: "explain", to: "apply", label: "practice"),
            ],
            interactions: [
                SceneInteraction(kind: .hideLabels, label: "Recall without labels"),
                SceneInteraction(kind: .prediction, label: "Predict before reveal"),
                SceneInteraction(kind: .explainAloud, label: "Explain aloud"),
            ],
            citations: citations,
            accessibilitySummary: "Three connected steps move from noticing source evidence, to explaining the rule, to applying it in a new example."
        )
    }
}

private struct GeneratedScene: Decodable {
    var kind: StudySceneKind
    var title: String
    var summary: String
    var nodes: [GeneratedNode]
    var connections: [GeneratedConnection]?
    var interactions: [GeneratedInteraction]?
    var accessibilitySummary: String

    func scene(citations: [StudyCitation]) -> StudySceneSpec {
        StudySceneSpec(
            kind: kind,
            title: title,
            summary: summary,
            nodes: nodes.map { SceneNode(id: $0.id, title: $0.title, detail: $0.detail, role: $0.role ?? "concept", x: $0.x, y: $0.y) },
            connections: (connections ?? []).map { SceneConnection(from: $0.from, to: $0.to, label: $0.label ?? "") },
            interactions: (interactions ?? []).map { SceneInteraction(kind: $0.kind, label: $0.label, targetNodeIDs: $0.targetNodeIDs ?? []) },
            citations: citations,
            accessibilitySummary: accessibilitySummary
        )
    }
}

private struct GeneratedNode: Decodable {
    var id: String
    var title: String
    var detail: String
    var role: String?
    var x: Double
    var y: Double
}

private struct GeneratedConnection: Decodable {
    var from: String
    var to: String
    var label: String?
}

private struct GeneratedInteraction: Decodable {
    var kind: SceneInteraction.Kind
    var label: String
    var targetNodeIDs: [String]?
}
