import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { toast, Toaster } from "sonner";
import { Brand } from "@/components/brand";
import { AppLayout } from "@/components/layout";
import { ErrorState } from "@/components/states";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError, errorMessage, getSession, signOut, type Session } from "@/lib/api";
import { AuthContext } from "@/lib/auth";
import { queryKeys } from "@/lib/queries";
import { DelegationsPage } from "@/pages/Delegations";
import { DiscussionPage } from "@/pages/Discussion";
import { InboxPage } from "@/pages/Inbox";
import { ListingsPage } from "@/pages/Listings";
import { LoginPage } from "@/pages/Login";
import { MessagesPage } from "@/pages/Messages";
import { NotFoundPage } from "@/pages/NotFound";
import { OverviewPage } from "@/pages/Overview";

function BootScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-6">
      <Brand />
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Checking your forum session…
      </p>
    </div>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: queryKeys.session,
    queryFn: getSession,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });

  const logout = useMutation({
    mutationFn: (session: Session) => signOut(session.csrf),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.session, null);
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== queryKeys.session[0],
      });
      toast.success("Signed out of the forum");
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) return;
      toast.error("Could not sign out", { description: errorMessage(error) });
    },
  });

  if (sessionQuery.isPending) return <BootScreen />;

  if (sessionQuery.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6">
        <Brand />
        <div className="w-full max-w-md">
          <ErrorState
            error={sessionQuery.error}
            onRetry={() => sessionQuery.refetch()}
          />
          <p className="mt-3 text-center text-xs text-muted-foreground">
            The forum backend may still be starting. Check that the forum service is healthy, then
            retry.
          </p>
        </div>
      </div>
    );
  }

  if (!sessionQuery.data) {
    return (
      <>
        <LoginPage
          onSignedIn={(session) => {
            queryClient.setQueryData(queryKeys.session, session);
            queryClient.invalidateQueries({ queryKey: queryKeys.me });
          }}
        />
        <Toaster richColors closeButton position="bottom-right" />
      </>
    );
  }

  const session = sessionQuery.data;

  return (
    <AuthContext.Provider
      value={{
        session,
        onSignOut: () => logout.mutate(session),
        signingOut: logout.isPending,
      }}
    >
      <BrowserRouter basename="/forum">
        <TooltipProvider delayDuration={250}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<OverviewPage />} />
              <Route path="inbox" element={<InboxPage />} />
              <Route path="delegations" element={<DelegationsPage />} />
              <Route path="listings" element={<ListingsPage />} />
              <Route path="messages" element={<MessagesPage />} />
              <Route path="discussion" element={<DiscussionPage />} />
              <Route path="login" element={<Navigate to="/" replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </TooltipProvider>
      </BrowserRouter>
      <Toaster richColors closeButton position="bottom-right" />
    </AuthContext.Provider>
  );
}
