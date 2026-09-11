import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Command,
  Snapshot,
  StudyArtifact,
  StudyArtifactUpdate,
  StudyMaterialSet,
} from "../../../packages/domain/contracts";
import type {
  StudyFlashcardsPayload,
  StudyQuizPayload,
} from "../../../packages/study/notebook-types";
import { userError } from "./errors";

function materialLabel(material: StudyMaterialSet | undefined) {
  if (!material) return "Desk study";
  return material.title;
}

function StudyMediaPlayer({
  artifact,
  save,
}: {
  artifact: StudyArtifact;
  save: (command: Command) => Promise<Snapshot | undefined>;
}) {
  const media = useRef<HTMLMediaElement>(null);
  const lastSavedMs = useRef(artifact.playbackPositionMs);
  const [saving, setSaving] = useState(false);
  const payload = artifact.payload;

  useEffect(() => {
    lastSavedMs.current = artifact.playbackPositionMs;
  }, [artifact.id, artifact.playbackPositionMs]);

  if (!payload || (payload.kind !== "audio" && payload.kind !== "video") || !payload.localPath)
    return <p className="muted">{artifact.status === "generating" ? "Generating in the background. You can keep working and return here when it is ready." : "The native media player will appear when the generated file is available."}</p>;

  async function persistPosition(positionMs: number, force = false) {
    if (!force && Math.abs(positionMs - lastSavedMs.current) < 5_000) return;
    lastSavedMs.current = positionMs;
    setSaving(true);
    try {
      await save({ type: "study.artifact.update", id: artifact.id, revision: artifact.revision, input: { playbackPositionMs: positionMs } });
    } finally {
      setSaving(false);
    }
  }

  const source = `desk://study-media/${artifact.id}`;
  const onTimeUpdate = (event: React.SyntheticEvent<HTMLMediaElement>) => void persistPosition(Math.round(event.currentTarget.currentTime * 1_000)).catch(() => undefined);
  const onPause = (event: React.SyntheticEvent<HTMLMediaElement>) => void persistPosition(Math.round(event.currentTarget.currentTime * 1_000), true).catch(() => undefined);
  const onEnded = (event: React.SyntheticEvent<HTMLMediaElement>) => void persistPosition(Math.round(event.currentTarget.currentTime * 1_000), true).catch(() => undefined);
  const onLoadedMetadata = (event: React.SyntheticEvent<HTMLMediaElement>) => {
    if (artifact.playbackPositionMs > 0 && Math.abs(event.currentTarget.currentTime * 1_000 - artifact.playbackPositionMs) > 1_000)
      event.currentTarget.currentTime = artifact.playbackPositionMs / 1_000;
  };
  const setMedia = (element: HTMLMediaElement | null) => { media.current = element; };
  return <>
    {artifact.type === "audio" ? <audio ref={setMedia} controls preload="metadata" src={source} aria-label={`${artifact.title} audio review`} onLoadedMetadata={onLoadedMetadata} onTimeUpdate={onTimeUpdate} onPause={onPause} onEnded={onEnded} /> : <video ref={setMedia} controls preload="metadata" src={source} aria-label={`${artifact.title} video review`} onLoadedMetadata={onLoadedMetadata} onTimeUpdate={onTimeUpdate} onPause={onPause} onEnded={onEnded} />}
    {saving && <small className="muted study-media-saving" role="status">Saving position…</small>}
  </>;
}

export function StudyArtifactWorkspace({
  artifact,
  material,
  data,
  save,
  close,
}: {
  artifact: StudyArtifact;
  material?: StudyMaterialSet;
  data: Snapshot;
  save: (command: Command) => Promise<Snapshot | undefined>;
  close: () => void;
}) {
  const [error, setError] = useState("");
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastFeedback, setLastFeedback] = useState<{ result: "correct" | "incorrect"; explanation: string } | null>(null);
  const quiz = artifact.payload?.kind === "quiz" ? artifact.payload as StudyQuizPayload : undefined;
  const flashcards = artifact.payload?.kind === "flashcards" ? artifact.payload as StudyFlashcardsPayload : undefined;
  const currentQuestion = quiz?.questions[quiz.currentIndex];
  const currentCard = flashcards?.cards[flashcards.currentIndex];
  const currentAnswer = currentQuestion ? quiz.answers.find((answer) => answer.questionId === currentQuestion.id) : undefined;
  const progress = useMemo(() => {
    if (quiz) return `${Math.min(quiz.questions.length, quiz.answers.length + (currentAnswer ? 0 : 1))} of ${quiz.questions.length}`;
    if (flashcards) return `${Math.min(flashcards.cards.length, flashcards.currentIndex + 1)} of ${flashcards.cards.length}`;
    return "";
  }, [currentAnswer, flashcards, quiz]);

  async function update(input: StudyArtifactUpdate): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      await save({ type: "study.artifact.update", id: artifact.id, revision: artifact.revision, input });
      return true;
    } catch (caught) {
      setError(userError(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function answerQuiz() {
    if (!quiz || !currentQuestion || selectedChoice === null || currentAnswer || busy) return;
    const correct = selectedChoice === currentQuestion.answerIndex;
    const answeredAt = new Date().toISOString();
    const answers = [...quiz.answers, { questionId: currentQuestion.id, choiceIndex: selectedChoice, result: correct ? "correct" as const : "incorrect" as const, hintCount: 0, answeredAt }];
    const last = quiz.currentIndex >= quiz.questions.length - 1;
    const nextPayload: StudyQuizPayload = {
      ...quiz,
      answers,
      currentIndex: last ? quiz.currentIndex : quiz.currentIndex + 1,
      completedAt: last ? answeredAt : null,
      score: last ? Math.round((answers.filter((answer) => answer.result === "correct").length / quiz.questions.length) * 100) : null,
    };
    if (!await update({ payload: nextPayload, completed: last })) return;
    setLastFeedback({ result: correct ? "correct" : "incorrect", explanation: currentQuestion.explanation ?? "" });
    const set = material;
    if (set?.classId) {
      try {
        const sessionActivityId = set.taskId
          ? data.sessions.find((session) => !session.endedAt && session.taskId === set.taskId)?.activityState?.currentId
          : undefined;
        await save({
          type: "attempt.create",
          input: {
            classId: set.classId,
            taskId: set.taskId,
            conceptIds: currentQuestion.conceptIds,
            result: correct ? "correct" : "incorrect",
            unaided: true,
            hintCount: 0,
            notes: `Quiz question: ${currentQuestion.prompt}`,
            attemptedAt: answeredAt,
            activityId: sessionActivityId ?? artifact.id,
            activityKind: "quiz",
            responseMode: "multiple-choice",
          },
        });
      } catch (caught) {
        setError(userError(caught));
      }
    }
    setSelectedChoice(null);
  }

  async function reviewCard(result: "again" | "got-it") {
    if (!flashcards || !currentCard || busy) return;
    const reviewedAt = new Date().toISOString();
    const reviews = [...flashcards.reviews, { cardId: currentCard.id, result, reviewedAt }];
    const last = flashcards.currentIndex >= flashcards.cards.length - 1;
    await update({ payload: { ...flashcards, reviews, currentIndex: last ? flashcards.currentIndex : flashcards.currentIndex + 1, revealed: false, completedAt: last ? reviewedAt : null }, completed: last });
  }

  return (
    <section className="study-artifact-workspace" aria-label="Study activity">
      <header className="study-artifact-header">
        <div>
          <div className="eyebrow">Study</div>
          <h2>{materialLabel(material)}</h2>
          <p className="muted">{artifact.type === "audio" ? "Audio review" : artifact.type === "video" ? "Video review" : artifact.type === "quiz" ? "Quiz" : "Flashcards"}{progress ? ` · ${progress}` : ""}</p>
        </div>
        <button type="button" onClick={close}>Close</button>
      </header>
      {artifact.status === "failed" && <p className="error" role="alert">{artifact.error ?? "Study generation failed."}</p>}
      {artifact.status === "generating" && !artifact.payload && (
        <p className="muted" role="status">Generating from the selected Desk Sources and Notes. You can keep working and return here when it is ready.</p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {quiz && currentQuestion && !quiz.completedAt && (
        <div className="study-quiz-card">
          {lastFeedback && <p className="study-answer-feedback" role="status">{lastFeedback.result === "correct" ? "Correct." : "Not quite."} {lastFeedback.explanation}</p>}
          <p className="study-question">{currentQuestion.prompt}</p>
          <div className="study-choice-list" role="radiogroup" aria-label="Quiz answers">
            {currentQuestion.choices.map((choice, index) => (
              <button key={choice} type="button" className={selectedChoice === index ? "selected" : ""} aria-pressed={selectedChoice === index} onClick={() => setSelectedChoice(index)} disabled={Boolean(currentAnswer) || busy}>
                <span className="study-choice-key">{String.fromCharCode(65 + index)}</span>{choice}
              </button>
            ))}
          </div>
          {currentAnswer ? <p role="status">{currentAnswer.result === "correct" ? "Correct." : "Not quite."} {currentQuestion.explanation ?? ""}</p> : <button className="primary" type="button" disabled={selectedChoice === null || busy} onClick={() => void answerQuiz()}>Check answer</button>}
        </div>
      )}
      {quiz?.completedAt && (
        <div className="study-completion" role="status">
          <h3>{quiz.score}%</h3>
          <p>{quiz.answers.filter((answer) => answer.result === "correct").length} of {quiz.questions.length} correct.</p>
          <p className="muted">Your checked answers were saved as Attempts. Keep reviewing any misses; a quiz result alone does not claim mastery.</p>
        </div>
      )}
      {flashcards && currentCard && !flashcards.completedAt && (
        <div className="study-flashcard-card">
          <div className="study-flashcard-face"><span className="eyebrow">{flashcards.revealed ? "Answer" : "Prompt"}</span><p>{flashcards.revealed ? currentCard.back : currentCard.front}</p></div>
          {!flashcards.revealed ? <button className="primary" type="button" disabled={busy} onClick={() => void update({ payload: { ...flashcards, revealed: true } })}>Reveal</button> : <div className="actions"><button type="button" disabled={busy} onClick={() => void reviewCard("again")}>Again</button><button className="primary" type="button" disabled={busy} onClick={() => void reviewCard("got-it")}>Got it</button></div>}
        </div>
      )}
      {flashcards?.completedAt && <div className="study-completion" role="status"><h3>Cards reviewed</h3><p>{flashcards.reviews.length} interactions saved.</p><p className="muted">Self-reported recall is light evidence; Desk will not claim mastery from a single deck.</p></div>}
      {(artifact.type === "audio" || artifact.type === "video") && artifact.payload?.kind === artifact.type && (
        <div className="study-media-card">
          <StudyMediaPlayer artifact={artifact} save={save} />
        </div>
      )}
      {artifact.materialSetId && data.studyMaterialSets.some((set) => set.id === artifact.materialSetId) && <p className="study-provenance">Based on the selected Desk Sources and Notes. Original material remains canonical.</p>}
    </section>
  );
}
