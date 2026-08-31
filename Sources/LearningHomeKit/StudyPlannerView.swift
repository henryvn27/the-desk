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

private struct StudyPlanDraftDay: Identifiable {
    var day: Date
    var drafts: [StudyPlanDraft]
    var id: Date { day }
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
    @AppStorage("TheDesk.StudyPlanner.selectedCalendarID") private var selectedCalendarID = ""
    @ViewStorage private var isConnectingCalendar = false
    @ViewStorage private var isExporting = false
    @ViewStorage private var message = ""
    @ViewStorage private var errorMessage: String?
    @ViewStorage private var editingSessionID: UUID?
    @ViewStorage private var editTitle = ""
    @ViewStorage private var editNotes = ""
    @ViewStorage private var editStart = Date()
    @ViewStorage private var editDurationMinutes = 45
    @ViewStorage private var showsPlanSettings = false

    public init() {}

    private var upcoming: [StudySession] {
        store.sessions.filter {
            $0.isPlannedBlock && $0.planState != .cancelled && ($0.scheduledStart ?? .distantPast) >= Calendar.current.startOfDay(for: Date())
        }
    }

    private var currentWeek: DateInterval? {
        Calendar.current.dateInterval(of: .weekOfYear, for: Date())
    }

    private var scheduledThisWeek: [StudySession] {
        guard let currentWeek else { return [] }
        return store.sessions.filter {
            guard $0.isPlannedBlock,
                  $0.planState != .cancelled,
                  let start = $0.scheduledStart else { return false }
            return currentWeek.contains(start)
        }
    }

    private var targetDrafts: [StudyPlanDraft] {
        if !drafts.isEmpty { return drafts }
        return StudyPlanBuilder.build(
            spaces: store.spaces,
            assignments: store.assignments,
            mastery: store.mastery,
            sources: store.sources,
            startingAt: startingAt,
            days: days,
            sessionsPerDay: sessionsPerDay,
            durationMinutes: durationMinutes
        )
    }

    private var weekTargetCount: Int {
        guard let currentWeek else { return 0 }
        return targetDrafts.filter { currentWeek.contains($0.start) }.count
    }

    private var weekScheduledProgress: Double? {
        guard weekTargetCount > 0 else { return nil }
        return min(Double(scheduledThisWeek.count) / Double(weekTargetCount), 1)
    }

    private var draftDays: [StudyPlanDraftDay] {
        Dictionary(grouping: drafts) { Calendar.current.startOfDay(for: $0.start) }
            .map { StudyPlanDraftDay(day: $0.key, drafts: $0.value.sorted { $0.start < $1.start }) }
            .sorted { $0.day < $1.day }
    }

    private var recommendationTitle: String {
        let dueCount = store.assignments.filter { $0.state != .verifiedComplete }.count
        let weakCount = store.mastery.filter { $0.score < 0.82 }.count
        if dueCount == 0 && weakCount == 0 {
            return store.sources.isEmpty ? "Add material to build your first plan" : "Create a calm review rhythm"
        }
        if dueCount > 0 && weakCount > 0 { return "Balance due work with targeted review" }
        if dueCount > 0 { return "Turn your due work into focus blocks" }
        return "Strengthen the topics that need another pass"
    }

    private var recommendationDetail: String {
        let dueCount = store.assignments.filter { $0.state != .verifiedComplete }.count
        let weakCount = store.mastery.filter { $0.score < 0.82 }.count
        let candidateCount = dueCount + weakCount + (dueCount == 0 && weakCount == 0 ? store.sources.count : 0)
        guard candidateCount > 0 else {
            return "Capture a note, textbook, lesson, or assignment first. The Desk will then turn it into a reviewable schedule."
        }
        let totalBlocks = min(days * sessionsPerDay, candidateCount)
        return "The Desk recommends up to \(totalBlocks) \(durationMinutes)-minute block\(totalBlocks == 1 ? "" : "s") across \(days) day\(days == 1 ? "" : "s"), prioritizing \(dueCount) open assignment\(dueCount == 1 ? "" : "s") and \(weakCount) weak topic\(weakCount == 1 ? "" : "s")."
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LHSpacing.lg) {
                header
                #if os(macOS)
                recommendationCard
                if !drafts.isEmpty { draftReview }
                #endif
                if !message.isEmpty {
                    Label(message, systemImage: drafts.isEmpty ? "checkmark.circle.fill" : "sparkles")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(drafts.isEmpty ? LearningPalette.moss : LearningPalette.copper)
                        .padding(LHSpacing.sm)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            drafts.isEmpty ? LearningPalette.mossSoft : LearningPalette.copperSoft,
                            in: RoundedRectangle(cornerRadius: LHRadius.control, style: .continuous)
                        )
                }
                #if os(macOS)
                planComposer
                #endif
                upcomingSection
            }
            .padding(LHSpacing.lg)
            .frame(maxWidth: 980, alignment: .leading)
        }
        .background(LearningPalette.appBackground)
        .navigationTitle("Study Plan")
        #if os(macOS)
        .onAppear {
            if drafts.isEmpty && upcoming.isEmpty {
                generate()
                message = ""
            }
        }
        #endif
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
        DeskPageHeader(
            "Study Plan",
            eyebrow: "Your week",
            detail: "Turn due work and weak topics into realistic focus blocks. Calendar events schedule the work; they never count as submission proof."
        )
    }

    #if os(macOS)
    private var recommendationCard: some View {
        PrimaryStudyCard(
            drafts.isEmpty ? recommendationTitle : "Your draft is ready to review",
            eyebrow: drafts.isEmpty ? "Recommended plan" : "\(drafts.count) proposed blocks",
            detail: drafts.isEmpty ? recommendationDetail : "Check every start time, remove anything that does not fit, then approve the plan before sending blocks to a calendar.",
            actionTitle: drafts.isEmpty ? "Build recommended plan" : nil,
            actionSymbol: "sparkles",
            action: generate,
            progress: weekScheduledProgress,
            progressLabel: weekTargetCount == 0 ? nil : "\(scheduledThisWeek.count) of \(weekTargetCount) scheduled this week",
            background: LearningPalette.clay,
            accent: LearningPalette.copper
        )
    }

    private var planComposer: some View {
        DisclosureGroup(isExpanded: $showsPlanSettings) {
            VStack(alignment: .leading, spacing: LHSpacing.md) {
                Divider()
                Text("Tune the recommendation before generating another draft. Nothing is saved until you approve it.")
                    .font(.subheadline)
                    .foregroundStyle(LearningPalette.mutedInk)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: LHSpacing.md) { planControls }
                    VStack(alignment: .leading, spacing: LHSpacing.md) { planControls }
                }
            }
            .padding(.top, LHSpacing.xs)
        } label: {
            Label("Adjust plan settings", systemImage: "slider.horizontal.3")
                .font(.headline)
                .foregroundStyle(LearningPalette.ink)
        }
        .padding(LHSpacing.md)
        .learningSurface(emphasized: false)
    }

    @ViewBuilder
    private var planControls: some View {
        DatePicker("Start", selection: $startingAt)
        Stepper("\(days) day\(days == 1 ? "" : "s")", value: $days, in: 1...14)
        Stepper("\(sessionsPerDay) per day", value: $sessionsPerDay, in: 1...6)
        Picker("Block length", selection: $durationMinutes) {
            ForEach([25, 35, 45, 60, 90], id: \.self) { Text("\($0) min").tag($0) }
        }
        .frame(maxWidth: 170)
        Button("Generate new draft") { generate() }
            .buttonStyle(.borderedProminent)
            .tint(LearningPalette.copper)
    }

    private var draftReview: some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            SectionHeading("Review your time blocks", detail: "Adjust each start time before approval. The Desk has not saved anything yet.")
            ForEach(draftDays) { day in
                VStack(alignment: .leading, spacing: LHSpacing.sm) {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(day.day.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()))
                                .font(.headline)
                                .foregroundStyle(LearningPalette.ink)
                            Text(priorityRationale(for: day.drafts))
                                .font(.caption)
                                .foregroundStyle(LearningPalette.mutedInk)
                        }
                        Spacer()
                        ProgressChip(
                            "\(day.drafts.reduce(0) { $0 + $1.durationMinutes }) min total",
                            tint: LearningPalette.moss
                        )
                    }

                    ForEach(day.drafts) { draft in
                        HStack(spacing: LHSpacing.md) {
                            Image(systemName: "clock")
                                .foregroundStyle(spaceColor(draft.spaceID))
                                .frame(width: 36, height: 36)
                                .background(spaceColor(draft.spaceID).opacity(0.12), in: RoundedRectangle(cornerRadius: LHRadius.control))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(draft.title)
                                    .font(.headline)
                                    .foregroundStyle(LearningPalette.ink)
                                Text("\(spaceTitle(draft.spaceID)) · \(draft.detail)")
                                    .font(.caption)
                                    .foregroundStyle(LearningPalette.mutedInk)
                                    .lineLimit(2)
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
                                .accessibilityLabel("Remove \(draft.title)")
                        }
                        .padding(.vertical, LHSpacing.xs)
                    }
                    Divider()
                }
            }
            HStack {
                Button("Discard draft") { drafts = [] }.buttonStyle(.bordered)
                Spacer()
                Button("Approve \(drafts.count) block\(drafts.count == 1 ? "" : "s")") { approveDraft() }
                    .buttonStyle(.borderedProminent)
                    .tint(LearningPalette.copper)
            }
        }
        .padding(LHSpacing.lg)
        .learningSurface()
    }
    #endif

    private var upcomingSection: some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            SectionHeading("Upcoming blocks", detail: "Approved blocks appear on every device after the Mac publishes the private companion snapshot.")

            #if os(macOS)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: LHSpacing.sm) {
                    calendarLabel
                    Spacer(minLength: LHSpacing.sm)
                    calendarButtons
                }
                VStack(alignment: .leading, spacing: LHSpacing.sm) {
                    calendarLabel
                    calendarButtons
                }
            }
            .padding(LHSpacing.sm)
            .background(LearningPalette.secondarySurface, in: RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous))
            #endif

            if upcoming.isEmpty {
                ContentUnavailableView(
                    "No study blocks yet",
                    systemImage: "calendar.badge.plus",
                    description: Text("Build and approve a plan on the paired Mac.")
                )
                .frame(maxWidth: .infinity, minHeight: 180)
                .learningSurface(emphasized: false)
            } else {
                ForEach(upcoming) { session in
                    HStack(spacing: LHSpacing.md) {
                        DateTile(date: session.scheduledStart ?? session.startedAt, tint: spaceColor(session.spaceID))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(session.title)
                                .font(.headline)
                                .foregroundStyle(LearningPalette.ink)
                            Text("\(spaceTitle(session.spaceID)) · \(session.plannedDurationMinutes ?? 0) minutes")
                                .font(.caption).foregroundStyle(LearningPalette.mutedInk)
                            if !session.notes.isEmpty { Text(session.notes).font(.caption).foregroundStyle(LearningPalette.mutedInk).lineLimit(2) }
                            if let targetLabel = targetLabel(session) {
                                Label(targetLabel, systemImage: "link")
                                    .font(.caption2.weight(.medium))
                                    .foregroundStyle(LearningPalette.copper)
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
    private var calendarLabel: some View {
        Label("Calendar", systemImage: "calendar")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(LearningPalette.ink)
    }

    @ViewBuilder
    private var calendarButtons: some View {
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
                .tint(LearningPalette.copper)
                .disabled(selectedCalendarID.isEmpty || upcoming.allSatisfy { $0.calendarEventIdentifier != nil })
        }
        Button("Export .ics") { isExporting = true }
            .buttonStyle(.bordered)
            .disabled(upcoming.isEmpty)
    }
    #endif

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
            if !calendarOptions.contains(where: { $0.id == selectedCalendarID }) {
                selectedCalendarID = calendarOptions.first?.id ?? ""
            }
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

    private func priorityRationale(for drafts: [StudyPlanDraft]) -> String {
        let assignments = drafts.filter { $0.linkedAssignmentID != nil }.count
        let weakTopics = drafts.filter { $0.linkedMasteryRecordID != nil }.count
        if assignments > 0 && weakTopics > 0 { return "Balances due work with low-mastery review." }
        if assignments > 0 { return "Prioritizes open work by priority and due date." }
        if weakTopics > 0 { return "Prioritizes the lowest-mastery topics." }
        return "Source review keeps your momentum moving."
    }
    #endif

    private func spaceTitle(_ id: UUID) -> String { store.space(id: id)?.title ?? "Study" }
    private func spaceColor(_ id: UUID) -> Color { Color(hex: store.space(id: id)?.colorHex ?? "#54706A") }
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
