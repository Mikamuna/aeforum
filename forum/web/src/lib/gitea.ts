export function giteaRepoHref(owner: string, name: string): string {
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

export function giteaIssueHref(owner: string, name: string, number: number | null): string | null {
  if (number === null || !Number.isInteger(number) || number <= 0) return null;
  return `${giteaRepoHref(owner, name)}/issues/${number}`;
}

export function giteaPullHref(owner: string, name: string, number: number | null): string | null {
  if (number === null || !Number.isInteger(number) || number <= 0) return null;
  return `${giteaRepoHref(owner, name)}/pulls/${number}`;
}

export function giteaProfileHref(login: string): string {
  return `/${encodeURIComponent(login)}`;
}

export const statusLabels = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  delivered: "Delivered",
} as const;
