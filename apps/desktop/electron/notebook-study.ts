import {
  FakeNotebookStudyEngine,
  NotebookLMRestEngine,
  type NotebookStudyEngine,
  type StudyEngineMaterial,
} from "../../../packages/study/notebook-engine";
import type { StudyArtifactType, StudyEngineStatus, StudyGenerationOptions } from "../../../packages/study/notebook-types";

class UnavailableNotebookStudyEngine implements NotebookStudyEngine {
  async status(): Promise<StudyEngineStatus> {
    return {
      available: false,
      connected: false,
      experimental: true,
      message: "Connect the optional Google Notebook study engine to generate Quiz, Flashcards, Audio, or Video.",
      capabilities: { quiz: false, flashcards: false, audio: false, video: false },
    };
  }
  async ensureMaterialSet(): Promise<never> {
    throw Error("Study generation is unavailable. Connect the optional Google Notebook study engine first.");
  }
  async generate(): Promise<never> {
    throw Error("Study generation is unavailable. Connect the optional Google Notebook study engine first.");
  }
}

export function createNotebookStudyEngine(options: { downloadDir?: string } = {}): NotebookStudyEngine {
  if (process.env.DESK_STUDY_ENGINE === "fake") return new FakeNotebookStudyEngine();
  const baseUrl = process.env.DESK_NOTEBOOKLM_URL;
  const token = process.env.DESK_NOTEBOOKLM_SERVER_TOKEN;
  if (baseUrl && token) {
    try {
      return new NotebookLMRestEngine({ baseUrl, token, ...options });
    } catch {
      // A malformed optional engine configuration must leave the local Desk
      // usable; status will explain that study generation is unavailable.
    }
  }
  return new UnavailableNotebookStudyEngine();
}

export type { StudyEngineMaterial, StudyArtifactType, StudyGenerationOptions };
