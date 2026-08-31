import Foundation

public struct SuggestedStudyAction: Identifiable, Hashable, Sendable {
    public var id = UUID()
    public var title: String
    public var detail: String
    public var dueInDays: Int
    public var priority: Int
    public var sourceAnchor: SourceAnchor?

    public init(title: String, detail: String, dueInDays: Int, priority: Int, sourceAnchor: SourceAnchor? = nil) {
        self.title = title
        self.detail = detail
        self.dueInDays = dueInDays
        self.priority = priority
        self.sourceAnchor = sourceAnchor
    }
}

public struct StudyActionExtractionResult: Sendable {
    public var actions: [SuggestedStudyAction]
    public var provider: ProviderIdentifier
    public var model: String
}

public enum StudyActionExtractionError: Error, LocalizedError {
    case invalidResponse

    public var errorDescription: String? {
        "The provider did not return a safe action list. Nothing was added to assignments or Reminders."
    }
}

/// Produces reviewable suggestions only. This type has no assignment or EventKit
/// write access; the review sheet performs those writes after explicit approval.
@MainActor
public final class StudyActionExtractor {
    public static let shared = StudyActionExtractor()
    private let harness: AIHarness

    public init(harness: AIHarness = .shared) {
        self.harness = harness
    }

    public func extract(
        source: SourceAsset,
        revision: SourceRevisionRecord,
        space: StudySpace,
        override: ProviderOverride = .automatic
    ) async throws -> StudyActionExtractionResult {
        let chunks = Self.actionChunks(
            from: revision.extractedText,
            sourceID: source.id,
            revision: revision.revisionNumber
        )
        guard !chunks.isEmpty else {
            return StudyActionExtractionResult(actions: [], provider: .localDemo, model: "local-action-scanner")
        }

        var merged: [SuggestedStudyAction] = []
        var seenTitles = Set<String>()
        var provider: ProviderIdentifier?
        var model = ""
        for chunk in Self.evenlySample(chunks, limit: 12) {
            let request = AIStudyRequest(
                spaceID: space.id,
                task: .extractActions,
                prompt: Self.prompt,
                tutorStyle: space.tutorStyle,
                context: "SOURCE: \(source.title) · revision \(revision.revisionNumber)\nANCHOR: \(chunk.anchor.excerpt)\n\n\(chunk.text)",
                citations: [StudyCitation(label: source.title, origin: .classSource, anchor: chunk.anchor)],
                allowProviderKnowledge: false
            )
            let executed = try await harness.execute(request, override: override)
            if executed.provider == .localDemo {
                return StudyActionExtractionResult(
                    actions: Self.localActions(from: chunks),
                    provider: .localDemo,
                    model: executed.response.model
                )
            }
            if let provider, provider != executed.provider { throw StudyActionExtractionError.invalidResponse }
            provider = executed.provider
            model = executed.response.model
            guard let data = Self.jsonData(from: executed.response.text),
                  let envelope = try? JSONDecoder().decode(ActionEnvelope.self, from: data) else {
                throw StudyActionExtractionError.invalidResponse
            }
            let generated = envelope.actions.prefix(12)
            let validated = generated.compactMap { $0.validated(anchor: chunk.anchor) }
            guard validated.count == generated.count else { throw StudyActionExtractionError.invalidResponse }
            for action in validated {
                let key = action.title.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
                if seenTitles.insert(key).inserted { merged.append(action) }
                if merged.count == 12 { break }
            }
            if merged.count == 12 { break }
        }
        return StudyActionExtractionResult(actions: merged, provider: provider ?? .localDemo, model: model.isEmpty ? "local-action-scanner" : model)
    }

    private static let prompt = """
    Extract only concrete student follow-up actions from the supplied class source. Do not invent homework, dates, or submission state.

    Return one JSON object and no Markdown:
    {"actions":[{"title":"short action","detail":"source-grounded detail","dueInDays":1,"priority":1}]}

    Use zero to twelve actions. dueInDays must be an integer from 0 through 365 and should be 1 when the source gives no date. priority must be 0 (low), 1 (normal), 2 (high), or 3 (urgent). An empty actions array is correct when the source contains no concrete follow-up.
    """

    private static func jsonData(from text: String) -> Data? {
        guard let start = text.firstIndex(of: "{"),
              let end = text.lastIndex(of: "}"),
              start <= end else { return nil }
        return String(text[start...end]).data(using: .utf8)
    }

    private struct ActionChunk {
        var text: String
        var anchor: SourceAnchor
    }

    private static let actionSignals = [
        "todo", "to do", "need to", "follow up", "action", "submit", "finish", "revise",
        "practice", "review", "due", "homework", "assignment", "complete", "prepare", "quiz", "test", "bring", "read ",
    ]

    private static func actionChunks(from text: String, sourceID: UUID, revision: Int) -> [ActionChunk] {
        var page: Int?
        var timestamp: TimeInterval?
        var chunks: [ActionChunk] = []
        let lines = text.components(separatedBy: .newlines)
        for (index, raw) in lines.enumerated() {
            let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if let value = markerValue(line, prefix: "[[page:") { page = Int(value); timestamp = nil; continue }
            if let value = markerValue(line, prefix: "[[time:") { timestamp = TimeInterval(value); continue }
            let lowered = line.lowercased()
            guard line.count >= 8, actionSignals.contains(where: lowered.contains) else { continue }
            let lower = max(0, index - 2)
            let upper = min(lines.count, index + 3)
            let context = lines[lower..<upper].joined(separator: "\n")
            let anchor = SourceAnchor(
                sourceID: sourceID,
                revision: revision,
                page: page,
                timestamp: timestamp,
                excerpt: String(line.prefix(300))
            )
            chunks.append(ActionChunk(text: String(context.prefix(6_000)), anchor: anchor))
        }
        return chunks
    }

    private static func markerValue(_ line: String, prefix: String) -> String? {
        guard line.hasPrefix(prefix), line.hasSuffix("]]"), line.count > prefix.count + 2 else { return nil }
        return String(line.dropFirst(prefix.count).dropLast(2))
    }

    private static func evenlySample<T>(_ values: [T], limit: Int) -> [T] {
        guard values.count > limit, limit > 1 else { return Array(values.prefix(limit)) }
        return (0..<limit).map { index in
            values[index * (values.count - 1) / (limit - 1)]
        }
    }

    private static func localActions(from chunks: [ActionChunk]) -> [SuggestedStudyAction] {
        var seen = Set<String>()
        return evenlySample(chunks, limit: 12).compactMap { chunk in
            let title = chunk.anchor.excerpt.trimmingCharacters(in: CharacterSet(charactersIn: " -•*\t"))
            let key = title.lowercased()
            guard seen.insert(key).inserted else { return nil }
            return SuggestedStudyAction(
                title: String(title.prefix(110)),
                detail: "Suggested directly from the imported source. Review before adding.",
                dueInDays: 1,
                priority: 1,
                sourceAnchor: chunk.anchor
            )
        }
    }
}

private struct ActionEnvelope: Decodable {
    var actions: [GeneratedStudyAction]
}

private struct GeneratedStudyAction: Decodable {
    var title: String
    var detail: String
    var dueInDays: Int
    var priority: Int

    func validated(anchor: SourceAnchor) -> SuggestedStudyAction? {
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanDetail = detail.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...120).contains(cleanTitle.count),
              cleanDetail.count <= 600,
              (0...365).contains(dueInDays),
              (0...3).contains(priority) else { return nil }
        return SuggestedStudyAction(title: cleanTitle, detail: cleanDetail, dueInDays: dueInDays, priority: priority, sourceAnchor: anchor)
    }
}
