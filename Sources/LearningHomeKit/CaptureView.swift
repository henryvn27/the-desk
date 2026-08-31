import AVFoundation
import SwiftUI
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
import VisionKit
#endif

public struct CaptureView: View {
    private enum CaptureKind: String, CaseIterable, Identifiable {
        case note = "Note"
        case file = "File or photo"
        case link = "Link"
        case audio = "Recording"
        var id: String { rawValue }
    }

    @EnvironmentObject private var store: LearningHomeStore
    @StateObject private var recorder = StudyAudioRecorder()
    @ViewStorage private var kind: CaptureKind = .note
    @ViewStorage private var destinationID: UUID?
    @ViewStorage private var noteTitle = ""
    @ViewStorage private var noteBody = ""
    @ViewStorage private var linkText = ""
    @ViewStorage private var showingImporter = false
    #if os(iOS)
    @ViewStorage private var showingScanner = false
    #endif
    @ViewStorage private var isWorking = false
    @ViewStorage private var statusMessage = ""
    @ViewStorage private var errorMessage: String?

    public init() {}

    private var destination: UUID? { destinationID ?? store.selectedSpaceID ?? store.spaces.first?.id }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LHSpacing.lg) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Capture Inbox")
                        .font(.system(.largeTitle, design: .serif, weight: .semibold))
                    Text("Everything gets a space. Suggested destinations always wait for your approval.")
                        .foregroundStyle(.secondary)
                }

                HStack {
                    Picker("Capture type", selection: $kind) {
                        ForEach(CaptureKind.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    Spacer(minLength: LHSpacing.lg)
                    Picker("Destination", selection: $destinationID) {
                        ForEach(store.spaces) { Text($0.title).tag(Optional($0.id)) }
                    }
                    .frame(width: 220)
                }

                captureSurface

                if !statusMessage.isEmpty {
                    Label(statusMessage, systemImage: "checkmark.circle.fill")
                        .foregroundStyle(LearningPalette.success)
                        .font(.subheadline)
                }

                queuePreview
            }
            .padding(LHSpacing.lg)
            .frame(maxWidth: 880, alignment: .leading)
        }
        .background(LearningPalette.appBackground)
        .navigationTitle("Capture")
        .onAppear { if destinationID == nil { destinationID = destination } }
        .fileImporter(isPresented: $showingImporter, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls): importFiles(urls)
            case .failure(let error): errorMessage = error.localizedDescription
            }
        }
        #if os(iOS)
        .sheet(isPresented: $showingScanner) {
            DocumentScannerView { result in
                showingScanner = false
                switch result {
                case .success(let url): importFiles([url])
                case .failure(let error): errorMessage = error.localizedDescription
                }
            }
        }
        #endif
        .alert("Capture failed", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "Unknown error") }
    }

    @ViewBuilder
    private var captureSurface: some View {
        switch kind {
        case .note: noteCapture
        case .file: fileCapture
        case .link: linkCapture
        case .audio: audioCapture
        }
    }

    private var noteCapture: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            Label("Quick note", systemImage: "square.and.pencil").font(.headline)
            TextField("Title", text: $noteTitle)
                .textFieldStyle(.roundedBorder)
            TextEditor(text: $noteBody)
                .font(.body)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 190)
                .padding(LHSpacing.sm)
                .background(LearningPalette.secondarySurface, in: RoundedRectangle(cornerRadius: LHRadius.surface))
            HStack {
                Text("Paste typed notes or a Wispr transcript excerpt.").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Save to space", action: saveNote)
                    .buttonStyle(.borderedProminent)
                    .disabled(noteBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || destination == nil)
            }
        }
        .padding(LHSpacing.lg)
        .learningSurface()
    }

    private var fileCapture: some View {
        VStack(spacing: LHSpacing.md) {
            Image(systemName: "doc.viewfinder")
                .font(.system(size: 38, weight: .light))
                .foregroundStyle(LearningPalette.indigo)
            Text("Textbooks, notes, slides, photos, or audio")
                .font(.title3.weight(.semibold))
            Text("Originals are preserved, deduplicated by SHA-256, and indexed with page or timestamp anchors on the Mac.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 540)
            HStack {
                #if os(iOS)
                Button { showingScanner = true } label: { Label("Scan pages", systemImage: "doc.viewfinder") }
                    .buttonStyle(.borderedProminent)
                    .disabled(destination == nil || isWorking || !VNDocumentCameraViewController.isSupported)
                #endif
                Button { showingImporter = true } label: { Label("Choose files", systemImage: "plus") }
                    .buttonStyle(.bordered)
                    .disabled(destination == nil || isWorking)
            }
            if isWorking { ProgressView().controlSize(.small) }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, LHSpacing.xxl)
        .padding(.horizontal, LHSpacing.lg)
        .learningSurface()
    }

    private var linkCapture: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            Label("Add a lesson or reference", systemImage: "link").font(.headline)
            TextField("https://…", text: $linkText)
                .textFieldStyle(.roundedBorder)
            Text("Khan Academy links are stored with a return check-in; The Desk never scrapes answers or progress.")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Save link", action: saveLink)
                    .buttonStyle(.borderedProminent)
                    .disabled(URL(string: linkText)?.scheme?.hasPrefix("http") != true || destination == nil)
            }
        }
        .padding(LHSpacing.lg)
        .learningSurface()
    }

    private var audioCapture: some View {
        VStack(spacing: LHSpacing.md) {
            ZStack {
                Circle().fill((recorder.isRecording ? LearningPalette.danger : LearningPalette.indigo).opacity(0.1))
                Image(systemName: recorder.isRecording ? "stop.fill" : "mic.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(recorder.isRecording ? LearningPalette.danger : LearningPalette.indigo)
            }
            .frame(width: 72, height: 72)
            Text(recorder.isRecording ? recorder.elapsed.formattedRecordingTime : "Record a study session")
                .font(.title3.weight(.semibold).monospacedDigit())
            Text("Recording is visible, user-started, and transcribed only after you stop.")
                .font(.subheadline).foregroundStyle(.secondary)
            Button(recorder.isRecording ? "Stop and import" : "Start recording") {
                if recorder.isRecording {
                    if let url = recorder.stop() { importFiles([url]) }
                } else {
                    Task { do { try await recorder.start() } catch { errorMessage = error.localizedDescription } }
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(recorder.isRecording ? LearningPalette.danger : LearningPalette.indigo)
            .disabled(destination == nil || isWorking)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, LHSpacing.xl)
        .learningSurface()
    }

    private var queuePreview: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            SectionHeading("Mac processing queue", detail: "Companion captures wait safely when the Mac is offline.")
            if store.jobs.isEmpty {
                Text("No queued captures").foregroundStyle(.secondary).padding(LHSpacing.md).frame(maxWidth: .infinity, alignment: .leading).learningSurface()
            } else {
                ForEach(store.jobs.prefix(5)) { job in
                    HStack {
                        Image(systemName: job.state == .completed ? "checkmark.circle" : "desktopcomputer.and.arrow.down")
                        Text(job.kindRaw.capitalized).font(.subheadline.weight(.medium))
                        Spacer()
                        StatusPill(job.stateRaw, tone: job.state == .failedFinal ? .danger : .neutral)
                    }
                    .padding(LHSpacing.sm)
                    .learningSurface(emphasized: false)
                }
            }
        }
    }

    private func saveNote() {
        guard let destination else { return }
        let title = noteTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Untitled note" : noteTitle
        #if os(iOS)
        Task {
            do {
                let id = try await CloudCaptureQueue.shared.enqueueText(noteBody, title: title, spaceID: destination, kind: "note")
                try store.createJob(kind: "noteCapture", payload: Data(noteBody.utf8), state: .waitingForMac, idempotencyKey: id)
                finishCapture("Queued for your Mac")
            } catch { errorMessage = error.localizedDescription }
        }
        #else
        Task {
            do {
                try await store.addNote(to: destination, title: title, body: noteBody)
                finishCapture("Saved to \(store.space(id: destination)?.title ?? "space")")
            } catch { errorMessage = error.localizedDescription }
        }
        #endif
    }

    private func saveLink() {
        guard let destination, let url = URL(string: linkText) else { return }
        let title = url.host() ?? "Study link"
        let body = url.absoluteString
        #if os(iOS)
        Task {
            do {
                let id = try await CloudCaptureQueue.shared.enqueueText(body, title: title, spaceID: destination, kind: "url")
                try store.createJob(kind: "urlCapture", payload: Data(body.utf8), state: .waitingForMac, idempotencyKey: id)
                finishCapture("Link queued for your Mac")
            } catch { errorMessage = error.localizedDescription }
        }
        #else
        Task {
            do {
                _ = try await store.addSource(to: destination, title: title, kind: .url, filename: "link.url", sha256: SHA256Digest.hex(Data(body.utf8)), extractedText: body)
                finishCapture("Link saved")
            } catch { errorMessage = error.localizedDescription }
        }
        #endif
    }

    private func importFiles(_ urls: [URL]) {
        guard let destination else { return }
        isWorking = true
        Task {
            do {
                #if os(iOS)
                for url in urls {
                    let id = try await CloudCaptureQueue.shared.enqueueFile(url, spaceID: destination)
                    try store.createJob(kind: "fileCapture", payload: Data(), state: .waitingForMac, idempotencyKey: id)
                }
                finishCapture("Queued for your Mac")
                #else
                for url in urls {
                    let prepared = try await SourceIngestionService.shared.prepare(url)
                    _ = try await store.importPreparedSource(prepared, into: destination)
                }
                finishCapture("Imported \(urls.count) item\(urls.count == 1 ? "" : "s")")
                #endif
            } catch { errorMessage = error.localizedDescription }
            isWorking = false
        }
    }

    private func finishCapture(_ message: String) {
        noteTitle = ""
        noteBody = ""
        linkText = ""
        statusMessage = message
    }
}

#if os(iOS)
private struct DocumentScannerView: UIViewControllerRepresentable {
    let completion: (Result<URL, Error>) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(completion: completion) }

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let controller = VNDocumentCameraViewController()
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: VNDocumentCameraViewController, context: Context) {}

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let completion: (Result<URL, Error>) -> Void

        init(completion: @escaping (Result<URL, Error>) -> Void) {
            self.completion = completion
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            do { completion(.success(try Self.writePDF(scan))) }
            catch { completion(.failure(error)) }
            controller.dismiss(animated: true)
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
            controller.dismiss(animated: true)
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
            completion(.failure(error))
            controller.dismiss(animated: true)
        }

        private static func writePDF(_ scan: VNDocumentCameraScan) throws -> URL {
            guard scan.pageCount > 0 else { throw DocumentScannerError.emptyScan }
            let root = FileManager.default.temporaryDirectory.appendingPathComponent("TheDeskScans", isDirectory: true)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            let url = root.appendingPathComponent("Scan-\(UUID().uuidString).pdf")
            let first = scan.imageOfPage(at: 0)
            let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: first.size))
            try renderer.writePDF(to: url) { context in
                for index in 0..<scan.pageCount {
                    let image = scan.imageOfPage(at: index)
                    let bounds = CGRect(origin: .zero, size: image.size)
                    context.beginPage(withBounds: bounds, pageInfo: [:])
                    image.draw(in: bounds)
                }
            }
            return url
        }
    }
}

private enum DocumentScannerError: Error, LocalizedError {
    case emptyScan
    var errorDescription: String? { "No document pages were captured." }
}
#endif

@MainActor
public final class StudyAudioRecorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published public private(set) var isRecording = false
    @Published public private(set) var elapsed: TimeInterval = 0
    private var recorder: AVAudioRecorder?
    private var timer: Timer?

    public func start() async throws {
        let allowed = await AVCaptureDevice.requestAccess(for: .audio)
        guard allowed else { throw RecordingError.permissionDenied }

        #if os(iOS)
        try AVAudioSession.sharedInstance().setCategory(.record, mode: .spokenAudio, options: [.duckOthers])
        try AVAudioSession.sharedInstance().setActive(true)
        #endif

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("TheDeskRecordings", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("Study-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.delegate = self
        guard recorder.record() else { throw RecordingError.couldNotStart }
        self.recorder = recorder
        elapsed = 0
        isRecording = true
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.elapsed = self?.recorder?.currentTime ?? 0 }
        }
    }

    @discardableResult
    public func stop() -> URL? {
        let url = recorder?.url
        recorder?.stop()
        recorder = nil
        timer?.invalidate()
        timer = nil
        isRecording = false
        return url
    }
}

public enum RecordingError: Error, LocalizedError {
    case permissionDenied, couldNotStart
    public var errorDescription: String? {
        switch self {
        case .permissionDenied: "Microphone permission is required to record a study session."
        case .couldNotStart: "The recording could not start."
        }
    }
}

private extension TimeInterval {
    var formattedRecordingTime: String {
        let whole = Int(self)
        return String(format: "%02d:%02d", whole / 60, whole % 60)
    }
}
