import { useQuery } from '@tanstack/react-query';
import { convexQuery } from '@convex-dev/react-query';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

export function useFixes(alertIds: string[]) {
  const { data, isPending } = useQuery({
    ...convexQuery(api.fixes.getByAlertIds, {
      alertIds: alertIds as Id<'alerts'>[],
    }),
    enabled: alertIds.length > 0,
  });

  return {
    fixes: data ?? [],
    isLoading: isPending && alertIds.length > 0,
  };
}
