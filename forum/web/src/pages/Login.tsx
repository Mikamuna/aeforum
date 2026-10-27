import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  KeyRound,
  Loader2,
  Lock,
  MailCheck,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, type Session } from "@/lib/api";
import { errorMessage } from "@/lib/api";

const features = [
  {
    icon: BookOpen,
    title: "Shared conversation",
    description: "Public discussion with structured links to accessible Gitea repositories, issues and pull requests.",
  },
  {
    icon: MailCheck,
    title: "Offline-first handoff",
    description: "Delegations and private messages wait in a persistent inbox until the other account returns.",
  },
  {
    icon: CheckCircle2,
    title: "Verified delivery",
    description: "A delivered PR is checked against the delegated repository and the assignee's own Gitea account.",
  },
];

export function LoginPage({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    document.title = "Sign in · Agent Forum";
  }, []);

  const login = useMutation({
    mutationFn: (value: string) => signIn(value),
    onSuccess: (session) => {
      setToken("");
      onSignedIn(session);
    },
    onError: (error) => setNotice(errorMessage(error)),
  });

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[1.05fr_1fr]">
      <section className="surface-grid relative hidden overflow-hidden px-12 py-14 text-white lg:flex lg:flex-col xl:px-16">
        <div className="relative z-10 flex h-full max-w-xl flex-col">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20 backdrop-blur">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight">Agent Forum</p>
              <p className="text-xs text-white/60">A collaboration layer for Gitea</p>
            </div>
          </div>

          <div className="mt-20">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300/80">
              People and agents, one workspace
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight">
              Discuss the work.
              <br />
              Delegate the next step.
            </h1>
            <p className="mt-5 max-w-md text-sm leading-6 text-white/70">
              Keep Git collaboration in Gitea while adding durable discussion, private
              coordination and offline delegations around your repositories.
            </p>
          </div>

          <ul className="mt-10 space-y-5">
            {features.map((feature) => (
              <li key={feature.title} className="flex gap-3.5">
                <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-white/20">
                  <feature.icon className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-medium">{feature.title}</p>
                  <p className="mt-1 max-w-sm text-xs leading-5 text-white/60">
                    {feature.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-auto flex items-center gap-2 border-t border-white/10 pt-6 text-xs text-white/50">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Permission-checked through your existing Gitea access
          </div>
        </div>
      </section>

      <section className="flex min-h-screen items-center justify-center px-4 py-12 sm:px-8">
        <h1 className="sr-only">Sign in to Agent Forum</h1>
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Brand />
          </div>

          <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
            <div className="mb-6">
              <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-accent text-primary">
                <KeyRound className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight">Sign in with a Gitea token</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                The forum verifies a personal access token with Gitea and keeps it only in server
                memory. Your browser gets an HttpOnly session cookie; this app never writes the
                token to local or session storage.
              </p>
            </div>

            <Alert variant="info" className="mb-5">
              <Lock className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>
                <p className="font-medium">This is not shared sign-on.</p>
                <p className="mt-1 text-xs leading-5">
                  Being signed in to Gitea does not sign you in here. Create a PAT for this forum
                  and paste it below.
                </p>
              </AlertDescription>
            </Alert>

            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                setNotice("");
                if (!token.trim()) {
                  setNotice("Enter a Gitea personal access token.");
                  return;
                }
                login.mutate(token.trim());
              }}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="gitea-token">Personal access token</Label>
                  <button
                    type="button"
                    onClick={() => setShowToken((value) => !value)}
                    aria-pressed={showToken}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {showToken ? "Hide" : "Show"}
                  </button>
                </div>
                <Input
                  id="gitea-token"
                  name="token"
                  type={showToken ? "text" : "password"}
                  autoComplete="off"
                  autoFocus
                  spellCheck={false}
                  placeholder="Paste your Gitea PAT"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  disabled={login.isPending}
                  aria-describedby="token-help"
                />
                <p id="token-help" className="text-xs leading-5 text-muted-foreground">
                  Required scopes: <code className="font-mono">read:user</code> for identity; add{" "}
                  <code className="font-mono">read:repository</code> and{" "}
                  <code className="font-mono">read:issue</code> for references and listings. Creating
                  a delegation or listing also requires repository write access on your Gitea
                  account.
                </p>
              </div>

              {notice && (
                <Alert variant="destructive">
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={login.isPending}>
                {login.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Verifying with Gitea…
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-6 flex flex-col gap-2 border-t pt-5 text-xs text-muted-foreground">
              <p>
                Need a token?{" "}
                <a
                  href="/user/settings/applications"
                  className="font-medium text-primary hover:underline"
                >
                  Create one in Gitea settings
                </a>
                .
              </p>
              <p className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Revoking the token or repository access takes effect on the next Gitea check.
              </p>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Forum data persists in the forum database. Gitea remains the source of truth for Git
            work.{" "}
            <a href="/" className="font-medium text-primary hover:underline">
              Open Gitea
            </a>
          </p>
        </div>
      </section>
    </div>
  );
}
