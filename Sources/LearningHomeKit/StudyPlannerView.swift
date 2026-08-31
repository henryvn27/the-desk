import SwiftUI
import UniformTypeIdentifiers

public struct StudyPlanDraft: Identifiable, Hashable, Sendable {
    public var id = UUID()
    public var spaceID: UUID
    public var title: String
    public var detail: String
    public var start: Date
    public var durationMinutes: Int
    public var linkedAssignmentID: UUID?
    public var linkedMasteryRecordID: UUID?
    public var linkedSourceID: UUID?
}

@MainActor
public enum StudyPlanBuilder {
    public static func build(
        spaces: [StudySpace],
        assignments: [Assignment],
        mastery: [MasteryRecord],
        sources: [SourceAsset],
        startingAt: Date,
        days: Int,
        sessionsPerDay: Int,
        durationMinutes: Int
    ) -> [StudyPlanDraft] {
        struct Item {
            var spaceID: UUID
            var title: String
            var detail: String
            var rank: Double
            var linkedAssignmentID: UUID?
            var linkedMasteryRecordID: UUID?
            var linkedSourceID: UUID?
        }

        let validSpaceIDs = Set(spaces.map(\.id))
        var items: [Item] = assignments.compactMap { assignment in
            guard validSpaceIDs.contains(assignment.spaceID) else { return nil }
            guard assignment.state != .verifiedComplete else { return nil }
            let urgency = max(0, 14 - assignment.dueAt.timeIntervalSinceNow / 86_400)
            return Item(
                spaceID: assignment.spaceID,
                title: assignment.title,
                detail: "Move this assignment forward. Due \(assignment.dueAt.formatted(date: .abbreviated, time: .shortened)).",
                rank: Double(assignment.priority * 10) + urgency,
                linkedAssignmentID: assignment.id
            )
        }
        items += mastery.filter { validSpaceIDs.contains($0.spaceID) && $0.score < 0.82 }.map { record in
            Item(
                spaceID: record.spaceID,
                title: "Review \(record.topic)",
                detail: "Current mastery: \(record.score.formatted(.percent.precision(.fractionLength(0)))). Practice retrieval before reviewing notes.",
                rank: (1 - record.score) * 20,
                linkedMasteryRecordID: record.id
            )
        }
        if items.isEmpty {
            items = sources.filter { validSpaceIDs.contains($0.spaceID) }.prefix(12).map {
                Item(spaceID: $0.spaceID, title: "Review \($0.title)", detail: "Resume from this source and finish with one recall question.", rank: 1, linkedSourceID: $0.id)
            }
        }
        items.sort { $0.rank > $1.rank }

        let safeDays = max(1, min(days, 14))
        let safeSessions = max(1, min(sessionsPerDay, 6))
        let safeDuration = max(15, min(durationMinutes, 120))
        var result: [StudyPlanDraft] = []
        var itemIndex = 0
        for day in 0..<safeDays {
            guard itemIndex < items.count else { break }
            let dayStart = Calendar.current.date(byAdding: .day, value: day, to: startingAt) ?? startingAt
            for slot in 0..<safeSessions {
                guard itemIndex < items.count else { break }
                let item = items[itemIndex]
                let start = Calendar.current.date(byAdding: .minute, value: slot * (safeDuration + 10), to: dayStart) ?? dayStart
                result.append(StudyPlanDraft(
                    spaceID: item.spaceID,
                    title: item.title,
                    detail: item.detail,
                    start: start,
                    durationMinutes: safeDuration,
                    linkedAssignmentID: item.linkedAssignmentID,
                    linkedMasteryRecordID: item.linkedMasteryRecordID,
                    linkedSourceID: item.linkedSourceID
                ))
                itemIndex += 1
            }
        }
        return result
    }
}

public struct StudyPlannerView: View {
    @EnvironmentObject private var store: LearningHomeStore
    @ViewStorage private var startingAt = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
    @ViewStorage private var days = 3
    @ViewStorage private var sessionsPerDay = 2
    @ViewStorage private var durationMinutes = 45
    @ViewStorage private var drafts: [StudyPlanDraft] = []
    @ViewStorage private var calendarOptions: [StudyCalendarOption] = []
    @ViewStorage private var selectedCalendarID = ""
    @ViewStorage private var isConnectingCalendar = false
    @ViewStorage private var isExporting = false
    @ViewStorage private var message = ""
    @ViewStorage private var errorMessage: String?
    @ViewStorage private var editingSessionID: UUID?
    @ViewStorage private var editTitle = ""
    @ViewStorage private var editNotes = ""
    @ViewStorage private var editStart = Date()
    @ViewStorage private var editDurationMinutes = 45

    public init() {}

    private var upcoming: [StudySession] {
        store.sessions.filter {
            $0.isPlannedBlock && $0.planState != .cancelled && ($0.scheduledStart ?? .distantPast) >= Calendar.current.startOfDay(for: Date())
        }
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LHSpacing.lg) {
                header
                #if os(macOS)
                planComposer
                if !drafts.isEmpty { draftReview }
                #endif
                upcomingSection
                if !message.isEmpty {
                    Label(message, systemImage: "checkmark.circle.fill")
                        .foregroundStyle(LearningPalette.success)
                }
            }
            .padding(LHSpacing.lg)
            .frame(maxWidth: 980, alignment: .leading)
        }
        .background(LearningPalette.appBackground)
        .navigationTitle("Study Plan")
        .alert("Study plan needs attention", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "Unknown error") }
        #if os(macOS)
        .sheet(isPresented: Binding(
            get: { editingSessionID != nil },
            set: { if !$0 { editingSessionID = nil } }
        )) {
            editBlockSheet
        }
        #endif
        #if os(macOS)
        .fileExporter(
            isPresented: $isExporting,
            document: StudyPlanCalendarDocument(data: StudyCalendarICS.data(
                sessions: upcoming,
                spaceTitles: Dictionary(uniqueKeysWithValues: store.spaces.map { ($0.id, $0.title) })
            )),
            contentType: UTType(filenameExtension: "ics") ?? .data,
            defaultFilename: "The Desk Study Plan"
        ) { result in
            if case .failure(let error) = result { errorMessage = error.localizedDescription }
        }
        #endif
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Time-block the work that matters")
                    .font(.system(.title2, design: .serif, weight: .semibold))
                Text("Plans stay honest: The Desk schedules study time, but a calendar event does not prove an assignment was submitted.")
                    .foregroundStyle(.secondary)
            }
            Spacer()
            StatusPill("\(upcoming.count) upcoming", symbol: "calendar", tone: .info)
        }
    }

    #if os(macOS)
    private var planComposer: some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            SectionHeading("Build a plan", detail: "Prioritizes due work and weak mastery areas. Nothing is saved until you approve the draft.")
            HStack(spacing: LHSpacing.md) {
                DatePicker("Start", selection: $startingAt)
                Stepper("\(days) day\(days == 1 ? "" : "s")", value: $days, in: 1...14)
                Stepper("\(sessionsPerDay)/day", value: $sessionsPerDay, in: 1...6)
                Picker("Block", selection: $durationMinutes) {
                    ForEach([25, 35, 45, 60, 90], id: \.self) { Text("\($0) min").tag($0) }
                }
                .frame(width: 130)
                Button("Generate draft") { generate() }.buttonStyle(.borderedProminent)
            }
        }
        .padding(LHSpacing.md)
        .learningSurface()
    }

    private var draftReview: some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            SectionHeading("Review \(drafts.count) time blocks", detail: "Adjust every start time before approval.")
            ForEach(drafts) { draft in
                HStack(spacing: LHSpacing.md) {
                    Circle().fill(spaceColor(draft.spaceID)).frame(width: 8, height: 8)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(draft.title).font(.headline)
                        Text("\(spaceTitle(draft.spaceID)) · \(draft.detail)").font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                    Spacer()
                    DatePicker("Start", selection: draftStartBinding(draft.id), displayedComponents: [.date, .hourAndMinute])
                        .labelsHidden()
                    Picker("Duration", selection: draftDurationBinding(draft.id)) {
                        ForEach([25, 35, 45, 60, 90], id: \.self) { Text("\($0)m").tag($0) }
                    }
                    .frame(width: 82)
                    Button(role: .destructive) { drafts.removeAll { $0.id == draft.id } } label: { Image(systemName: "xmark") }
                        .buttonStyle(.borderless)
                }
                .padding(.vertical, LHSpacing.xs)
                Divider()
            }
            HStack {
                Button("Discard draft") { drafts = [] }.buttonStyle(.bordered)
                Spacer()
                Button("Approve and save in The Desk") { approveDraft() }.buttonStyle(.borderedProminent)
            }
        }
        .padding(LHSpacing.md)
        .learningSurface()
    }
    #endif

    private var upcomingSection: some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            HStack {
                SectionHeading("Upcoming blocks", detail: "Visible on every device after the Mac publishes the private companion snapshot.")
                Spacer()
                #if os(macOS)
                if calendarOptions.isEmpty {
                    Button(isConnectingCalendar ? "Connecting…" : "Connect Apple or Google Calendar") {
                        Task { await connectCalendar() }
                    }
                    .buttonStyle(.bordered)
                    .disabled(isConnectingCalendar)
                } else {
                    Picker("Calendar", selection: $selectedCalendarID) {
                        ForEach(calendarOptions) { option in
                            Text("\(option.accountKind.title) · \(option.title)").tag(option.id)
                        }
                    }
                    .frame(maxWidth: 280)
                    Button("Add unlinked blocks") { addUnlinkedToCalendar() }
                        .buttonStyle(.borderedProminent)
                        .disabled(selectedCalendarID.isEmpty || upcoming.allSatisfy { $0.calendarEventIdentifier != nil })
                }
                Button("Export .ics") { isExporting = true }
                    .buttonStyle(.bordered)
                    .disabled(upcoming.isEmpty)
                #endif
            }

            if upcoming.isEmpty {
                ContentUnavailableView(
                    "No study blocks yet",
                    systemImage: "calendar.badge.plus",
                    description: Text("Build and approve a plan on the paired Mac.")
                )
            } else {
                ForEach(upcoming) { session in
                    HStack(spacing: LHSpacing.md) {
                        DateTile(date: session.scheduledStart ?? session.startedAt, tint: spaceColor(session.spaceID))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(session.title).font(.headline)
                            Text("\(spaceTitle(session.spaceID)) · \(session.plannedDurationMinutes ?? 0) minutes")
                                .font(.caption).foregroundStyle(.secondary)
                            if !session.notes.isEmpty { Text(session.notes).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                            if let targetLabel = targetLabel(session) {
                                Label(targetLabel, systemImage: "link")
                                    .font(.caption2.weight(.medium))
                                    .foregroundStyle(LearningPalette.indigo)
                            }
                        }
                        Spacer()
                        if let calendarName = session.calendarName {
                            StatusPill(calendarName, symbol: "calendar.badge.checkmark", tone: .success)
                        } else {
                            StatusPill("The Desk only", symbol: "calendar", tone: .neutral)
                        }
                        #if os(macOS)
                        Button("Edit") { beginEditing(session) }
                            .buttonStyle(.bordered)
                        #endif
                    }
                    .padding(LHSpacing.md)
                    .learningSurface()
                }
            }
        }
    }

    #if os(macOS)
    private func generate() {
        drafts = StudyPlanBuilder.build(
            spaces: store.spaces,
            assignments: store.assignments,
            mastery: store.mastery,
            sources: store.sources,
            startingAt: startingAt,
            days: days,
            sessionsPerDay: sessionsPerDay,
            durationMinutes: durationMinutes
        )
        message = drafts.isEmpty ? "No due work or study sources are available yet." : "Draft generated. Review the time blocks before approving."
    }

    private func approveDraft() {
        let planID = UUID()
        let inputs = drafts.map { draft in
            PlannedSessionInput(
                spaceID: draft.spaceID,
                title: draft.title,
                notes: draft.detail,
                scheduledStart: draft.start,
                durationMinutes: draft.durationMinutes,
                planID: planID,
                linkedAssignmentID: draft.linkedAssignmentID,
                linkedMasteryRecordID: draft.linkedMasteryRecordID,
                linkedSourceID: draft.linkedSourceID
            )
        }
        do {
            _ = try store.addPlannedSessions(inputs)
            message = "Saved \(drafts.count) approved time block\(drafts.count == 1 ? "" : "s") in The Desk."
            drafts = []
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private var editBlockSheet: some View {
        NavigationStack {
            Form {
                TextField("Title", text: $editTitle)
                TextField("Study notes", text: $editNotes, axis: .vertical)
                    .lineLimit(2...5)
                DatePicker("Start", selection: $editStart, displayedComponents: [.date, .hourAndMinute])
                Picker("Duration", selection: $editDurationMinutes) {
                    ForEach([25, 35, 45, 60, 90], id: \.self) { Text("\($0) minutes").tag($0) }
                }
                if let session = editingSession {
                    Text(session.calendarEventIdentifier == nil
                         ? "This changes the block in The Desk."
                         : "The Desk will update only its linked \(session.calendarName ?? "calendar") event. If that event was removed or changed ownership, nothing will be saved.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Edit study block")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { editingSessionID = nil }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { saveEditedBlock() }
                        .disabled(editTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .frame(minWidth: 520, minHeight: 390)
    }

    private var editingSession: StudySession? {
        guard let editingSessionID else { return nil }
        return store.sessions.first(where: { $0.id == editingSessionID })
    }

    private func beginEditing(_ session: StudySession) {
        editingSessionID = session.id
        editTitle = session.title
        editNotes = session.notes
        editStart = session.scheduledStart ?? Date()
        editDurationMinutes = session.plannedDurationMinutes ?? 45
    }

    private func saveEditedBlock() {
        guard let session = editingSession else { return }
        let proposed = StudySession(
            spaceID: session.spaceID,
            title: editTitle,
            notes: editNotes,
            scheduledStart: editStart,
            durationMinutes: editDurationMinutes,
            planID: session.planID ?? UUID(),
            linkedAssignmentID: session.linkedAssignmentID,
            linkedMasteryRecordID: session.linkedMasteryRecordID,
            linkedSourceID: session.linkedSourceID
        )
        proposed.id = session.id
        proposed.calendarEventIdentifier = session.calendarEventIdentifier
        proposed.calendarName = session.calendarName
        do {
            if proposed.calendarEventIdentifier != nil {
                try store.preflightDurableWrite()
                try StudyCalendarConnector.shared.updateLinkedEvent(
                    for: proposed,
                    spaceTitle: spaceTitle(proposed.spaceID)
                )
            }
            let updated: Bool
            if proposed.calendarEventIdentifier != nil {
                updated = try store.updatePlannedSessionDurably(
                    id: session.id,
                    title: editTitle,
                    notes: editNotes,
                    scheduledStart: editStart,
                    durationMinutes: editDurationMinutes
                )
            } else {
                updated = try store.updatePlannedSession(
                    id: session.id,
                    title: editTitle,
                    notes: editNotes,
                    scheduledStart: editStart,
                    durationMinutes: editDurationMinutes
                )
            }
            guard updated else {
                throw StudyCalendarError.invalidBlock
            }
            message = proposed.calendarEventIdentifier == nil
                ? "Updated the study block in The Desk."
                : "Updated the study block and its linked calendar event."
            editingSessionID = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func connectCalendar() async {
        isConnectingCalendar = true
        do {
            calendarOptions = try await StudyCalendarConnector.shared.writableCalendars()
            selectedCalendarID = calendarOptions.first?.id ?? ""
            if calendarOptions.isEmpty { errorMessage = "No writable Apple, Google, Exchange, or local calendars were found on this Mac." }
        } catch { errorMessage = error.localizedDescription }
        isConnectingCalendar = false
    }

    private func addUnlinkedToCalendar() {
        guard let option = calendarOptions.first(where: { $0.id == selectedCalendarID }) else { return }
        do {
            try store.preflightDurableWrite()
            var added = 0
            for session in upcoming where session.calendarEventIdentifier == nil {
                let identifier = try StudyCalendarConnector.shared.createEvent(
                    for: session,
                    spaceTitle: spaceTitle(session.spaceID),
                    calendarIdentifier: option.id
                )
                try store.linkCalendarEventDurably(
                    identifier,
                    calendarName: "\(option.accountKind.title) · \(option.title)",
                    to: session.id
                )
                added += 1
            }
            message = "Added \(added) block\(added == 1 ? "" : "s") to \(option.title)."
        } catch { errorMessage = error.localizedDescription }
    }

    private func draftStartBinding(_ id: UUID) -> Binding<Date> {
        Binding(
            get: { drafts.first(where: { $0.id == id })?.start ?? Date() },
            set: { value in if let index = drafts.firstIndex(where: { $0.id == id }) { drafts[index].start = value } }
        )
    }

    private func draftDurationBinding(_ id: UUID) -> Binding<Int> {
        Binding(
            get: { drafts.first(where: { $0.id == id })?.durationMinutes ?? 45 },
            set: { value in if let index = drafts.firstIndex(where: { $0.id == id }) { drafts[index].durationMinutes = value } }
        )
    }
    #endif

    private func spaceTitle(_ id: UUID) -> String { store.space(id: id)?.title ?? "Study" }
    private func spaceColor(_ id: UUID) -> Color { Color(hex: store.space(id: id)?.colorHex ?? "#4657B8") }
    private func targetLabel(_ session: StudySession) -> String? {
        if session.linkedAssignmentID != nil { return "Linked assignment" }
        if session.linkedMasteryRecordID != nil { return "Linked weak topic" }
        if session.linkedSourceID != nil { return "Linked source" }
        return nil
    }
}

private struct DateTile: View {
    let date: Date
    let tint: Color

    var body: some View {
        VStack(spacing: 1) {
            Text(date.formatted(.dateTime.month(.abbreviated))).font(.caption2.weight(.semibold)).textCase(.uppercase)
            Text(date.formatted(.dateTime.day())).font(.title3.weight(.semibold).monospacedDigit())
            Text(date.formatted(date: .omitted, time: .shortened)).font(.caption2)
        }
        .foregroundStyle(tint)
        .frame(width: 66, height: 58)
        .background(tint.opacity(0.09), in: RoundedRectangle(cornerRadius: LHRadius.surface))
    }
}

#if os(macOS)
private struct StudyPlanCalendarDocument: FileDocument {
    static var readableContentTypes: [UTType] { [UTType(filenameExtension: "ics") ?? .data] }
    var data: Data

    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}
#endif
