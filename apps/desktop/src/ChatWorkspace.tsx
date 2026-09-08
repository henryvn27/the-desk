import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Snapshot } from "../../../packages/domain/contracts";
import type { DeskIntelligence } from "../../../packages/intelligence/desk-intelligence";
import { Button, Textarea } from "./components/base";
import { WorkspaceHeader } from "./components/desk";
import { Plus, Send01 } from "@untitledui/icons";
import {
  deriveChatSuggestions,
  formatUpcoming,
  type ChatAction,
  type ChatArtifact,
  type ChatRequest,
  type ChatResponse,
} from "../../../packages/intelligence/chat";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  artifact?: ChatArtifact;
  action?: ChatAction;
  suggestions?: string[];
  model?: string;
  deterministic?: boolean;
};

export type ChatThread = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
};

type Props = {
  data: Snapshot;
  intelligence?: DeskIntelligence;
  providerConfigured: boolean | null;
  busy: boolean;
  page: string;
  threads: ChatThread[];
  activeThreadId: string | null;
  setThreads: React.Dispatch<React.SetStateAction<ChatThread[]>>;
  setActiveThreadId: (id: string) => void;
  ask: (input: ChatRequest) => Promise<ChatResponse>;
  onAction: (action: ChatAction) => void;
  onNewChat: () => void;
};

function newThread(): ChatThread {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    messages: [],
    updatedAt: new Date().toISOString(),
  };
}

function initialAssistant(data: Snapshot) {
  const active = data.sessions.find((session) => !session.endedAt);
  const task = active ? data.tasks.find((candidate) => candidate.id === active.taskId) : undefined;
  return task
    ? `You’re in the middle of ${task.title}. I can keep you moving, explain a concept, or help with the next step.`
    : "I’m ready to help you decide what matters now, understand your work, or open the right Desk workspace.";
}

function messageHistory(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.content.trim())
    .slice(-8)
    .map((message) => ({ role: message.role, content: message.content }));
}

function Artifact({ artifact, onAction, profileTimeZone }: { artifact: ChatArtifact; onAction: (action: ChatAction) => void; profileTimeZone?: string | null }) {
  if (artifact.kind === "next")
    return (
      <section className="chat-artifact chat-artifact-next" aria-label="Next action">
        <div className="chat-artifact-label">Next move</div>
        <strong>{artifact.title}</strong>
        <p>{artifact.detail}</p>
        <div className="chat-artifact-meta">
          {artifact.className && <span>{artifact.className}</span>}
          {artifact.estimatedMinutes && <span>{artifact.estimatedMinutes} min</span>}
        </div>
        {artifact.action && (
          <Button variant="primary" size="compact" className="chat-artifact-action" onPress={() => onAction(artifact.action!)}>
            {artifact.action.type === "start-session" ? "Start" : artifact.action.type === "resume-session" ? "Resume" : "Open"}
          </Button>
        )}
      </section>
    );
  if (artifact.kind === "continue")
    return (
      <section className="chat-artifact chat-artifact-next" aria-label="Continue work">
        <div className="chat-artifact-label">Continue</div>
        <strong>{artifact.title}</strong>
        <p>{artifact.detail}</p>
        <Button variant="primary" size="compact" className="chat-artifact-action" onPress={() => onAction(artifact.action)}>
          {artifact.action.type === "open-notes" ? "Open Note" : "Resume"}
        </Button>
      </section>
    );
  if (artifact.kind === "upcoming")
    return (
      <section className="chat-artifact chat-artifact-list" aria-label="Upcoming work">
        <div className="chat-artifact-label">Upcoming</div>
        {artifact.items.map((item) => (
          <div className="chat-list-row" key={item.taskId}>
            <strong>{item.title}</strong>
            <span>{formatUpcoming(item, artifact.timeZone ?? profileTimeZone)}</span>
          </div>
        ))}
      </section>
    );
  if (artifact.kind === "attention")
    return (
      <section className="chat-artifact chat-artifact-list" aria-label="Needs attention">
        <div className="chat-artifact-label">Needs attention</div>
        {artifact.items.map((item, index) => (
          <div className="chat-list-row" key={`${item.title}-${index}`}>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </div>
        ))}
      </section>
    );
  return (
    <section className="chat-artifact chat-artifact-list" aria-label="Available time plan">
      <div className="chat-artifact-label">{artifact.availableMinutes} minute plan</div>
      {artifact.blocks.map((block, index) => (
        <div className="chat-list-row" key={`${block.title}-${index}`}>
          <strong>{block.title}</strong>
          <span>{block.minutes} min · {block.reason}</span>
          {block.taskId && index === 0 && (
            <Button size="compact" onPress={() => onAction({ type: "start-session", taskId: block.taskId! })}>Start</Button>
          )}
        </div>
      ))}
    </section>
  );
}

export function ChatWorkspace({
  data,
  intelligence,
  providerConfigured,
  busy,
  page,
  threads,
  activeThreadId,
  setThreads,
  setActiveThreadId,
  ask,
  onAction,
  onNewChat,
}: Props) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const current = threads.find((thread) => thread.id === activeThreadId) ?? threads[0];
  const suggestions = useMemo(
    () => (intelligence ? deriveChatSuggestions(data, intelligence) : []),
    [data, intelligence],
  );
  const sortedThreads = useMemo(
    () => threads.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [threads],
  );

  useEffect(() => {
    if (threads.length) {
      if (!activeThreadId || !threads.some((thread) => thread.id === activeThreadId))
        setActiveThreadId(threads[0]!.id);
      return;
    }
    const thread = newThread();
    setThreads([thread]);
    setActiveThreadId(thread.id);
  }, [activeThreadId, setActiveThreadId, setThreads, threads]);

  async function submit(value = draft) {
    const question = value.trim();
    if (!question || sending || busy || !current) return;
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: question };
    const prior = current.messages;
    const nextMessages = [...prior, userMessage];
    setDraft("");
    setSending(true);
    setThreads((all) => all.map((thread) => thread.id === current.id ? {
      ...thread,
      title: thread.messages.length ? thread.title : question.slice(0, 48),
      messages: nextMessages,
      updatedAt: new Date().toISOString(),
    } : thread));
    try {
      const response = await ask({
        question,
        history: messageHistory(prior),
        context: {
          page,
          ...(data.classes.some((course) => course.id === page) ? { classId: page } : {}),
        },
      });
      const assistant: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.text,
        ...(response.artifact ? { artifact: response.artifact } : {}),
        ...(response.action ? { action: response.action } : {}),
        ...(response.suggestions ? { suggestions: response.suggestions } : {}),
        ...(response.model ? { model: response.model } : {}),
        deterministic: response.deterministic,
      };
      setThreads((all) => all.map((thread) => thread.id === current.id ? {
        ...thread,
        messages: [...nextMessages, assistant],
        updatedAt: new Date().toISOString(),
      } : thread));
    } catch {
      setThreads((all) => all.map((thread) => thread.id === current.id ? {
        ...thread,
        messages: [...nextMessages, { id: crypto.randomUUID(), role: "assistant", content: "I couldn’t complete that request. Your saved work is unchanged." }],
        updatedAt: new Date().toISOString(),
      } : thread));
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  return (
    <div className="chat-workspace">
      <WorkspaceHeader
        className="chat-heading"
        eyebrow="Your academic workspace"
        title="What are you working on?"
        detail="Ask The Desk to help you decide, understand, or continue."
        status={{
          tone: providerConfigured === false ? "warning" : providerConfigured === true ? "positive" : "neutral",
          label: providerConfigured === false ? "AI needs a provider key in Settings" : providerConfigured === true ? "AI connected · Luna" : "Checking AI connection…",
        }}
        actions={<Button variant="secondary" size="compact" className="chat-new-button" icon={Plus} onPress={onNewChat}>New chat</Button>}
      />
      <div className="chat-layout">
        <aside className="chat-history" aria-label="Recent chats">
          <div className="chat-history-label">Recent</div>
          {sortedThreads.map((thread) => (
            <Button
              size="compact"
              className="chat-thread"
              key={thread.id}
              aria-current={thread.id === current?.id ? "page" : undefined}
              onPress={() => setActiveThreadId(thread.id)}
            >
              <strong>{thread.title}</strong>
              <span>{thread.messages.length ? `${thread.messages.length} messages` : "New conversation"}</span>
            </Button>
          ))}
        </aside>
        <section className="chat-main" aria-label="Desk conversation">
          <div className="chat-scroll">
            {!current?.messages.length && intelligence && (
              <div className="chat-welcome">
                <div className="chat-avatar" aria-hidden="true">D</div>
                <div>
                <p>{initialAssistant(data)}</p>
                  <div className="chat-suggestions" aria-label="Suggested questions">
                    {suggestions.map((suggestion) => (
                      <Button size="compact" key={suggestion} onPress={() => void submit(suggestion)}>{suggestion}</Button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {current?.messages.map((message) => (
              <article className={`chat-message chat-message-${message.role}`} key={message.id}>
                <div className="chat-message-body">
                  <p>{message.content}</p>
                  {message.artifact && <Artifact artifact={message.artifact} onAction={onAction} profileTimeZone={data.user?.timeZone} />}
                  {message.action && !message.artifact && (
                    <Button variant="primary" size="compact" className="chat-artifact-action" onPress={() => onAction(message.action!)}>Open</Button>
                  )}
                  {message.suggestions && (
                    <div className="chat-suggestions">
                        {message.suggestions.map((suggestion) => <Button size="compact" key={suggestion} onPress={() => void submit(suggestion)}>{suggestion}</Button>)}
                    </div>
                  )}
                  {message.model && <small className="chat-model">{message.model}</small>}
                </div>
              </article>
            ))}
            {sending && <div className="chat-thinking" role="status">Thinking with your saved context…</div>}
          </div>
          <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <label className="sr-only" htmlFor="chat-input">Ask The Desk</label>
              <Textarea
              id="chat-input"
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") { event.preventDefault(); setDraft(""); return; }
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void submit(); }
              }}
              placeholder="Ask The Desk anything…"
              rows={2}
              disabled={sending || busy}
            />
            <div className="chat-composer-footer">
              <span>⌘↵ to send · Esc to clear</span>
              <Button variant="primary" size="compact" type="submit" isDisabled={!draft.trim() || sending || busy} icon={Send01}>Send</Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
