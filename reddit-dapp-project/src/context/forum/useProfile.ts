import { useState } from 'react'
import { fetchUserActivities, fetchUserProfile } from '@/services/graph'
import type { GraphActivity, GraphUser } from '@/services/graph'

type Options = {
  walletAddress: string
  loadNotifications: (account: string) => Promise<void>
}

/** Profile stats and recent activity, both sourced from the subgraph. */
export function useProfile({ walletAddress, loadNotifications }: Options) {
  const [profileAddress, setProfileAddress] = useState('')
  const [profileData, setProfileData] = useState<GraphUser | null>(null)
  const [profileActivities, setProfileActivities] = useState<GraphActivity[]>([])
  const [profileGraphOffline, setProfileGraphOffline] = useState(false)

  const loadProfileData = async (address: string) => {
    const [profile, activities] = await Promise.all([fetchUserProfile(address), fetchUserActivities(address, 30)])

    // activities === null means graphQuery failed (endpoint down); a missing
    // user entity (profile null) with activities [] just means a fresh account.
    setProfileGraphOffline(activities === null)
    setProfileData(profile)
    setProfileActivities(activities || [])

    if (address.toLowerCase() === walletAddress.toLowerCase()) {
      loadNotifications(address)
    }
  }

  return {
    profileAddress,
    setProfileAddress,
    profileData,
    profileActivities,
    profileGraphOffline,
    loadProfileData,
  }
}
