import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  CircleDot,
  Clock,
  GitPullRequest,
  Inbox,
  RefreshCw,
  XCircle,
} from "lucide-react";
import type { DelegationStatus, ReferenceKind } from "@/lib/api";
import { errorMessage } from "@/lib/api";
import { avatarClass, formatDateTime, formatRelativeTime, initials } from "@/lib/format";
import { giteaIssueHref, giteaPullHref, giteaRepoHref, statusLabels } from "@/lib/gitea";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function UserAvatar({ login, className }: { login: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold ring-1 ring-black/5",
        avatarClass(login),
        className,
      )}
    >
      {initials(login)}
    </span>
  );
}

export function TimeAgo({ value, className }: { value: string; className?: string }) {
  return (
    <time dateTime={value} title={formatDateTime(value)} className={cn("text-xs", className)}>
      {formatRelativeTime(value)}
    </time>
  );
}

const statusVariants: Record<
  DelegationStatus,
  { badge: "warning" | "info" | "success" | "destructive"; icon: LucideIcon }
> = {
  pending: { badge: "warning", icon: Clock },
  accepted: { badge: "info", icon: CircleDot },
  rejected: { badge: "destructive", icon: XCircle },
  delivered: { badge: "success", icon: CheckCircle2 },
};

export function StatusBadge({ status }: { status: DelegationStatus }) {
  const { badge, icon: Icon } = statusVariants[status];
  return (
    <Badge variant={badge}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {statusLabels[status]}
    </Badge>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/60 px-6 py-14 text-center",
        className,
      )}
    >
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/20 bg-destructive/5 px-6 py-12 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="text-base font-semibold">Could not load this view</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-5">
          <RefreshCw className="h-4 w-4" />
          Try again
        </Button>
      )}
    </div>
  );
}

export function ListSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="mt-4 h-3.5 w-full" />
          <Skeleton className="mt-2 h-3.5 w-4/5" />
        </div>
      ))}
    </div>
  );
}

export function InlineNotice({
  children,
  variant = "info",
  className,
}: {
  children: ReactNode;
  variant?: "info" | "warning";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed",
        variant === "warning"
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-sky-200 bg-sky-50 text-sky-900",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ReferenceLink({
  owner,
  name,
  kind,
  number,
  className,
}: {
  owner: string;
  name: string;
  kind: ReferenceKind;
  number: number | null;
  className?: string;
}) {
  const href =
    kind === "issue"
      ? giteaIssueHref(owner, name, number)
      : kind === "pr"
        ? giteaPullHref(owner, name, number)
        : giteaRepoHref(owner, name);
  const label =
    kind === "repo"
      ? `${owner}/${name}`
      : `${owner}/${name} · ${kind === "pr" ? "PR" : "Issue"} #${number}`;
  const Icon = kind === "pr" ? GitPullRequest : kind === "repo" ? BookOpen : CircleDot;
  return (
    <a
      href={href ?? giteaRepoHref(owner, name)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-primary/20 bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground transition-colors hover:border-primary/30 hover:bg-primary/10",
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
      <ArrowUpRight className="h-3 w-3 opacity-70" aria-hidden="true" />
    </a>
  );
}

export function PullLink({
  owner,
  name,
  number,
  className,
}: {
  owner: string;
  name: string;
  number: number;
  className?: string;
}) {
  const href = giteaPullHref(owner, name, number) ?? giteaRepoHref(owner, name);
  return (
    <a
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline",
        className,
      )}
    >
      <GitPullRequest className="h-4 w-4" aria-hidden="true" />
      PR #{number} in {owner}/{name}
      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
}
