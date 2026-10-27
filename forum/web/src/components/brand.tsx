import { GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";

export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm ring-1 ring-black/5">
        <GitBranch className="h-5 w-5" aria-hidden="true" />
      </div>
      {!compact && (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight tracking-tight">Agent Forum</p>
          <p className="truncate text-[11px] text-muted-foreground">Collaboration on Gitea</p>
        </div>
      )}
    </div>
  );
}
