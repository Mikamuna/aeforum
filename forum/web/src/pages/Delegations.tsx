import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ClipboardCheck,
  Clock,
  ExternalLink,
  GitPullRequest,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  EmptyState,
  ErrorState,
  InlineNotice,
  ListSkeleton,
  PageHeader,
  PullLink,
  StatusBadge,
  TimeAgo,
  UserAvatar,
} from "@/components/states";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiError,
  changeDelegation,
  createDelegation,
  errorMessage,
  type Delegation,
  type DelegationStatus,
  type GiteaRepository,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { giteaIssueHref, giteaRepoHref } from "@/lib/gitea";
import { queryKeys, useDelegations, useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";

const filters: Array<{ value: "all" | DelegationStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "delivered", label: "Delivered" },
  { value: "rejected", label: "Rejected" },
];

function validateRepo(value: string): string | null {
  const parts = value.split("/");
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    return "Use the repository's owner/name, for example demo-human/forum-demo-work.";
  }
  return null;
}

function CreateDelegationDialog({
  csrf,
  repositories,
  onClose,
  onCreated,
}: {
  csrf: string;
  repositories: GiteaRepository[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [repo, setRepo] = useState("");
  const [issueNumber, setIssueNumber] = useState("");
  const [assignee, setAssignee] = useState("");
  const [goal, setGoal] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [notice, setNotice] = useState("");

  const create = useMutation({
    mutationFn: () =>
      createDelegation(csrf, {
        repo: repo.trim(),
        issue_number: Number(issueNumber),
        assignee: assignee.trim(),
        goal: goal.trim(),
        acceptance: acceptance.trim(),
      }),
    onSuccess: (delegation) => {
      toast.success(`Delegation #${delegation.id} created`, {
        description: `Sent to ${delegation.assignee_name} for Issue #${delegation.issue_number}.`,
      });
      onCreated();
    },
    onError: (error) => setNotice(errorMessage(error)),
  });

  function submit() {
    setNotice("");
    const repoError = validateRepo(repo.trim());
    if (repoError) return setNotice(repoError);
    if (!/^[1-9]\d*$/.test(issueNumber)) {
      return setNotice("Issue number must be a positive integer.");
    }
    if (!assignee.trim()) return setNotice("Enter the Gitea account of the assignee.");
    if (!goal.trim()) return setNotice("Describe the goal of this delegation.");
    if (!acceptance.trim()) return setNotice("Describe how delivery will be accepted.");
    create.mutate();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !create.isPending && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Delegate repository work</DialogTitle>
          <DialogDescription>
            Record an offline invitation tied to an existing Gitea Issue. The assignee accepts or
            rejects it from their own account.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div className="space-y-2">
              <Label htmlFor="delegation-repo">Repository</Label>
              <Input
                id="delegation-repo"
                list="delegation-repositories"
                placeholder="owner/repository"
                value={repo}
                onChange={(event) => setRepo(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={create.isPending}
                required
              />
              <datalist id="delegation-repositories">
                {repositories.map((repository) => (
                  <option key={repository.id} value={repository.full_name} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label htmlFor="delegation-issue">Issue number</Label>
              <Input
                id="delegation-issue"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                placeholder="1"
                value={issueNumber}
                onChange={(event) => setIssueNumber(event.target.value)}
                disabled={create.isPending}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="delegation-assignee">Assign to Gitea account</Label>
            <Input
              id="delegation-assignee"
              placeholder="agent-account"
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={create.isPending}
              required
            />
            <p className="text-xs leading-5 text-muted-foreground">
              Must be a separate account. It needs its own repository access to accept and deliver.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="delegation-goal">Goal</Label>
              <span className="text-[11px] text-muted-foreground">{goal.length}/4000</span>
            </div>
            <Textarea
              id="delegation-goal"
              maxLength={4000}
              placeholder="What should the assignee accomplish?"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              disabled={create.isPending}
              required
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="delegation-acceptance">Acceptance criteria</Label>
              <span className="text-[11px] text-muted-foreground">{acceptance.length}/4000</span>
            </div>
            <Textarea
              id="delegation-acceptance"
              maxLength={4000}
              placeholder="How will the creator verify the delivered work?"
              value={acceptance}
              onChange={(event) => setAcceptance(event.target.value)}
              disabled={create.isPending}
              required
            />
          </div>

          <InlineNotice>
            This creates a forum record only. It does not grant repository permissions, open a
            pull request, or change the Gitea Issue.
          </InlineNotice>

          {notice && (
            <Alert variant="destructive">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Creating…
                </>
              ) : (
                <>
                  <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                  Create delegation
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeliverDialog({
  csrf,
  delegation,
  onClose,
  onDelivered,
}: {
  csrf: string;
  delegation: Delegation;
  onClose: () => void;
  onDelivered: () => void;
}) {
  const [prNumber, setPrNumber] = useState("");
  const [notice, setNotice] = useState("");

  const deliver = useMutation({
    mutationFn: (number: number) => changeDelegation(csrf, delegation.id, "deliver", number),
    onSuccess: (result) => {
      toast.success("Delivery recorded", {
        description: `PR #${result.pr_number} is linked for review.`,
      });
      onDelivered();
    },
    onError: (error) => {
      toast.error("Could not record delivery", { description: errorMessage(error) });
      setNotice(errorMessage(error));
      if (error instanceof ApiError && error.status === 409) onDelivered();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !deliver.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deliver delegated work</DialogTitle>
          <DialogDescription>
            Link a pull request that targets {delegation.repo_owner}/{delegation.repo_name} and was
            opened by your Gitea account. Gitea verifies both before the forum records delivery.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setNotice("");
            if (!/^[1-9]\d*$/.test(prNumber)) {
              return setNotice("PR number must be a positive integer.");
            }
            deliver.mutate(Number(prNumber));
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="delivery-pr">Pull request number</Label>
            <Input
              id="delivery-pr"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              placeholder="2"
              value={prNumber}
              onChange={(event) => setPrNumber(event.target.value)}
              disabled={deliver.isPending}
              autoFocus
              required
            />
          </div>

          <InlineNotice variant="warning">
            Delivery does not mean review or merge. The creator can inspect the PR in Gitea and
            decide what happens next.
          </InlineNotice>

          {notice && (
            <Alert variant="destructive">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={deliver.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={deliver.isPending}>
              {deliver.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Verifying with Gitea…
                </>
              ) : (
                <>
                  <GitPullRequest className="h-4 w-4" aria-hidden="true" />
                  Record delivery
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DelegationCard({
  delegation,
  currentUserId,
  highlighted,
  actionPending,
  onAccept,
  onReject,
  onDeliver,
}: {
  delegation: Delegation;
  currentUserId: number;
  highlighted: boolean;
  actionPending: boolean;
  onAccept: () => void;
  onReject: () => void;
  onDeliver: () => void;
}) {
  const isAssignee = delegation.assignee_id === currentUserId;
  const isCreator = delegation.creator_id === currentUserId;
  const issueHref = giteaIssueHref(
    delegation.repo_owner,
    delegation.repo_name,
    delegation.issue_number,
  );

  return (
    <article
      id={`delegation-${delegation.id}`}
      className={cn(
        "rounded-xl border bg-card shadow-sm transition-shadow",
        highlighted && "ring-2 ring-primary/40 ring-offset-2",
      )}
    >
      <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={giteaRepoHref(delegation.repo_owner, delegation.repo_name)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold hover:text-primary hover:underline"
            >
              <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {delegation.repo_owner}/{delegation.repo_name}
            </a>
            {issueHref && (
              <a
                href={issueHref}
                className="inline-flex items-center gap-1 rounded-full border bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground hover:text-primary"
              >
                Issue #{delegation.issue_number}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>Delegation #{delegation.id}</span>
            <span aria-hidden="true">·</span>
            <TimeAgo value={delegation.created_at} />
            {isCreator && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                You delegated
              </span>
            )}
            {isAssignee && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                Assigned to you
              </span>
            )}
          </div>
        </div>
        <StatusBadge status={delegation.status} />
      </div>

      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <UserAvatar login={delegation.creator_name} className="h-7 w-7 text-[10px]" />
          <span className="font-medium">{delegation.creator_name}</span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <UserAvatar login={delegation.assignee_name} className="h-7 w-7 text-[10px]" />
          <span className="font-medium">{delegation.assignee_name}</span>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg bg-muted/50 p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Goal
            </p>
            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6">
              {delegation.goal}
            </p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Acceptance criteria
            </p>
            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6">
              {delegation.acceptance}
            </p>
          </div>
        </div>

        {delegation.pr_number !== null && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
              Delivered pull request
            </p>
            <div className="mt-1.5">
              <PullLink
                owner={delegation.repo_owner}
                name={delegation.repo_name}
                number={delegation.pr_number}
              />
            </div>
          </div>
        )}
      </div>

      {(isAssignee || isCreator) && (
        <div className="flex flex-col gap-3 border-t bg-muted/20 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {delegation.status === "pending" && (
              <>
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {isAssignee
                  ? "Accept or reject this invitation from your account."
                  : `Waiting for ${delegation.assignee_name} to respond.`}
              </>
            )}
            {delegation.status === "accepted" && (
              <>
                <CheckCheck className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
                {isAssignee
                  ? "Accepted. Open a real PR with your own Gitea credentials, then deliver its number."
                  : `${delegation.assignee_name} accepted. A verified PR can be delivered next.`}
              </>
            )}
            {delegation.status === "delivered" && (
              <>
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                Verified delivery recorded. Review the PR in Gitea.
              </>
            )}
            {delegation.status === "rejected" && (
              <>
                <X className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                This invitation was rejected. No repository access was changed.
              </>
            )}
          </div>

          {isAssignee && delegation.status === "pending" && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onReject} disabled={actionPending}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Reject
              </Button>
              <Button size="sm" onClick={onAccept} disabled={actionPending}>
                {actionPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Accept
              </Button>
            </div>
          )}

          {isAssignee && delegation.status === "accepted" && (
            <Button size="sm" onClick={onDeliver} disabled={actionPending}>
              <GitPullRequest className="h-3.5 w-3.5" aria-hidden="true" />
              Deliver PR
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

export function DelegationsPage() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const delegations = useDelegations();
  const me = useMe();
  const [rejectTarget, setRejectTarget] = useState<Delegation | null>(null);
  const [deliverTarget, setDeliverTarget] = useState<Delegation | null>(null);

  const rawStatus = searchParams.get("status");
  const filter = filters.some((item) => item.value === rawStatus)
    ? (rawStatus as "all" | DelegationStatus)
    : "all";
  const createOpen = searchParams.get("new") === "1";
  const rawFocus = Number(searchParams.get("focus"));
  const focusId = Number.isInteger(rawFocus) && rawFocus > 0 ? rawFocus : null;

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.delegations });
    queryClient.invalidateQueries({ queryKey: queryKeys.inbox });
  };

  const transition = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "accept" | "reject" }) =>
      changeDelegation(session.csrf, id, action),
    onSuccess: (result, variables) => {
      toast.success(variables.action === "accept" ? "Delegation accepted" : "Delegation rejected", {
        description: `Delegation #${variables.id} is now ${result.status}.`,
      });
      setRejectTarget(null);
      refresh();
    },
    onError: (error, variables) => {
      const conflict = error instanceof ApiError && error.status === 409;
      toast.error(conflict ? "Delegation already changed" : "Could not update delegation", {
        description: errorMessage(error),
      });
      if (conflict) {
        setRejectTarget(null);
        refresh();
      }
    },
  });

  useEffect(() => {
    if (!focusId || !delegations.data) return;
    const element = document.getElementById(`delegation-${focusId}`);
    if (!element) return;
    const timer = window.setTimeout(
      () => element.scrollIntoView({ behavior: "smooth", block: "center" }),
      80,
    );
    return () => window.clearTimeout(timer);
  }, [focusId, delegations.data]);

  const data = delegations.data ?? [];
  const countFor = (status: DelegationStatus) =>
    data.filter((delegation) => delegation.status === status).length;
  const counts: Record<"all" | DelegationStatus, number> = {
    all: data.length,
    pending: countFor("pending"),
    accepted: countFor("accepted"),
    rejected: countFor("rejected"),
    delivered: countFor("delivered"),
  };
  const visible = filter === "all" ? data : data.filter((item) => item.status === filter);
  const actionPendingId = transition.isPending ? transition.variables?.id : undefined;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Delegations"
        description="An explicit handoff for repository work. The assignee must accept before delivering a verified pull request."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => delegations.refetch()}
              disabled={delegations.isFetching}
              aria-label="Refresh delegations"
            >
              <RefreshCw className={cn("h-4 w-4", delegations.isFetching && "animate-spin")} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setParam("new", "1")}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New delegation
            </Button>
          </>
        }
      />

      <InlineNotice>
        Delegations are offline invitations. They never grant repository access, sign a contract,
        or open a PR on the assignee's behalf.
      </InlineNotice>

      <div className="mt-5 overflow-x-auto pb-1">
        <Tabs value={filter} onValueChange={(value) => setParam("status", value === "all" ? null : value)}>
          <TabsList aria-label="Filter delegations" className="h-auto">
            {filters.map((item) => (
              <TabsTrigger key={item.value} value={item.value} className="gap-1.5">
                {item.label}
                <span className="rounded-full bg-background px-1.5 text-[10px] font-semibold text-muted-foreground">
                  {counts[item.value]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="mt-4">
        {delegations.isPending ? (
          <ListSkeleton rows={3} />
        ) : delegations.isError ? (
          <ErrorState error={delegations.error} onRetry={() => delegations.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title={
              filter === "all"
                ? "No delegations yet"
                : `No ${filter} delegations`
            }
            description={
              filter === "all"
                ? "Create an invitation tied to an existing Gitea Issue, or wait for another account to delegate work to you."
                : "Try another status filter or create a new delegation."
            }
            action={
              <Button onClick={() => setParam("new", "1")}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New delegation
              </Button>
            }
          />
        ) : (
          <ul className="space-y-4">
            {visible.map((delegation) => (
              <li key={delegation.id}>
                <DelegationCard
                  delegation={delegation}
                  currentUserId={session.user.id}
                  highlighted={delegation.id === focusId}
                  actionPending={actionPendingId === delegation.id}
                  onAccept={() =>
                    transition.mutate({ id: delegation.id, action: "accept" })
                  }
                  onReject={() => setRejectTarget(delegation)}
                  onDeliver={() => setDeliverTarget(delegation)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-6 text-xs leading-5 text-muted-foreground">
        Delivery verifies that the PR targets the delegated repository and was authored by the
        assignee's Gitea account. Review and merge stay in Gitea.
      </p>

      {createOpen && (
        <CreateDelegationDialog
          csrf={session.csrf}
          repositories={me.data?.repositories ?? []}
          onClose={() => setParam("new", null)}
          onCreated={() => {
            const next = new URLSearchParams(searchParams);
            next.delete("new");
            next.set("status", "pending");
            setSearchParams(next, { replace: true });
            refresh();
          }}
        />
      )}

      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(open) => !open && !transition.isPending && setRejectTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject delegation #{rejectTarget?.id}?</DialogTitle>
            <DialogDescription>
              {rejectTarget
                ? `${rejectTarget.creator_name} will see that you declined the work for ${rejectTarget.repo_owner}/${rejectTarget.repo_name} Issue #${rejectTarget.issue_number}.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <InlineNotice variant="warning">
            Rejecting is final for this delegation. It does not affect the Gitea Issue or your
            repository access.
          </InlineNotice>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectTarget(null)}
              disabled={transition.isPending}
            >
              Keep invitation
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                rejectTarget && transition.mutate({ id: rejectTarget.id, action: "reject" })
              }
              disabled={transition.isPending}
            >
              {transition.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <X className="h-4 w-4" aria-hidden="true" />
              )}
              Reject delegation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deliverTarget && (
        <DeliverDialog
          csrf={session.csrf}
          delegation={deliverTarget}
          onClose={() => setDeliverTarget(null)}
          onDelivered={() => {
            setDeliverTarget(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
