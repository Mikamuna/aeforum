function parseTimestamp(value: string): Date {
  // SQLite CURRENT_TIMESTAMP is UTC with a space separator and no zone suffix.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatDateTime(value: string): string {
  return dateTimeFormatter.format(parseTimestamp(value));
}

export function formatRelativeTime(value: string): string {
  const date = parseTimestamp(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ] as const;
  for (const [unit, secondsPerUnit] of units) {
    if (Math.abs(seconds) >= secondsPerUnit) {
      return relativeFormatter.format(Math.round(seconds / secondsPerUnit), unit);
    }
  }
  return relativeFormatter.format(seconds, "second");
}

export function formatDay(value: string): string {
  const date = parseTimestamp(value);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  return isToday ? "Today" : dateFormatter.format(date);
}

export function initials(login: string): string {
  const cleaned = login.replace(/[^A-Za-z0-9]/g, "");
  return (cleaned.slice(0, 2) || "?").toUpperCase();
}

const avatarPalettes = [
  "bg-emerald-100 text-emerald-800",
  "bg-sky-100 text-sky-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-violet-100 text-violet-800",
  "bg-teal-100 text-teal-800",
];

export function avatarClass(login: string): string {
  let hash = 0;
  for (const character of login) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return avatarPalettes[hash % avatarPalettes.length];
}
