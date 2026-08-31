import SwiftUI

#if os(macOS)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

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

/* Aesthetic direction: quiet / tactile / studious.
 * - Type: native SF for controls and body; platform serif only for long-form learning titles.
 * - Color: graphite and paper establish the desk; copper, moss, and clay carry meaning.
 * - Density: an 8-point rhythm with 44-point minimum touch targets on mobile.
 * - Radius: 10 for controls, 16 for surfaces, 24 for prominent cards.
 * - Components: quiet borders and restrained depth; one filled primary action per surface.
 * - Motion: short and direct. No entrance theater, gradients, or decorative glass stacks.
 */

public enum LHSpacing {
    public static let xxs: CGFloat = 4
    public static let xs: CGFloat = 8
    public static let sm: CGFloat = 16
    public static let md: CGFloat = 24
    public static let lg: CGFloat = 32
    public static let xl: CGFloat = 40
    public static let xxl: CGFloat = 48
    public static let xxxl: CGFloat = 64
}

public enum LHRadius {
    public static let control: CGFloat = 10
    public static let surface: CGFloat = 16
    public static let prominent: CGFloat = 24
    public static let pill: CGFloat = 999
}

public enum LHMotion {
    public static let standard = Animation.easeInOut(duration: 0.22)
    public static let direct = Animation.easeOut(duration: 0.18)
}

public enum LearningPalette {
    // Core Desk palette. Light and dark values are intentionally authored as
    // separate appearances; dark mode is not a mechanical inversion.
    public static let graphite = Color.adaptive(lightHex: "#25282B", darkHex: "#17191B")
    public static let graphiteSoft = Color.adaptive(lightHex: "#3B4045", darkHex: "#34383C")
    public static let paper = Color.adaptive(lightHex: "#F7F4ED", darkHex: "#222425")
    public static let parchment = Color.adaptive(lightHex: "#E8E2D7", darkHex: "#2B2E30")
    public static let surface = Color.adaptive(lightHex: "#FFFDFA", darkHex: "#292B2D")
    public static let secondarySurface = Color.adaptive(lightHex: "#F0ECE4", darkHex: "#303335")
    public static let ink = Color.adaptive(lightHex: "#1F2326", darkHex: "#F4F0E8")
    public static let mutedInk = Color.adaptive(lightHex: "#656A67", darkHex: "#B8BCB8")
    public static let hairline = Color.adaptive(lightHex: "#D6D0C5", darkHex: "#3B3E40")
    public static let copper = Color.adaptive(lightHex: "#9D4E31", darkHex: "#D7835F")
    public static let copperSoft = Color.adaptive(lightHex: "#F1DED5", darkHex: "#4C3027")
    public static let moss = Color.adaptive(lightHex: "#50705A", darkHex: "#83A48D")
    public static let mossSoft = Color.adaptive(lightHex: "#D8E2DC", darkHex: "#2E3832")
    public static let clay = Color.adaptive(lightHex: "#E8D7CC", darkHex: "#3A2B26")

    // Semantic roles retain enough separation for non-color cues to do the
    // rest of the work: labels, symbols, and progress values remain explicit.
    public static let success = Color.adaptive(lightHex: "#3F765A", darkHex: "#83A48D")
    public static let warning = Color.adaptive(lightHex: "#A66A25", darkHex: "#D9A06A")
    public static let danger = Color.adaptive(lightHex: "#A34848", darkHex: "#D98989")
    public static let primaryForeground = Color.adaptive(lightHex: "#FFFFFF", darkHex: "#1F2326")
    public static let onGraphite = Color.adaptive(lightHex: "#FFFFFF", darkHex: "#F4F0E8")

    // Compatibility aliases. Existing screens can migrate incrementally while
    // all focus/action usage takes on the Desk's copper identity.
    public static let indigo = copper
    public static let indigoMuted = copperSoft
    public static let copperMuted = copperSoft

    public static var appBackground: Color {
        paper
    }

    public static var separator: Color {
        hairline
    }

    public static var focus: Color {
        copper
    }
}

private enum DeskColorValue {
    static func rgba(from hex: String) -> (red: Double, green: Double, blue: Double, alpha: Double) {
        let value = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        let number = UInt64(value, radix: 16) ?? 0
        let red: UInt64
        let green: UInt64
        let blue: UInt64
        let alpha: UInt64
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
        return (
            Double(red) / 255,
            Double(green) / 255,
            Double(blue) / 255,
            Double(alpha) / 255
        )
    }

    #if os(macOS)
    static func nsColor(from hex: String) -> NSColor {
        let value = rgba(from: hex)
        return NSColor(
            calibratedRed: value.red,
            green: value.green,
            blue: value.blue,
            alpha: value.alpha
        )
    }
    #elseif canImport(UIKit)
    static func uiColor(from hex: String) -> UIColor {
        let value = rgba(from: hex)
        return UIColor(
            red: value.red,
            green: value.green,
            blue: value.blue,
            alpha: value.alpha
        )
    }
    #endif
}

public extension Color {
    init(hex: String) {
        let value = DeskColorValue.rgba(from: hex)
        self.init(
            .sRGB,
            red: value.red,
            green: value.green,
            blue: value.blue,
            opacity: value.alpha
        )
    }

    /// Returns a system-adaptive color without requiring an asset catalog.
    static func adaptive(lightHex: String, darkHex: String) -> Color {
        #if os(macOS)
        let light = DeskColorValue.nsColor(from: lightHex)
        let dark = DeskColorValue.nsColor(from: darkHex)
        let dynamic = NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light
        }
        return Color(nsColor: dynamic)
        #elseif canImport(UIKit)
        let light = DeskColorValue.uiColor(from: lightHex)
        let dark = DeskColorValue.uiColor(from: darkHex)
        return Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
        #else
        return Color(hex: lightHex)
        #endif
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
                    .stroke(LearningPalette.hairline.opacity(0.78), lineWidth: 0.75)
            }
            .shadow(
                color: LearningPalette.ink.opacity(emphasized ? 0.07 : 0),
                radius: emphasized ? 10 : 0,
                x: 0,
                y: emphasized ? 4 : 0
            )
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
        case .neutral: LearningPalette.mutedInk
        case .success: LearningPalette.success
        case .warning: LearningPalette.warning
        case .danger: LearningPalette.danger
        case .info: LearningPalette.copper
        }
    }

    public var body: some View {
        HStack(spacing: 5) {
            if let symbol { Image(systemName: symbol) }
            Text(title)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(tint)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(tint.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}
