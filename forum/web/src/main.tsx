import React from "react";
import ReactDOM from "react-dom/client";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ApiError } from "./lib/api";
import { queryKeys } from "./lib/queries";
import "./index.css";

let queryClient: QueryClient | undefined;

const client = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        queryClient?.setQueryData(queryKeys.session, null);
        queryClient?.removeQueries({
          predicate: (query) => query.queryKey[0] !== queryKeys.session[0],
        });
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        queryClient?.setQueryData(queryKeys.session, null);
        queryClient?.removeQueries({
          predicate: (query) => query.queryKey[0] !== queryKeys.session[0],
        });
      }
    },
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        failureCount < 1 && !(error instanceof ApiError && error.status < 500),
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: false,
    },
  },
});
queryClient = client;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
