import { QueryClient } from '@tanstack/react-query'

// Chain/graph reads are cheap to refetch but not free (RPC calls, subgraph
// queries) - a short staleTime avoids refetching on every component remount
// while still keeping data reasonably fresh after writes invalidate it.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
    },
  },
})
