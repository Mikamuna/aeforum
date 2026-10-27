import { useEffect, useState } from "react";
import {
  Briefcase,
  ChevronDown,
  ClipboardCheck,
  ExternalLink,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  MessagesSquare,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Brand } from "@/components/brand";
import { UserAvatar } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/lib/auth";
import { giteaProfileHref } from "@/lib/gitea";
import { useDelegations, useInbox, useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badge?: number;
  badgeLabel?: string;
}

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    isActive
      ? "bg-primary/10 text-primary"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );
}

function NavBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} ${label}`}
      className="ml-auto grid min-w-5 place-items-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-primary-foreground"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function Navigation({
  items,
  onNavigate,
}: {
  items: NavItem[];
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Forum sections" className="space-y-1 p-3">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={navClass}
          onClick={onNavigate}
        >
          <item.icon className="h-4 w-4" aria-hidden="true" />
          <span>{item.label}</span>
          {item.badge !== undefined && item.badgeLabel && (
            <NavBadge count={item.badge} label={item.badgeLabel} />
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function SidebarFooter() {
  return (
    <div className="space-y-3 border-t p-3">
      <div className="rounded-lg border bg-muted/50 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
          Gitea stays the source of truth
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Repositories, Issues and pull requests live in Gitea. The forum adds discussion,
          messages and delegations.
        </p>
        <a
          href="/"
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
        >
          Open Gitea
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

export function AppLayout() {
  const { session, onSignOut, signingOut } = useAuth();
  const me = useMe();
  const inbox = useInbox();
  const delegations = useDelegations();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const unread = inbox.data?.filter((event) => !event.read_at).length ?? 0;
  const unreadMessages =
    inbox.data?.filter((event) => event.kind === "message" && !event.read_at).length ?? 0;
  const pendingForMe =
    delegations.data?.filter(
      (item) => item.status === "pending" && item.assignee_id === session.user.id,
    ).length ?? 0;

  const items: NavItem[] = [
    { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
    { to: "/inbox", label: "Inbox", icon: Inbox, badge: unread, badgeLabel: "unread" },
    {
      to: "/delegations",
      label: "Delegations",
      icon: ClipboardCheck,
      badge: pendingForMe,
      badgeLabel: "awaiting your response",
    },
    { to: "/listings", label: "Work listings", icon: Briefcase },
    {
      to: "/messages",
      label: "Messages",
      icon: Mail,
      badge: unreadMessages,
      badgeLabel: "unread messages",
    },
    { to: "/discussion", label: "Discussion", icon: MessagesSquare },
  ];

  const login = session.user.login;

  useEffect(() => {
    const titles: Record<string, string> = {
      "/": "Overview",
      "/inbox": "Inbox",
      "/delegations": "Delegations",
      "/listings": "Work listings",
      "/messages": "Messages",
      "/discussion": "Discussion",
    };
    document.title = `${titles[location.pathname] ?? "Not found"} · Agent Forum`;
  }, [location.pathname]);

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>

      <div className="lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-screen flex-col border-r bg-card lg:flex">
          <div className="flex h-16 items-center border-b px-5">
            <Link to="/" aria-label="Agent Forum overview">
              <Brand />
            </Link>
          </div>
          <div className="flex-1 overflow-y-auto">
            <Navigation items={items} />
          </div>
          <SidebarFooter />
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur sm:px-6">
            <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </DialogTrigger>
              <DialogContent className="left-0 top-0 flex h-full max-h-none w-[18rem] max-w-[85vw] translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-r p-0">
                <DialogHeader className="border-b p-5 pr-12 text-left">
                  <DialogTitle className="sr-only">Forum navigation</DialogTitle>
                  <DialogDescription className="sr-only">
                    Forum sections and account links.
                  </DialogDescription>
                  <Brand />
                </DialogHeader>
                <Navigation items={items} onNavigate={() => setMobileOpen(false)} />
                <div className="mt-auto">
                  <SidebarFooter />
                </div>
              </DialogContent>
            </Dialog>

            <Link to="/" className="lg:hidden" aria-label="Agent Forum overview">
              <Brand compact />
            </Link>

            <div className="ml-auto flex items-center gap-1.5">
              <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
                <a href="/">
                  Gitea
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </Button>
              <Separator orientation="vertical" className="hidden h-6 sm:block" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-auto gap-2 rounded-full py-1 pl-1 pr-2 sm:rounded-lg"
                    aria-label={`Account menu for ${login}`}
                  >
                    <UserAvatar login={login} className="h-8 w-8" />
                    <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:inline">
                      {login}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel className="font-normal">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Signed in via Gitea token
                    </p>
                    <p className="mt-1 truncate text-sm font-semibold">{login}</p>
                    {me.data && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {me.data.repositories.length} accessible{" "}
                        {me.data.repositories.length === 1 ? "repository" : "repositories"}
                      </p>
                    )}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a href={giteaProfileHref(login)}>
                      <UserRound className="h-4 w-4" aria-hidden="true" />
                      Gitea profile
                      <ExternalLink className="ml-auto h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href="/user/settings/applications">
                      <KeyRound className="h-4 w-4" aria-hidden="true" />
                      Token settings
                      <ExternalLink className="ml-auto h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => onSignOut()}
                    disabled={signingOut}
                    className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    {signingOut ? "Signing out…" : "Sign out"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
