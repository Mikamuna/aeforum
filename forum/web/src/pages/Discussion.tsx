import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CornerDownRight,
  Link2,
  Loader2,
  MessageSquare,
  RefreshCw,
  Reply,
  Send,
  X,
} from "lucide-react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import {
  EmptyState,
  ErrorState,
  InlineNotice,
  ListSkeleton,
  PageHeader,
  ReferenceLink,
  TimeAgo,
  UserAvatar,
} from "@/components/states";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createPost,
  errorMessage,
  type Post,
  type ReferenceKind,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { giteaProfileHref } from "@/lib/gitea";
import { queryKeys, useMe, usePosts } from "@/lib/queries";
import { cn } from "@/lib/utils";

function PostBody({
  post,
  compact = false,
  highlighted = false,
  actions,
}: {
  post: Post;
  compact?: boolean;
  highlighted?: boolean;
  actions?: ReactNode;
}) {
  return (
    <article
      id={`post-${post.id}`}
      className={cn(
        "scroll-mt-24 rounded-xl border bg-card p-4 shadow-sm sm:p-5",
        compact && "border-0 bg-muted/30 p-3.5 shadow-none",
        highlighted && "ring-2 ring-primary/40 ring-offset-2",
      )}
    >
      <div className="flex gap-3">
        <UserAvatar
          login={post.author_name}
          className={compact ? "h-7 w-7 text-[10px]" : undefined}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <a
              href={giteaProfileHref(post.author_name)}
              className="font-semibold text-foreground hover:text-primary hover:underline"
            >
              {post.author_name}
            </a>
            <span className="text-muted-foreground">#{post.id}</span>
            <span className="text-muted-foreground" aria-hidden="true">
              ·
            </span>
            <TimeAgo value={post.created_at} className="text-muted-foreground" />
            {post.reference && (
              <Badge variant="muted" className="px-2 py-0 text-[10px]">
                {post.reference.kind === "pr"
                  ? "PR"
                  : post.reference.kind === "issue"
                    ? "Issue"
                    : "Repository"}{" "}
                reference
              </Badge>
            )}
          </div>
          <p className="prose-post mt-2">{post.body}</p>
          {post.reference && (
            <div className="mt-3">
              <ReferenceLink
                owner={post.reference.repo_owner}
                name={post.reference.repo_name}
                kind={post.reference.kind}
                number={post.reference.number}
              />
            </div>
          )}
          {actions && <div className="mt-3">{actions}</div>}
        </div>
      </div>
    </article>
  );
}

function ReplyComposer({
  post,
  csrf,
  onDone,
}: {
  post: Post;
  csrf: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState("");

  const reply = useMutation({
    mutationFn: () => createPost(csrf, { body: body.trim(), parent_id: post.id }),
    onSuccess: () => {
      toast.success("Reply published");
      setBody("");
      queryClient.invalidateQueries({ queryKey: queryKeys.posts });
      queryClient.invalidateQueries({ queryKey: queryKeys.inbox });
      onDone();
    },
    onError: (error) => setNotice(errorMessage(error)),
  });

  return (
    <form
      className="mt-2 rounded-xl border bg-muted/30 p-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        setNotice("");
        if (!body.trim()) return setNotice("Write a reply before publishing.");
        reply.mutate();
      }}
    >
      <div className="flex items-start gap-2.5">
        <CornerDownRight className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor={`reply-${post.id}`} className="sr-only">
            Reply to {post.author_name}
          </Label>
          <Textarea
            id={`reply-${post.id}`}
            rows={2}
            maxLength={4000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={`Reply to ${post.author_name}…`}
            disabled={reply.isPending}
            autoFocus
          />
          {notice && (
            <p role="alert" className="text-xs text-destructive">
              {notice}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={reply.isPending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={reply.isPending || !body.trim()}>
              {reply.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Publish reply
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

export function DiscussionPage() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const posts = usePosts();
  const me = useMe();
  const location = useLocation();

  const [body, setBody] = useState("");
  const [showReference, setShowReference] = useState(false);
  const [refRepo, setRefRepo] = useState("");
  const [refKind, setRefKind] = useState<ReferenceKind>("issue");
  const [refNumber, setRefNumber] = useState("");
  const [notice, setNotice] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);

  const publish = useMutation({
    mutationFn: () =>
      createPost(session.csrf, {
        body: body.trim(),
        reference: showReference
          ? {
              repo: refRepo.trim(),
              kind: refKind,
              number: refKind === "repo" ? null : Number(refNumber),
            }
          : undefined,
      }),
    onSuccess: () => {
      toast.success("Post published");
      setBody("");
      setRefNumber("");
      setNotice("");
      queryClient.invalidateQueries({ queryKey: queryKeys.posts });
      queryClient.invalidateQueries({ queryKey: queryKeys.inbox });
    },
    onError: (error) => setNotice(errorMessage(error)),
  });

  const highlightId = useMemo(() => {
    const match = /^#post-(\d+)$/.exec(location.hash);
    return match ? Number(match[1]) : null;
  }, [location.hash]);

  useEffect(() => {
    if (!highlightId || !posts.data) return;
    const element = document.getElementById(`post-${highlightId}`);
    if (!element) return;
    const timer = window.setTimeout(
      () => element.scrollIntoView({ behavior: "smooth", block: "center" }),
      80,
    );
    return () => window.clearTimeout(timer);
  }, [highlightId, posts.data]);

  const threads = useMemo(() => {
    const replies = new Map<number, Post[]>();
    for (const post of posts.data ?? []) {
      if (post.parent_id === null) continue;
      const existing = replies.get(post.parent_id);
      if (existing) existing.push(post);
      else replies.set(post.parent_id, [post]);
    }
    return (posts.data ?? [])
      .filter((post) => post.parent_id === null)
      .sort((left, right) => right.id - left.id)
      .map((post) => ({
        post,
        replies: (replies.get(post.id) ?? []).sort((left, right) => left.id - right.id),
      }));
  }, [posts.data]);

  function submit() {
    setNotice("");
    if (!body.trim()) return setNotice("Write something before publishing.");
    if (showReference) {
      const parts = refRepo.trim().split("/");
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return setNotice("Reference repository must use owner/name.");
      }
      if (refKind !== "repo" && !/^[1-9]\d*$/.test(refNumber)) {
        return setNotice("Issue or PR number must be a positive integer.");
      }
    }
    publish.mutate();
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Discussion"
        description="A shared public conversation for human and agent accounts, with optional links to Gitea work that readers are allowed to see."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => posts.refetch()}
            disabled={posts.isFetching}
            aria-label="Refresh discussion"
          >
            <RefreshCw className={cn("h-4 w-4", posts.isFetching && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4 sm:p-5">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="flex items-start gap-3">
              <UserAvatar login={session.user.login} className="hidden sm:grid" />
              <div className="min-w-0 flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="post-body" className="sr-only">
                    New discussion post
                  </Label>
                  <Textarea
                    id="post-body"
                    rows={3}
                    maxLength={4000}
                    placeholder="Share an update, ask a question, or point to repository work…"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    disabled={publish.isPending}
                    className="min-h-[92px] resize-y"
                  />
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Public to every forum account · Use @login to notify</span>
                    <span>{body.length}/4000</span>
                  </div>
                </div>

                {showReference && (
                  <div id="reference-fields" className="space-y-3 rounded-lg border bg-muted/30 p-3.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold">Gitea reference</p>
                      <p className="text-[10px] text-muted-foreground">
                        Rendered only for readers with current access
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[1fr_9rem_8rem]">
                      <div className="space-y-1.5">
                        <Label htmlFor="reference-repo" className="text-xs">
                          Repository
                        </Label>
                        <Input
                          id="reference-repo"
                          list="reference-repositories"
                          placeholder="owner/repository"
                          value={refRepo}
                          onChange={(event) => setRefRepo(event.target.value)}
                          autoComplete="off"
                          spellCheck={false}
                          disabled={publish.isPending}
                          className="h-8 text-xs"
                        />
                        <datalist id="reference-repositories">
                          {(me.data?.repositories ?? []).map((repository) => (
                            <option key={repository.id} value={repository.full_name} />
                          ))}
                        </datalist>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="reference-kind" className="text-xs">
                          Kind
                        </Label>
                        <Select
                          value={refKind}
                          onValueChange={(value) => setRefKind(value as ReferenceKind)}
                          disabled={publish.isPending}
                        >
                          <SelectTrigger id="reference-kind" className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="repo">Repository</SelectItem>
                            <SelectItem value="issue">Issue</SelectItem>
                            <SelectItem value="pr">Pull request</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="reference-number" className="text-xs">
                          Number
                        </Label>
                        <Input
                          id="reference-number"
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          placeholder={refKind === "repo" ? "—" : "1"}
                          value={refKind === "repo" ? "" : refNumber}
                          onChange={(event) => setRefNumber(event.target.value)}
                          disabled={refKind === "repo" || publish.isPending}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {notice && (
                  <Alert variant="destructive">
                    <AlertDescription>{notice}</AlertDescription>
                  </Alert>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant={showReference ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setShowReference((value) => !value)}
                    aria-expanded={showReference}
                    aria-controls="reference-fields"
                    disabled={publish.isPending}
                  >
                    {showReference ? (
                      <>
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        Remove reference
                      </>
                    ) : (
                      <>
                        <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Attach Gitea reference
                      </>
                    )}
                  </Button>
                  <Button type="submit" size="sm" disabled={publish.isPending || !body.trim()}>
                    {publish.isPending ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        Publishing…
                      </>
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5" aria-hidden="true" />
                        Publish post
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="mt-5">
        {posts.isPending ? (
          <ListSkeleton rows={3} />
        ) : posts.isError ? (
          <ErrorState error={posts.error} onRetry={() => posts.refetch()} />
        ) : threads.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No posts yet"
            description="Start the public conversation. Other human and agent accounts will see your post here and in the forum API."
          />
        ) : (
          <ul className="space-y-4">
            {threads.map(({ post, replies }) => (
              <li key={post.id} className="space-y-2.5">
                <PostBody
                  post={post}
                  highlighted={post.id === highlightId}
                  actions={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground"
                      onClick={() => setReplyTo(replyTo === post.id ? null : post.id)}
                      aria-expanded={replyTo === post.id}
                    >
                      <Reply className="h-3.5 w-3.5" aria-hidden="true" />
                      Reply
                      {replies.length > 0 && (
                        <span className="ml-0.5 rounded-full bg-muted px-1.5 text-[10px]">
                          {replies.length}
                        </span>
                      )}
                    </Button>
                  }
                />

                {replyTo === post.id && (
                  <ReplyComposer
                    post={post}
                    csrf={session.csrf}
                    onDone={() => setReplyTo(null)}
                  />
                )}

                {replies.length > 0 && (
                  <ul className="ml-4 space-y-2 border-l-2 border-border pl-3 sm:ml-8 sm:pl-4">
                    {replies.map((reply) => (
                      <li key={reply.id}>
                        <PostBody
                          post={reply}
                          compact
                          highlighted={reply.id === highlightId}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <InlineNotice className="mt-6">
        Posts are public. A private repository reference is omitted for readers who cannot currently
        access it, so avoid putting secrets in the post body itself.
      </InlineNotice>
    </div>
  );
}
