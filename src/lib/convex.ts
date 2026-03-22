import { ConvexReactClient } from "convex/react";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL ?? "https://convex-api.example.com";

export const convex = new ConvexReactClient(CONVEX_URL);
export const convexQueryClient = new ConvexQueryClient(convex);
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryKeyHashFn: convexQueryClient.hashFn(),
      queryFn: convexQueryClient.queryFn(),
    },
  },
});
convexQueryClient.connect(queryClient);
