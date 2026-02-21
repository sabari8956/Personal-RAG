"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { TextShimmer } from "@/components/text-shimmer";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  animate?: boolean;
};

type ChatApiResponse = {
  answer: string;
};

const SESSION_KEY = "rag_gateway_session_id";
const HISTORY_KEY = "rag_gateway_history_v1";
const MAX_HISTORY = 20;
const CONTEXT_WINDOW = 12;
const PROMPT_PREVIEWS = [
  "What is Sabari building right now?",
  "Give me a sharp intro for Sabari in 3 lines.",
  "Which project best shows Sabari's product thinking?",
  "What are Sabari's strongest technical skills?",
];
const STARTER_MESSAGE =
  "Hey, I am Sabari's digital sidekick. Ask me about his projects, thinking, and journey, and I will connect the dots with context.";

function createSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sess_${Math.random().toString(36).slice(2, 12)}`;
}

function createMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `msg_${Math.random().toString(36).slice(2, 12)}`;
}

function buildMessage(role: ChatRole, content: string, animate = false): ChatMessage {
  return {
    id: createMessageId(),
    role,
    content,
    animate,
  };
}

function normalizeStoredMessages(data: unknown): ChatMessage[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .filter(
      (item): item is { role?: unknown; content?: unknown } =>
        item !== null && typeof item === "object",
    )
    .map((item) => {
      const role = item.role === "assistant" ? "assistant" : item.role === "user" ? "user" : null;
      const content = typeof item.content === "string" ? item.content : null;
      if (!role || !content) {
        return null;
      }
      return buildMessage(role, content, false);
    })
    .filter((message): message is ChatMessage => message !== null);
}

function TypewriterText({
  text,
  startDelayMs = 0,
  speedMs = 18,
}: {
  text: string;
  startDelayMs?: number;
  speedMs?: number;
}) {
  const [visibleChars, setVisibleChars] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let tickTimer: number | undefined;

    const startTimer = window.setTimeout(() => {
      const tick = () => {
        if (cancelled) {
          return;
        }
        let done = false;
        setVisibleChars((current) => {
          if (current >= text.length) {
            done = true;
            return current;
          }
          return current + 1;
        });
        if (!done) {
          tickTimer = window.setTimeout(tick, speedMs);
        }
      };
      tick();
    }, startDelayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      if (tickTimer) {
        window.clearTimeout(tickTimer);
      }
    };
  }, [speedMs, startDelayMs, text]);

  return <p>{text.slice(0, visibleChars)}</p>;
}

export function ChatWidget() {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const starterTimerRef = useRef<number | null>(null);
  const promptTypingTimerRef = useRef<number | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [autoTypingPrompt, setAutoTypingPrompt] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [previewPhraseIndex, setPreviewPhraseIndex] = useState(0);
  const [revealedWordCount, setRevealedWordCount] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const clearStarterTimer = () => {
      if (starterTimerRef.current !== null) {
        window.clearTimeout(starterTimerRef.current);
        starterTimerRef.current = null;
      }
    };

    const queueStarterMessage = (delayMs: number) => {
      clearStarterTimer();
      starterTimerRef.current = window.setTimeout(() => {
        setMessages((previous) =>
          previous.length === 0
            ? [buildMessage("assistant", STARTER_MESSAGE, true)]
            : previous,
        );
        starterTimerRef.current = null;
      }, delayMs);
    };

    const storedSession = sessionStorage.getItem(SESSION_KEY);
    const finalSession = storedSession || createSessionId();
    if (!storedSession) {
      sessionStorage.setItem(SESSION_KEY, finalSession);
    }
    setSessionId(finalSession);

    const storedHistory = sessionStorage.getItem(HISTORY_KEY);
    if (storedHistory) {
      try {
        const parsed = JSON.parse(storedHistory) as unknown;
        let restored = normalizeStoredMessages(parsed).slice(-MAX_HISTORY);
        const hasUserMessages = restored.some((message) => message.role === "user");
        const hasAssistantReplyBeyondStarter = restored.some(
          (message, index) =>
            message.role === "assistant" &&
            (index !== 0 || message.content !== STARTER_MESSAGE),
        );

        if (
          hasUserMessages &&
          !hasAssistantReplyBeyondStarter &&
          restored[0]?.role === "assistant" &&
          restored[0].content === STARTER_MESSAGE
        ) {
          restored = restored.slice(1);
        }

        if (restored.length > 0) {
          setMessages(restored);
          return () => clearStarterTimer();
        }
      } catch {
        sessionStorage.removeItem(HISTORY_KEY);
      }
    }

    setMessages([]);
    queueStarterMessage(2000);

    return () => clearStarterTimer();
  }, []);

  useEffect(() => {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-MAX_HISTORY)));
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, pending]);

  const canSubmit = useMemo(() => {
    return query.trim().length > 0 && !pending && !autoTypingPrompt;
  }, [autoTypingPrompt, pending, query]);
  const activePreviewWords = useMemo(() => {
    return PROMPT_PREVIEWS[previewPhraseIndex].split(" ");
  }, [previewPhraseIndex]);

  useEffect(() => {
    if (query.trim().length > 0 || isInputFocused || pending) {
      return;
    }

    const done = revealedWordCount >= activePreviewWords.length;
    const timeout = setTimeout(
      () => {
        if (done) {
          setPreviewPhraseIndex((index) => (index + 1) % PROMPT_PREVIEWS.length);
          setRevealedWordCount(1);
          return;
        }
        setRevealedWordCount((count) => count + 1);
      },
      done ? 1300 : 210,
    );

    return () => clearTimeout(timeout);
  }, [activePreviewWords.length, isInputFocused, pending, query, revealedWordCount]);

  useEffect(() => {
    if (query.trim().length > 0 || isInputFocused) {
      setRevealedWordCount(1);
    }
  }, [isInputFocused, query]);

  useEffect(() => {
    return () => {
      if (promptTypingTimerRef.current !== null) {
        window.clearTimeout(promptTypingTimerRef.current);
        promptTypingTimerRef.current = null;
      }
    };
  }, []);

  function stopPromptAutoTyping() {
    if (promptTypingTimerRef.current !== null) {
      window.clearTimeout(promptTypingTimerRef.current);
      promptTypingTimerRef.current = null;
    }
    setAutoTypingPrompt(false);
  }

  function typePromptIntoInput(prompt: string) {
    stopPromptAutoTyping();
    setQuery("");
    setError(null);
    setAutoTypingPrompt(true);

    let charIndex = 0;
    const step = () => {
      charIndex += 1;
      setQuery(prompt.slice(0, charIndex));
      if (charIndex >= prompt.length) {
        promptTypingTimerRef.current = null;
        setAutoTypingPrompt(false);
        return;
      }
      promptTypingTimerRef.current = window.setTimeout(step, 14);
    };

    promptTypingTimerRef.current = window.setTimeout(step, 50);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || !sessionId || pending) {
      return;
    }

    if (starterTimerRef.current !== null) {
      window.clearTimeout(starterTimerRef.current);
      starterTimerRef.current = null;
    }
    stopPromptAutoTyping();

    setPending(true);
    setError(null);

    const nextMessages: ChatMessage[] = [
      ...messages,
      buildMessage("user", trimmed, false),
    ].slice(-MAX_HISTORY);

    setMessages(nextMessages);
    setQuery("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: sessionId,
          query: trimmed,
          history: nextMessages.slice(-CONTEXT_WINDOW),
        }),
      });

      const data = (await response.json()) as
        | ChatApiResponse
        | { error?: { message?: string; trace_id?: string } };

      if (!response.ok || !("answer" in data)) {
        const message =
          typeof data === "object" && data && "error" in data
            ? data.error?.message || "Request failed"
            : "Request failed";
        throw new Error(message);
      }

      setMessages((previous) =>
        [
          ...previous,
          buildMessage("assistant", data.answer, true),
        ].slice(-MAX_HISTORY),
      );
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Unexpected request error",
      );
    } finally {
      setPending(false);
    }
  }

  function resetSession() {
    if (starterTimerRef.current !== null) {
      window.clearTimeout(starterTimerRef.current);
      starterTimerRef.current = null;
    }
    stopPromptAutoTyping();

    const newSession = createSessionId();
    sessionStorage.setItem(SESSION_KEY, newSession);
    sessionStorage.removeItem(HISTORY_KEY);
    setSessionId(newSession);
    setMessages([]);
    starterTimerRef.current = window.setTimeout(() => {
      setMessages((previous) =>
        previous.length === 0
          ? [buildMessage("assistant", STARTER_MESSAGE, true)]
          : previous,
      );
      starterTimerRef.current = null;
    }, 1200);
    setError(null);
  }

  function onTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <section className="chat-widget">
      <div className="messages">
        {messages.map((message) => (
          <article key={message.id} className={`bubble ${message.role}`}>
            <h3>{message.role === "user" ? "You" : "Sabari Copilot"}</h3>
            {message.role === "assistant" && message.animate ? (
              <TypewriterText
                text={message.content}
                startDelayMs={80}
                speedMs={12}
              />
            ) : (
              <p>{message.content}</p>
            )}
          </article>
        ))}

        {pending && (
          <article className="bubble assistant">
            <h3>Sabari Copilot</h3>
            <TextShimmer className="pending-line">
              Mapping your question across Sabari&apos;s projects, notes, and ideas...
            </TextShimmer>
          </article>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-form" onSubmit={onSubmit}>
        <div className="input-shell">
          <textarea
            value={query}
            onChange={(event) => {
              if (autoTypingPrompt) {
                stopPromptAutoTyping();
              }
              setQuery(event.target.value);
            }}
            onKeyDown={onTextareaKeyDown}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            rows={1}
            maxLength={2000}
            placeholder=""
            disabled={pending}
          />
          {query.trim().length === 0 && !isInputFocused && !pending && (
            <div className="prompt-overlay" aria-hidden="true">
              {activePreviewWords.map((word, index) => (
                <span
                  key={`${previewPhraseIndex}-${word}-${index}`}
                  className={`prompt-word ${index < revealedWordCount ? "is-visible" : ""}`}
                >
                  {word}
                </span>
              ))}
            </div>
          )}
        </div>
        {!pending && (
          <div className="prompt-variants" aria-label="Suggested prompts">
            <span className="prompt-variants-label">Try:</span>
            {PROMPT_PREVIEWS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="prompt-variant-btn"
                onClick={() => typePromptIntoInput(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
        <div className="form-row">
          {error ? (
            <span className="error-text">{error}</span>
          ) : (
            <button className="text-btn" type="button" onClick={resetSession}>
              New chat
            </button>
          )}
          <button type="submit" disabled={!canSubmit}>
            {pending ? "Thinking..." : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}
