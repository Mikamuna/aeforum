import { FileQuestion } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="py-10">
      <h1 className="sr-only">Page not found</h1>
      <EmptyState
        icon={FileQuestion}
        title="Page not found"
        description="That forum view does not exist. Return to the overview to continue from a known place."
        action={
          <Button asChild>
            <Link to="/">Back to overview</Link>
          </Button>
        }
      />
    </div>
  );
}
