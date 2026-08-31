import SwiftUI

public struct LearningInspector: View {
    @EnvironmentObject private var store: LearningHomeStore
    @ViewStorage private var errorMessage: String?
    let selection: AppDestination

    public init(selection: AppDestination) { self.selection = selection }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LHSpacing.lg) {
                switch selection {
                case .space(let id): spaceInspector(store.space(id: id))
                case .capture: queueInspector
                case .integrations: integrationInspector
                case .planner: plannerInspector
                case .today: todayInspector
                }
            }
            .padding(LHSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(LearningPalette.secondarySurface.opacity(0.45))
        .navigationTitle("Context")
        .alert("Tutor style could not be saved", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "Unknown error") }
    }

    @ViewBuilder
    private func spaceInspector(_ space: StudySpace?) -> some View {
        if let space {
            SpaceIdentity(space: space)
            inspectorSection("Tutor behavior") {
                Picker("Style", selection: Binding(
                    get: { space.tutorStyle },
                    set: { value in
                        do { try store.setTutorStyle(value, for: space.id) }
                        catch { errorMessage = error.localizedDescription }
                    }
                )) {
                    ForEach(TutorStyle.allCases, id: \.rawValue) { Text($0.title).tag($0) }
                }
                Text("Remembered per space, never forced globally.").font(.caption).foregroundStyle(.secondary)
            }
            inspectorSection("Sources") {
                Text("\(store.sources(in: space.id).count) indexed items").font(.subheadline)
                ForEach(store.sources(in: space.id).prefix(4)) { source in
                    Button {
                        store.selectedSourceID = source.id
                    } label: {
                        Label(source.title, systemImage: source.kind.symbol).lineLimit(1)
                    }
                    .buttonStyle(.plain)
                }
            }
            if let canvas = store.canvases(in: space.id).first {
                inspectorSection("Active canvas") {
                    Text(canvas.title).font(.subheadline.weight(.medium))
                    HStack { StatusPill("v\(canvas.version)"); if canvas.isStale { StatusPill("Stale", tone: .warning) } }
                    Text(canvas.sourceRevisionSignature).font(.caption.monospaced()).foregroundStyle(.tertiary).lineLimit(2)
                }
            }
        }
    }

    private var todayInspector: some View {
        Group {
            Label("Today", systemImage: "sun.max").font(.title3.weight(.semibold))
            inspectorSection("Proof boundary") {
                Text("Planned work, reminder completion, attachment state, and verified external submission remain distinct.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            inspectorSection("Review due") {
                ForEach(store.mastery.filter { $0.nextReviewAt <= Date() }) { record in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(record.topic).font(.subheadline.weight(.medium))
                        ProgressView(value: record.score).tint(record.score < 0.7 ? LearningPalette.warning : LearningPalette.success)
                    }
                }
            }
        }
    }

    private var queueInspector: some View {
        Group {
            Label("Processing queue", systemImage: "desktopcomputer.and.arrow.down").font(.title3.weight(.semibold))
            inspectorSection("Mac host") {
                StatusPill("This Mac", symbol: "desktopcomputer", tone: .success)
                Text("Companion captures are idempotent and wait in private CloudKit when this Mac is offline.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(store.jobs.prefix(8)) { job in
                HStack { Text(job.kindRaw.capitalized).font(.subheadline); Spacer(); StatusPill(job.stateRaw) }
            }
        }
    }

    private var plannerInspector: some View {
        Group {
            Label("Study Plan", systemImage: "calendar.badge.clock").font(.title3.weight(.semibold))
            inspectorSection("Calendar boundary") {
                Text("Only approved study blocks are created. The Desk updates only stored event identifiers and never edits unrelated calendar events.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            inspectorSection("Upcoming") {
                let sessions = store.sessions.filter { $0.isPlannedBlock && ($0.scheduledStart ?? .distantPast) >= Calendar.current.startOfDay(for: Date()) }
                if sessions.isEmpty {
                    Text("No approved blocks yet").font(.subheadline).foregroundStyle(.secondary)
                }
                ForEach(sessions.prefix(5)) { session in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(session.title).font(.subheadline.weight(.medium)).lineLimit(1)
                        Text((session.scheduledStart ?? session.startedAt).formatted(date: .abbreviated, time: .shortened))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private var integrationInspector: some View {
        Group {
            Label("Connector health", systemImage: "point.3.connected.trianglepath.dotted").font(.title3.weight(.semibold))
            ForEach(store.integrations) { integration in
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(integration.displayName).font(.subheadline.weight(.medium))
                        Spacer()
                        Circle().fill(integration.statusRaw == "ready" ? LearningPalette.success : LearningPalette.warning).frame(width: 7, height: 7)
                    }
                    Text(integration.isReadOnly ? "Read only" : "Scoped access").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func inspectorSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            Text(title.uppercased()).font(.caption2.weight(.bold)).tracking(0.7).foregroundStyle(.secondary)
            content()
        }
        .padding(LHSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .learningSurface(emphasized: false)
    }
}
