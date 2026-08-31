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
                DeskPageHeader(
                    "Capture anything",
                    eyebrow: "Capture inbox",
                    detail: "Drop in a thought, textbook, photo, link, or recording. You always choose where it belongs before The Desk processes it."
                )

                captureMethods
                destinationCard

                captureSurface

                if !statusMessage.isEmpty {
                    HStack(spacing: LHSpacing.xs) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(LearningPalette.moss)
                        Text(statusMessage)
                            .foregroundStyle(LearningPalette.ink)
                    }
                        .font(.subheadline.weight(.medium))
                        .padding(LHSpacing.sm)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(LearningPalette.mossSoft, in: RoundedRectangle(cornerRadius: LHRadius.control))
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

    private var captureMethods: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: LHSpacing.sm)], spacing: LHSpacing.sm) {
            captureMethodButton(.note, symbol: "square.and.pencil", detail: "Type or paste")
            captureMethodButton(.file, symbol: "doc.viewfinder", detail: "Scan or upload")
            captureMethodButton(.link, symbol: "link", detail: "Save a lesson")
            captureMethodButton(.audio, symbol: "waveform", detail: "Record a session")
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Capture method")
    }

    private func captureMethodButton(_ value: CaptureKind, symbol: String, detail: String) -> some View {
        let isSelected = kind == value
        return Button {
            withAnimation(LHMotion.direct) { kind = value }
        } label: {
            HStack(spacing: LHSpacing.sm) {
                Image(systemName: symbol)
                    .font(.title3)
                    .foregroundStyle(isSelected ? LearningPalette.primaryForeground : LearningPalette.copper)
                    .frame(width: 38, height: 38)
                    .background(
                        isSelected ? LearningPalette.copper : LearningPalette.copperSoft,
                        in: RoundedRectangle(cornerRadius: LHRadius.control, style: .continuous)
                    )
                VStack(alignment: .leading, spacing: LHSpacing.xxs) {
                    Text(value.rawValue)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(LearningPalette.ink)
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(LearningPalette.mutedInk)
                }
                Spacer(minLength: 0)
            }
            .padding(LHSpacing.sm)
            .frame(maxWidth: .infinity, minHeight: 68, alignment: .leading)
            .background(isSelected ? LearningPalette.copperSoft : LearningPalette.surface)
            .clipShape(RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous)
                    .stroke(isSelected ? LearningPalette.copper : LearningPalette.hairline, lineWidth: isSelected ? 1.5 : 0.75)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(value.rawValue), \(detail)")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var destinationCard: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: LHSpacing.md) {
                destinationLabel
                Spacer(minLength: LHSpacing.md)
                destinationPicker
            }
            VStack(alignment: .leading, spacing: LHSpacing.sm) {
                destinationLabel
                destinationPicker
            }
        }
        .padding(LHSpacing.md)
        .background(LearningPalette.graphite)
        .clipShape(RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous)
                .stroke(LearningPalette.graphiteSoft, lineWidth: 0.75)
        }
    }

    @ViewBuilder
    private var destinationLabel: some View {
        VStack(alignment: .leading, spacing: LHSpacing.xxs) {
            Label("Save to", systemImage: "folder.fill")
                .font(.headline)
                .foregroundStyle(LearningPalette.onGraphite)
            Text("Every capture needs an approved class or track.")
                .font(.subheadline)
                .foregroundStyle(LearningPalette.onGraphite.opacity(0.72))
        }
    }

    private var destinationPicker: some View {
        Picker("Destination space", selection: $destinationID) {
            ForEach(store.spaces) { Text($0.title).tag(Optional($0.id)) }
        }
        .labelsHidden()
        .frame(maxWidth: 240)
        .tint(LearningPalette.copper)
        .accessibilityLabel("Destination space")
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
            SectionHeading("Quick note", detail: "Paste typed notes or a Wispr transcript excerpt.")
            TextField("Title", text: $noteTitle)
                .textFieldStyle(.roundedBorder)
            TextEditor(text: $noteBody)
                .font(.body)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 190)
                .padding(LHSpacing.sm)
                .background(LearningPalette.secondarySurface, in: RoundedRectangle(cornerRadius: LHRadius.surface))
            HStack {
                Label("Saved as an original source", systemImage: "lock.doc")
                    .font(.caption)
                    .foregroundStyle(LearningPalette.mutedInk)
                Spacer()
                Button("Save to space", action: saveNote)
                    .buttonStyle(.borderedProminent)
                    .tint(LearningPalette.copper)
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
                .foregroundStyle(LearningPalette.copper)
            Text("Textbooks, notes, slides, photos, or audio")
                .font(.title3.weight(.semibold))
                .foregroundStyle(LearningPalette.ink)
            Text("Originals are preserved, deduplicated by SHA-256, and indexed with page or timestamp anchors on the Mac.")
                .foregroundStyle(LearningPalette.mutedInk)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 540)
            HStack {
                #if os(iOS)
                Button { showingScanner = true } label: { Label("Scan pages", systemImage: "doc.viewfinder") }
                    .buttonStyle(.borderedProminent)
                    .tint(LearningPalette.copper)
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
            SectionHeading("Add a lesson or reference", detail: "Keep a return path to the original material.")
            TextField("https://…", text: $linkText)
                .textFieldStyle(.roundedBorder)
            Text("Khan Academy links are stored with a return check-in; The Desk never scrapes answers or progress.")
                .font(.caption).foregroundStyle(LearningPalette.mutedInk)
            HStack {
                Spacer()
                Button("Save link", action: saveLink)
                    .buttonStyle(.borderedProminent)
                    .tint(LearningPalette.copper)
                    .disabled(URL(string: linkText)?.scheme?.hasPrefix("http") != true || destination == nil)
            }
        }
        .padding(LHSpacing.lg)
        .learningSurface()
    }

    private var audioCapture: some View {
        VStack(spacing: LHSpacing.md) {
            ZStack {
                Circle().fill((recorder.isRecording ? LearningPalette.danger : LearningPalette.copper).opacity(0.12))
                Image(systemName: recorder.isRecording ? "stop.fill" : "mic.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(recorder.isRecording ? LearningPalette.danger : LearningPalette.copper)
            }
            .frame(width: 72, height: 72)
            Text(recorder.isRecording ? recorder.elapsed.formattedRecordingTime : "Record a study session")
                .font(.title3.weight(.semibold).monospacedDigit())
                .foregroundStyle(LearningPalette.ink)
            Text("Recording is visible, user-started, and transcribed only after you stop.")
                .font(.subheadline).foregroundStyle(LearningPalette.mutedInk)
            Button(recorder.isRecording ? "Stop and import" : "Start recording") {
                if recorder.isRecording {
                    if let url = recorder.stop() { importFiles([url]) }
                } else {
                    Task { do { try await recorder.start() } catch { errorMessage = error.localizedDescription } }
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(recorder.isRecording ? LearningPalette.danger : LearningPalette.copper)
            .disabled(destination == nil || isWorking)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, LHSpacing.xl)
        .learningSurface()
    }

    private var queuePreview: some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            SectionHeading("Processing queue", detail: "Companion captures wait safely when the Mac is offline, then resume without duplication.")

            ViewThatFits(in: .horizontal) {
                HStack(spacing: LHSpacing.sm) {
                    captureProgressChip("Captured", tint: LearningPalette.copper)
                    Image(systemName: "chevron.right").font(.caption2).foregroundStyle(LearningPalette.mutedInk)
                    captureProgressChip("Processed on Mac", tint: LearningPalette.moss)
                    Image(systemName: "chevron.right").font(.caption2).foregroundStyle(LearningPalette.mutedInk)
                    captureProgressChip("Ready to study", tint: LearningPalette.moss)
                }
                VStack(alignment: .leading, spacing: LHSpacing.xs) {
                    captureProgressChip("1 · Captured", tint: LearningPalette.copper)
                    captureProgressChip("2 · Processed on Mac", tint: LearningPalette.moss)
                    captureProgressChip("3 · Ready to study", tint: LearningPalette.moss)
                }
            }

            if store.jobs.isEmpty {
                HStack(spacing: LHSpacing.xs) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(LearningPalette.moss)
                    Text("Nothing is waiting. Your latest captures are ready to study.")
                        .foregroundStyle(LearningPalette.ink)
                }
                    .font(.subheadline)
                    .padding(LHSpacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .learningSurface(emphasized: false)
            } else {
                ForEach(store.jobs.prefix(5)) { job in
                    VStack(alignment: .leading, spacing: LHSpacing.sm) {
                        HStack(spacing: LHSpacing.sm) {
                            Image(systemName: queueSymbol(job.state))
                                .foregroundStyle(queueTint(job.state))
                                .frame(width: 34, height: 34)
                                .background(queueTint(job.state).opacity(0.12), in: RoundedRectangle(cornerRadius: LHRadius.control))
                            VStack(alignment: .leading, spacing: LHSpacing.xxs) {
                                Text(job.kindRaw.capitalized)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(LearningPalette.ink)
                                Text(queueDetail(job.state))
                                    .font(.caption)
                                    .foregroundStyle(LearningPalette.mutedInk)
                            }
                            Spacer()
                            if job.state == .processing { ProgressView().controlSize(.small) }
                            queueStateBadge(job.state)
                        }

                        if isFailure(job.state), !job.errorMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Text(job.errorMessage)
                                .font(.caption)
                                .foregroundStyle(LearningPalette.ink)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(LHSpacing.sm)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(LearningPalette.secondarySurface, in: RoundedRectangle(cornerRadius: LHRadius.control))
                                .accessibilityLabel("Processing error: \(job.errorMessage)")
                        }

                        queueRecovery(for: job)
                    }
                    .padding(LHSpacing.md)
                    .learningSurface(emphasized: false)
                }
            }
        }
    }

    private func queueTitle(_ state: SyncJobState) -> String {
        switch state {
        case .queued: "Queued"
        case .processing: "Processing"
        case .waitingForMac: "Waiting for Mac"
        case .needsAuthentication: "Sign in needed"
        case .failedRetryable: "Will retry"
        case .failedFinal: "Needs attention"
        case .completed: "Ready"
        }
    }

    private func queueDetail(_ state: SyncJobState) -> String {
        switch state {
        case .queued: "Ready for the next processing pass"
        case .processing: "The Mac is extracting and indexing this capture"
        case .waitingForMac: "Safe in your private queue until the Mac reconnects"
        case .needsAuthentication: "A connected service needs you to sign in again"
        case .failedRetryable: "The Desk will retry without creating a duplicate"
        case .failedFinal: "This capture reached the safe retry limit"
        case .completed: "Processed and available in its study space"
        }
    }

    private func queueSymbol(_ state: SyncJobState) -> String {
        switch state {
        case .completed: "checkmark.circle.fill"
        case .processing: "gearshape.2"
        case .waitingForMac: "desktopcomputer"
        case .needsAuthentication: "person.crop.circle.badge.exclamationmark"
        case .failedRetryable: "arrow.clockwise"
        case .failedFinal: "exclamationmark.triangle.fill"
        case .queued: "clock.fill"
        }
    }

    private func queueTint(_ state: SyncJobState) -> Color {
        switch state {
        case .completed: LearningPalette.moss
        case .failedFinal: LearningPalette.danger
        case .needsAuthentication, .failedRetryable: LearningPalette.warning
        case .queued, .processing, .waitingForMac: LearningPalette.copper
        }
    }

    private func isFailure(_ state: SyncJobState) -> Bool {
        state == .failedRetryable || state == .failedFinal
    }

    private func captureProgressChip(_ title: String, tint: Color) -> some View {
        HStack(spacing: LHSpacing.xxs) {
            Circle()
                .fill(tint)
                .frame(width: 6, height: 6)
            Text(title)
                .foregroundStyle(LearningPalette.ink)
        }
        .font(.caption.weight(.medium))
        .padding(.horizontal, LHSpacing.xs)
        .frame(minHeight: 28)
        .background(tint.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }

    private func queueStateBadge(_ state: SyncJobState) -> some View {
        HStack(spacing: LHSpacing.xxs) {
            Circle()
                .fill(queueTint(state))
                .frame(width: 6, height: 6)
            Text(queueTitle(state))
                .foregroundStyle(LearningPalette.ink)
        }
        .font(.caption.weight(.semibold))
        .padding(.horizontal, LHSpacing.xs)
        .padding(.vertical, LHSpacing.xxs)
        .background(queueTint(state).opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func queueRecovery(for job: SyncJob) -> some View {
        switch job.state {
        case .failedRetryable:
            #if os(macOS)
            HStack(alignment: .firstTextBaseline, spacing: LHSpacing.sm) {
                Text("The queue will retry automatically after its safety backoff.")
                    .font(.caption)
                    .foregroundStyle(LearningPalette.mutedInk)
                Spacer()
                Button("Retry eligible items") {
                    Task {
                        isWorking = true
                        let summary = await MacQueueProcessor.shared.drain(into: store)
                        statusMessage = summary.processed > 0
                            ? "Processed \(summary.processed) queued capture\(summary.processed == 1 ? "" : "s")"
                            : "Retry check complete. The capture remains safely queued."
                        isWorking = false
                    }
                }
                .buttonStyle(.bordered)
                .tint(LearningPalette.copper)
                .disabled(isWorking)
            }
            #else
            Text("Keep the Mac app open. The queue will retry automatically after its safety backoff.")
                .font(.caption)
                .foregroundStyle(LearningPalette.mutedInk)
            #endif
        case .failedFinal:
            HStack(alignment: .firstTextBaseline, spacing: LHSpacing.sm) {
                Text("Start a fresh capture from the original item; this failure stays here for reference.")
                    .font(.caption)
                    .foregroundStyle(LearningPalette.mutedInk)
                Spacer()
                Button("Start fresh") {
                    kind = captureKind(for: job.kindRaw)
                    statusMessage = "Ready for a fresh \(kind.rawValue.lowercased()) capture"
                }
                .buttonStyle(.bordered)
                .tint(LearningPalette.copper)
            }
        default:
            EmptyView()
        }
    }

    private func captureKind(for rawKind: String) -> CaptureKind {
        let normalized = rawKind.lowercased()
        if normalized.contains("file") { return .file }
        if normalized.contains("url") || normalized.contains("link") { return .link }
        if normalized.contains("audio") || normalized.contains("record") { return .audio }
        return .note
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
