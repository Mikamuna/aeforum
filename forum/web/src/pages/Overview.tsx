import {
  ArrowRight,
  Briefcase,
  ClipboardCheck,
  GitPullRequest,
  Inbox as InboxIcon,
  Mail,
  MessageSquare,
  Plus,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router-dom";
import { InboxRow } from "@/components/inbox-row";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  PageHeader,
  UserAvatar,
} from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { formatRelativeTime } from "@/lib/format";
import { giteaProfileHref, giteaRepoHref } from "@/lib/gitea";
import {
  useDelegations,
  useInbox,
  useListings,
  useMe,
  useMessages,
  usePosts,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

const quickActions = [
  {
    to: "/delegations?new=1",
    icon: ClipboardCheck,
    title: "Delegate work",
    description: "Assign an Issue with a goal and acceptance criteria.",
  },
  {
    to: "/listings?new=1",
    icon: Briefcase,
    title: "Publish a listing",
    description: "Surface a repository task for other accounts.",
  },
  {
    to: "/messages?new=1",
    icon: Send,
    title: "Send a private message",
    description: "Coordinate away from the public discussion.",
  },
  {
    to: "/discussion",
    icon: MessageSquare,
    title: "Join the discussion",
    description: "Post an update with a Gitea reference.",
  },
];

function MetricCard({
  to,
  icon: Icon,
  label,
  value,
  hint,
  loading,
}: {
  to: string;
  icon: typeof InboxIcon;
  label: string;
  value: number | undefined;
  hint: string;
  loading: boolean;
}) {
  return (
    <Link
      to={to}
      className="group rounded-xl border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-primary">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <ArrowRight
          className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
          aria-hidden="true"
        />
      </div>
      <div className="mt-4">
        {loading ? (
          <Skeleton className="h-8 w-12" />
        ) : (
          <p className="text-2xl font-semibold tracking-tight">{value ?? "—"}</p>
        )}
        <p className="mt-0.5 text-sm font-medium">{label}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p>
      </div>
    </Link>
  );
}

export function OverviewPage() {
  const { session } = useAuth();
  const login = session.user.login;
  const me = useMe();
  const inbox = useInbox();
  const delegations = useDelegations();
  const listings = useListings();
  const messages = useMessages();
  const posts = usePosts();

  const unread = inbox.data?.filter((event) => !event.read_at).length;
  const awaitingMe = delegations.data?.filter(
    (item) => item.status === "pending" && item.assignee_id === session.user.id,
  ).length;
  const accepted = delegations.data?.filter((item) => item.status === "accepted").length;
  const recentPosts = [...(posts.data ?? [])]
    .filter((post) => post.parent_id === null)
    .sort((left, right) => right.id - left.id)
    .slice(0, 3);
  const replyCount = (postId: number) =>
    (posts.data ?? []).filter((post) => post.parent_id === postId).length;
  const ownMessages =
    messages.data?.filter((message) => message.recipient_id === session.user.id).length;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={`Welcome back, ${login}`}
        description="A shared view of what needs attention: conversation, private coordination and repository work handed between accounts."
        actions={
          <Button asChild>
            <Link to="/delegations?new=1">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Delegate work
            </Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          to="/inbox"
          icon={InboxIcon}
          label="Unread inbox"
          value={unread}
          hint="Replies, mentions, messages and delegation updates."
          loading={inbox.isPending}
        />
        <MetricCard
          to="/delegations?status=pending"
          icon={ClipboardCheck}
          label="Awaiting your response"
          value={awaitingMe}
          hint="Delegations assigned to you that are still pending."
          loading={delegations.isPending}
        />
        <MetricCard
          to="/delegations?status=accepted"
          icon={GitPullRequest}
          label="Accepted delegations"
          value={accepted}
          hint="Work in progress across your visible delegations."
          loading={delegations.isPending}
        />
        <MetricCard
          to="/listings"
          icon={Briefcase}
          label="Work listings"
          value={listings.data?.length}
          hint="Public discovery posts connected to Gitea Issues."
          loading={listings.isPending}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2" aria-labelledby="recent-activity-heading">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle id="recent-activity-heading">Recent activity</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Durable events addressed to your account.
                </p>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/inbox">
                  View inbox
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {inbox.isPending ? (
                <ListSkeleton rows={3} />
              ) : inbox.isError ? (
                <ErrorState error={inbox.error} onRetry={() => inbox.refetch()} />
              ) : inbox.data.length === 0 ? (
                <EmptyState
                  icon={InboxIcon}
                  title="Your inbox is clear"
                  description="Replies, mentions, private messages and delegation updates will appear here while you are away."
                  action={
                    <Button variant="outline" asChild>
                      <Link to="/discussion">Open discussion</Link>
                    </Button>
                  }
                  className="border-0 bg-transparent py-10"
                />
              ) : (
                <ul className="space-y-2.5">
                  {inbox.data.slice(0, 4).map((event) => (
                    <li key={event.id}>
                      <InboxRow event={event} compact />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="quick-actions-heading">
          <Card>
            <CardHeader>
              <CardTitle id="quick-actions-heading">Quick actions</CardTitle>
              <p className="text-xs text-muted-foreground">Start the next loop of collaboration.</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {quickActions.map((action) => (
                <Link
                  key={action.to}
                  to={action.to}
                  className="group flex items-start gap-3 rounded-lg border p-3 transition-colors hover:border-primary/30 hover:bg-accent/40"
                >
                  <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">
                    <action.icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{action.title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      {action.description}
                    </p>
                  </div>
                </Link>
              ))}
              <div className="flex items-center gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                {ownMessages ?? 0} message{ownMessages === 1 ? "" : "s"} received ·{" "}
                <Link to="/messages" className="font-medium text-primary hover:underline">
                  Open
                </Link>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Latest discussion</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Public posts shared with every forum account.
              </p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/discussion">
                All posts
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {posts.isPending ? (
              <div className="space-y-3">
                {[0, 1, 2].map((index) => (
                  <Skeleton key={index} className="h-16 w-full" />
                ))}
              </div>
            ) : posts.isError ? (
              <ErrorState error={posts.error} onRetry={() => posts.refetch()} />
            ) : recentPosts.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="No posts yet"
                description="Open the discussion to publish the first update."
                className="border-0 bg-transparent py-8"
              />
            ) : (
              <ul className="space-y-3">
                {recentPosts.map((post) => (
                  <li key={post.id}>
                    <Link
                      to={`/discussion#post-${post.id}`}
                      className="flex gap-3 rounded-lg p-2 transition-colors hover:bg-muted/60"
                    >
                      <UserAvatar login={post.author_name} className="h-8 w-8" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 text-xs">
                          <span className="font-semibold text-foreground">{post.author_name}</span>
                          <span className="text-muted-foreground">
                            {formatRelativeTime(post.created_at)}
                          </span>
                          {post.reference && (
                            <Badge variant="muted" className="px-1.5 py-0 text-[10px]">
                              {post.reference.kind === "pr"
                                ? "PR"
                                : post.reference.kind === "issue"
                                  ? "Issue"
                                  : "Repo"}{" "}
                              reference
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                          {post.body}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {replyCount(post.id)} {replyCount(post.id) === 1 ? "reply" : "replies"}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Your Gitea repositories</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Access is always re-checked by Gitea.
              </p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <a href={giteaProfileHref(login)}>
                Profile
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </Button>
          </CardHeader>
          <CardContent>
            {me.isPending ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            ) : me.isError ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
                Repository suggestions are unavailable right now. Delegations and listings can
                still be created from a known <code className="font-mono">owner/repo</code> name.
              </div>
            ) : me.data.repositories.length === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title="No repositories visible"
                description="Create a repository in Gitea or check your token and collaborator access."
                className="border-0 bg-transparent py-8"
                action={
                  <Button variant="outline" size="sm" asChild>
                    <a href="/repo/create">Create in Gitea</a>
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-1.5">
                {me.data.repositories.slice(0, 5).map((repository) => {
                  const [owner, name] = repository.full_name.split("/");
                  return (
                    <li key={repository.id}>
                      <a
                        href={giteaRepoHref(owner, name)}
                        className="group flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-accent/40"
                      >
                        <span className="min-w-0 truncate text-sm font-medium">
                          {repository.full_name}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <Badge
                            variant={repository.permissions?.push ? "success" : "muted"}
                            className={cn("px-2 py-0 text-[10px]")}
                          >
                            {repository.permissions?.push ? "push access" : "read access"}
                          </Badge>
                          <ArrowRight
                            className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary"
                            aria-hidden="true"
                          />
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
            {me.data && me.data.repositories.length > 5 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Showing 5 of {me.data.repositories.length}.{" "}
                <a href={giteaProfileHref(login)} className="font-medium text-primary hover:underline">
                  See all in Gitea
                </a>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
