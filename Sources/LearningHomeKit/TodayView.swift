import SwiftUI

#if os(macOS)
import AppKit
#elseif os(iOS)
import UIKit
#endif

public struct TodayView: View {
    @EnvironmentObject private var store: LearningHomeStore
    private let openSpace: ((UUID) -> Void)?

    public init(openSpace: ((UUID) -> Void)? = nil) {
        self.openSpace = openSpace
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

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LHSpacing.lg) {
                header
                summary
                if let focusAssignment, let space = store.space(id: focusAssignment.spaceID) {
                    focusCard(assignment: focusAssignment, space: space)
                }
                studyBlockSection
                assignmentSection
                resumeSection
            }
            .padding(LHSpacing.lg)
            .frame(maxWidth: 940, alignment: .leading)
        }
        .background(LearningPalette.appBackground)
        .navigationTitle("Today")
    }

    private var header: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 4) {
                Text(Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                Text("Know what matters next.")
                    .font(.system(.largeTitle, design: .serif, weight: .semibold))
            }
            Spacer()
            #if os(macOS)
            StatusPill("Mac engine", symbol: "desktopcomputer", tone: .success)
            #else
            StatusPill("Paired Mac host", symbol: "desktopcomputer", tone: .neutral)
            #endif
        }
    }

    private var summary: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 138), spacing: LHSpacing.md)], alignment: .leading, spacing: LHSpacing.md) {
            MetricBlock(value: "\(activeAssignments.count)", label: "open items", symbol: "checklist", tint: LearningPalette.indigo)
            let reviews = store.mastery.filter { $0.nextReviewAt <= Date() }.count
            MetricBlock(value: "\(reviews)", label: "reviews due", symbol: "arrow.clockwise", tint: LearningPalette.warning)
            let queued = store.jobs.filter { $0.state != .completed }.count
            MetricBlock(value: "\(queued)", label: "captures queued", symbol: "tray", tint: Color(hex: "#347A78"))
            let todayBlocks = upcomingBlocks.filter { Calendar.current.isDateInToday($0.scheduledStart ?? .distantPast) }.count
            MetricBlock(value: "\(todayBlocks)", label: "blocks today", symbol: "calendar.badge.clock", tint: LearningPalette.success)
        }
        .padding(LHSpacing.md)
        .learningSurface()
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
                                    .foregroundStyle(store.space(id: session.spaceID).map { Color(hex: $0.colorHex) } ?? LearningPalette.indigo)
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
        HStack(spacing: LHSpacing.lg) {
            VStack(alignment: .leading, spacing: LHSpacing.sm) {
                Label("Best next move", systemImage: "scope")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color(hex: space.colorHex))
                Text(assignment.title)
                    .font(.title2.weight(.semibold))
                Text(assignment.detail)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: LHSpacing.sm) {
                    Button("Start focused study") {
                        store.selectedSpaceID = space.id
                        openSpace?(space.id)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color(hex: space.colorHex))
                    Button("Open source") {
                        if let url = assignment.externalURL {
                            #if os(macOS)
                            NSWorkspace.shared.open(url)
                            #else
                            UIApplication.shared.open(url)
                            #endif
                        }
                    }
                    .buttonStyle(.bordered)
                    .disabled(assignment.externalURL == nil)
                }
            }
            Spacer(minLength: LHSpacing.md)
            VStack(alignment: .trailing, spacing: LHSpacing.sm) {
                SpaceIdentity(space: space)
                Text(assignment.dueAt.learningDueLabel)
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
                AssignmentStatePill(assignment.state)
            }
        }
        .padding(LHSpacing.lg)
        .background(Color(hex: space.colorHex).opacity(0.065))
        .clipShape(RoundedRectangle(cornerRadius: LHRadius.prominent, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: LHRadius.prominent, style: .continuous)
                .stroke(Color(hex: space.colorHex).opacity(0.22), lineWidth: 1)
        }
    }

    private var assignmentSection: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            SectionHeading("Your day", detail: "Completion and submission evidence stay separate.")
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
            Image(systemName: space?.symbolName ?? "checklist")
                .foregroundStyle(space.map { Color(hex: $0.colorHex) } ?? .secondary)
                .frame(width: 34, height: 34)
                .background((space.map { Color(hex: $0.colorHex) } ?? .secondary).opacity(0.09), in: RoundedRectangle(cornerRadius: 8))
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
            context.stroke(curve, with: .color(LearningPalette.indigo), style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
        }
        .padding(6)
        .background(LearningPalette.paper.opacity(0.75), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityLabel("Projectile trajectory preview")
    }
}
