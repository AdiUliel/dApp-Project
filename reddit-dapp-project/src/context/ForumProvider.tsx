import type { ReactNode } from 'react'
import { ForumContext } from './forumContext'
import { useForumState } from './useForumState'

/**
 * Owns all forum state. Kept as a single provider because the underlying flows
 * are cross-cutting (a post write reloads posts, communities and moderator
 * info together) - see the note at the top of useForumState.
 */
export function ForumProvider({ children }: { children: ReactNode }) {
  const value = useForumState()
  return <ForumContext.Provider value={value}>{children}</ForumContext.Provider>
}
