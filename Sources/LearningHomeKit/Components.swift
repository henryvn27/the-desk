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
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.title3.weight(.semibold))
                if let detail { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
            }
            Spacer()
            if let actionTitle, let action {
                Button(actionTitle, action: action).buttonStyle(.link)
            }
        }
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
        HStack(spacing: compact ? 8 : 12) {
            Image(systemName: space.symbolName)
                .font(compact ? .body : .title2)
                .foregroundStyle(Color(hex: space.colorHex))
                .frame(width: compact ? 28 : 42, height: compact ? 28 : 42)
                .background(Color(hex: space.colorHex).opacity(0.1), in: RoundedRectangle(cornerRadius: compact ? 7 : 10, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(space.title).font(compact ? .subheadline.weight(.semibold) : .headline)
                if !compact { Text(space.subtitle).font(.caption).foregroundStyle(.secondary) }
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
            .foregroundStyle(.secondary)
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

    public init(value: String, label: String, symbol: String, tint: Color) {
        self.value = value
        self.label = label
        self.symbol = symbol
        self.tint = tint
    }

    public var body: some View {
        HStack(spacing: LHSpacing.sm) {
            Image(systemName: symbol)
                .foregroundStyle(tint)
                .frame(width: 30, height: 30)
                .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(value).font(.headline.monospacedDigit())
                Text(label).font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

public extension Date {
    var learningDueLabel: String {
        if Calendar.current.isDateInToday(self) { return "Today · " + formatted(date: .omitted, time: .shortened) }
        if Calendar.current.isDateInTomorrow(self) { return "Tomorrow · " + formatted(date: .omitted, time: .shortened) }
        return formatted(date: .abbreviated, time: .shortened)
    }
}
