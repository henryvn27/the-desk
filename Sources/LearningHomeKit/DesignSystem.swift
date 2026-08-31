import SwiftUI

/// Small local view storage backed by StateObject. It keeps the project buildable
/// with both Xcode SwiftUI and command-line SDKs that omit the SwiftUIMacros plug-in.
@MainActor
@propertyWrapper
public struct ViewStorage<Value>: DynamicProperty {
    private final class Box: ObservableObject {
        @Published var value: Value
        init(_ value: Value) { self.value = value }
    }

    @StateObject private var box: Box

    public init(wrappedValue: Value) {
        _box = StateObject(wrappedValue: Box(wrappedValue))
    }

    public var wrappedValue: Value {
        get { box.value }
        nonmutating set { box.value = newValue }
    }

    public var projectedValue: Binding<Value> {
        Binding(get: { box.value }, set: { box.value = $0 })
    }
}

/* Aesthetic direction: quiet / studious / precise.
 * - Type: native SF for controls and body; platform serif only for long-form learning titles.
 * - Color: cool neutral surfaces, restrained indigo focus color, class color as a small locator.
 * - Density: compact-normal on an 8-point scale; 44-point minimum touch targets on mobile.
 * - Radius: 6 for controls, 10 for grouped surfaces. Borders over decorative shadows.
 * - Components: quiet/outlined by default; one filled primary action per surface.
 * - Motion: critically damped and short. No entrance theater, gradients, or decorative glass stacks.
 */

public enum LHSpacing {
    public static let xxs: CGFloat = 4
    public static let xs: CGFloat = 8
    public static let sm: CGFloat = 12
    public static let md: CGFloat = 16
    public static let lg: CGFloat = 24
    public static let xl: CGFloat = 32
    public static let xxl: CGFloat = 48
}

public enum LHRadius {
    public static let control: CGFloat = 6
    public static let surface: CGFloat = 10
    public static let prominent: CGFloat = 14
}

public enum LHMotion {
    public static let standard = Animation.spring(response: 0.32, dampingFraction: 1.0)
    public static let direct = Animation.easeOut(duration: 0.18)
}

public enum LearningPalette {
    public static let indigo = Color(hex: "#4657B8")
    public static let indigoMuted = Color(hex: "#E8EAF7")
    public static let paper = Color(hex: "#F5F2E9")
    public static let ink = Color(hex: "#20242B")
    public static let success = Color(hex: "#2E7D5B")
    public static let warning = Color(hex: "#A36A18")
    public static let danger = Color(hex: "#B24B45")

    public static var appBackground: Color {
        #if os(macOS)
        Color(nsColor: .windowBackgroundColor)
        #else
        Color(uiColor: .systemGroupedBackground)
        #endif
    }

    public static var surface: Color {
        #if os(macOS)
        Color(nsColor: .controlBackgroundColor)
        #else
        Color(uiColor: .secondarySystemGroupedBackground)
        #endif
    }

    public static var secondarySurface: Color {
        #if os(macOS)
        Color(nsColor: .underPageBackgroundColor)
        #else
        Color(uiColor: .tertiarySystemGroupedBackground)
        #endif
    }

    public static var separator: Color {
        #if os(macOS)
        Color(nsColor: .separatorColor)
        #else
        Color(uiColor: .separator)
        #endif
    }
}

public extension Color {
    init(hex: String) {
        let value = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        let number = UInt64(value, radix: 16) ?? 0
        let red, green, blue, alpha: UInt64
        switch value.count {
        case 8:
            red = number >> 24
            green = number >> 16 & 0xFF
            blue = number >> 8 & 0xFF
            alpha = number & 0xFF
        default:
            red = number >> 16
            green = number >> 8 & 0xFF
            blue = number & 0xFF
            alpha = 0xFF
        }
        self.init(
            .sRGB,
            red: Double(red) / 255,
            green: Double(green) / 255,
            blue: Double(blue) / 255,
            opacity: Double(alpha) / 255
        )
    }
}

public struct LearningSurfaceModifier: ViewModifier {
    var emphasized: Bool

    public func body(content: Content) -> some View {
        content
            .background(emphasized ? LearningPalette.surface : LearningPalette.secondarySurface)
            .clipShape(RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: LHRadius.surface, style: .continuous)
                    .stroke(LearningPalette.separator.opacity(0.65), lineWidth: 0.75)
            }
    }
}

public extension View {
    func learningSurface(emphasized: Bool = true) -> some View {
        modifier(LearningSurfaceModifier(emphasized: emphasized))
    }
}

public struct StatusPill: View {
    public enum Tone { case neutral, success, warning, danger, info }

    let title: String
    let symbol: String?
    let tone: Tone

    public init(_ title: String, symbol: String? = nil, tone: Tone = .neutral) {
        self.title = title
        self.symbol = symbol
        self.tone = tone
    }

    private var tint: Color {
        switch tone {
        case .neutral: .secondary
        case .success: LearningPalette.success
        case .warning: LearningPalette.warning
        case .danger: LearningPalette.danger
        case .info: LearningPalette.indigo
        }
    }

    public var body: some View {
        HStack(spacing: 5) {
            if let symbol { Image(systemName: symbol) }
            Text(title)
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(tint)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(tint.opacity(0.1), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}
