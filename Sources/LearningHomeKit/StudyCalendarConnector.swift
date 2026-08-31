@preconcurrency import EventKit
import Foundation

public struct StudyCalendarOption: Identifiable, Hashable, Sendable {
    public enum AccountKind: String, Sendable {
        case apple, google, exchange, local, other

        public var title: String {
            switch self {
            case .apple: "Apple Calendar"
            case .google: "Google Calendar"
            case .exchange: "Exchange"
            case .local: "On My Mac"
            case .other: "Calendar"
            }
        }
    }

    public var id: String
    public var title: String
    public var accountTitle: String
    public var accountKind: AccountKind
}

public enum StudyCalendarError: Error, LocalizedError {
    case permissionDenied, unavailable, invalidBlock

    public var errorDescription: String? {
        switch self {
        case .permissionDenied: "Calendar access was not granted. The plan remains saved only in The Desk."
        case .unavailable: "That calendar is no longer writable. No unrelated calendar event was changed."
        case .invalidBlock: "The study block is missing a start time or duration."
        }
    }
}

/// EventKit writes are restricted to new study blocks and events whose identifiers
/// were previously stored by The Desk. Calendars unrelated to those IDs are read-only.
@MainActor
public final class StudyCalendarConnector {
    public static let shared = StudyCalendarConnector()
    private let eventStore = EKEventStore()

    private init() {}

    public func writableCalendars() async throws -> [StudyCalendarOption] {
        let granted = try await eventStore.requestFullAccessToEvents()
        guard granted else { throw StudyCalendarError.permissionDenied }
        return eventStore.calendars(for: .event)
            .filter(\.allowsContentModifications)
            .map { calendar in
                StudyCalendarOption(
                    id: calendar.calendarIdentifier,
                    title: calendar.title,
                    accountTitle: calendar.source.title,
                    accountKind: Self.accountKind(for: calendar.source)
                )
            }
            .sorted {
                if $0.accountTitle == $1.accountTitle { return $0.title < $1.title }
                return $0.accountTitle < $1.accountTitle
            }
    }

    public func createEvent(for session: StudySession, spaceTitle: String, calendarIdentifier: String) throws -> String {
        guard let start = session.scheduledStart,
              let minutes = session.plannedDurationMinutes else {
            throw StudyCalendarError.invalidBlock
        }
        guard let calendar = eventStore.calendar(withIdentifier: calendarIdentifier),
              calendar.allowsContentModifications else {
            throw StudyCalendarError.unavailable
        }
        let marker = "Study block ID: \(session.id.uuidString)"
        let lookupStart = start.addingTimeInterval(-86_400)
        let lookupEnd = start.addingTimeInterval(86_400)
        let predicate = eventStore.predicateForEvents(withStart: lookupStart, end: lookupEnd, calendars: [calendar])
        if let existing = eventStore.events(matching: predicate).first(where: { $0.notes?.contains(marker) == true }),
           let identifier = existing.eventIdentifier {
            return identifier
        }
        let event = EKEvent(eventStore: eventStore)
        event.title = session.title
        event.startDate = start
        event.endDate = Calendar.current.date(byAdding: .minute, value: minutes, to: start) ?? start.addingTimeInterval(TimeInterval(minutes * 60))
        event.calendar = calendar
        event.notes = "The Desk · \(spaceTitle)\n\(session.notes)\n\(marker)"
        try eventStore.save(event, span: .thisEvent, commit: true)
        guard let identifier = event.eventIdentifier else { throw StudyCalendarError.unavailable }
        return identifier
    }

    public func updateLinkedEvent(for session: StudySession, spaceTitle: String) throws {
        guard let identifier = session.calendarEventIdentifier,
              let event = eventStore.event(withIdentifier: identifier),
              let start = session.scheduledStart,
              let minutes = session.plannedDurationMinutes,
              Self.ownsLinkedEvent(notes: event.notes, sessionID: session.id) else {
            throw StudyCalendarError.unavailable
        }
        event.title = session.title
        event.startDate = start
        event.endDate = start.addingTimeInterval(TimeInterval(minutes * 60))
        event.notes = "The Desk · \(spaceTitle)\n\(session.notes)\nStudy block ID: \(session.id.uuidString)"
        try eventStore.save(event, span: .thisEvent, commit: true)
    }

    public static func ownsLinkedEvent(notes: String?, sessionID: UUID) -> Bool {
        notes?.contains("Study block ID: \(sessionID.uuidString)") == true
    }

    private static func accountKind(for source: EKSource) -> StudyCalendarOption.AccountKind {
        let value = "\(source.title) \(source.sourceIdentifier)".lowercased()
        if value.contains("google") || value.contains("gmail") { return .google }
        if value.contains("icloud") || value.contains("apple") { return .apple }
        switch source.sourceType {
        case .exchange: return .exchange
        case .local: return .local
        default: return .other
        }
    }
}

public enum StudyCalendarICS {
    public static func data(sessions: [StudySession], spaceTitles: [UUID: String]) -> Data {
        var lines = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//The Desk//Study Plan//EN",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
        ]
        for session in sessions.sorted(by: { ($0.scheduledStart ?? .distantFuture) < ($1.scheduledStart ?? .distantFuture) }) {
            guard let start = session.scheduledStart, let minutes = session.plannedDurationMinutes else { continue }
            let end = start.addingTimeInterval(TimeInterval(minutes * 60))
            lines += [
                "BEGIN:VEVENT",
                "UID:\(session.id.uuidString)@thedesk.local",
                "DTSTAMP:\(date(start))",
                "DTSTART:\(date(start))",
                "DTEND:\(date(end))",
                "SUMMARY:\(escape(session.title))",
                "DESCRIPTION:\(escape("The Desk · \(spaceTitles[session.spaceID] ?? "Study")\n\(session.notes)"))",
                "END:VEVENT",
            ]
        }
        lines.append("END:VCALENDAR")
        let folded = lines.flatMap(fold)
        return Data((folded.joined(separator: "\r\n") + "\r\n").utf8)
    }

    private static func date(_ value: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
        return formatter.string(from: value)
    }

    private static func escape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: ";", with: "\\;")
            .replacingOccurrences(of: ",", with: "\\,")
            .replacingOccurrences(of: "\n", with: "\\n")
    }

    /// RFC 5545 content lines are capped at 75 octets; continuation lines start
    /// with one space. Iterating Characters avoids splitting a UTF-8 sequence.
    private static func fold(_ line: String) -> [String] {
        var result: [String] = []
        var current = ""
        var byteCount = 0
        for character in line {
            let value = String(character)
            let bytes = value.utf8.count
            if byteCount + bytes > 75, !current.isEmpty {
                result.append(current)
                current = " " + value
                byteCount = 1 + bytes
            } else {
                current += value
                byteCount += bytes
            }
        }
        if !current.isEmpty { result.append(current) }
        return result
    }
}
