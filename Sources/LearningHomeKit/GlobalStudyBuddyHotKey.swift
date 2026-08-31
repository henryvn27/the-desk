#if os(macOS)
import AppKit
import Carbon
import Foundation

/// Registers hold-to-talk ⌥Space without Accessibility or Input Monitoring.
/// Press reveals/listens; release may request one snapshot only after the user
/// has already confirmed a capture target inside Study Buddy.
@MainActor
public final class GlobalStudyBuddyHotKey {
    public static let shared = GlobalStudyBuddyHotKey()
    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?

    private init() {}

    public func register() {
        guard hotKey == nil else { return }
        let eventTypes = [
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased)),
        ]
        let callback: EventHandlerUPP = { _, event, _ in
            guard let event else { return OSStatus(eventNotHandledErr) }
            var identifier = EventHotKeyID()
            let status = GetEventParameter(
                event,
                EventParamName(kEventParamDirectObject),
                EventParamType(typeEventHotKeyID),
                nil,
                MemoryLayout<EventHotKeyID>.size,
                nil,
                &identifier
            )
            guard status == noErr, identifier.signature == 0x44534B31, identifier.id == 1 else {
                return OSStatus(eventNotHandledErr)
            }
            let eventKind = GetEventKind(event)
            DispatchQueue.main.async {
                if eventKind == UInt32(kEventHotKeyPressed) {
                    NotificationCenter.default.post(name: .learningHomeShowStudyBuddy, object: nil)
                    DispatchQueue.main.async {
                        NotificationCenter.default.post(name: .learningHomeStudyBuddyHoldBegan, object: nil)
                    }
                } else if eventKind == UInt32(kEventHotKeyReleased) {
                    NotificationCenter.default.post(name: .learningHomeStudyBuddyHoldEnded, object: nil)
                }
            }
            return noErr
        }
        let installStatus = eventTypes.withUnsafeBufferPointer { events in
            InstallEventHandler(
                GetApplicationEventTarget(),
                callback,
                events.count,
                events.baseAddress,
                nil,
                &handler
            )
        }
        guard installStatus == noErr else { return }

        let identifier = EventHotKeyID(signature: 0x44534B31, id: 1)
        if RegisterEventHotKey(
            UInt32(kVK_Space),
            UInt32(optionKey),
            identifier,
            GetApplicationEventTarget(),
            0,
            &hotKey
        ) != noErr {
            if let handler { RemoveEventHandler(handler) }
            self.handler = nil
        }
    }

    public func unregister() {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let handler { RemoveEventHandler(handler) }
        hotKey = nil
        handler = nil
    }
}
#endif
