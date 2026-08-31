import SwiftUI

public struct SectionHeading: View {
    let title: String
    let detail: String?
    let actionTitle: String?
    let action: (() -> Void)?

    public init(_ title: String, detail: String? = nil, actionTitle: String? = nil, action: (() -> Void)? = nil) {
        self.title = title
        self.detail = detail
        self.actionTitle = actionTitle
        self.action = action
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: LHSpacing.sm) {
            VStack(alignment: .leading, spacing: LHSpacing.xxs) {
                Text(title)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(LearningPalette.ink)
                if let detail {
                    Text(detail)
                        .font(.subheadline)
                        .foregroundStyle(LearningPalette.mutedInk)
                }
            }
            Spacer()
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.link)
                    .foregroundStyle(LearningPalette.copper)
            }
        }
    }
}

/// A consistent page entry point: quiet context, one clear title, and one
/// optional action. Keep secondary configuration out of this header.
public struct DeskPageHeader: View {
    let eyebrow: String?
    let title: String
    let detail: String?
    let actionTitle: String?
    let actionSymbol: String?
    let action: (() -> Void)?

    public init(
        _ title: String,
        eyebrow: String? = nil,
        detail: String? = nil,
        actionTitle: String? = nil,
        actionSymbol: String? = nil,
        action: (() -> Void)? = nil
    ) {
        self.eyebrow = eyebrow
        self.title = title
        self.detail = detail
        self.actionTitle = actionTitle
        self.actionSymbol = actionSymbol
        self.action = action
    }

    public init(
        title: String,
        eyebrow: String? = nil,
        detail: String? = nil,
        actionTitle: String? = nil,
        actionSymbol: String? = nil,
        action: (() -> Void)? = nil
    ) {
        self.init(
            title,
            eyebrow: eyebrow,
            detail: detail,
            actionTitle: actionTitle,
            actionSymbol: actionSymbol,
            action: action
        )
    }

    public var body: some View {
        HStack(alignment: .top, spacing: LHSpacing.md) {
            VStack(alignment: .leading, spacing: LHSpacing.xs) {
                if let eyebrow, !eyebrow.isEmpty {
                    Text(eyebrow.uppercased())
                        .font(.caption.weight(.semibold))
                        .tracking(0.8)
                        .foregroundStyle(LearningPalette.mutedInk)
                }
                Text(title)
                    .font(.largeTitle.weight(.semibold))
                    .foregroundStyle(LearningPalette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail, !detail.isEmpty {
                    Text(detail)
                        .font(.body)
                        .foregroundStyle(LearningPalette.mutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: LHSpacing.sm)
            if let actionTitle, let action {
                Button(action: action) {
                    if let actionSymbol {
                        Label(actionTitle, systemImage: actionSymbol)
                    } else {
                        Text(actionTitle)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(LearningPalette.copper)
                .foregroundStyle(LearningPalette.primaryForeground)
                .controlSize(.regular)
                .frame(minHeight: 44)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The primary "what should I do next?" surface for Home, a class, or a plan.
/// The optional progress figure is deliberately supporting information.
public struct PrimaryStudyCard: View {
    let eyebrow: String?
    let title: String
    let detail: String?
    let actionTitle: String?
    let actionSymbol: String?
    let action: (() -> Void)?
    let progress: Double?
    let progressLabel: String?
    let background: Color
    let accent: Color

    public init(
        _ title: String,
        eyebrow: String? = nil,
        detail: String? = nil,
        actionTitle: String? = nil,
        actionSymbol: String? = nil,
        action: (() -> Void)? = nil,
        progress: Double? = nil,
        progressLabel: String? = nil,
        background: Color = LearningPalette.clay,
        accent: Color = LearningPalette.copper
    ) {
        self.eyebrow = eyebrow
        self.title = title
        self.detail = detail
        self.actionTitle = actionTitle
        self.actionSymbol = actionSymbol
        self.action = action
        self.progress = progress
        self.progressLabel = progressLabel
        self.background = background
        self.accent = accent
    }

    public init(
        title: String,
        eyebrow: String? = nil,
        detail: String? = nil,
        actionTitle: String? = nil,
        actionSymbol: String? = nil,
        action: (() -> Void)? = nil,
        progress: Double? = nil,
        progressLabel: String? = nil,
        background: Color = LearningPalette.clay,
        accent: Color = LearningPalette.copper
    ) {
        self.init(
            title,
            eyebrow: eyebrow,
            detail: detail,
            actionTitle: actionTitle,
            actionSymbol: actionSymbol,
            action: action,
            progress: progress,
            progressLabel: progressLabel,
            background: background,
            accent: accent
        )
    }

    public var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .center, spacing: LHSpacing.lg) {
                copy
                if let progress { progressFigure(progress).frame(width: 152) }
            }
            VStack(alignment: .leading, spacing: LHSpacing.lg) {
                copy
                if let progress { progressFigure(progress).frame(maxWidth: .infinity, alignment: .leading) }
            }
        }
        .padding(LHSpacing.lg)
        .background(background)
        .clipShape(RoundedRectangle(cornerRadius: LHRadius.prominent, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: LHRadius.prominent, style: .continuous)
                .stroke(LearningPalette.hairline.opacity(0.55), lineWidth: 0.75)
        }
        .shadow(color: LearningPalette.ink.opacity(0.08), radius: 14, x: 0, y: 6)
    }

    @ViewBuilder
    private var copy: some View {
        VStack(alignment: .leading, spacing: LHSpacing.xs) {
            if let eyebrow, !eyebrow.isEmpty {
                Text(eyebrow.uppercased())
                    .font(.caption.weight(.semibold))
                    .tracking(0.8)
                    .foregroundStyle(LearningPalette.mutedInk)
            }
            Text(title)
                .font(.title2.weight(.semibold))
                .foregroundStyle(LearningPalette.ink)
                .fixedSize(horizontal: false, vertical: true)
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.body)
                    .foregroundStyle(LearningPalette.mutedInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let actionTitle, let action {
                Button(action: action) {
                    if let actionSymbol {
                        Label(actionTitle, systemImage: actionSymbol)
                    } else {
                        Text(actionTitle)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(accent)
                .foregroundStyle(LearningPalette.primaryForeground)
                .controlSize(.regular)
                .frame(minHeight: 44)
                .padding(.top, LHSpacing.xs)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func progressFigure(_ value: Double) -> some View {
        let clamped = min(max(value, 0), 1)
        return VStack(alignment: .leading, spacing: LHSpacing.xxs) {
            Text("\(Int((clamped * 100).rounded()))%")
                .font(.system(.title, design: .rounded).weight(.semibold).monospacedDigit())
                .foregroundStyle(LearningPalette.ink)
            Text(progressLabel ?? "progress")
                .font(.caption)
                .foregroundStyle(LearningPalette.mutedInk)
            ProgressView(value: clamped)
                .tint(LearningPalette.moss)
                .frame(height: 8)
        }
        .padding(LHSpacing.md)
        .background(LearningPalette.surface.opacity(0.72), in: RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(progressLabel ?? "Progress")
        .accessibilityValue("\(Int((clamped * 100).rounded())) percent")
    }
}

/// A compact status/value capsule for task rows and metadata clusters.
public struct ProgressChip: View {
    let label: String
    let value: String?
    let tint: Color

    public init(_ label: String, value: String? = nil, tint: Color = LearningPalette.moss) {
        self.label = label
        self.value = value
        self.tint = tint
    }

    public init(label: String, value: String? = nil, tint: Color = LearningPalette.moss) {
        self.init(label, value: value, tint: tint)
    }

    public var body: some View {
        HStack(spacing: LHSpacing.xxs) {
            Circle()
                .fill(tint)
                .frame(width: 6, height: 6)
            Text(label)
            if let value {
                Text(value)
                    .fontWeight(.semibold)
                    .monospacedDigit()
            }
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(tint)
        .padding(.horizontal, LHSpacing.xs)
        .frame(minHeight: 28)
        .background(tint.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

/// A labeled progress track with a descriptive VoiceOver value.
public struct MasteryBar: View {
    let title: String
    let value: Double
    let detail: String?
    let tint: Color

    public init(_ title: String, value: Double, detail: String? = nil, tint: Color = LearningPalette.moss) {
        self.title = title
        self.value = value
        self.detail = detail
        self.tint = tint
    }

    public init(title: String, value: Double, detail: String? = nil, tint: Color = LearningPalette.moss) {
        self.init(title, value: value, detail: detail, tint: tint)
    }

    public var body: some View {
        let clamped = min(max(value, 0), 1)
        VStack(alignment: .leading, spacing: LHSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: LHSpacing.xs) {
                Text(title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(LearningPalette.ink)
                Spacer(minLength: LHSpacing.xs)
                Text("\(Int((clamped * 100).rounded()))%")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(LearningPalette.mutedInk)
            }
            ProgressView(value: clamped)
                .tint(tint)
                .frame(height: 8)
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(LearningPalette.mutedInk)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(
            ["\(Int((clamped * 100).rounded())) percent", detail]
                .compactMap { $0 }
                .joined(separator: ", ")
        )
    }
}

/// A surface for one subject/topic's progress. Use class color as a locator,
/// while the progress semantic remains moss for consistent scanning.
public struct SubjectProgressCard: View {
    let title: String
    let progress: Double
    let detail: String?
    let symbol: String?
    let tint: Color

    public init(
        _ title: String,
        progress: Double,
        detail: String? = nil,
        symbol: String? = nil,
        tint: Color = LearningPalette.moss
    ) {
        self.title = title
        self.progress = progress
        self.detail = detail
        self.symbol = symbol
        self.tint = tint
    }

    public init(
        title: String,
        progress: Double,
        detail: String? = nil,
        symbol: String? = nil,
        tint: Color = LearningPalette.moss
    ) {
        self.init(title, progress: progress, detail: detail, symbol: symbol, tint: tint)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: LHSpacing.md) {
            if let symbol {
                Label(title, systemImage: symbol)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(LearningPalette.ink)
            } else {
                Text(title)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(LearningPalette.ink)
            }
            MasteryBar(title: "Readiness", value: progress, detail: detail, tint: tint)
        }
        .padding(LHSpacing.md)
        .background(LearningPalette.surface)
        .clipShape(RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous)
                .stroke(LearningPalette.hairline.opacity(0.78), lineWidth: 0.75)
        }
    }
}

/// A reusable row for the ordered work list on Home and a class dashboard.
public struct DailyTaskRow: View {
    let title: String
    let detail: String?
    let status: String?
    let isComplete: Bool
    let action: (() -> Void)?

    public init(
        title: String,
        detail: String? = nil,
        status: String? = nil,
        isComplete: Bool = false,
        action: (() -> Void)? = nil
    ) {
        self.title = title
        self.detail = detail
        self.status = status
        self.isComplete = isComplete
        self.action = action
    }

    public var body: some View {
        Group {
            if let action {
                Button(action: action) { rowContent }
                    .buttonStyle(.plain)
                    .contentShape(Rectangle())
            } else {
                rowContent
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
    }

    private var rowContent: some View {
        HStack(alignment: .center, spacing: LHSpacing.sm) {
            Image(systemName: isComplete ? "checkmark.circle.fill" : "circle")
                .font(.title3)
                .foregroundStyle(isComplete ? LearningPalette.success : LearningPalette.copper)
                .frame(width: 28, height: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: LHSpacing.xxs) {
                Text(title)
                    .font(.body.weight(.medium))
                    .foregroundStyle(LearningPalette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(LearningPalette.mutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: LHSpacing.xs)
            if let status, !status.isEmpty {
                ProgressChip(status, tint: isComplete ? LearningPalette.success : LearningPalette.copper)
            }
        }
        .padding(.vertical, LHSpacing.xs)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(title)
        .accessibilityValue(
            [detail, status, isComplete ? "Complete" : "Not complete"]
                .compactMap { $0 }
                .joined(separator: ", ")
        )
    }
}

public struct SpaceIdentity: View {
    let space: StudySpace
    let compact: Bool

    public init(space: StudySpace, compact: Bool = false) {
        self.space = space
        self.compact = compact
    }

    public var body: some View {
        HStack(spacing: compact ? LHSpacing.xs : LHSpacing.sm) {
            Image(systemName: space.symbolName)
                .font(compact ? .body : .title2)
                .foregroundStyle(Color(hex: space.colorHex))
                .frame(width: compact ? 28 : 42, height: compact ? 28 : 42)
                .background(
                    Color(hex: space.colorHex).opacity(0.1),
                    in: RoundedRectangle(cornerRadius: compact ? LHRadius.control : LHRadius.surface, style: .continuous)
                )
            VStack(alignment: .leading, spacing: 2) {
                Text(space.title)
                    .font(compact ? .subheadline.weight(.semibold) : .headline)
                    .foregroundStyle(LearningPalette.ink)
                if !compact {
                    Text(space.subtitle)
                        .font(.caption)
                        .foregroundStyle(LearningPalette.mutedInk)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

public struct SourceKindLabel: View {
    let source: SourceAsset
    public init(source: SourceAsset) { self.source = source }

    public var body: some View {
        Label(source.kind.rawValue.capitalized, systemImage: source.kind.symbol)
            .font(.caption.weight(.medium))
            .foregroundStyle(LearningPalette.mutedInk)
    }
}

public struct ProcessingStatusPill: View {
    let state: ProcessingState
    public init(_ state: ProcessingState) { self.state = state }

    public var body: some View {
        switch state {
        case .ready: StatusPill("Ready", symbol: "checkmark", tone: .success)
        case .queued: StatusPill("Queued", symbol: "clock", tone: .neutral)
        case .processing: StatusPill("Processing", symbol: "arrow.triangle.2.circlepath", tone: .info)
        case .needsAuthentication: StatusPill("Sign in", symbol: "person.crop.circle.badge.exclamationmark", tone: .warning)
        case .failed: StatusPill("Needs attention", symbol: "exclamationmark.triangle", tone: .danger)
        }
    }
}

public struct AssignmentStatePill: View {
    let state: AssignmentState
    public init(_ state: AssignmentState) { self.state = state }

    public var body: some View {
        switch state {
        case .verifiedComplete: StatusPill(state.title, symbol: "checkmark.seal.fill", tone: .success)
        case .submittedUnverified: StatusPill(state.title, symbol: "arrow.clockwise", tone: .warning)
        case .returned: StatusPill(state.title, symbol: "arrow.uturn.backward", tone: .danger)
        case .ready: StatusPill(state.title, symbol: "play.fill", tone: .info)
        case .planned: StatusPill(state.title, symbol: "calendar", tone: .neutral)
        }
    }
}

public struct MetricBlock: View {
    let value: String
    let label: String
    let symbol: String
    let tint: Color

    public init(value: String, label: String, symbol: String, tint: Color = LearningPalette.copper) {
        self.value = value
        self.label = label
        self.symbol = symbol
        self.tint = tint
    }

    public var body: some View {
        HStack(spacing: LHSpacing.xs) {
            Image(systemName: symbol)
                .foregroundStyle(tint)
                .frame(width: 32, height: 32)
                .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: LHRadius.control, style: .continuous))
            VStack(alignment: .leading, spacing: LHSpacing.xxs) {
                Text(value)
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(LearningPalette.ink)
                Text(label)
                    .font(.caption)
                    .foregroundStyle(LearningPalette.mutedInk)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(value)
    }
}

public extension Date {
    var learningDueLabel: String {
        if Calendar.current.isDateInToday(self) { return "Today · " + formatted(date: .omitted, time: .shortened) }
        if Calendar.current.isDateInTomorrow(self) { return "Tomorrow · " + formatted(date: .omitted, time: .shortened) }
        return formatted(date: .abbreviated, time: .shortened)
    }
}
