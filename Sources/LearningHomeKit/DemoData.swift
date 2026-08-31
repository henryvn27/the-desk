import Foundation

enum DemoData {
    /// Fictional fixtures used for previews and tests. They do not represent a
    /// real student, schedule, family conversation, or submission history.
    static func makeSnapshot(now: Date = Date()) -> LearningHomeSnapshot {
        let calendar = Calendar.current

        let physics = StudySpace(
            id: UUID(uuidString: "10000000-0000-0000-0000-000000000001")!,
            kind: .class,
            title: "AP Physics C",
            subtitle: "Mechanics · Unit 1",
            colorHex: "#54706A",
            symbolName: "function",
            tutorStyle: .coachFirst,
            sortOrder: 0
        )
        let statistics = StudySpace(
            id: UUID(uuidString: "10000000-0000-0000-0000-000000000002")!,
            kind: .class,
            title: "AP Statistics",
            subtitle: "Unit 1 · Sample class",
            colorHex: "#9D4E31",
            symbolName: "chart.xyaxis.line",
            tutorStyle: .explainFirst,
            sortOrder: 1
        )
        let essays = StudySpace(
            id: UUID(uuidString: "10000000-0000-0000-0000-000000000003")!,
            kind: .track,
            title: "Writing Portfolio",
            subtitle: "Sample long-form writing project",
            colorHex: "#7A6651",
            symbolName: "text.book.closed",
            tutorStyle: .custom,
            sortOrder: 2
        )
        let sat = StudySpace(
            id: UUID(uuidString: "10000000-0000-0000-0000-000000000004")!,
            kind: .track,
            title: "SAT Prep",
            subtitle: "Math and reading practice",
            colorHex: "#66717A",
            symbolName: "scope",
            tutorStyle: .examPractice,
            sortOrder: 3
        )

        let physicsBook = SourceAsset(
            spaceID: physics.id,
            title: "Projectile motion · Chapter 3",
            kind: .pdf,
            originalFilename: "physics-mechanics-ch03.pdf",
            processingState: .ready,
            pageCount: 38
        )
        let reference = SourceAsset(
            spaceID: physics.id,
            title: "AP Physics C reference sheet",
            kind: .pdf,
            originalFilename: "ap-physics-c-reference.pdf",
            processingState: .ready,
            pageCount: 2
        )
        let lecture = SourceAsset(
            spaceID: physics.id,
            title: "Lecture 02 · vectors and motion",
            kind: .audio,
            originalFilename: "lecture-02.m4a",
            processingState: .ready,
            duration: 2_742
        )
        let statsNotes = SourceAsset(
            spaceID: statistics.id,
            title: "Lesson 1.6 · measuring variability",
            kind: .note,
            originalFilename: "lesson-1-6-notes.txt",
            processingState: .ready,
            pageCount: 4
        )
        let meeting = SourceAsset(
            spaceID: essays.id,
            title: "Writing workshop notes",
            kind: .wispr,
            connectorName: "Wispr Flow",
            originalFilename: "wispr-meeting.json",
            processingState: .ready,
            duration: 2_118
        )

        let revisions = [
            SourceRevisionRecord(
                sourceID: physicsBook.id,
                revisionNumber: 1,
                sha256: "demo-physics-ch03",
                extractedText: "For projectile motion without air resistance, horizontal acceleration is zero and vertical acceleration is constant at -g. Resolve the initial velocity into v₀ cos θ horizontally and v₀ sin θ vertically. Horizontal position is x = v₀ cos θ · t. Vertical position is y = y₀ + v₀ sin θ · t - ½gt². At the highest point, vertical velocity is zero while horizontal velocity remains constant."
            ),
            SourceRevisionRecord(
                sourceID: reference.id,
                revisionNumber: 1,
                sha256: "demo-reference",
                extractedText: "Kinematics: v = v₀ + at; x = x₀ + v₀t + ½at²; v² = v₀² + 2a(x-x₀)."
            ),
            SourceRevisionRecord(
                sourceID: lecture.id,
                revisionNumber: 1,
                sha256: "demo-lecture",
                extractedText: "00:18 Resolve motion into independent axes. 12:04 Horizontal velocity stays constant. 31:22 At the peak, only the vertical component is zero."
            ),
            SourceRevisionRecord(
                sourceID: statsNotes.id,
                revisionNumber: 1,
                sha256: "demo-stats",
                extractedText: "Standard deviation describes a typical distance from the mean. IQR is resistant to extreme values; standard deviation is not."
            ),
            SourceRevisionRecord(
                sourceID: meeting.id,
                revisionNumber: 1,
                sha256: "demo-wispr",
                extractedText: "Open with one concrete problem-solving moment. Show what changed in the writer's thinking, then make the final paragraph specific about the next step."
            ),
        ]

        let dueSoon = calendar.date(byAdding: .hour, value: 3, to: now) ?? now
        let tonight = calendar.date(bySettingHour: 20, minute: 0, second: 0, of: now) ?? now
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: now) ?? now
        let assignments = [
            Assignment(
                spaceID: physics.id,
                title: "Projectile motion graphs",
                detail: "Finish the Khan practice and record confidence.",
                dueAt: dueSoon,
                state: .ready,
                sourceName: "Khan Academy",
                externalURL: URL(string: "https://www.khanacademy.org/science/ap-college-physics-1/x2e2f5c68f2f2c6b6:kinematics"),
                priority: 3
            ),
            Assignment(
                spaceID: statistics.id,
                title: "Practice set 1.6 review",
                detail: "Review the sample attachment, then verify its external submission state.",
                dueAt: tonight,
                state: .submittedUnverified,
                sourceName: "Google Classroom",
                evidenceSummary: "Example attachment present; submission state not yet verified.",
                priority: 2
            ),
            Assignment(
                spaceID: essays.id,
                title: "Sample essay · revision outline",
                detail: "Apply the three concrete notes from the writing workshop.",
                dueAt: tomorrow,
                state: .planned,
                sourceName: "Manual",
                priority: 1
            ),
        ]

        let mastery = [
            MasteryRecord(spaceID: physics.id, topic: "Projectile motion graphs", score: 0.62, confidence: 2, nextReviewAt: now),
            MasteryRecord(spaceID: statistics.id, topic: "Standard deviation", score: 0.81, confidence: 3, nextReviewAt: tomorrow),
        ]

        let citation = StudyCitation(
            label: "Projectile motion · Chapter 3, p. 74",
            origin: .classSource,
            anchor: SourceAnchor(sourceID: physicsBook.id, page: 74, excerpt: "Horizontal acceleration is zero and vertical acceleration is constant at -g.")
        )
        let spec = StudySceneSpec(
            kind: .parameterLab,
            title: "Why launch angle changes range",
            summary: "Separate the launch velocity into horizontal and vertical components, then watch how flight time and range change together.",
            nodes: [
                SceneNode(id: "launch", title: "Launch velocity", detail: "Resolve v₀ into x and y components.", role: "input", x: 0.16, y: 0.28),
                SceneNode(id: "horizontal", title: "Horizontal motion", detail: "aₓ = 0, so vₓ is constant.", x: 0.5, y: 0.18),
                SceneNode(id: "vertical", title: "Vertical motion", detail: "aᵧ = −g changes vᵧ every second.", x: 0.5, y: 0.58),
                SceneNode(id: "range", title: "Range", detail: "Horizontal speed × time aloft.", role: "result", x: 0.84, y: 0.38),
            ],
            connections: [
                SceneConnection(from: "launch", to: "horizontal", label: "v₀ cos θ"),
                SceneConnection(from: "launch", to: "vertical", label: "v₀ sin θ"),
                SceneConnection(from: "horizontal", to: "range", label: "speed"),
                SceneConnection(from: "vertical", to: "range", label: "flight time"),
            ],
            interactions: [
                SceneInteraction(kind: .parameter, label: "Change launch angle"),
                SceneInteraction(kind: .prediction, label: "Predict the farthest angle"),
                SceneInteraction(kind: .hideLabels, label: "Practice without labels", targetNodeIDs: ["horizontal", "vertical"]),
            ],
            citations: [citation],
            accessibilitySummary: "A concept map and trajectory lab showing launch velocity splitting into horizontal and vertical motion, which combine to determine range."
        )
        let canvas = CanvasArtifact(
            spaceID: physics.id,
            title: spec.title,
            spec: spec,
            sourceRevisionSignature: "demo-physics-ch03:1",
            isPinned: true
        )

        let integrations = [
            IntegrationAccount(id: "codex", displayName: "Codex plan", status: "checking", detail: "Uses the local Codex app-server and ChatGPT sign-in.", isReadOnly: false),
            IntegrationAccount(id: "calendar", displayName: "Apple & Google Calendar", status: "permissionRequired", detail: "Creates only approved study blocks in a selected writable calendar.", isReadOnly: false),
            IntegrationAccount(id: "reminders", displayName: "Apple Reminders", status: "permissionRequired", detail: "Only app-created or explicitly linked reminders.", isReadOnly: false),
            IntegrationAccount(id: "classroom", displayName: "Google Classroom", status: "configurationRequired", detail: "Read-only classes, assignments, grades, and submission state.", isReadOnly: true),
            IntegrationAccount(id: "wispr", displayName: "Wispr Flow", status: "configurationRequired", detail: "Imports completed meeting transcripts through read-only MCP.", isReadOnly: true),
            IntegrationAccount(id: "notebooklm", displayName: "NotebookLM", status: "checking", detail: "Optional secondary engine; The Desk remains canonical.", isReadOnly: false),
            IntegrationAccount(id: "khan", displayName: "Khan Academy", status: "ready", detail: "Lesson links and manual confidence check-ins; no scraping.", isReadOnly: true),
        ]

        return LearningHomeSnapshot(
            spaces: [physics, statistics, essays, sat],
            sources: [physicsBook, reference, lecture, statsNotes, meeting],
            revisions: revisions,
            assignments: assignments,
            canvases: [canvas],
            mastery: mastery,
            integrations: integrations
        )
    }
}
