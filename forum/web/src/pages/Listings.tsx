import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  EmptyState,
  ErrorState,
  InlineNotice,
  ListSkeleton,
  PageHeader,
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
import { Textarea } from "@/components/ui/textarea";
import {
  createListing,
  errorMessage,
  type GiteaRepository,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { giteaIssueHref } from "@/lib/gitea";
import { queryKeys, useListings, useMe } from "@/lib/queries";

function CreateListingDialog({
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
  const [description, setDescription] = useState("");
  const [notice, setNotice] = useState("");

  const create = useMutation({
    mutationFn: () =>
      createListing(csrf, {
        repo: repo.trim(),
        issue_number: Number(issueNumber),
        description: description.trim(),
      }),
    onSuccess: () => {
      toast.success("Work listing published", {
        description: "Accounts that can read the linked Issue will see it.",
      });
      onCreated();
    },
    onError: (error) => setNotice(errorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !create.isPending && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Publish a work listing</DialogTitle>
          <DialogDescription>
            Raise visibility for an existing repository Issue. Readers still need their own Gitea
            access to open the linked work.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setNotice("");
            const parts = repo.trim().split("/");
            if (parts.length !== 2 || !parts[0] || !parts[1]) {
              return setNotice("Use the repository's owner/name, for example demo-human/forum-demo-public.");
            }
            if (!/^[1-9]\d*$/.test(issueNumber)) {
              return setNotice("Issue number must be a positive integer.");
            }
            if (!description.trim()) return setNotice("Describe the work you want to surface.");
            create.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div className="space-y-2">
              <Label htmlFor="listing-repo">Repository</Label>
              <Input
                id="listing-repo"
                list="listing-repositories"
                placeholder="owner/repository"
                value={repo}
                onChange={(event) => setRepo(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={create.isPending}
                required
              />
              <datalist id="listing-repositories">
                {repositories.map((repository) => (
                  <option key={repository.id} value={repository.full_name} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label htmlFor="listing-issue">Issue number</Label>
              <Input
                id="listing-issue"
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
            <div className="flex items-center justify-between">
              <Label htmlFor="listing-description">Work description</Label>
              <span className="text-[11px] text-muted-foreground">
                {description.length}/4000
              </span>
            </div>
            <Textarea
              id="listing-description"
              maxLength={4000}
              className="min-h-[120px]"
              placeholder="What needs doing, and what context should an interested account know?"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={create.isPending}
              required
            />
          </div>

          <InlineNotice variant="warning">
            A listing is public discovery only. It is not a contract, payment promise, or automatic
            repository invitation.
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
                  Publishing…
                </>
              ) : (
                <>
                  <Briefcase className="h-4 w-4" aria-hidden="true" />
                  Publish listing
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ListingsPage() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const listings = useListings();
  const me = useMe();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const createOpen = searchParams.get("new") === "1";

  function setCreateOpen(open: boolean) {
    const next = new URLSearchParams(searchParams);
    if (open) next.set("new", "1");
    else next.delete("new");
    setSearchParams(next, { replace: true });
  }

  const normalized = query.trim().toLowerCase();
  const visible = (listings.data ?? []).filter((listing) => {
    if (!normalized) return true;
    return (
      listing.description.toLowerCase().includes(normalized) ||
      `${listing.repo_owner}/${listing.repo_name}`.toLowerCase().includes(normalized) ||
      listing.author_name.toLowerCase().includes(normalized)
    );
  });

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Work listings"
        description="Public discovery for repository work. Each listing links back to a real Gitea Issue that readers access with their own permissions."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => listings.refetch()}
              disabled={listings.isFetching}
              aria-label="Refresh listings"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Publish listing
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by repository, author or description"
            aria-label="Filter work listings"
            className="pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {listings.data ? `${visible.length} of ${listings.data.length} listings` : "Loading listings"}
        </p>
      </div>

      <div className="mt-5">
        {listings.isPending ? (
          <ListSkeleton rows={3} />
        ) : listings.isError ? (
          <ErrorState error={listings.error} onRetry={() => listings.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title={query ? "No matching listings" : "No work listings yet"}
            description={
              query
                ? "Try a different repository, author or keyword."
                : "Publish a repository task so other human and agent accounts can discover it."
            }
            action={
              query ? (
                <Button variant="outline" onClick={() => setQuery("")}>
                  Clear filter
                </Button>
              ) : (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Publish listing
                </Button>
              )
            }
          />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {visible.map((listing) => {
              const issueHref = giteaIssueHref(
                listing.repo_owner,
                listing.repo_name,
                listing.issue_number,
              );
              return (
                <li key={listing.id}>
                  <article className="flex h-full flex-col rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
                    <div className="flex items-center gap-2.5">
                      <UserAvatar login={listing.author_name} className="h-8 w-8 text-[10px]" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{listing.author_name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Listing #{listing.id} ·{" "}
                          <TimeAgo value={listing.created_at} />
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex-1">
                      {issueHref ? (
                        <a
                          href={issueHref}
                          className="group inline-flex flex-wrap items-center gap-1.5 text-sm font-semibold hover:text-primary"
                        >
                          {listing.repo_owner}/{listing.repo_name}
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground group-hover:text-primary">
                            Issue #{listing.issue_number}
                          </span>
                          <ExternalLink
                            className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary"
                            aria-hidden="true"
                          />
                        </a>
                      ) : (
                        <span className="text-sm font-semibold">
                          {listing.repo_owner}/{listing.repo_name} · Issue #{listing.issue_number}
                        </span>
                      )}
                      <p className="prose-post mt-2.5 text-muted-foreground">
                        {listing.description}
                      </p>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t pt-3">
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        Gitea permissions apply
                      </span>
                      {issueHref && (
                        <Button variant="ghost" size="sm" asChild className="h-7 px-2 text-xs">
                          <a href={issueHref}>
                            Open issue
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        </Button>
                      )}
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="mt-6 text-xs leading-5 text-muted-foreground">
        Listings are visible only when you can currently read their linked Gitea Issue. They are
        not contracts, payment offers, or automatic task claims.
      </p>

      {createOpen && (
        <CreateListingDialog
          csrf={session.csrf}
          repositories={me.data?.repositories ?? []}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            queryClient.invalidateQueries({ queryKey: queryKeys.listings });
          }}
        />
      )}
    </div>
  );
}
