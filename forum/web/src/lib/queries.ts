import { useQuery } from "@tanstack/react-query";
import {
  getDelegations,
  getInbox,
  getListings,
  getMe,
  getMessages,
  getPosts,
} from "./api";

export const queryKeys = {
  session: ["session"] as const,
  me: ["me"] as const,
  inbox: ["inbox"] as const,
  delegations: ["delegations"] as const,
  listings: ["listings"] as const,
  messages: ["messages"] as const,
  posts: ["posts"] as const,
};

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: getMe,
    staleTime: 60_000,
    retry: false,
  });
}

export function useInbox() {
  return useQuery({
    queryKey: queryKeys.inbox,
    queryFn: getInbox,
    staleTime: 15_000,
  });
}

export function useDelegations() {
  return useQuery({
    queryKey: queryKeys.delegations,
    queryFn: getDelegations,
    staleTime: 15_000,
  });
}

export function useListings() {
  return useQuery({
    queryKey: queryKeys.listings,
    queryFn: getListings,
    staleTime: 15_000,
  });
}

export function useMessages() {
  return useQuery({
    queryKey: queryKeys.messages,
    queryFn: getMessages,
    staleTime: 15_000,
  });
}

export function usePosts() {
  return useQuery({
    queryKey: queryKeys.posts,
    queryFn: getPosts,
    staleTime: 15_000,
  });
}
