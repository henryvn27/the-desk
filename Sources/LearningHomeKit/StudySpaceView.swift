import SwiftUI

public struct StudySpaceView: View {
    fileprivate enum SpaceTab: String, CaseIterable, Identifiable {
        case overview = "Overview"
        case tutor = "Tutor"
        case sources = "Sources"
        case assignments = "Assignments"
        case canvas = "Canvas"
        var id: String { rawValue }
    }

    @EnvironmentObject private var store: LearningHomeStore
    let space: StudySpace
    @ViewStorage private var tab: SpaceTab = .overview
    @ViewStorage private var errorMessage: String?

    public init(space: StudySpace) { self.space = space }

    public var body: some View {
        VStack(spacing: 0) {
            spaceHeader
            Divider()
            Group {
                switch tab {
                case .overview: SpaceOverview(space: space, openTab: { tab = $0 })
                case .tutor: TutorView(space: space)
                case .sources: SourceLibraryView(spaceID: space.id)
                case .assignments: SpaceAssignmentsView(space: space)
                case .canvas: CanvasBrowserView(space: space)
                }
            }
        }
        .background(LearningPalette.appBackground)
        .onAppear { store.selectedSpaceID = space.id }
        .onChange(of: store.selectedCanvasID) { _, canvasID in
            if let canvasID, store.canvases(in: space.id).contains(where: { $0.id == canvasID }) { tab = .canvas }
        }
        .alert("Class could not be updated", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "Unknown error") }
    }

    private var spaceHeader: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            #if os(macOS)
            HStack(alignment: .top, spacing: LHSpacing.md) {
                pageHeader(showsTutorAction: true)
                tutorStylePicker
                    .frame(width: 170)
                    .padding(.top, LHSpacing.xxs)
            }
            #else
            pageHeader(showsTutorAction: false)
            HStack(spacing: LHSpacing.sm) {
                StatusPill(space.tutorStyle.title, symbol: "person.fill.questionmark", tone: .info)
                Spacer()
                if tab != .tutor {
                    Button { tab = .tutor } label: { Label("Study with tutor", systemImage: "sparkles") }
                        .buttonStyle(.borderedProminent)
                        .tint(LearningPalette.copper)
                }
            }
            #endif

            #if os(macOS)
            Picker("Class section", selection: $tab) {
                ForEach(SpaceTab.allCases) { Text($0.rawValue).tag($0) }
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            .frame(maxWidth: 560)
            #else
            Picker("Class section", selection: $tab) {
                ForEach(SpaceTab.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.menu)
            #endif
        }
        .padding(.horizontal, LHSpacing.lg)
        .padding(.top, LHSpacing.md)
        .padding(.bottom, LHSpacing.sm)
        .background(LearningPalette.surface)
    }

    private func pageHeader(showsTutorAction: Bool) -> some View {
        DeskPageHeader(
            space.title,
            eyebrow: space.kind == .class ? "Class workspace" : "Learning track",
            detail: space.subtitle,
            actionTitle: showsTutorAction && tab != .tutor ? "Study with tutor" : nil,
            actionSymbol: "sparkles",
            action: { tab = .tutor }
        )
    }

    private var tutorStylePicker: some View {
        Picker("Tutor style", selection: Binding(
            get: { space.tutorStyle },
            set: { value in
                do { try store.setTutorStyle(value, for: space.id) }
                catch { errorMessage = error.localizedDescription }
            }
        )) {
            ForEach(TutorStyle.allCases, id: \.rawValue) { Text($0.title).tag($0) }
        }
        .accessibilityHint("Sets how the tutor responds in this class")
    }
}

private struct SpaceOverview: View {
    private struct Recommendation {
        var title: String
        var detail: String
        var actionTitle: String
    }

    @EnvironmentObject private var store: LearningHomeStore
    let space: StudySpace
    let openTab: (StudySpaceView.SpaceTab) -> Void

    private var mastery: [MasteryRecord] { store.mastery.filter { $0.spaceID == space.id } }
    private var sources: [SourceAsset] { store.sources(in: space.id) }
    private var assignments: [Assignment] { store.assignments(in: space.id) }
    private var activeAssignments: [Assignment] {
        assignments
            .filter { $0.state != .verifiedComplete }
            .sorted { $0.dueAt < $1.dueAt }
    }
    private var weakestMastery: MasteryRecord? { mastery.min { $0.score < $1.score } }
    private var averageMastery: Double {
        mastery.isEmpty ? 0 : mastery.map(\.score).reduce(0, +) / Double(mastery.count)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LHSpacing.lg) {
                PrimaryStudyCard(
                    nextRecommendation.title,
                    eyebrow: "Next best step",
                    detail: nextRecommendation.detail,
                    actionTitle: nextRecommendation.actionTitle,
                    actionSymbol: "arrow.right",
                    action: { openTab(.tutor) },
                    progress: mastery.isEmpty ? nil : averageMastery,
                    progressLabel: "class mastery",
                    background: LearningPalette.clay,
                    accent: LearningPalette.copper
                )

                metrics

                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: LHSpacing.md) {
                        masteryPanel.frame(maxWidth: .infinity, alignment: .top)
                        assignmentPanel.frame(maxWidth: .infinity, alignment: .top)
                    }
                    VStack(alignment: .leading, spacing: LHSpacing.md) {
                        masteryPanel
                        assignmentPanel
                    }
                }

                VStack(alignment: .leading, spacing: LHSpacing.sm) {
                    SectionHeading("Recent material", detail: "Originals and revisions stay attached to this space.", actionTitle: "View all") { openTab(.sources) }
                    if sources.isEmpty {
                        Label("Add a textbook, note, photo, link, or recording to begin.", systemImage: "tray.and.arrow.down")
                            .font(.subheadline)
                            .foregroundStyle(LearningPalette.mutedInk)
                            .padding(LHSpacing.md)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .learningSurface(emphasized: false)
                    } else {
                        ForEach(sources.prefix(3)) { SourceCard(source: $0) }
                    }
                }
            }
            .padding(LHSpacing.lg)
            .frame(maxWidth: 1080, alignment: .leading)
        }
    }

    private var metrics: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 0) {
                MetricBlock(value: "\(sources.count)", label: "Sources", symbol: "books.vertical", tint: Color(hex: space.colorHex))
                Divider().frame(height: 44).padding(.horizontal, LHSpacing.sm)
                MetricBlock(value: "\(activeAssignments.count)", label: "Open items", symbol: "checklist", tint: LearningPalette.copper)
                Divider().frame(height: 44).padding(.horizontal, LHSpacing.sm)
                MetricBlock(value: averageMastery.formatted(.percent.precision(.fractionLength(0))), label: "Mastery", symbol: "chart.line.uptrend.xyaxis", tint: LearningPalette.moss)
            }
            VStack(alignment: .leading, spacing: LHSpacing.sm) {
                MetricBlock(value: "\(sources.count)", label: "Sources", symbol: "books.vertical", tint: Color(hex: space.colorHex))
                MetricBlock(value: "\(activeAssignments.count)", label: "Open items", symbol: "checklist", tint: LearningPalette.copper)
                MetricBlock(value: averageMastery.formatted(.percent.precision(.fractionLength(0))), label: "Mastery", symbol: "chart.line.uptrend.xyaxis", tint: LearningPalette.moss)
            }
        }
        .padding(LHSpacing.md)
        .learningSurface()
    }

    private var masteryPanel: some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            SectionHeading("Mastery", detail: "Retrieval practice updates these estimates.")
            if mastery.isEmpty {
                Text("Complete a practice session to establish your first mastery signal.")
                    .font(.subheadline)
                    .foregroundStyle(LearningPalette.mutedInk)
            } else {
                ForEach(mastery.sorted { $0.score < $1.score }.prefix(4)) { record in
                    MasteryBar(
                        record.topic,
                        value: record.score,
                        detail: record.score < 0.7 ? "Good next review target" : nil,
                        tint: record.score < 0.7 ? LearningPalette.copper : LearningPalette.moss
                    )
                }
            }
        }
        .padding(LHSpacing.md)
        .learningSurface()
    }

    private var assignmentPanel: some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            SectionHeading("Coming up", detail: "Due work stays separate from submission proof.", actionTitle: "View all") { openTab(.assignments) }
            if activeAssignments.isEmpty {
                Label("No open assignments", systemImage: "checkmark.circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(LearningPalette.moss)
            } else {
                ForEach(activeAssignments.prefix(4)) { assignment in
                    HStack(alignment: .top, spacing: LHSpacing.sm) {
                        Image(systemName: "circle")
                            .foregroundStyle(LearningPalette.copper)
                            .padding(.top, 2)
                        VStack(alignment: .leading, spacing: LHSpacing.xxs) {
                            Text(assignment.title)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(LearningPalette.ink)
                                .lineLimit(2)
                            Text(assignment.dueAt.learningDueLabel)
                                .font(.caption)
                                .foregroundStyle(LearningPalette.mutedInk)
                        }
                        Spacer(minLength: LHSpacing.xs)
                        AssignmentStatePill(assignment.state)
                    }
                }
            }
        }
        .padding(LHSpacing.md)
        .learningSurface()
    }

    private var nextRecommendation: Recommendation {
        if let mastery = weakestMastery, mastery.score < 0.7 {
            return Recommendation(
                title: mastery.topic,
                detail: "This is your weakest active topic. Start coach-first and explain the first step before seeing the solution.",
                actionTitle: "Practice this topic"
            )
        }
        if let assignment = activeAssignments.first {
            return Recommendation(
                title: assignment.title,
                detail: "Move your nearest due assignment forward with class-grounded help. Due \(assignment.dueAt.learningDueLabel.lowercased()).",
                actionTitle: "Work on this assignment"
            )
        }
        if let source = sources.first {
            return Recommendation(
                title: "Review \(source.title)",
                detail: "Continue from this class source with page-linked explanations and retrieval practice.",
                actionTitle: "Review with tutor"
            )
        }
        return Recommendation(
            title: "Start a guided class check-in",
            detail: "Ask the tutor what to capture or practice first for this class.",
            actionTitle: "Open tutor"
        )
    }
}

public struct SpaceAssignmentsView: View {
    @EnvironmentObject private var store: LearningHomeStore
    let space: StudySpace
    @ViewStorage private var reminderMessage = ""
    @ViewStorage private var errorMessage: String?
    @ViewStorage private var showingNewAssignment = false

    public init(space: StudySpace) { self.space = space }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LHSpacing.md) {
                #if os(macOS)
                SectionHeading("Assignments", detail: "A reminder checkmark is not submission proof.", actionTitle: "New assignment") {
                    showingNewAssignment = true
                }
                #else
                SectionHeading("Assignments", detail: "A reminder checkmark is not submission proof. Create or edit assignments on the paired Mac.")
                #endif
                ForEach(store.assignments(in: space.id)) { assignment in
                    VStack(alignment: .leading, spacing: LHSpacing.sm) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(assignment.title).font(.headline)
                                Text(assignment.detail).font(.subheadline).foregroundStyle(.secondary)
                                Text("\(assignment.sourceName) · \(assignment.dueAt.learningDueLabel)")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if assignment.state == .verifiedComplete || assignment.state == .returned {
                                AssignmentStatePill(assignment.state)
                            } else {
                                Picker("State", selection: Binding(
                                    get: { assignment.state },
                                    set: { value in
                                        do { try store.setAssignmentState(value, assignmentID: assignment.id) }
                                        catch { errorMessage = error.localizedDescription }
                                    }
                                )) {
                                    ForEach([AssignmentState.planned, .ready, .submittedUnverified], id: \.rawValue) { Text($0.title).tag($0) }
                                }
                                .frame(width: 185)
                                #if os(iOS)
                                .disabled(true)
                                #endif
                            }
                        }

                        if !assignment.evidenceSummary.isEmpty {
                            Label(assignment.evidenceSummary, systemImage: assignment.evidence.contains(where: \.provesSubmission) ? "checkmark.seal.fill" : "paperclip")
                                .font(.caption)
                                .foregroundStyle(assignment.evidence.contains(where: \.provesSubmission) ? LearningPalette.success : LearningPalette.warning)
                        }

                        HStack {
                            AssignmentStatePill(assignment.state)
                            Spacer()
                            if assignment.externalURL != nil { Link("Open \(assignment.sourceName)", destination: assignment.externalURL!) }
                            #if os(macOS)
                            Button(assignment.linkedReminderIdentifier.isEmpty ? "Create linked Reminder" : "Reminder linked") {
                                linkReminder(assignment)
                            }
                            .buttonStyle(.bordered)
                            .disabled(!assignment.linkedReminderIdentifier.isEmpty)
                            #endif
                        }
                    }
                    .padding(LHSpacing.md)
                    .learningSurface()
                }
                if !reminderMessage.isEmpty { Label(reminderMessage, systemImage: "checkmark.circle.fill").foregroundStyle(LearningPalette.success) }
            }
            .padding(LHSpacing.lg)
            .frame(maxWidth: 900, alignment: .leading)
        }
        .alert("Reminder could not be linked", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "Unknown error") }
        .sheet(isPresented: $showingNewAssignment) {
            NewAssignmentSheet(space: space) { showingNewAssignment = false }
        }
    }

    private func linkReminder(_ assignment: Assignment) {
        Task {
            do {
                try store.preflightDurableWrite()
                let identifier = try await ReminderConnector.shared.createLinkedReminder(for: assignment, spaceTitle: space.title)
                try store.linkReminderDurably(identifier, to: assignment.id)
                reminderMessage = "Linked in Apple Reminders"
            } catch { errorMessage = error.localizedDescription }
        }
    }
}

private struct NewAssignmentSheet: View {
    @EnvironmentObject private var store: LearningHomeStore
    @Environment(\.dismiss) private var dismiss
    @ViewStorage private var title = ""
    @ViewStorage private var detail = ""
    @ViewStorage private var dueAt = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
    @ViewStorage private var priority = 1
    @ViewStorage private var errorMessage: String?
    let space: StudySpace
    let onCreate: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                TextField("Assignment title", text: $title)
                TextField("Details", text: $detail, axis: .vertical).lineLimit(2...5)
                DatePicker("Due", selection: $dueAt)
                Picker("Priority", selection: $priority) {
                    Text("Low").tag(0)
                    Text("Normal").tag(1)
                    Text("High").tag(2)
                    Text("Urgent").tag(3)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("New assignment")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        do {
                            _ = try store.addAssignment(spaceID: space.id, title: title, detail: detail, dueAt: dueAt, priority: priority)
                            onCreate()
                        } catch {
                            errorMessage = error.localizedDescription
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 500, minHeight: 430)
        #endif
        .alert("Assignment could not be saved", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "Unknown error") }
    }
}

public struct CanvasBrowserView: View {
    @EnvironmentObject private var store: LearningHomeStore
    let space: StudySpace

    public init(space: StudySpace) { self.space = space }

    private var selected: CanvasArtifact? {
        let items = store.canvases(in: space.id)
        return items.first(where: { $0.id == store.selectedCanvasID }) ?? items.first
    }

    public var body: some View {
        if let selected {
            StudyCanvasView(artifact: selected, space: space)
        } else {
            ContentUnavailableView("No canvas yet", systemImage: "point.3.filled.connected.trianglepath.dotted", description: Text("Ask the tutor to visualize a topic, then save it here."))
        }
    }
}
