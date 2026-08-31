import Foundation
import SQLite3

public struct SearchHit: Identifiable, Hashable, Sendable {
    public var id = UUID()
    public var sourceID: UUID
    public var revision: Int
    public var page: Int?
    public var timestamp: TimeInterval?
    public var excerpt: String
    public var score: Double

    public init(sourceID: UUID, revision: Int, page: Int?, timestamp: TimeInterval?, excerpt: String, score: Double) {
        self.sourceID = sourceID
        self.revision = revision
        self.page = page
        self.timestamp = timestamp
        self.excerpt = excerpt
        self.score = score
    }
}

public struct SearchDocument: Sendable {
    public var sourceID: UUID
    public var revision: Int
    public var text: String

    public init(sourceID: UUID, revision: Int, text: String) {
        self.sourceID = sourceID
        self.revision = revision
        self.text = text
    }
}

public enum SearchIndexError: Error, LocalizedError {
    case open(String), statement(String), write(String)

    public var errorDescription: String? {
        switch self {
        case .open(let message): "Could not open the study search index: \(message)"
        case .statement(let message): "Could not query the study search index: \(message)"
        case .write(let message): "Could not update the study search index: \(message)"
        }
    }
}

public final class LocalSearchIndex: @unchecked Sendable {
    private var database: OpaquePointer?
    private let lock = NSLock()
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    public init(url: URL? = nil) throws {
        let path: String
        if let url {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            path = url.path
        } else {
            path = ":memory:"
        }

        guard sqlite3_open_v2(path, &database, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            throw SearchIndexError.open(Self.message(database))
        }
        try execute("PRAGMA journal_mode=WAL")
        try execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS source_segments USING fts5(
                source_id UNINDEXED,
                revision UNINDEXED,
                page UNINDEXED,
                timestamp UNINDEXED,
                content,
                tokenize='unicode61 remove_diacritics 2'
            )
            """)
    }

    deinit {
        sqlite3_close(database)
    }

    public func index(sourceID: UUID, revision: Int, text: String) throws {
        lock.lock()
        defer { lock.unlock() }

        try executeLocked("BEGIN IMMEDIATE")
        do {
            var deleteStatement: OpaquePointer?
            try prepare("DELETE FROM source_segments WHERE source_id = ?", into: &deleteStatement)
            defer { sqlite3_finalize(deleteStatement) }
            sqlite3_bind_text(deleteStatement, 1, sourceID.uuidString, -1, transient)
            guard sqlite3_step(deleteStatement) == SQLITE_DONE else {
                throw SearchIndexError.write(Self.message(database))
            }

            var insertStatement: OpaquePointer?
            try prepare(
                "INSERT INTO source_segments(source_id, revision, page, timestamp, content) VALUES (?, ?, ?, ?, ?)",
                into: &insertStatement
            )
            defer { sqlite3_finalize(insertStatement) }

            for segment in Self.segments(from: text) {
                sqlite3_reset(insertStatement)
                sqlite3_clear_bindings(insertStatement)
                sqlite3_bind_text(insertStatement, 1, sourceID.uuidString, -1, transient)
                sqlite3_bind_int(insertStatement, 2, Int32(revision))
                if let page = segment.page { sqlite3_bind_int(insertStatement, 3, Int32(page)) }
                else { sqlite3_bind_null(insertStatement, 3) }
                if let timestamp = segment.timestamp { sqlite3_bind_double(insertStatement, 4, timestamp) }
                else { sqlite3_bind_null(insertStatement, 4) }
                sqlite3_bind_text(insertStatement, 5, segment.text, -1, transient)
                guard sqlite3_step(insertStatement) == SQLITE_DONE else {
                    throw SearchIndexError.write(Self.message(database))
                }
            }
            try executeLocked("COMMIT")
        } catch {
            try? executeLocked("ROLLBACK")
            throw error
        }
    }

    public func remove(sourceID: UUID) throws {
        lock.lock()
        defer { lock.unlock() }
        var statement: OpaquePointer?
        try prepare("DELETE FROM source_segments WHERE source_id = ?", into: &statement)
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, sourceID.uuidString, -1, transient)
        guard sqlite3_step(statement) == SQLITE_DONE else { throw SearchIndexError.write(Self.message(database)) }
    }

    public func reset() throws {
        lock.lock()
        defer { lock.unlock() }
        try executeLocked("DELETE FROM source_segments")
    }

    public func search(_ query: String, sourceIDs: Set<UUID>? = nil, limit: Int = 8) throws -> [SearchHit] {
        let terms = query
            .split { !$0.isLetter && !$0.isNumber }
            .map(String.init)
            .filter { $0.count > 1 }
            .prefix(12)
        guard !terms.isEmpty else { return [] }
        if let sourceIDs, sourceIDs.isEmpty { return [] }

        lock.lock()
        defer { lock.unlock() }

        let match = terms.map { "\"\($0.replacingOccurrences(of: "\"", with: ""))\"" }.joined(separator: " OR ")
        let filteredIDs = sourceIDs?.map(\.uuidString).sorted() ?? []
        let sourceClause = filteredIDs.isEmpty ? "" : " AND source_id IN (\(Array(repeating: "?", count: filteredIDs.count).joined(separator: ",")))"
        let sql = """
            SELECT source_id, revision, page, timestamp,
                   snippet(source_segments, 4, '‹', '›', ' … ', 28),
                   bm25(source_segments)
            FROM source_segments
            WHERE source_segments MATCH ?\(sourceClause)
            ORDER BY bm25(source_segments)
            LIMIT ?
            """
        var statement: OpaquePointer?
        try prepare(sql, into: &statement)
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, match, -1, transient)
        for (offset, identifier) in filteredIDs.enumerated() {
            sqlite3_bind_text(statement, Int32(offset + 2), identifier, -1, transient)
        }
        sqlite3_bind_int(statement, Int32(filteredIDs.count + 2), Int32(max(1, min(limit, 100))))

        var hits: [SearchHit] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            guard let sourceString = sqlite3_column_text(statement, 0).map({ String(cString: $0) }),
                  let sourceID = UUID(uuidString: sourceString) else { continue }
            hits.append(SearchHit(
                sourceID: sourceID,
                revision: Int(sqlite3_column_int(statement, 1)),
                page: sqlite3_column_type(statement, 2) == SQLITE_NULL ? nil : Int(sqlite3_column_int(statement, 2)),
                timestamp: sqlite3_column_type(statement, 3) == SQLITE_NULL ? nil : sqlite3_column_double(statement, 3),
                excerpt: sqlite3_column_text(statement, 4).map { String(cString: $0) } ?? "",
                score: -sqlite3_column_double(statement, 5)
            ))
            if hits.count == limit { break }
        }
        return hits
    }

    private func execute(_ sql: String) throws {
        lock.lock()
        defer { lock.unlock() }
        try executeLocked(sql)
    }

    private func executeLocked(_ sql: String) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else {
            throw SearchIndexError.write(Self.message(database))
        }
    }

    private func prepare(_ sql: String, into statement: inout OpaquePointer?) throws {
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else {
            throw SearchIndexError.statement(Self.message(database))
        }
    }

    private static func message(_ database: OpaquePointer?) -> String {
        database.flatMap(sqlite3_errmsg).map(String.init(cString:)) ?? "Unknown SQLite error"
    }

    private struct Segment {
        var page: Int?
        var timestamp: TimeInterval?
        var text: String
    }

    private static func segments(from text: String) -> [Segment] {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
        let paragraphs = normalized.components(separatedBy: "\n\n")
        var result: [Segment] = []
        var page: Int?
        var timestamp: TimeInterval?

        for paragraph in paragraphs {
            let value = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty else { continue }
            if value.hasPrefix("[[page:") {
                page = Int(value.dropFirst(7).prefix { $0.isNumber })
            }
            if value.hasPrefix("[[time:") {
                timestamp = TimeInterval(value.dropFirst(7).prefix { $0.isNumber || $0 == "." })
            }
            for chunk in value.chunked(maxCharacters: 900) {
                result.append(Segment(page: page, timestamp: timestamp, text: chunk))
            }
        }
        return result.isEmpty && !normalized.isEmpty ? [Segment(page: nil, timestamp: nil, text: normalized)] : result
    }
}

public actor StudySearchService {
    public static let shared = StudySearchService()
    private let index: LocalSearchIndex?

    public init(url: URL? = nil) {
        let resolvedURL: URL?
        if let url {
            resolvedURL = url
        } else if let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            resolvedURL = support.appendingPathComponent("TheDesk/Search/index.sqlite")
        } else {
            resolvedURL = nil
        }
        index = try? LocalSearchIndex(url: resolvedURL)
    }

    public func rebuild(_ documents: [SearchDocument]) throws {
        guard let index else { throw SearchIndexError.open("The persistent index is unavailable") }
        try index.reset()
        for document in documents {
            try index.index(sourceID: document.sourceID, revision: document.revision, text: document.text)
        }
    }

    public func index(_ document: SearchDocument) throws {
        guard let index else { throw SearchIndexError.open("The persistent index is unavailable") }
        try index.index(sourceID: document.sourceID, revision: document.revision, text: document.text)
    }

    public func search(_ query: String, sourceIDs: Set<UUID>, limit: Int = 8) throws -> [SearchHit] {
        guard let index else { throw SearchIndexError.open("The persistent index is unavailable") }
        return try index.search(query, sourceIDs: sourceIDs, limit: limit)
    }
}

private extension String {
    func chunked(maxCharacters: Int) -> [String] {
        guard count > maxCharacters else { return [self] }
        var chunks: [String] = []
        var start = startIndex
        while start < endIndex {
            let tentative = index(start, offsetBy: maxCharacters, limitedBy: endIndex) ?? endIndex
            let end = self[start..<tentative].lastIndex(of: " ") ?? tentative
            let chunk = self[start..<end].trimmingCharacters(in: .whitespacesAndNewlines)
            if !chunk.isEmpty { chunks.append(chunk) }
            start = end < endIndex ? index(after: end) : endIndex
        }
        return chunks
    }
}
