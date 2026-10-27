import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCheck,
  Loader2,
  Mail,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  PageHeader,
  TimeAgo,
  UserAvatar,
} from "@/components/states";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  errorMessage,
  markInboxRead,
  sendMessage,
  type InboxEvent,
  type Message,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatDay } from "@/lib/format";
import { giteaProfileHref } from "@/lib/gitea";
import { queryKeys, useDelegations, useInbox, useMessages } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface Conversation {
  login: string;
  messages: Message[];
  last: Message;
  unreadCount: number;
  unreadEventIds: number[];
}

function NewMessageDialog({
  csrf,
  accounts,
  onClose,
  onSent,
}: {
  csrf: string;
  accounts: string[];
  onClose: () => void;
  onSent: (recipient: string) => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState("");

  const send = useMutation({
    mutationFn: () => sendMessage(csrf, { recipient: recipient.trim(), body: body.trim() }),
    onSuccess: (message) => {
      toast.success(`Message sent to ${message.recipient_name}`);
      onSent(message.recipient_name);
    },
    onError: (error) => setNotice(errorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !send.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New private message</DialogTitle>
          <DialogDescription>
            Only the recipient and you can read this conversation. It is delivered to their forum
            inbox even while they are offline.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setNotice("");
            const name = recipient.trim();
            if (!name) return setNotice("Enter the Gitea account to message.");
            if (/\s|\//.test(name)) return setNotice("Use a Gitea login without spaces or slashes.");
            if (!body.trim()) return setNotice("Write a message before sending.");
            send.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="message-recipient">Recipient</Label>
            <Input
              id="message-recipient"
              list="message-accounts"
              placeholder="Gitea account"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={send.isPending}
              autoFocus
              required
            />
            <datalist id="message-accounts">
              {accounts.map((account) => (
                <option key={account} value={account} />
              ))}
            </datalist>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="message-body">Message</Label>
              <span className="text-[11px] text-muted-foreground">{body.length}/4000</span>
            </div>
            <Textarea
              id="message-body"
              maxLength={4000}
              className="min-h-[120px]"
              placeholder="Write a private note…"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              disabled={send.isPending}
              required
            />
          </div>

          {notice && (
            <Alert variant="destructive">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={send.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={send.isPending}>
              {send.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" aria-hidden="true" />
                  Send privately
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ThreadView({
  conversation,
  currentUserId,
  csrf,
  markingRead,
  onMarkRead,
  onBack,
  onSent,
}: {
  conversation: Conversation;
  currentUserId: number;
  csrf: string;
  markingRead: boolean;
  onMarkRead: (ids: number[]) => void;
  onBack: () => void;
  onSent: () => void;
}) {
  const [body, setBody] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const send = useMutation({
    mutationFn: () => sendMessage(csrf, { recipient: conversation.login, body: body.trim() }),
    onSuccess: () => {
      setBody("");
      toast.success(`Message sent to ${conversation.login}`);
      onSent();
    },
    onError: (error) => toast.error("Could not send message", { description: errorMessage(error) }),
  });

  useEffect(() => {
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [conversation.login, conversation.messages.length]);

  function submit() {
    if (!body.trim() || send.isPending) return;
    send.mutate();
  }

  return (
    <Card className="flex h-[calc(100dvh-14rem)] min-h-[30rem] flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b p-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={onBack}
              aria-label="Back to conversations"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Back to conversations</TooltipContent>
        </Tooltip>
        <UserAvatar login={conversation.login} />
        <div className="min-w-0 flex-1">
          <a
            href={giteaProfileHref(conversation.login)}
            className="truncate text-sm font-semibold hover:text-primary hover:underline"
          >
            {conversation.login}
          </a>
          <p className="text-[11px] text-muted-foreground">
            Private conversation · {conversation.messages.length}{" "}
            {conversation.messages.length === 1 ? "message" : "messages"}
          </p>
        </div>
        {conversation.unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onMarkRead(conversation.unreadEventIds)}
            disabled={markingRead}
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {conversation.unreadCount} unread
          </Button>
        )}
      </div>

      <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto bg-muted/20 p-4">
        {conversation.messages.map((message, index) => {
          const mine = message.sender_id === currentUserId;
          const previous = index > 0 ? conversation.messages[index - 1] : null;
          const day = formatDay(message.created_at);
          const showDay = !previous || formatDay(previous.created_at) !== day;
          return (
            <div key={message.id}>
              {showDay && (
                <div className="mb-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {day}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}
              <div className={cn("flex items-end gap-2", mine && "flex-row-reverse")}>
                {!mine && (
                  <UserAvatar
                    login={message.sender_name}
                    className="mb-4 h-7 w-7 text-[10px]"
                  />
                )}
                <div className={cn("max-w-[min(34rem,82%)]", mine && "text-right")}>
                  <div
                    className={cn(
                      "inline-block rounded-2xl px-3.5 py-2.5 text-left text-sm leading-5 shadow-sm",
                      mine
                        ? "rounded-br-md bg-primary text-primary-foreground"
                        : "rounded-bl-md border bg-card text-card-foreground",
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {mine ? "You" : message.sender_name} ·{" "}
                    <time dateTime={message.created_at} title={formatDateTime(message.created_at)}>
                      {formatDateTime(message.created_at)}
                    </time>
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <form
        className="flex items-end gap-2 border-t bg-card p-3 sm:p-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex-1">
          <Label htmlFor="thread-message" className="sr-only">
            Message to {conversation.login}
          </Label>
          <Textarea
            id="thread-message"
            rows={2}
            maxLength={4000}
            className="min-h-[44px] resize-none"
            placeholder={`Message ${conversation.login}…`}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
            disabled={send.isPending}
          />
        </div>
        <Button
          type="submit"
          size="icon"
          className="mb-0.5"
          disabled={!body.trim() || send.isPending}
          aria-label="Send message"
        >
          {send.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>
    </Card>
  );
}

export function MessagesPage() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const messages = useMessages();
  const inbox = useInbox();
  const delegations = useDelegations();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");

  const currentUserId = session.user.id;
  const selectedParam = searchParams.get("with");
  const createOpen = searchParams.get("new") === "1";

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.messages });
    queryClient.invalidateQueries({ queryKey: queryKeys.inbox });
  };

  const markRead = useMutation({
    mutationFn: async (ids: number[]) => {
      for (const id of ids) await markInboxRead(session.csrf, id);
    },
    onSuccess: () => {
      toast.success("Conversation marked as read");
      queryClient.invalidateQueries({ queryKey: queryKeys.inbox });
    },
    onError: (error) =>
      toast.error("Could not mark conversation as read", { description: errorMessage(error) }),
  });

  const conversations = useMemo(() => {
    const grouped = new Map<string, Message[]>();
    for (const message of messages.data ?? []) {
      const other =
        message.sender_id === currentUserId ? message.recipient_name : message.sender_name;
      if (!other) continue;
      const existing = grouped.get(other);
      if (existing) existing.push(message);
      else grouped.set(other, [message]);
    }
    const result: Conversation[] = [];
    for (const [login, thread] of grouped) {
      const unreadEvents = (inbox.data ?? []).filter(
        (event: InboxEvent) =>
          event.kind === "message" &&
          !event.read_at &&
          thread.some(
            (message) =>
              message.id === event.source_id && message.recipient_id === currentUserId,
          ),
      );
      result.push({
        login,
        messages: thread,
        last: thread[thread.length - 1],
        unreadCount: unreadEvents.length,
        unreadEventIds: unreadEvents.map((event) => event.id),
      });
    }
    return result.sort((left, right) => right.last.id - left.last.id);
  }, [messages.data, inbox.data, currentUserId]);

  const selected = conversations.find(
    (conversation) => conversation.login.toLowerCase() === selectedParam?.toLowerCase(),
  );

  const accounts = useMemo(() => {
    const names = new Set<string>();
    for (const conversation of conversations) names.add(conversation.login);
    for (const delegation of delegations.data ?? []) {
      if (delegation.creator_id !== currentUserId) names.add(delegation.creator_name);
      if (delegation.assignee_id !== currentUserId) names.add(delegation.assignee_name);
    }
    for (const event of inbox.data ?? []) {
      if (event.message_sender) names.add(event.message_sender);
      if (event.post_author) names.add(event.post_author);
    }
    names.delete(session.user.login);
    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [conversations, delegations.data, inbox.data, currentUserId, session.user.login]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  const normalized = search.trim().toLowerCase();
  const visibleConversations = conversations.filter((conversation) => {
    if (!normalized) return true;
    return (
      conversation.login.toLowerCase().includes(normalized) ||
      conversation.last.body.toLowerCase().includes(normalized)
    );
  });

  const unreadTotal = conversations.reduce(
    (total, conversation) => total + conversation.unreadCount,
    0,
  );

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Messages"
        description="Private, addressed conversations. Messages are separate from public posts and remain in the recipient's inbox while they are offline."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                messages.refetch();
                inbox.refetch();
              }}
              disabled={messages.isFetching}
              aria-label="Refresh messages"
            >
              <RefreshCw className={cn("h-4 w-4", messages.isFetching && "animate-spin")} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setParam("new", "1")}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New message
            </Button>
          </>
        }
      />

      {messages.isPending ? (
        <ListSkeleton rows={3} />
      ) : messages.isError ? (
        <ErrorState error={messages.error} onRetry={() => messages.refetch()} />
      ) : conversations.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No conversations yet"
          description="Send a private message to a Gitea account. It stays in their forum inbox until they return."
          action={
            <Button onClick={() => setParam("new", "1")}>
              <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
              New message
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-[20rem_minmax(0,1fr)]">
          <Card
            className={cn(
              "h-[calc(100dvh-14rem)] min-h-[30rem] flex-col overflow-hidden",
              selected ? "hidden md:flex" : "flex",
            )}
          >
            <div className="border-b p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">Conversations</p>
                  <p className="text-[11px] text-muted-foreground">
                    {conversations.length} total
                    {unreadTotal > 0 ? ` · ${unreadTotal} unread` : ""}
                  </p>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setParam("new", "1")}
                      aria-label="Start a new private message"
                    >
                      <MessageSquarePlus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>New private message</TooltipContent>
                </Tooltip>
              </div>
              <div className="relative mt-3">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Filter conversations"
                  aria-label="Filter conversations"
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {visibleConversations.length === 0 ? (
                <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                  No conversations match this filter.
                </p>
              ) : (
                <ul className="space-y-1" aria-label="Conversations">
                  {visibleConversations.map((conversation) => {
                    const active = selected?.login === conversation.login;
                    return (
                      <li key={conversation.login}>
                        <Link
                          to={`?with=${encodeURIComponent(conversation.login)}`}
                          replace
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "block w-full rounded-lg p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            active ? "bg-accent" : "hover:bg-muted",
                          )}
                        >
                          <div className="flex items-center gap-2.5">
                            <UserAvatar
                              login={conversation.login}
                              className="h-8 w-8 text-[10px]"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-xs font-semibold">
                                  {conversation.login}
                                </span>
                                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                                  {formatDay(conversation.last.created_at)}
                                </span>
                                {conversation.unreadCount > 0 && (
                                  <Badge
                                    variant="default"
                                    className="h-4 min-w-4 justify-center px-1 text-[9px]"
                                    aria-label={`${conversation.unreadCount} unread`}
                                  >
                                    {conversation.unreadCount}
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                {conversation.last.sender_id === currentUserId ? "You: " : ""}
                                {conversation.last.body}
                              </p>
                            </div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>

          <section className={cn("min-w-0", selected ? "block" : "hidden md:block")}>
            {selected ? (
              <ThreadView
                key={selected.login}
                conversation={selected}
                currentUserId={currentUserId}
                csrf={session.csrf}
                markingRead={markRead.isPending}
                onMarkRead={(ids) => markRead.mutate(ids)}
                onBack={() => setParam("with", null)}
                onSent={() => {
                  refresh();
                }}
              />
            ) : (
              <Card className="flex h-[calc(100dvh-14rem)] min-h-[30rem] flex-col items-center justify-center p-8 text-center">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
                  <Mail className="h-6 w-6" aria-hidden="true" />
                </div>
                <p className="mt-4 text-sm font-semibold">Select a conversation</p>
                <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                  Private messages stay here across forum restarts and are visible only to the two
                  accounts in the conversation.
                </p>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Latest activity <TimeAgo value={conversations[0].last.created_at} />
                </p>
              </Card>
            )}
          </section>
        </div>
      )}

      {createOpen && (
        <NewMessageDialog
          csrf={session.csrf}
          accounts={accounts}
          onClose={() => setParam("new", null)}
          onSent={(recipient) => {
            setParam("new", null);
            const next = new URLSearchParams(searchParams);
            next.delete("new");
            next.set("with", recipient);
            setSearchParams(next, { replace: true });
            refresh();
          }}
        />
      )}
    </div>
  );
}
