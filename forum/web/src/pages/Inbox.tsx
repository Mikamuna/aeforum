import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Inbox as InboxIcon, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { InboxRow } from "@/components/inbox-row";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage, markInboxRead } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { queryKeys, useInbox } from "@/lib/queries";

export function InboxPage() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const inbox = useInbox();
  const [tab, setTab] = useState<"all" | "unread">("all");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.inbox });

  const markRead = useMutation({
    mutationFn: (id: number) => markInboxRead(session.csrf, id),
    onSuccess: () => {
      toast.success("Inbox item marked as read");
      invalidate();
    },
    onError: (error) => toast.error("Could not mark as read", { description: errorMessage(error) }),
  });

  const markAll = useMutation({
    mutationFn: async (ids: number[]) => {
      for (const id of ids) await markInboxRead(session.csrf, id);
    },
    onSuccess: () => {
      toast.success("Inbox cleared");
      invalidate();
    },
    onError: (error) => {
      toast.error("Could not mark the inbox as read", { description: errorMessage(error) });
      invalidate();
    },
  });

  const events = inbox.data ?? [];
  const unreadEvents = events.filter((event) => !event.read_at);
  const visible = tab === "unread" ? unreadEvents : events;
  const markingId = markRead.isPending ? markRead.variables : null;

  function renderList() {
    if (inbox.isPending) return <ListSkeleton rows={4} />;
    if (inbox.isError) return <ErrorState error={inbox.error} onRetry={() => inbox.refetch()} />;
    if (visible.length === 0) {
      return (
        <EmptyState
          icon={InboxIcon}
          title={tab === "unread" ? "No unread activity" : "Inbox is empty"}
          description={
            tab === "unread"
              ? "Everything addressed to you has been read. New replies, mentions, messages and delegation updates will appear here."
              : "Replies, mentions, private messages and delegation state changes are delivered here while you are offline."
          }
        />
      );
    }
    return (
      <ul className="space-y-3">
        {visible.map((event) => (
          <li key={event.id}>
            <InboxRow
              event={event}
              onMarkRead={(id) => markRead.mutate(id)}
              markingRead={markingId === event.id}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Inbox"
        description="Durable events addressed to your account. Reading an item updates the forum record; messages stay private."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => inbox.refetch()}
              disabled={inbox.isFetching}
              aria-label="Refresh inbox"
            >
              <RefreshCw className={inbox.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => markAll.mutate(unreadEvents.map((event) => event.id))}
              disabled={unreadEvents.length === 0 || markAll.isPending}
            >
              <CheckCheck className="h-4 w-4" />
              {markAll.isPending ? "Marking…" : "Mark all read"}
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={(value) => setTab(value as "all" | "unread")}>
        <TabsList aria-label="Filter inbox">
          <TabsTrigger value="all">
            All
            <span className="rounded-full bg-background px-1.5 text-[10px] font-semibold text-muted-foreground">
              {events.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="unread">
            Unread
            <span className="rounded-full bg-background px-1.5 text-[10px] font-semibold text-muted-foreground">
              {unreadEvents.length}
            </span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="all">{renderList()}</TabsContent>
        <TabsContent value="unread">{renderList()}</TabsContent>
      </Tabs>

      <p className="mt-6 text-xs leading-5 text-muted-foreground">
        Only items still backed by your current Gitea access are shown. Delegation links open the
        forum record; repository links open Gitea.
      </p>
    </div>
  );
}
