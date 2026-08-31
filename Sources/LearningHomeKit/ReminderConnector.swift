@preconcurrency import EventKit
import Foundation

public struct ReminderSyncResult: Sendable {
    public var assignmentID: UUID
    public var reminderIdentifier: String
    public var isCompleted: Bool
    public var completionDate: Date?
}

public enum ReminderConnectorError: Error, LocalizedError {
    case permissionDenied, unavailable

    public var errorDescription: String? {
        switch self {
        case .permissionDenied: "The Desk needs Reminders access before it can create or sync linked study reminders."
        case .unavailable: "The linked reminder is no longer available. No unrelated reminder was changed."
        }
    }
}

/// EventKit access is intentionally limited to reminders created by The Desk or linked by identifier.
@MainActor
public final class ReminderConnector {
    public static let shared = ReminderConnector()
    private let store = EKEventStore()

    public func requestAccess() async throws -> Bool {
        let granted = try await store.requestFullAccessToReminders()
        guard granted else { throw ReminderConnectorError.permissionDenied }
        return granted
    }

    public func createLinkedReminder(for assignment: Assignment, spaceTitle: String) async throws -> String {
        _ = try await requestAccess()
        let marker = "Assignment ID: \(assignment.id.uuidString)"
        let existing = await withCheckedContinuation { continuation in
            let predicate = store.predicateForReminders(in: nil)
            store.fetchReminders(matching: predicate) { reminders in
                continuation.resume(returning: reminders?.first(where: { $0.notes?.contains(marker) == true }))
            }
        }
        if let existing {
            return existing.calendarItemIdentifier
        }
        let reminder = EKReminder(eventStore: store)
        reminder.title = assignment.title
        reminder.notes = "The Desk · \(spaceTitle)\n\(marker)\nReminder completion does not prove external submission."
        reminder.calendar = store.defaultCalendarForNewReminders()
        reminder.dueDateComponents = Calendar.current.dateComponents(in: .current, from: assignment.dueAt)
        try store.save(reminder, commit: true)
        guard let identifier = reminder.calendarItemIdentifier as String? else { throw ReminderConnectorError.unavailable }
        return identifier
    }

    public func syncLinkedAssignments(_ assignments: [Assignment]) async throws -> [ReminderSyncResult] {
        _ = try await requestAccess()
        var results: [ReminderSyncResult] = []
        for assignment in assignments where !assignment.linkedReminderIdentifier.isEmpty {
            guard let reminder = store.calendarItem(withIdentifier: assignment.linkedReminderIdentifier) as? EKReminder else { continue }
            results.append(ReminderSyncResult(
                assignmentID: assignment.id,
                reminderIdentifier: assignment.linkedReminderIdentifier,
                isCompleted: reminder.isCompleted,
                completionDate: reminder.completionDate
            ))
        }
        return results
    }

    public func updateLinkedReminder(for assignment: Assignment) throws {
        guard !assignment.linkedReminderIdentifier.isEmpty,
              let reminder = store.calendarItem(withIdentifier: assignment.linkedReminderIdentifier) as? EKReminder else {
            throw ReminderConnectorError.unavailable
        }
        reminder.title = assignment.title
        reminder.dueDateComponents = Calendar.current.dateComponents(in: .current, from: assignment.dueAt)
        try store.save(reminder, commit: true)
    }
}
