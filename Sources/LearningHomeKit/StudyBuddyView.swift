#if os(macOS)
import AppKit
import AVFoundation
@preconcurrency import ScreenCaptureKit
@preconcurrency import Speech
import SwiftUI
import Vision

public struct StudyBuddyView: View {
    @EnvironmentObject private var store: LearningHomeStore
    @StateObject private var model = StudyBuddyModel()
    @Environment(\.dismiss) private var dismiss
    private let onClose: (() -> Void)?

    public init(onClose: (() -> Void)? = nil) {
        self.onClose = onClose
    }

    public var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            HSplitView {
                capturePanel.frame(minWidth: 330)
                tutorPanel.frame(minWidth: 310)
            }
        }
        .background(LearningPalette.appBackground)
        .task { await model.loadTargets() }
        .onDisappear { model.purgeCaptureSession() }
        .onReceive(NotificationCenter.default.publisher(for: .learningHomeStudyBuddyHoldBegan)) { _ in
            model.beginClickyHold(spaceTitle: store.space(id: store.selectedSpaceID)?.title ?? "Study")
        }
        .onReceive(NotificationCenter.default.publisher(for: .learningHomeStudyBuddyHoldEnded)) { _ in
            guard let space = store.space(id: store.selectedSpaceID) else { return }
            Task { await model.finishClickyHold(space: space, store: store) }
        }
        .alert("Study Buddy needs attention", isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(model.errorMessage ?? "Unknown error") }
    }

    private var header: some View {
        HStack(spacing: LHSpacing.sm) {
            Image(systemName: "cursorarrow.rays").foregroundStyle(LearningPalette.indigo)
            VStack(alignment: .leading, spacing: 1) {
                Text("Study Buddy").font(.headline)
                Text("Confirm once · then hold ⌥Space to talk and release to capture").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if let space = store.space(id: store.selectedSpaceID) { SpaceIdentity(space: space, compact: true) }
            Button("Done") {
                if let onClose { onClose() } else { dismiss() }
            }
            .keyboardShortcut(.cancelAction)
        }
        .padding(LHSpacing.md)
        .background(LearningPalette.surface)
    }

    private var capturePanel: some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            HStack {
                Picker("Capture", selection: $model.selectedTargetID) {
                    if model.targets.isEmpty { Text("Choose a screen or window").tag("") }
                    ForEach(model.targets) { Text($0.title).tag($0.id) }
                }
                Picker("Area", selection: $model.regionMode) {
                    Text("Whole selection").tag(StudyCaptureRegion.full)
                    Text("Center region").tag(StudyCaptureRegion.center)
                }
                .frame(width: 145)
            }
            Button {
                Task { _ = await model.capture() }
            } label: {
                Label(model.image == nil ? "Capture once" : "Capture again", systemImage: "viewfinder")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.selectedTargetID.isEmpty || model.isCapturing)

            if model.isCapturing {
                VStack { ProgressView(); Text("Waiting for macOS screen permission…").font(.caption).foregroundStyle(.secondary) }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let image = model.image {
                ScreenshotOverlayPreview(image: image, cues: model.cues)
                    .clipShape(RoundedRectangle(cornerRadius: LHRadius.surface))
                    .overlay { RoundedRectangle(cornerRadius: LHRadius.surface).stroke(LearningPalette.separator) }
                HStack {
                    StatusPill("One-time capture", symbol: "checkmark", tone: .success)
                    Spacer()
                    Text("Not retained by default").font(.caption).foregroundStyle(.secondary)
                }
            } else {
                VStack(spacing: LHSpacing.sm) {
                    Image(systemName: "rectangle.dashed.badge.record").font(.system(size: 38, weight: .light)).foregroundStyle(.secondary)
                    Text("Nothing has been captured").font(.headline)
                    Text("Choose a display or window, then activate a single snapshot. The Desk does not watch continuously.")
                        .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(LHSpacing.lg)
                .learningSurface(emphasized: false)
            }
        }
        .padding(LHSpacing.md)
    }

    private var tutorPanel: some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Ask about what you chose").font(.headline)
                Text("Screenshot OCR joins the active class context. Overlay cues are validated data, not executable UI commands.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            HStack(alignment: .bottom, spacing: LHSpacing.xs) {
                TextField("What am I missing on this graph?", text: $model.question, axis: .vertical)
                    .lineLimit(2...5)
                    .textFieldStyle(.roundedBorder)
                Button { model.toggleListening() } label: {
                    Image(systemName: model.isListening ? "stop.fill" : "mic.fill")
                        .frame(width: 24, height: 24)
                }
                .buttonStyle(.borderedProminent)
                .tint(model.isListening ? LearningPalette.danger : LearningPalette.indigo)
                .help(model.isListening ? "Stop voice question" : "Speak your question")
            }

            HStack {
                Picker("Provider", selection: $model.providerChoice) {
                    Text("Automatic").tag("automatic")
                    ForEach(ProviderIdentifier.allCases, id: \.rawValue) { Text($0.title).tag($0.rawValue) }
                }
                Spacer()
                Button {
                    guard let space = store.space(id: store.selectedSpaceID) else { return }
                    Task { await model.ask(space: space, store: store) }
                } label: { Label("Explain", systemImage: "waveform.and.magnifyingglass") }
                .buttonStyle(.borderedProminent)
                .disabled(model.image == nil || model.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isAnswering)
            }

            if model.isAnswering { ProgressView(model.status).controlSize(.small) }
            ScrollView {
                Text(model.answer.isEmpty ? "The explanation will appear here with its provider and class grounding." : model.answer)
                    .foregroundStyle(model.answer.isEmpty ? .secondary : .primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .padding(LHSpacing.md)
            }
            .learningSurface()

            if !model.usedModel.isEmpty { StatusPill("\(model.usedProvider?.title ?? "Provider") · \(model.usedModel)", symbol: "cpu", tone: .info) }

            HStack {
                Button { model.speak() } label: { Label("Read aloud", systemImage: "speaker.wave.2") }
                    .disabled(model.answer.isEmpty)
                Spacer()
                Button {
                    guard let space = store.space(id: store.selectedSpaceID) else { return }
                    model.saveToCanvas(space: space, store: store)
                } label: { Label("Save to Canvas", systemImage: "pin") }
                .buttonStyle(.bordered)
                .disabled(model.answer.isEmpty)
            }
        }
        .padding(LHSpacing.md)
    }
}

public enum StudyCaptureRegion: String, CaseIterable { case full, center }

public struct StudyCaptureTarget: Identifiable, Hashable {
    public enum Kind: Hashable { case display(UInt32), window(UInt32) }
    public var id: String
    public var title: String
    public var kind: Kind
}

@MainActor
public final class StudyBuddyModel: ObservableObject {
    @Published public var targets: [StudyCaptureTarget] = []
    @Published public var selectedTargetID = ""
    @Published public var regionMode: StudyCaptureRegion = .full
    @Published public var image: CGImage?
    @Published public var cues: [OverlayCue] = []
    @Published public var ocrText = ""
    @Published public var question = "What concept should I use first, and where do you see it?"
    @Published public var answer = ""
    @Published public var providerChoice = "automatic"
    @Published public var usedProvider: ProviderIdentifier?
    @Published public var usedModel = ""
    @Published public var status = ""
    @Published public var isCapturing = false
    @Published public var isAnswering = false
    @Published public var isListening = false
    @Published public var errorMessage: String?
    private let speaker = AVSpeechSynthesizer()
    private let audioEngine = AVAudioEngine()
    private var speechRequest: SFSpeechAudioBufferRecognitionRequest?
    private var speechTask: SFSpeechRecognitionTask?
    private var cueCandidates: [OverlayCueCandidate] = []
    private var confirmedTargetID: String?
    private var isClickyHoldActive = false
    private var captureGeneration = UUID()
    private var listeningTask: Task<Void, Never>?

    public func loadTargets() async {
        do {
            let content = try await SCShareableContent.current
            var options = content.displays.enumerated().map { index, display in
                StudyCaptureTarget(id: "display-\(display.displayID)", title: "Display \(index + 1)", kind: .display(display.displayID))
            }
            let ownPID = ProcessInfo.processInfo.processIdentifier
            options += content.windows
                .filter { $0.isOnScreen && $0.frame.width >= 320 && $0.frame.height >= 180 && $0.owningApplication?.processID != ownPID }
                .prefix(24)
                .map { window in
                    let app = window.owningApplication?.applicationName ?? "Window"
                    let title = window.title?.trimmingCharacters(in: .whitespacesAndNewlines)
                    return StudyCaptureTarget(id: "window-\(window.windowID)", title: title?.isEmpty == false ? "\(app) · \(title!)" : app, kind: .window(window.windowID))
                }
            targets = options
            if selectedTargetID.isEmpty { selectedTargetID = options.first?.id ?? "" }
        } catch { errorMessage = error.localizedDescription }
    }

    @discardableResult
    public func capture() async -> Bool {
        guard let target = targets.first(where: { $0.id == selectedTargetID }) else { return false }
        let generation = captureGeneration
        isCapturing = true
        defer { isCapturing = false }
        do {
            StudyBuddyResponseOverlayController.shared.hide()
            let content = try await SCShareableContent.current
            let filter: SCContentFilter
            let sourceSize: CGSize
            switch target.kind {
            case .display(let id):
                guard let display = content.displays.first(where: { $0.displayID == id }) else { throw StudyBuddyError.targetUnavailable }
                filter = SCContentFilter(display: display, excludingWindows: [])
                sourceSize = CGSize(width: display.width, height: display.height)
            case .window(let id):
                guard let window = content.windows.first(where: { $0.windowID == id }) else { throw StudyBuddyError.targetUnavailable }
                filter = SCContentFilter(desktopIndependentWindow: window)
                sourceSize = window.frame.size
            }

            let configuration = SCStreamConfiguration()
            let captureRect: CGRect
            if regionMode == .center {
                captureRect = CGRect(x: sourceSize.width * 0.12, y: sourceSize.height * 0.12, width: sourceSize.width * 0.76, height: sourceSize.height * 0.76)
                configuration.sourceRect = captureRect
            } else { captureRect = CGRect(origin: .zero, size: sourceSize) }
            let scale = min(1.0, 1_600 / max(captureRect.width, 1))
            configuration.width = max(1, Int(captureRect.width * scale))
            configuration.height = max(1, Int(captureRect.height * scale))
            configuration.showsCursor = false
            let captured = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
            guard generation == captureGeneration, !Task.isCancelled else { return false }
            image = captured
            let recognized = try recognize(captured)
            guard generation == captureGeneration, !Task.isCancelled else { return false }
            ocrText = recognized.text
            cueCandidates = recognized.candidates
            cues = []
            answer = ""
            usedModel = ""
            confirmedTargetID = selectedTargetID
            status = "Target confirmed · hold ⌥Space to ask"
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    public func beginClickyHold(spaceTitle: String) {
        guard !isClickyHoldActive, !isAnswering else { return }
        guard confirmedTargetID == selectedTargetID else {
            status = "Choose a target and use Capture once before hold-to-talk"
            StudyBuddyResponseOverlayController.shared.begin(spaceTitle: spaceTitle)
            StudyBuddyResponseOverlayController.shared.finish(text: status)
            return
        }
        isClickyHoldActive = true
        question = ""
        StudyBuddyResponseOverlayController.shared.begin(spaceTitle: spaceTitle)
        launchListening()
    }

    public func finishClickyHold(space: StudySpace, store: LearningHomeStore) async {
        guard isClickyHoldActive else { return }
        isClickyHoldActive = false
        listeningTask?.cancel()
        listeningTask = nil
        stopListening()
        try? await Task.sleep(for: .milliseconds(250))
        let spokenQuestion = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !spokenQuestion.isEmpty else {
            status = "No question heard · hold ⌥Space and try again"
            StudyBuddyResponseOverlayController.shared.finish(text: status)
            return
        }
        guard await capture() else {
            StudyBuddyResponseOverlayController.shared.hide()
            return
        }
        question = spokenQuestion
        await ask(space: space, store: store)
    }

    public func ask(space: StudySpace, store: LearningHomeStore) async {
        guard image != nil else { return }
        let generation = captureGeneration
        isAnswering = true
        status = "Grounding in \(space.title)…"
        answer = ""
        usedProvider = nil
        usedModel = ""
        StudyBuddyResponseOverlayController.shared.begin(spaceTitle: space.title)
        let classContext = store.sources(in: space.id).prefix(3).compactMap { source in
            store.latestRevision(for: source.id).map { "SOURCE \(source.title)\n\($0.extractedText.prefix(1_600))" }
        }.joined(separator: "\n\n")
        let request = AIStudyRequest(
            spaceID: space.id,
            task: .explain,
            prompt: question,
            tutorStyle: space.tutorStyle,
            context: "\(classContext)\n\nSCREENSHOT OCR\n\(ocrText.prefix(4_000))",
            citations: store.sources(in: space.id).prefix(3).map { source in
                StudyCitation(label: source.title, origin: .classSource, anchor: SourceAnchor(sourceID: source.id, excerpt: String(store.latestRevision(for: source.id)?.extractedText.prefix(180) ?? "")))
            }
        )
        let override: ProviderOverride = providerChoice == "automatic" ? .automatic : .provider(ProviderIdentifier(rawValue: providerChoice) ?? .localDemo)
        do {
            let stream = try await AIHarness.shared.stream(request, override: override)
            for try await event in stream {
                guard generation == captureGeneration, !Task.isCancelled else { throw CancellationError() }
                switch event {
                case .status(let value):
                    status = value
                    StudyBuddyResponseOverlayController.shared.update(text: answer, status: value)
                case .token(let value):
                    answer += value
                    StudyBuddyResponseOverlayController.shared.update(text: answer, status: status)
                case .citations: break
                case .completed(let provider, let model): usedProvider = provider; usedModel = model; status = "Complete"
                }
            }
            status = "Choosing source-grounded overlay cues…"
            await generateOverlayCues(space: space)
            guard generation == captureGeneration, !Task.isCancelled else { throw CancellationError() }
            status = "Complete"
            StudyBuddyResponseOverlayController.shared.finish(text: answer)
        } catch {
            StudyBuddyResponseOverlayController.shared.hide()
            errorMessage = error.localizedDescription
        }
        isAnswering = false
    }

    public func purgeCaptureSession() {
        captureGeneration = UUID()
        isClickyHoldActive = false
        listeningTask?.cancel()
        listeningTask = nil
        stopListening()
        if speaker.isSpeaking { speaker.stopSpeaking(at: .immediate) }
        image = nil
        ocrText = ""
        cues = []
        cueCandidates = []
        answer = ""
        usedProvider = nil
        usedModel = ""
        confirmedTargetID = nil
        isCapturing = false
        isAnswering = false
        StudyBuddyResponseOverlayController.shared.hide()
    }

    public func speak() {
        guard !answer.isEmpty else { return }
        if speaker.isSpeaking {
            speaker.stopSpeaking(at: .immediate)
        } else {
            let utterance = AVSpeechUtterance(string: answer)
            utterance.rate = AVSpeechUtteranceDefaultSpeechRate
            speaker.speak(utterance)
        }
    }

    public func toggleListening() {
        if isListening || listeningTask != nil {
            listeningTask?.cancel()
            listeningTask = nil
            stopListening()
        } else {
            launchListening()
        }
    }

    private func launchListening() {
        listeningTask?.cancel()
        let generation = captureGeneration
        listeningTask = Task { [weak self] in
            guard let self else { return }
            await self.startListening(generation: generation)
            if self.captureGeneration == generation { self.listeningTask = nil }
        }
    }

    static func canContinueListening(
        startedGeneration: UUID,
        currentGeneration: UUID,
        isCancelled: Bool
    ) -> Bool {
        !isCancelled && startedGeneration == currentGeneration
    }

    private func startListening(generation: UUID) async {
        guard Self.canContinueListening(
            startedGeneration: generation,
            currentGeneration: captureGeneration,
            isCancelled: Task.isCancelled
        ) else { return }
        let microphoneAllowed = await AVCaptureDevice.requestAccess(for: .audio)
        guard Self.canContinueListening(
            startedGeneration: generation,
            currentGeneration: captureGeneration,
            isCancelled: Task.isCancelled
        ) else { return }
        guard microphoneAllowed else {
            errorMessage = "Microphone permission is required to speak a Study Buddy question."
            return
        }
        let speechAuthorization = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard Self.canContinueListening(
            startedGeneration: generation,
            currentGeneration: captureGeneration,
            isCancelled: Task.isCancelled
        ) else { return }
        guard speechAuthorization == .authorized,
              let recognizer = SFSpeechRecognizer(locale: Locale.current),
              recognizer.isAvailable else {
            errorMessage = "Speech recognition is unavailable or not authorized."
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        speechRequest = request
        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else {
            speechRequest = nil
            errorMessage = "No microphone input is available."
            return
        }
        let audioHandler: AVAudioNodeTapBlock = { buffer, _ in
            request.append(buffer)
        }
        guard Self.canContinueListening(
            startedGeneration: generation,
            currentGeneration: captureGeneration,
            isCancelled: Task.isCancelled
        ) else {
            speechRequest = nil
            return
        }
        do {
            if #available(macOS 27.0, *) {
                try input.__installTap(
                    onBus: 0,
                    bufferSize: 1_024,
                    format: format,
                    error: (),
                    block: audioHandler
                )
            } else {
                input.installTap(onBus: 0, bufferSize: 1_024, format: format, block: audioHandler)
            }
            guard Self.canContinueListening(
                startedGeneration: generation,
                currentGeneration: captureGeneration,
                isCancelled: Task.isCancelled
            ) else {
                input.removeTap(onBus: 0)
                speechRequest = nil
                return
            }
            speechTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                Task { @MainActor in
                    if let result { self?.question = result.bestTranscription.formattedString }
                    if error != nil || result?.isFinal == true { self?.stopListening() }
                }
            }
            audioEngine.prepare()
            try audioEngine.start()
            isListening = true
            status = "Listening…"
        } catch {
            input.removeTap(onBus: 0)
            speechRequest = nil
            speechTask = nil
            errorMessage = error.localizedDescription
        }
    }

    private func stopListening() {
        guard isListening || speechRequest != nil else { return }
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        speechRequest?.endAudio()
        speechTask?.finish()
        speechRequest = nil
        speechTask = nil
        isListening = false
        status = question.isEmpty ? "Ready" : "Question captured"
    }

    public func saveToCanvas(space: StudySpace, store: LearningHomeStore) {
        let words = answer.split(separator: " ")
        let first = words.prefix(18).joined(separator: " ")
        let second = words.dropFirst(18).prefix(20).joined(separator: " ")
        let spec = StudySceneSpec(
            kind: .annotatedDiagram,
            title: "Study Buddy · \(question.prefix(52))",
            summary: answer,
            nodes: [
                SceneNode(id: "screen", title: "What you selected", detail: String(ocrText.prefix(180)), role: "input", x: 0.18, y: 0.5),
                SceneNode(id: "idea", title: "Key idea", detail: first, x: 0.52, y: 0.3),
                SceneNode(id: "next", title: "Next move", detail: second, role: "result", x: 0.82, y: 0.58),
            ],
            connections: [SceneConnection(from: "screen", to: "idea", label: "notice"), SceneConnection(from: "idea", to: "next", label: "apply")],
            interactions: [SceneInteraction(kind: .hideLabels, label: "Recall without labels"), SceneInteraction(kind: .explainAloud, label: "Explain aloud")],
            accessibilitySummary: "An annotated Study Buddy explanation linking the selected screen region to a key idea and the next step."
        )
        let artifact = CanvasArtifact(spaceID: space.id, title: spec.title, spec: spec, sourceRevisionSignature: "study-buddy:\(Date().timeIntervalSince1970)")
        do {
            try store.saveCanvas(artifact)
            store.selectedCanvasID = artifact.id
            status = "Saved to Canvas"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func generateOverlayCues(space: StudySpace) async {
        guard !cueCandidates.isEmpty else {
            cues = []
            return
        }
        let fallback = semanticLocalCues()
        guard usedProvider != .localDemo else {
            cues = fallback
            return
        }
        let candidateText = cueCandidates.map { candidate in
            "\(candidate.id): \(candidate.text)"
        }.joined(separator: "\n")
        let request = AIStudyRequest(
            spaceID: space.id,
            task: .extractActions,
            prompt: """
            Select zero to three OCR candidates that most directly support the explanation. Return JSON only:
            {"cues":[{"candidateID":"ocr-1","kind":"highlight","label":"why this region matters"}]}
            kind must be highlight, arrow, or label. Never invent a candidate ID.
            """,
            tutorStyle: space.tutorStyle,
            context: "QUESTION\n\(question)\n\nEXPLANATION\n\(answer.prefix(4_000))\n\nOCR CANDIDATES\n\(candidateText)",
            citations: [],
            allowProviderKnowledge: false,
            preferredProvider: usedProvider
        )
        let override: ProviderOverride = usedProvider.map(ProviderOverride.provider) ?? .automatic
        do {
            let executed = try await AIHarness.shared.execute(request, override: override)
            guard let envelope = OverlaySelectionEnvelope.decode(executed.response.text) else {
                cues = fallback
                return
            }
            let candidateByID = Dictionary(uniqueKeysWithValues: cueCandidates.map { ($0.id, $0) })
            let selected = envelope.cues.prefix(3).compactMap { selection -> OverlayCue? in
                guard let candidate = candidateByID[selection.candidateID],
                      let kind = OverlayCue.Kind(rawValue: selection.kind),
                      !selection.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
                return OverlayCue(kind: kind, region: candidate.region, label: String(selection.label.prefix(160)))
            }
            let spec = OverlayCueSpec(cues: selected)
            cues = selected.count == envelope.cues.prefix(3).count && spec.validate() ? selected : fallback
        } catch {
            cues = fallback
        }
    }

    private func semanticLocalCues() -> [OverlayCue] {
        let queryWords = Set("\(question) \(answer)".lowercased().split { !$0.isLetter && !$0.isNumber }.filter { $0.count >= 3 }.map(String.init))
        return cueCandidates.compactMap { candidate -> (OverlayCueCandidate, Int)? in
            let words = Set(candidate.text.lowercased().split { !$0.isLetter && !$0.isNumber }.map(String.init))
            let score = words.intersection(queryWords).count
            return score > 0 ? (candidate, score) : nil
        }
        .sorted { $0.1 > $1.1 }
        .prefix(3)
        .map { OverlayCue(kind: .highlight, region: $0.0.region, label: $0.0.text) }
    }

    private func recognize(_ image: CGImage) throws -> (text: String, candidates: [OverlayCueCandidate]) {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        try VNImageRequestHandler(cgImage: image).perform([request])
        let observations = request.results ?? []
        let text = observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
        let candidates = observations.prefix(40).enumerated().compactMap { index, observation -> OverlayCueCandidate? in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox
            return OverlayCueCandidate(
                id: "ocr-\(index + 1)",
                text: String(candidate.string.prefix(160)),
                region: NormalizedRect(x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height),
            )
        }
        return (text, candidates)
    }
}

private struct OverlayCueCandidate {
    var id: String
    var text: String
    var region: NormalizedRect
}

private struct OverlaySelectionEnvelope: Decodable {
    struct Selection: Decodable {
        var candidateID: String
        var kind: String
        var label: String
    }
    var cues: [Selection]

    static func decode(_ text: String) -> Self? {
        guard let start = text.firstIndex(of: "{"), let end = text.lastIndex(of: "}"), start <= end else { return nil }
        return try? JSONDecoder().decode(Self.self, from: Data(text[start...end].utf8))
    }
}

private struct ScreenshotOverlayPreview: View {
    let image: CGImage
    let cues: [OverlayCue]

    var body: some View {
        GeometryReader { proxy in
            Image(nsImage: NSImage(cgImage: image, size: .zero))
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .overlay {
                    GeometryReader { overlay in
                        ForEach(cues) { cue in
                            let rect = CGRect(
                                x: cue.region.x * overlay.size.width,
                                y: cue.region.y * overlay.size.height,
                                width: cue.region.width * overlay.size.width,
                                height: cue.region.height * overlay.size.height
                            )
                            cueOverlay(cue, rect: rect)
                        }
                    }
                }
        }
        .aspectRatio(CGFloat(image.width) / CGFloat(image.height), contentMode: .fit)
    }

    @ViewBuilder
    private func cueOverlay(_ cue: OverlayCue, rect: CGRect) -> some View {
        switch cue.kind {
        case .highlight:
            RoundedRectangle(cornerRadius: 4)
                .stroke(LearningPalette.warning, lineWidth: 2)
                .background(LearningPalette.warning.opacity(0.08))
                .frame(width: rect.width, height: rect.height)
                .position(x: rect.midX, y: rect.midY)
                .accessibilityLabel(cue.label)
        case .arrow:
            Image(systemName: "arrow.down.right.circle.fill")
                .font(.title2)
                .foregroundStyle(LearningPalette.warning)
                .position(x: rect.minX, y: rect.minY)
                .accessibilityLabel(cue.label)
        case .label:
            Text(cue.label)
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(.regularMaterial, in: Capsule())
                .overlay { Capsule().stroke(LearningPalette.warning) }
                .position(x: rect.midX, y: max(12, rect.minY - 10))
                .accessibilityLabel(cue.label)
        }
    }
}

public enum StudyBuddyError: Error, LocalizedError {
    case targetUnavailable
    public var errorDescription: String? { "The selected window or display is no longer available. Choose it again." }
}
#endif
