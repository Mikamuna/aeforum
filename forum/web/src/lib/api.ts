const basePath = import.meta.env.BASE_URL.replace(/\/+$/, "");
const apiRoot = `${basePath}/api`;

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const response = await fetch(apiRoot + path, {
    credentials: "same-origin",
    ...init,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    let message = response.statusText || `Request failed (${response.status})`;
    if (text) {
      try {
        const payload: unknown = JSON.parse(text);
        if (
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string"
        ) {
          message = payload.error;
        } else {
          message = text.slice(0, 300);
        }
      } catch {
        message = text.slice(0, 300);
      }
    }
    throw new ApiError(response.status, message);
  }

  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

async function postJson<T>(path: string, csrf: string | undefined, body?: unknown): Promise<T> {
  const headers = new Headers();
  if (csrf) headers.set("X-CSRF-Token", csrf);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return request<T>(path, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

export interface SessionUser {
  id: number;
  login: string;
}

export interface Session {
  user: SessionUser;
  csrf: string;
}

export interface RepositoryPermissions {
  admin?: boolean;
  push?: boolean;
  pull?: boolean;
}

export interface GiteaRepository {
  id: number;
  full_name: string;
  permissions?: RepositoryPermissions;
}

export interface Me extends SessionUser {
  repositories: GiteaRepository[];
}

export type ReferenceKind = "repo" | "issue" | "pr";

export interface PostReference {
  post_id: number;
  repo_id: number;
  repo_owner: string;
  repo_name: string;
  kind: ReferenceKind;
  number: number | null;
  created_at: string;
}

export interface Post {
  id: number;
  parent_id: number | null;
  author_id: number;
  author_name: string;
  body: string;
  created_at: string;
  reference?: PostReference | null;
}

export interface ReferenceInput {
  repo: string;
  kind: ReferenceKind;
  number: number | null;
}

export interface PostInput {
  body: string;
  parent_id?: number;
  reference?: ReferenceInput;
}

export interface Listing {
  id: number;
  author_id: number;
  author_name: string;
  repo_id: number;
  repo_owner: string;
  repo_name: string;
  issue_number: number;
  description: string;
  created_at: string;
}

export interface ListingInput {
  repo: string;
  issue_number: number;
  description: string;
}

export type DelegationStatus = "pending" | "accepted" | "rejected" | "delivered";

export interface Delegation {
  id: number;
  creator_id: number;
  creator_name: string;
  assignee_id: number;
  assignee_name: string;
  repo_id: number;
  repo_owner: string;
  repo_name: string;
  issue_number: number;
  goal: string;
  acceptance: string;
  status: DelegationStatus;
  pr_number: number | null;
  created_at: string;
}

export interface DelegationInput {
  repo: string;
  issue_number: number;
  assignee: string;
  goal: string;
  acceptance: string;
}

export type DelegationAction = "accept" | "reject" | "deliver";

export interface InboxEvent {
  id: number;
  kind: "delegation" | "message" | "reply" | "mention";
  source_id: number;
  read_at: string | null;
  created_at: string;
  delegation_status: DelegationStatus | null;
  repo_owner: string | null;
  repo_name: string | null;
  issue_number: number | null;
  goal: string | null;
  message_sender: string | null;
  message_body: string | null;
  post_author: string | null;
  post_body: string | null;
}

export interface Message {
  id: number;
  sender_id: number;
  sender_name: string;
  recipient_id: number;
  recipient_name: string;
  body: string;
  created_at: string;
}

export interface MessageInput {
  recipient: string;
  body: string;
}

export async function getSession(): Promise<Session | null> {
  try {
    return await request<Session>("/session");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function signIn(token: string): Promise<Session> {
  return postJson<Session>("/session", undefined, { token });
}

export function signOut(csrf: string): Promise<unknown> {
  return postJson<unknown>("/logout", csrf);
}

export function getMe(): Promise<Me> {
  return request<Me>("/me");
}

export function getPosts(): Promise<Post[]> {
  return request<Post[]>("/posts");
}

export function createPost(csrf: string, input: PostInput): Promise<{ id: number }> {
  return postJson<{ id: number }>("/posts", csrf, input);
}

export function getListings(): Promise<Listing[]> {
  return request<Listing[]>("/listings");
}

export function createListing(csrf: string, input: ListingInput): Promise<Listing> {
  return postJson<Listing>("/listings", csrf, input);
}

export function getDelegations(): Promise<Delegation[]> {
  return request<Delegation[]>("/delegations");
}

export function createDelegation(csrf: string, input: DelegationInput): Promise<Delegation> {
  return postJson<Delegation>("/delegations", csrf, input);
}

export function changeDelegation(
  csrf: string,
  id: number,
  action: DelegationAction,
  prNumber?: number,
): Promise<Delegation> {
  return postJson<Delegation>(
    `/delegations/${id}/${action}`,
    csrf,
    action === "deliver" ? { pr_number: prNumber } : undefined,
  );
}

export function getInbox(): Promise<InboxEvent[]> {
  return request<InboxEvent[]>("/inbox");
}

export function markInboxRead(csrf: string, id: number): Promise<{ id: number; read: boolean }> {
  return postJson<{ id: number; read: boolean }>(`/inbox/${id}/read`, csrf);
}

export function getMessages(): Promise<Message[]> {
  return request<Message[]>("/messages");
}

export function sendMessage(csrf: string, input: MessageInput): Promise<Message> {
  return postJson<Message>("/messages", csrf, input);
}
