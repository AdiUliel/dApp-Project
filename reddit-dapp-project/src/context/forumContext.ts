import { createContext } from 'react'
import type { useForumState } from './useForumState'

// The context value is derived from the hook's return type rather than
// declared by hand, so adding a field to useForumState automatically makes it
// available to every consumer with no second place to update.
export type ForumContextValue = ReturnType<typeof useForumState>

export const ForumContext = createContext<ForumContextValue | null>(null)
