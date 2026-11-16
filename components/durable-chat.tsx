"use client";

import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import { isStaticToolUIPart, type UIMessage } from "ai";
import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { z } from "zod";
import {
  type ComponentProps,
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";

const MAX_STORED_MESSAGES = 40;

type StoredChat<M extends UIMessage> = {
  id: string;
  messages: M[];
  activeRunId: string | null;
};

export type DurableChatProps<M extends UIMessage> = {
  /** POST endpoint. Reconnects go to `{api}/{runId}/stream`. */
  api: string;
  storageKey: string;
  suggestions: string[];
  emptyTitle: string;
  emptyDescription: string;
  placeholder: string;
  inputLabel: string;
  /** Renders a non-text part, such as a tool call. */
  renderPart: (part: M["parts"][number]) => ReactNode;
};

/**
 * A chat whose turns run as durable workflows. The chat lives in
 * localStorage, so it renders on the client only. The server and the first
 * client render show an empty panel.
 */
export function DurableChat<M extends UIMessage>(props: DurableChatProps<M>) {
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [session, setSession] = useState(0);

  if (!isClient) return <div className="h-full" />;

  const reset = () => {
    clearStoredChat(props.storageKey);
    setSession((n) => n + 1);
  };

  return <ChatSession key={session} {...props} onReset={reset} />;
}

/**
 * One chat. Each turn runs as a durable workflow. The active run id is kept
 * until the turn ends, so a refresh reconnects to the running turn.
 */
function ChatSession<M extends UIMessage>({
  api,
  storageKey,
  suggestions,
  emptyTitle,
  emptyDescription,
  placeholder,
  inputLabel,
  renderPart,
  onReset,
}: DurableChatProps<M> & { onReset: () => void }) {
  const [initial] = useState(() => readStoredChat<M>(storageKey));
  const [input, setInput] = useState("");

  const transport = useMemo(
    () =>
      new WorkflowChatTransport<M>({
        api,
        maxConsecutiveErrors: 5,
        onChatSendMessage: (response) => {
          setActiveRun(storageKey, initial.id, response.headers.get("x-workflow-run-id"));
        },
        onChatEnd: () => setActiveRun(storageKey, initial.id, null),
        // In-session reconnects already carry the run id. After a refresh the
        // default URL holds the chat id, so the stored run id replaces it.
        prepareReconnectToStreamRequest: ({ api: url }) => {
          if (url.includes("/wrun_")) return { api: url };
          const runId = readStoredChat<M>(storageKey).activeRunId;
          return { api: runId ? `${api}/${encodeURIComponent(runId)}/stream` : url };
        },
      }),
    [api, storageKey, initial.id],
  );

  const { messages, sendMessage, status, stop, error, regenerate } =
    useChat<M>({
      id: initial.id,
      messages: initial.messages,
      transport,
      resume: initial.activeRunId !== null,
      // A 4xx means the run is gone. Network errors keep the id for a resume.
      onError: (err) => {
        if (/Failed to fetch chat: 4\d\d/.test(err.message)) setActiveRun(storageKey, initial.id, null);
      },
    });

  // A refresh replays the running turn from its start, so the stored copy
  // ends at the last user message until the turn is done.
  useEffect(() => {
    const done = status === "ready" || status === "error";
    saveMessages(
      storageKey,
      initial.id,
      done ? withoutOpenToolCalls(messages) : upToLastUserMessage(messages),
    );
  }, [storageKey, initial.id, messages, status]);

  const busy = status === "submitted" || status === "streaming";

  // A failed model call ends the stream without an error chunk, and a reload
  // before the run id arrives loses the turn. Both leave a turn without an answer.
  const unanswered =
    status === "ready" && !error && readStoredChat<M>(storageKey).activeRunId === null &&
    lacksAnswer(messages);

  // Stop detaches the client. The run finishes on the server but is not resumed.
  const halt = () => {
    stop();
    setActiveRun(storageKey, initial.id, null);
  };

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendMessage({ text: trimmed });
    setInput("");
  };

  const handleSubmit = (message: PromptInputMessage) => send(message.text);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              title={emptyTitle}
              description={emptyDescription}
            />
          ) : (
            messages.map((message) => (
              <Message from={message.role} key={message.id}>
                <MessageContent className={message.role === "assistant" ? "w-full" : undefined}>
                  {message.parts.map((part, index) => {
                    const key = `${message.id}-${index}`;
                    if (part.type === "text") {
                      return (
                        <MessageResponse key={key} components={markdownComponents}>
                          {part.text}
                        </MessageResponse>
                      );
                    }
                    return <Fragment key={key}>{renderPart(part)}</Fragment>;
                  })}
                </MessageContent>
              </Message>
            ))
          )}

          {status === "submitted" && <Shimmer className="text-sm">Thinking…</Shimmer>}

          {unanswered && (
            <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
              <p>The assistant did not answer.</p>
              <button
                type="button"
                onClick={() => regenerate()}
                className="mt-1 underline underline-offset-4"
              >
                Try again
              </button>
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
              <p>The assistant is not available right now.</p>
              <button
                type="button"
                onClick={() => regenerate()}
                className="mt-1 underline underline-offset-4"
              >
                Try again
              </button>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="flex flex-col gap-3 border-t p-3">
        {messages.length === 0 && (
          <Suggestions>
            {suggestions.map((s) => (
              <Suggestion key={s} suggestion={s} onClick={send} />
            ))}
          </Suggestions>
        )}
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder={placeholder}
              aria-label={inputLabel}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              {messages.length > 0 && (
                <PromptInputButton
                  onClick={() => {
                    halt();
                    onReset();
                  }}
                  aria-label="Start a new chat"
                >
                  <RotateCcw aria-hidden className="size-4" />
                  <span>New chat</span>
                </PromptInputButton>
              )}
            </PromptInputTools>
            <PromptInputSubmit
              status={status}
              onStop={halt}
              disabled={!busy && !input.trim()}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

const LOCAL_ORIGIN = "https://shop.invalid";

function parseUrl(value: string, base?: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

// Store links open in the same tab without the external link dialog.
// Other links open in a new tab. The URL parser catches `/\evil.com`.
function ChatLink({ href, children }: ComponentProps<"a">) {
  const linkClass = "font-medium text-primary underline underline-offset-4";
  const url = href ? parseUrl(href, LOCAL_ORIGIN) : null;
  if (href?.startsWith("/") && url?.origin === LOCAL_ORIGIN) {
    return (
      <Link href={`${url.pathname}${url.search}${url.hash}`} className={linkClass}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={linkClass}>
      {children}
    </a>
  );
}

// Images load only from the store's blob storage. A model reply that an
// injected ticket text steers could otherwise send data out in an image URL.
function ChatImage({ src, alt }: ComponentProps<"img">) {
  const url = src && !(src instanceof Blob) ? parseUrl(src) : null;
  if (url?.protocol !== "https:" || !url.hostname.endsWith(".vercel-storage.com")) {
    return alt ? <span>{alt}</span> : null;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url.href} alt={alt ?? ""} className="max-w-full rounded-md" />;
}

const markdownComponents = { a: ChatLink, img: ChatImage };

function noopSubscribe() {
  return () => {};
}

function newChat<M extends UIMessage>(): StoredChat<M> {
  return { id: crypto.randomUUID(), messages: [], activeRunId: null };
}

// Only this app writes the stored chat, and the server validates every
// message again, so a message needs only to be an object here.
function storedChatSchema<M extends UIMessage>() {
  return z.object({
    id: z.string(),
    messages: z.array(z.custom<M>((value) => Object(value) === value)),
    activeRunId: z.string().nullable().catch(null),
  });
}

function readStoredChat<M extends UIMessage>(key: string): StoredChat<M> {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return newChat();
    const stored = storedChatSchema<M>().safeParse(JSON.parse(raw));
    return stored.success ? stored.data : newChat();
  } catch {
    return newChat();
  }
}

// Another tab may own the stored chat. Then this tab does not write.
function writeStoredChat<M extends UIMessage>(
  key: string,
  id: string,
  update: (chat: StoredChat<M>) => StoredChat<M>,
) {
  try {
    const empty = window.localStorage.getItem(key) === null;
    const current = readStoredChat<M>(key);
    if (!empty && current.id !== id) return;
    const base = empty ? { ...newChat<M>(), id } : current;
    window.localStorage.setItem(key, JSON.stringify(update(base)));
  } catch {
    // Storage is full or blocked. The chat still works without resume.
  }
}

function saveMessages<M extends UIMessage>(key: string, id: string, messages: M[]) {
  writeStoredChat<M>(key, id, (chat) => ({ ...chat, messages: messages.slice(-MAX_STORED_MESSAGES) }));
}

function setActiveRun(key: string, id: string, runId: string | null) {
  writeStoredChat(key, id, (chat) => ({ ...chat, activeRunId: runId }));
}

function clearStoredChat(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

function lacksAnswer(messages: UIMessage[]) {
  const last = messages.at(-1);
  if (!last) return false;
  if (last.role === "user") return true;
  return !last.parts.some((part) => part.type === "text" || isStaticToolUIPart(part));
}

// A stopped turn can leave a tool call without a result. Stored, it would
// break the next request.
function withoutOpenToolCalls<M extends UIMessage>(messages: M[]): M[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.filter(
      (part) =>
        !isStaticToolUIPart(part) ||
        part.state === "output-available" ||
        part.state === "output-error",
    ),
  }));
}

function upToLastUserMessage<M extends UIMessage>(messages: M[]): M[] {
  const last = messages.findLastIndex((message) => message.role === "user");
  return messages.slice(0, last + 1);
}
