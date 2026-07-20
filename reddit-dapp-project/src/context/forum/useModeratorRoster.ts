import { useState } from 'react'
import { EMPTY_ADDRESS } from '@/lib/contracts'
import type { ForumCore } from './core'
import type { ModeratorDisplay } from '@/types/forum'

/**
 * Read-only moderator roster for a community, plus its top active users.
 *
 * Deliberately dependency-free: the moderator *actions* live in
 * useModerationActions, which needs loadPosts/loadCommunities. Keeping the
 * loader separate is what stops moderation <-> posts becoming a cycle.
 */
export function useModeratorRoster(core: ForumCore) {
  const { getContract } = core

  const [moderators, setModerators] = useState<ModeratorDisplay[]>([])
  const [topActiveUsers, setTopActiveUsers] = useState<string[]>([])

  const loadModeratorInfo = async (communityId: string) => {
    try {
      const contract = await getContract(false)
      const addresses: string[] = await contract.getModeratorAddresses(communityId)
      const topUsers = await contract.getTopActiveUsers(communityId)

      const loadedModerators: ModeratorDisplay[] = []

      for (const address of addresses) {
        const role = await contract.getModeratorRole(communityId, address)
        const score = await contract.activityScore(communityId, address)

        loadedModerators.push({
          address,
          score: score.toString(),
          role: {
            isModerator: role[0],
            isCreatorModerator: role[1],
            isActiveBasedModerator: role[2],
            isAppointedModerator: role[3],
          },
        })
      }

      setModerators(loadedModerators)
      setTopActiveUsers([topUsers[0], topUsers[1]].filter((address) => address && address !== EMPTY_ADDRESS))
    } catch (error) {
      console.error('Failed to load moderators:', error)
      setModerators([])
      setTopActiveUsers([])
    }
  }

  const clearModerators = () => {
    setModerators([])
    setTopActiveUsers([])
  }

  return { moderators, topActiveUsers, loadModeratorInfo, clearModerators }
}
