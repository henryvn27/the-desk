import SwiftUI

#if os(macOS)
import AppKit
#elseif os(iOS)
import UIKit
#endif

public struct TodayView: View {
    @EnvironmentObject private var store: LearningHomeStore
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    private let openSpace: ((UUID) -> Void)?
    private let openPlan: (() -> Void)?

    public init(openSpace: ((UUID) -> Void)? = nil, openPlan: (() -> Void)? = nil) {
        self.openSpace = openSpace
        self.openPlan = openPlan
    }

    private var activeAssignments: [Assignment] {
        store.assignments.filter { $0.state != .verifiedComplete }
    }

    private var focusAssignment: Assignment? { activeAssignments.first }
    private var upcomingBlocks: [StudySession] {
        store.sessions.filter {
            $0.isPlannedBlock && $0.planState != .cancelled && ($0.scheduledStart ?? .distantPast) >= Date()
        }
        .sorted { ($0.scheduledStart ?? .distantFuture) < ($1.scheduledStart ?? .distantFuture) }
    }

    private var todayBlocks: [StudySession] {
        store.sessions.filter {
            $0.isPlannedBlock && $0.planState != .cancelled &&
            Calendar.current.isDateInToday($0.scheduledStart ?? .distantPast)
        }
    }

    private var plannedMinutes: Int {
        todayBlocks.reduce(0) { $0 + ($1.plannedDurationMinutes ?? 0) }
    }

    private var completedMinutes: Int {
        todayBlocks.filter { $0.planState == .completed }.reduce(0) { $0 + ($1.plannedDurationMinutes ?? 0) }
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LHSpacing.lg) {
                header
                if let focusAssignment, let space = store.space(id: focusAssignment.spaceID) {
                    focusCard(assignment: focusAssignment, space: space)
                } else {
                    emptyFocusCard
                }
                assignmentSection
                studyBlockSection
                resumeSection
            }
            .padding(.horizontal, horizontalSizeClass == .compact ? LHSpacing.md : LHSpacing.xl)
            .padding(.vertical, LHSpacing.xl)
            .frame(maxWidth: 1080, alignment: .leading)
        }
        .background(LearningPalette.appBackground)
        .navigationTitle("Home")
    }

    private var header: some View {
        HStack(alignment: .top, spacing: LHSpacing.lg) {
            VStack(alignment: .leading, spacing: LHSpacing.xs) {
                Text(Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()).uppercased())
                    .font(.caption.weight(.bold))
                    .tracking(1.05)
                    .foregroundStyle(LearningPalette.mutedInk)
                Text("\(greeting). Ready to make progress?")
                    .font(.system(size: 38, weight: .bold, design: .default))
                    .tracking(-1.1)
                    .foregroundStyle(LearningPalette.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            #if os(macOS)
            StatusPill("Mac study host", symbol: "desktopcomputer", tone: .neutral)
            #else
            StatusPill("Runs when Mac is online", symbol: "desktopcomputer", tone: .neutral)
            #endif
        }
    }

    private var greeting: String {
        switch Calendar.current.component(.hour, from: Date()) {
        case 5..<12: "Good morning"
        case 12..<18: "Good afternoon"
        default: "Good evening"
        }
    }

    private var studyBlockSection: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            SectionHeading("Study blocks", detail: "Approved time from Study Plan; calendar events do not prove assignment submission.")
            if upcomingBlocks.isEmpty {
                Text("No upcoming blocks. Build a plan from Study Plan on the paired Mac.")
                    .font(.subheadline).foregroundStyle(.secondary)
                    .padding(LHSpacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .learningSurface()
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(upcomingBlocks.prefix(4).enumerated()), id: \.element.id) { index, session in
                        Button {
                            store.selectedSpaceID = session.spaceID
                            openSpace?(session.spaceID)
                        } label: {
                            HStack(spacing: LHSpacing.md) {
                                Image(systemName: "calendar.badge.clock")
                                    .foregroundStyle(store.space(id: session.spaceID).map { Color(hex: $0.colorHex) } ?? LearningPalette.copper)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(session.title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                                    Text("\(store.space(id: session.spaceID)?.title ?? "Study") · \((session.scheduledStart ?? session.startedAt).formatted(date: .abbreviated, time: .shortened)) · \(session.plannedDurationMinutes ?? 0) min")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if session.calendarEventIdentifier != nil {
                                    StatusPill("Calendar", symbol: "checkmark", tone: .success)
                                } else {
                                    StatusPill("The Desk", tone: .neutral)
                                }
                                Image(systemName: "arrow.right").foregroundStyle(.tertiary)
                            }
                            .padding(.horizontal, LHSpacing.md)
                            .padding(.vertical, LHSpacing.sm)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if index < min(upcomingBlocks.count, 4) - 1 { Divider().padding(.leading, 44) }
                    }
                }
                .learningSurface()
            }
        }
    }

    private func focusCard(assignment: Assignment, space: StudySpace) -> some View {
        Group {
            if horizontalSizeClass == .compact {
                VStack(alignment: .leading, spacing: LHSpacing.lg) {
                    focusCopy(assignment: assignment, space: space)
                    focusProgress(assignment: assignment)
                }
            } else {
                HStack(alignment: .center, spacing: LHSpacing.xl) {
                    focusCopy(assignment: assignment, space: space)
                    Spacer(minLength: LHSpacing.md)
                    focusProgress(assignment: assignment)
                }
            }
        }
        .padding(LHSpacing.lg)
        .background(LearningPalette.clay)
        .clipShape(RoundedRectangle(cornerRadius: LHRadius.prominent, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: LHRadius.prominent, style: .continuous)
                .stroke(LearningPalette.copper.opacity(0.12), lineWidth: 1)
        }
    }

    private func focusCopy(assignment: Assignment, space: StudySpace) -> some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            Text("TODAY AT THE DESK")
                .font(.caption.weight(.bold))
                .tracking(1.0)
                .foregroundStyle(LearningPalette.copper)
            Text(assignment.title)
                .font(.system(size: 29, weight: .bold))
                .tracking(-0.65)
                .foregroundStyle(LearningPalette.ink)
            Text("\(heroTitle) \(space.title): \(assignment.detail)")
                .font(.body)
                .foregroundStyle(LearningPalette.mutedInk)
                .fixedSize(horizontal: false, vertical: true)
            if horizontalSizeClass == .compact {
                VStack(alignment: .leading, spacing: LHSpacing.xs) {
                    startButton(space: space)
                    HStack(spacing: LHSpacing.sm) {
                        sourceLink(assignment: assignment)
                        adjustPlanButton
                    }
                }
            } else {
                HStack(spacing: LHSpacing.sm) {
                    startButton(space: space)
                    sourceLink(assignment: assignment)
                    adjustPlanButton
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func startButton(space: StudySpace) -> some View {
        Button("Start \(space.title)") {
            store.selectedSpaceID = space.id
            openSpace?(space.id)
        }
        .buttonStyle(.borderedProminent)
        .tint(LearningPalette.copper)
    }

    @ViewBuilder
    private func sourceLink(assignment: Assignment) -> some View {
        if let url = assignment.externalURL {
            Link("Open source", destination: url)
                .buttonStyle(.bordered)
        }
    }

    private var adjustPlanButton: some View {
        Button("Adjust plan") { openPlan?() }
            .buttonStyle(.bordered)
    }

    private func focusProgress(assignment: Assignment) -> some View {
        VStack(alignment: .leading, spacing: LHSpacing.xs) {
            Text("\(completedMinutes)")
                .font(.system(size: 40, weight: .bold).monospacedDigit())
                .tracking(-1.2)
            Text("of \(max(plannedMinutes, 60)) min")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(LearningPalette.mutedInk)
            ProgressView(value: Double(completedMinutes), total: Double(max(plannedMinutes, 60)))
                .tint(LearningPalette.moss)
                .frame(maxWidth: 128)
            Text(assignment.dueAt.learningDueLabel)
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .padding(LHSpacing.md)
        .frame(width: horizontalSizeClass == .compact ? nil : 160, alignment: .leading)
        .background(LearningPalette.surface.opacity(0.72), in: RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous))
    }

    private var heroTitle: String {
        if plannedMinutes > 0 {
            return "\(plannedMinutes) focused minutes, already planned."
        }
        return "One focused session, ready when you are."
    }

    private var emptyFocusCard: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            Text("TODAY AT THE DESK")
                .font(.caption.weight(.bold))
                .tracking(1.0)
                .foregroundStyle(LearningPalette.copper)
            Text("Your desk is clear.")
                .font(.title2.weight(.bold))
            Text("Build a study plan or capture material when you are ready.")
                .foregroundStyle(LearningPalette.mutedInk)
            Button("Build a study plan") { openPlan?() }
                .buttonStyle(.borderedProminent)
                .tint(LearningPalette.copper)
        }
        .padding(LHSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LearningPalette.clay, in: RoundedRectangle(cornerRadius: LHRadius.prominent, style: .continuous))
    }

    private var assignmentSection: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            SectionHeading("Your daily tasks", detail: "\(activeAssignments.count) open · completion and submission stay separate")
            VStack(spacing: 0) {
                ForEach(Array(activeAssignments.prefix(5).enumerated()), id: \.element.id) { index, assignment in
                    TodayAssignmentRow(assignment: assignment, space: store.space(id: assignment.spaceID))
                    if index < min(activeAssignments.count, 5) - 1 { Divider().padding(.leading, 52) }
                }
            }
            .learningSurface()
        }
    }

    private var resumeSection: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            SectionHeading("Resume learning", detail: "Saved canvases stay linked to their sources.")
            if let canvas = store.canvases.first, let space = store.space(id: canvas.spaceID) {
                Button {
                    store.selectedCanvasID = canvas.id
                    openSpace?(space.id)
                } label: {
                    HStack(spacing: LHSpacing.md) {
                        MiniTrajectoryPlot()
                            .frame(width: 150, height: 82)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(canvas.title).font(.headline).foregroundStyle(.primary)
                            Text(space.title).font(.subheadline).foregroundStyle(Color(hex: space.colorHex))
                            Text("Interactive lab · version \(canvas.version)")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "arrow.right").foregroundStyle(.secondary)
                    }
                    .padding(LHSpacing.md)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .learningSurface()
            }
        }
    }
}

private struct TodayAssignmentRow: View {
    @EnvironmentObject private var store: LearningHomeStore
    @ViewStorage private var errorMessage: String?
    let assignment: Assignment
    let space: StudySpace?

    var body: some View {
        HStack(spacing: LHSpacing.sm) {
            Image(systemName: space?.symbolName ?? "doc.text")
                .font(.caption.weight(.semibold))
                .foregroundStyle(space.map { Color(hex: $0.colorHex) } ?? LearningPalette.copper)
                .frame(width: 28, height: 28)
                .background(
                    (space.map { Color(hex: $0.colorHex) } ?? LearningPalette.copper).opacity(0.12),
                    in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                )
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(assignment.title).font(.subheadline.weight(.semibold))
                Text("\(space?.title ?? "Study") · \(assignment.dueAt.learningDueLabel)")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            AssignmentStatePill(assignment.state)
            if assignment.state == .planned {
                #if os(macOS)
                Button("Ready") {
                    do { try store.setAssignmentState(.ready, assignmentID: assignment.id) }
                    catch { errorMessage = error.localizedDescription }
                }
                    .buttonStyle(.bordered)
                #endif
            } else if assignment.state == .submittedUnverified {
                Button("Verify") {
                    guard let url = assignment.externalURL else { return }
                    #if os(macOS)
                    NSWorkspace.shared.open(url)
                    #else
                    UIApplication.shared.open(url)
                    #endif
                }
                    .buttonStyle(.bordered)
                    .disabled(assignment.externalURL == nil)
                    .help("Open the external source and verify its real submission state")
            }
        }
        .padding(.horizontal, LHSpacing.md)
        .padding(.vertical, LHSpacing.sm)
        .alert("Assignment could not be updated", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "Unknown error") }
    }
}

struct MiniTrajectoryPlot: View {
    var body: some View {
        Canvas { context, size in
            let baseline = Path { path in
                path.move(to: CGPoint(x: 8, y: size.height - 10))
                path.addLine(to: CGPoint(x: size.width - 8, y: size.height - 10))
            }
            context.stroke(baseline, with: .color(.secondary.opacity(0.25)), lineWidth: 1)
            var curve = Path()
            for step in 0...40 {
                let t = Double(step) / 40
                let x = 8 + CGFloat(t) * (size.width - 16)
                let y = size.height - 10 - CGFloat(4 * t * (1 - t)) * (size.height - 22)
                if step == 0 { curve.move(to: CGPoint(x: x, y: y)) }
                else { curve.addLine(to: CGPoint(x: x, y: y)) }
            }
            context.stroke(curve, with: .color(LearningPalette.copper), style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
        }
        .padding(6)
        .background(LearningPalette.paper.opacity(0.75), in: RoundedRectangle(cornerRadius: LHRadius.control, style: .continuous))
        .accessibilityLabel("Projectile trajectory preview")
    }
}
