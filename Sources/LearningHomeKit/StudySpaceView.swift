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
        #if os(macOS)
        HStack(spacing: LHSpacing.md) {
            SpaceIdentity(space: space)
            Spacer()
            Picker("Section", selection: $tab) {
                ForEach(SpaceTab.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 510)
            Picker("Tutor style", selection: Binding(
                get: { space.tutorStyle },
                set: { value in
                    do { try store.setTutorStyle(value, for: space.id) }
                    catch { errorMessage = error.localizedDescription }
                }
            )) {
                ForEach(TutorStyle.allCases, id: \.rawValue) { Text($0.title).tag($0) }
            }
            .frame(width: 150)
        }
        .padding(LHSpacing.md)
        .background(LearningPalette.surface)
        #else
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            SpaceIdentity(space: space)
            HStack {
                Picker("Section", selection: $tab) {
                    ForEach(SpaceTab.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.menu)
                Spacer()
                StatusPill(space.tutorStyle.title, symbol: "person.fill.questionmark")
            }
        }
        .padding(LHSpacing.md)
        .background(LearningPalette.surface)
        #endif
    }
}

private struct SpaceOverview: View {
    @EnvironmentObject private var store: LearningHomeStore
    let space: StudySpace
    let openTab: (StudySpaceView.SpaceTab) -> Void

    private var mastery: [MasteryRecord] { store.mastery.filter { $0.spaceID == space.id } }
    private var sources: [SourceAsset] { store.sources(in: space.id) }
    private var assignments: [Assignment] { store.assignments(in: space.id) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LHSpacing.lg) {
                HStack(spacing: LHSpacing.md) {
                    MetricBlock(value: "\(sources.count)", label: "sources", symbol: "books.vertical", tint: Color(hex: space.colorHex))
                    Divider().frame(height: 34)
                    MetricBlock(value: "\(assignments.filter { $0.state != .verifiedComplete }.count)", label: "open items", symbol: "checklist", tint: LearningPalette.indigo)
                    Divider().frame(height: 34)
                    let average = mastery.isEmpty ? 0 : mastery.map(\.score).reduce(0, +) / Double(mastery.count)
                    MetricBlock(value: average.formatted(.percent.precision(.fractionLength(0))), label: "mastery", symbol: "chart.line.uptrend.xyaxis", tint: LearningPalette.success)
                }
                .padding(LHSpacing.md)
                .learningSurface()

                HStack(alignment: .top, spacing: LHSpacing.md) {
                    VStack(alignment: .leading, spacing: LHSpacing.sm) {
                        Label("Focused study", systemImage: "scope")
                            .font(.caption.weight(.semibold)).foregroundStyle(Color(hex: space.colorHex))
                        Text(nextPromptTitle).font(.title2.weight(.semibold))
                        Text(nextPromptDetail).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        HStack {
                            Button("Open tutor") { openTab(.tutor) }.buttonStyle(.borderedProminent).tint(Color(hex: space.colorHex))
                            Button("Review sources") { openTab(.sources) }.buttonStyle(.bordered)
                        }
                    }
                    .padding(LHSpacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .learningSurface()

                    masteryPanel
                        .frame(maxWidth: 330)
                }

                VStack(alignment: .leading, spacing: LHSpacing.sm) {
                    SectionHeading("Recent material", detail: "Originals and revisions stay attached to this space.", actionTitle: "View all") { openTab(.sources) }
                    ForEach(sources.prefix(3)) { SourceCard(source: $0) }
                }
            }
            .padding(LHSpacing.lg)
            .frame(maxWidth: 950, alignment: .leading)
        }
    }

    private var masteryPanel: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            Text("Review radar").font(.headline)
            if mastery.isEmpty {
                Text("Mastery appears after practice.").font(.subheadline).foregroundStyle(.secondary)
            } else {
                ForEach(mastery) { record in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text(record.topic).font(.subheadline.weight(.medium)).lineLimit(1)
                            Spacer()
                            Text(record.score, format: .percent.precision(.fractionLength(0))).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        }
                        ProgressView(value: record.score).tint(record.score < 0.7 ? LearningPalette.warning : LearningPalette.success)
                    }
                }
            }
        }
        .padding(LHSpacing.md)
        .learningSurface()
    }

    private var nextPromptTitle: String { mastery.first?.topic ?? assignments.first?.title ?? "Ask from your class sources" }
    private var nextPromptDetail: String {
        if let first = mastery.first, first.score < 0.7 { return "This is your weakest active topic. Start coach-first and explain the first step before seeing the solution." }
        return "Continue from your latest source with page-linked explanations and practice."
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
