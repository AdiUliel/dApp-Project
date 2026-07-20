// Pure display/formatting helpers. Nothing here touches React state or the
// chain, so it stays trivially testable and reusable across components.
import { ethers } from 'ethers'
import type { Language } from '@/lib/i18n'
import type { CommunityMetadata, IpfsMetadataRecord, ModeratorRole, PostMetadata } from '@/types/forum'

/** Optimistic placeholders use this id prefix until the chain confirms them. */
export const isTempId = (id: string) => id.startsWith('pending-')

export const isPostMetadata = (value: IpfsMetadataRecord | null): value is PostMetadata => {
  return Boolean(value && 'title' in value && 'body' in value)
}

export const isCommunityMetadata = (value: IpfsMetadataRecord | null): value is CommunityMetadata => {
  return Boolean(value && 'description' in value)
}

// Reddit-style "hot" ranking: vote magnitude on a log scale plus time decay,
// so newer posts and higher-scored posts float up together.
export const hotScore = (score: number, createdAtSeconds: number, isMemberCommunity: boolean) => {
  const magnitude = Math.log10(Math.max(Math.abs(score), 1))
  const sign = score > 0 ? 1 : score < 0 ? -1 : 0
  const membershipBoost = isMemberCommunity ? 0.4 : 0
  return sign * magnitude + createdAtSeconds / 45000 + membershipBoost
}

export const formatAddress = (address: string) => {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

// Timestamps arrive as either seconds (chain) or milliseconds (local comments);
// anything past 10^10 is already in ms.
export const formatDate = (timestamp: string | number, lang: Language) => {
  const value = Number(timestamp)
  if (!value) return '-'

  const date = value > 10_000_000_000 ? new Date(value) : new Date(value * 1000)
  return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-US', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

export const formatEth = (wei: string) => {
  try {
    return `${Number(ethers.formatEther(wei)).toFixed(6)} ETH`
  } catch {
    return '0 ETH'
  }
}

export const roleLabel = (role?: ModeratorRole) => {
  if (!role?.isModerator) return 'Member'
  if (role.isCreatorModerator) return 'Creator MOD'
  if (role.isAppointedModerator) return 'Appointed MOD'
  if (role.isActiveBasedModerator) return 'Active MOD'
  return 'MOD'
}

export const isCommentSignatureValid = (comment: { message: string; signature: string; author: string }) => {
  try {
    return ethers.verifyMessage(comment.message, comment.signature).toLowerCase() === comment.author.toLowerCase()
  } catch {
    return false
  }
}
