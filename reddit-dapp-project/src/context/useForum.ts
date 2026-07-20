import { useContext } from 'react'
import { ForumContext } from './forumContext'

/** Reads the forum state/actions. Must be called under <ForumProvider>. */
export function useForum() {
  const value = useContext(ForumContext)
  if (!value) {
    throw new Error('useForum must be used inside <ForumProvider>')
  }
  return value
}
