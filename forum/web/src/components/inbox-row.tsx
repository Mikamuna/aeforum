import {
  AtSign,
  Check,
  ClipboardCheck,
  Mail,
  MessageSquare,
  Unlock,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { InboxEvent } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { giteaIssueHref } from "@/lib/gitea";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/states";

function presentation(event: InboxEvent) {
  switch (event.kind) {
    case "delegation":
      return {
        icon: ClipboardCheck,
        label: "Delegation",
        title: `Delegation #${event.source_id}`,
        preview: event.goal ?? "Open the delegation to review its goal and acceptance criteria.",
        to: `/delegations?focus=${event.source_id}`,
        gitea:
          event.repo_owner && event.repo_name && event.issue_number
            ? giteaIssueHref(event.repo_owner, event.repo_name, event.issue_number)
            : null,
        giteaLabel:
          event.repo_owner && event.repo_name && event.issue_number
            ? `${event.repo_owner}/${event.repo_name} #${event.issue_number}`
            : null,
      };
    case "message":
      return {
        icon: Mail,
        label: "Private message",
        title: `Message from ${event.message_sender ?? "another account"}`,
        preview: event.message_body ?? "Open your messages to read this note.",
        to: event.message_sender
          ? `/messages?with=${encodeURIComponent(event.message_sender)}`
          : "/messages",
        gitea: null,
        giteaLabel: null,
      };
    case "reply":
      return {
        icon: MessageSquare,
        label: "Reply",
        title: `${event.post_author ?? "Someone"} replied to your post`,
        preview: event.post_body ?? "Open the discussion to read the reply.",
        to: `/discussion#post-${event.source_id}`,
        gitea: null,
        giteaLabel: null,
      };
    case "mention":
      return {
        icon: AtSign,
        label: "Mention",
        title: `${event.post_author ?? "Someone"} mentioned you`,
        preview: event.post_body ?? "Open the discussion to read the mention.",
        to: `/discussion#post-${event.source_id}`,
        gitea: null,
        giteaLabel: null,
      };
  }
}

export function InboxRow({
  event,
  compact = false,
  onMarkRead,
  markingRead = false,
}: {
  event: InboxEvent;
  compact?: boolean;
  onMarkRead?: (id: number) => void;
  markingRead?: boolean;
}) {
  const item = presentation(event);
  const unread = !event.read_at;
  const Icon = item.icon;

  return (
    <article
      className={cn(
        "rounded-xl border bg-card p-4 shadow-sm transition-colors sm:p-5",
        unread && "border-primary/25",
        compact && "p-4",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg",
            unread ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {item.label}
            </span>
            {unread && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                Unread
              </span>
            )}
            <span className="text-[11px] text-muted-foreground">
              · {formatRelativeTime(event.created_at)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Link
              to={item.to}
              className="text-sm font-semibold leading-5 hover:text-primary hover:underline"
            >
              {item.title}
            </Link>
            {event.kind === "delegation" && event.delegation_status && (
              <StatusBadge status={event.delegation_status} />
            )}
          </div>
          <p
            className={cn(
              "mt-1.5 text-sm leading-6 text-muted-foreground",
              compact ? "line-clamp-2" : "whitespace-pre-wrap break-words",
            )}
          >
            {item.preview}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {item.gitea && (
              <a
                href={item.gitea}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Unlock className="h-3 w-3" aria-hidden="true" />
                {item.giteaLabel}
              </a>
            )}
            {unread && onMarkRead && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onMarkRead(event.id)}
                disabled={markingRead}
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                {markingRead ? "Marking…" : "Mark read"}
              </Button>
            )}
            {!unread && !compact && (
              <Badge variant="muted" className="gap-1">
                <Check className="h-3 w-3" aria-hidden="true" />
                Read
              </Badge>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
