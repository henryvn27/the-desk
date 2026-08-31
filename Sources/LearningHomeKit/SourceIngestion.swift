import AVFoundation
import Foundation
import PDFKit
import Speech
import UniformTypeIdentifiers
import Vision

#if os(macOS)
import AppKit
#elseif os(iOS)
import UIKit
#endif

public struct PreparedSource: Sendable {
    public var title: String
    public var kind: SourceKind
    public var filename: String
    public var sha256: String
    public var extractedText: String
    public var anchorIndexData: Data
    public var storedFileURL: URL
    public var pageCount: Int
    public var duration: TimeInterval

    public init(
        title: String,
        kind: SourceKind,
        filename: String,
        sha256: String,
        extractedText: String,
        anchorIndexData: Data,
        storedFileURL: URL,
        pageCount: Int,
        duration: TimeInterval
    ) {
        self.title = title
        self.kind = kind
        self.filename = filename
        self.sha256 = sha256
        self.extractedText = extractedText
        self.anchorIndexData = anchorIndexData
        self.storedFileURL = storedFileURL
        self.pageCount = pageCount
        self.duration = duration
    }
}

public enum SourceIngestionError: Error, LocalizedError {
    case unsupportedType(String)
    case fileTooLarge
    case unreadable
    case speechPermission
    case transcription(String)
    case extractionLimit(String)

    public var errorDescription: String? {
        switch self {
        case .unsupportedType(let type): "The Desk cannot extract \(type) yet, but the original file was preserved."
        case .fileTooLarge: "This source exceeds The Desk's safe import limit for this file type. Split it into smaller volumes before importing."
        case .unreadable: "The selected source could not be read."
        case .speechPermission: "Speech recognition permission is required to transcribe this recording."
        case .transcription(let message): "Transcription failed: \(message)"
        case .extractionLimit(let message): message
        }
    }
}

enum PDFExtractionLimits {
    static let maximumPages = 20_000
    static let maximumPageTextBytes = 2 * 1_024 * 1_024
    static let maximumTotalTextBytes = 64 * 1_024 * 1_024
}

public actor SourceIngestionService {
    public static let shared = SourceIngestionService()

    private let engine: LearningEngineClient

    public init(engine: LearningEngineClient = .shared) {
        self.engine = engine
    }

    public func prepare(_ sourceURL: URL) async throws -> PreparedSource {
        let accessed = sourceURL.startAccessingSecurityScopedResource()
        defer { if accessed { sourceURL.stopAccessingSecurityScopedResource() } }

        let kind = Self.kind(for: sourceURL)
        let fileSize = try sourceURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard fileSize >= 0, Int64(fileSize) <= Self.maximumFileBytes(for: kind) else {
            throw SourceIngestionError.fileTooLarge
        }
        let digest = try SHA256Digest.hex(fileURL: sourceURL)
        let storedURL = try storeOriginal(sourceURL, digest: digest)
        let filename = sourceURL.lastPathComponent
        let title = sourceURL.deletingPathExtension().lastPathComponent
        var text = ""
        var pageCount = 0
        var duration: TimeInterval = 0
        var anchors: [SourceAnchor] = []

        switch kind {
        case .pdf:
            guard let document = PDFDocument(url: storedURL) else { throw SourceIngestionError.unreadable }
            let extraction = try await extractPDFIncrementally(document, digest: digest)
            pageCount = extraction.pageCount
            text = extraction.text
            anchors = extraction.anchors
        case .image:
            text = try recognizeText(in: storedURL)
        case .audio:
            duration = (try? await AVURLAsset(url: storedURL).load(.duration).seconds) ?? 0
            text = try await transcribe(storedURL)
            anchors = Self.timestampAnchors(from: text)
        case .document, .presentation, .epub:
            let extraction = try await engine.extract(fileURL: storedURL)
            text = extraction.text
            pageCount = extraction.pageCount
        case .note:
            guard let data = try? Data(contentsOf: storedURL) else { throw SourceIngestionError.unreadable }
            text = String(data: data, encoding: .utf8)
                ?? String(data: data, encoding: .utf16)
                ?? String(decoding: data, as: UTF8.self)
        case .url, .wispr:
            guard let data = try? Data(contentsOf: storedURL) else { throw SourceIngestionError.unreadable }
            text = String(decoding: data, as: UTF8.self)
        }

        return PreparedSource(
            title: title,
            kind: kind,
            filename: filename,
            sha256: digest,
            extractedText: text.trimmingCharacters(in: .whitespacesAndNewlines),
            anchorIndexData: (try? JSONEncoder().encode(anchors)) ?? Data(),
            storedFileURL: storedURL,
            pageCount: pageCount,
            duration: duration
        )
    }

    private func storeOriginal(_ sourceURL: URL, digest: String) throws -> URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("TheDesk/Sources", isDirectory: true)
            .appendingPathComponent(digest, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let suffix = sourceURL.pathExtension.isEmpty ? "" : ".\(sourceURL.pathExtension.lowercased())"
        let destination = root.appendingPathComponent("original\(suffix)")
        if !FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.copyItem(at: sourceURL, to: destination)
        }
        return destination
    }

    private struct PDFCheckpointManifest: Codable {
        var digest: String
        var pageCount: Int
        var nextPageIndex: Int
        var totalTextBytes: Int
    }

    private func extractPDFIncrementally(_ document: PDFDocument, digest: String) async throws -> (text: String, pageCount: Int, anchors: [SourceAnchor]) {
        guard document.pageCount <= PDFExtractionLimits.maximumPages else {
            throw SourceIngestionError.extractionLimit("This PDF has more than The Desk's 20,000-page safety limit.")
        }
        let directory = try checkpointDirectory(for: digest)
        var checkpoint = restoredCheckpoint(
            from: directory,
            digest: digest,
            pageCount: document.pageCount
        )
        if checkpoint == nil {
            try resetCheckpointDirectory(directory)
            checkpoint = PDFCheckpointManifest(
                digest: digest,
                pageCount: document.pageCount,
                nextPageIndex: 0,
                totalTextBytes: 0
            )
            try persist(checkpoint!, to: manifestURL(in: directory))
        }
        var manifest = checkpoint!

        for index in manifest.nextPageIndex..<document.pageCount {
            try Task.checkCancellation()
            var pageText = ""
            if let page = document.page(at: index) {
                pageText = page.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if pageText.isEmpty {
                    pageText = (try? recognizeText(in: page))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                }
            }
            let pageBytes = pageText.utf8.count
            guard pageBytes <= PDFExtractionLimits.maximumPageTextBytes else {
                throw SourceIngestionError.extractionLimit("Page \(index + 1) exceeds The Desk's 2 MB extracted-text safety limit.")
            }
            let contribution = pageText.isEmpty
                ? 0
                : "[[page:\(index + 1)]]\n\(pageText)\n\n".utf8.count
            guard manifest.totalTextBytes + contribution <= PDFExtractionLimits.maximumTotalTextBytes else {
                throw SourceIngestionError.extractionLimit("This PDF contains more than The Desk's 64 MB extracted-text safety limit.")
            }
            try Data(pageText.utf8).write(
                to: pageChunkURL(index: index, in: directory),
                options: [.atomic, .completeFileProtectionUnlessOpen]
            )
            manifest.nextPageIndex = index + 1
            manifest.totalTextBytes += contribution
            try persist(manifest, to: manifestURL(in: directory))
            if manifest.nextPageIndex.isMultiple(of: 12) { await Task.yield() }
        }

        var text = ""
        text.reserveCapacity(manifest.totalTextBytes)
        var anchors: [SourceAnchor] = []
        anchors.reserveCapacity(min(document.pageCount, 4_096))
        var assembledBytes = 0
        for index in 0..<document.pageCount {
            let data = try Data(contentsOf: pageChunkURL(index: index, in: directory), options: [.mappedIfSafe])
            guard data.count <= PDFExtractionLimits.maximumPageTextBytes,
                  let pageText = String(data: data, encoding: .utf8) else {
                throw SourceIngestionError.extractionLimit("A PDF checkpoint page was invalid and must be processed again.")
            }
            guard !pageText.isEmpty else { continue }
            let part = "[[page:\(index + 1)]]\n\(pageText)\n\n"
            assembledBytes += part.utf8.count
            guard assembledBytes <= PDFExtractionLimits.maximumTotalTextBytes else {
                throw SourceIngestionError.extractionLimit("This PDF contains more than The Desk's 64 MB extracted-text safety limit.")
            }
            text += part
            anchors.append(SourceAnchor(sourceID: UUID(), page: index + 1, excerpt: String(pageText.prefix(240))))
        }
        guard assembledBytes == manifest.totalTextBytes else {
            throw SourceIngestionError.extractionLimit("The PDF checkpoint did not match its resume manifest.")
        }
        try? FileManager.default.removeItem(at: directory)
        return (text, document.pageCount, anchors)
    }

    private func checkpointDirectory(for digest: String) throws -> URL {
        guard digest.count == 64, digest.utf8.allSatisfy({ byte in
            (48...57).contains(byte) || (97...102).contains(byte)
        }) else { throw SourceIngestionError.unreadable }
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("TheDesk/Checkpoints", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root.appendingPathComponent(digest, isDirectory: true)
    }

    private func resetCheckpointDirectory(_ directory: URL) throws {
        if FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.removeItem(at: directory)
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    private func manifestURL(in directory: URL) -> URL {
        directory.appendingPathComponent("manifest.json")
    }

    private func pageChunkURL(index: Int, in directory: URL) -> URL {
        directory.appendingPathComponent(String(format: "page-%06d.txt", index + 1))
    }

    private func restoredCheckpoint(
        from directory: URL,
        digest: String,
        pageCount: Int
    ) -> PDFCheckpointManifest? {
        guard let data = try? Data(contentsOf: manifestURL(in: directory)),
              let stored = try? JSONDecoder().decode(PDFCheckpointManifest.self, from: data),
              stored.digest == digest,
              stored.pageCount == pageCount,
              (0...pageCount).contains(stored.nextPageIndex),
              stored.totalTextBytes >= 0,
              stored.totalTextBytes <= PDFExtractionLimits.maximumTotalTextBytes else { return nil }
        var verifiedBytes = 0
        for index in 0..<stored.nextPageIndex {
            guard let data = try? Data(contentsOf: pageChunkURL(index: index, in: directory), options: [.mappedIfSafe]),
                  data.count <= PDFExtractionLimits.maximumPageTextBytes,
                  let pageText = String(data: data, encoding: .utf8) else { return nil }
            if !pageText.isEmpty {
                verifiedBytes += "[[page:\(index + 1)]]\n\(pageText)\n\n".utf8.count
                guard verifiedBytes <= PDFExtractionLimits.maximumTotalTextBytes else { return nil }
            }
        }
        return verifiedBytes == stored.totalTextBytes ? stored : nil
    }

    private func persist(_ checkpoint: PDFCheckpointManifest, to url: URL) throws {
        let data = try JSONEncoder().encode(checkpoint)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
    }

    private func recognizeText(in url: URL) throws -> String {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        let handler = VNImageRequestHandler(url: url)
        try handler.perform([request])
        return (request.results ?? [])
            .compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: "\n")
    }

    private func recognizeText(in page: PDFPage) throws -> String {
        let bounds = page.bounds(for: .mediaBox)
        let scale = min(3, max(1, 2_200 / max(bounds.width, bounds.height)))
        let size = CGSize(width: max(1, bounds.width * scale), height: max(1, bounds.height * scale))
        let thumbnail = page.thumbnail(of: size, for: .mediaBox)
        #if os(macOS)
        guard let image = thumbnail.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            throw SourceIngestionError.unreadable
        }
        #else
        guard let image = thumbnail.cgImage else { throw SourceIngestionError.unreadable }
        #endif

        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        try VNImageRequestHandler(cgImage: image).perform([request])
        return (request.results ?? [])
            .compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: "\n")
    }

    private func transcribe(_ url: URL) async throws -> String {
        let authorization = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard authorization == .authorized else { throw SourceIngestionError.speechPermission }
        guard let recognizer = SFSpeechRecognizer(locale: Locale.current), recognizer.isAvailable else {
            throw SourceIngestionError.transcription("Speech recognition is unavailable")
        }

        return try await withCheckedThrowingContinuation { continuation in
            let request = SFSpeechURLRecognitionRequest(url: url)
            request.shouldReportPartialResults = false
            if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
            var task: SFSpeechRecognitionTask?
            task = recognizer.recognitionTask(with: request) { result, error in
                if let error {
                    task?.cancel()
                    continuation.resume(throwing: SourceIngestionError.transcription(error.localizedDescription))
                } else if let result, result.isFinal {
                    let segments = result.bestTranscription.segments.map { segment in
                        "[[time:\(String(format: "%.2f", segment.timestamp))]]\n\(segment.substring)"
                    }
                    task?.finish()
                    continuation.resume(returning: segments.joined(separator: "\n\n"))
                }
            }
        }
    }

    private static func kind(for url: URL) -> SourceKind {
        let type = UTType(filenameExtension: url.pathExtension.lowercased())
        if type?.conforms(to: .pdf) == true { return .pdf }
        if type?.conforms(to: .image) == true { return .image }
        if type?.conforms(to: .audio) == true { return .audio }
        switch url.pathExtension.lowercased() {
        case "epub": return .epub
        case "doc", "docx", "rtf": return .document
        case "ppt", "pptx", "key": return .presentation
        case "json": return .wispr
        default: return .note
        }
    }

    private static func maximumFileBytes(for kind: SourceKind) -> Int64 {
        switch kind {
        case .pdf: 1 * 1_024 * 1_024 * 1_024
        case .audio: 2 * 1_024 * 1_024 * 1_024
        case .image: 100 * 1_024 * 1_024
        case .document, .presentation, .epub: 256 * 1_024 * 1_024
        case .note, .url, .wispr: 32 * 1_024 * 1_024
        }
    }

    private static func timestampAnchors(from text: String) -> [SourceAnchor] {
        text.components(separatedBy: "\n\n").compactMap { block in
            guard block.hasPrefix("[[time:"),
                  let raw = block.dropFirst(7).split(separator: "]").first,
                  let timestamp = TimeInterval(raw) else { return nil }
            let excerpt = block.components(separatedBy: "\n").dropFirst().joined(separator: " ")
            return SourceAnchor(sourceID: UUID(), timestamp: timestamp, excerpt: excerpt)
        }
    }
}

public extension LearningHomeStore {
    func importPreparedSource(
        _ prepared: PreparedSource,
        into spaceID: UUID,
        connector: String = "Local"
    ) async throws -> SourceAsset {
        let source = try await addSource(
            to: spaceID,
            title: prepared.title,
            kind: prepared.kind,
            filename: prepared.filename,
            sha256: prepared.sha256,
            extractedText: prepared.extractedText,
            anchorIndexData: prepared.anchorIndexData,
            originalFilePath: prepared.storedFileURL.path,
            connector: connector,
            pageCount: prepared.pageCount,
            duration: prepared.duration
        )
        #if os(macOS)
        if let revision = latestRevision(for: source.id) {
            let document = SearchDocument(sourceID: source.id, revision: revision.revisionNumber, text: revision.extractedText)
            Task { try? await StudySearchService.shared.index(document) }
        }
        #endif
        return source
    }

    @discardableResult
    func importPreparedRevision(
        _ prepared: PreparedSource,
        sourceID: UUID
    ) async throws -> SourceRevisionRecord? {
        let revision = try await addRevision(
            to: sourceID,
            sha256: prepared.sha256,
            extractedText: prepared.extractedText,
            anchorIndexData: prepared.anchorIndexData,
            originalFilePath: prepared.storedFileURL.path,
            pageCount: prepared.pageCount,
            duration: prepared.duration
        )
        #if os(macOS)
        if let revision {
            let document = SearchDocument(sourceID: sourceID, revision: revision.revisionNumber, text: revision.extractedText)
            Task { try? await StudySearchService.shared.index(document) }
        }
        #endif
        return revision
    }
}
