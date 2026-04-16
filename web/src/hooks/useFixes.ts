import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

interface ConvexFix {
  _id: string;
  _creationTime: number;
  timestamp: number;
  alertIds: string[];
  description: string;
  rootCause: string;
  commit?: string;
  scope: "reactive" | "weekly" | "monthly";
}

export function useFixes(alertIds: string[]) {
  const { data, isPending } = useQuery({
    ...convexQuery(api.fixes.getByAlertIds, {
      alertIds: alertIds as Id<"alerts">[],
    }),
    enabled: alertIds.length > 0,
  });

  return {
    fixes: (data as ConvexFix[] | undefined) ?? [],
    isLoading: isPending && alertIds.length > 0,
  };
}
