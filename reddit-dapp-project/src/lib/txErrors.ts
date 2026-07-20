// Turns an ethers error into a human-readable reason: user rejection, a
// decoded custom error from any of the three contracts (mapped through i18n),
// or the provider's short message as a last resort.
import { ethers } from 'ethers'
import { ALL_ABI_FRAGMENTS } from '@/lib/contracts'
import type { TranslationKey, Translator } from '@/lib/i18n'

type EthersLikeError = {
  code?: string
  data?: unknown
  reason?: string
  shortMessage?: string
  revert?: { name?: string }
  info?: { error?: { data?: unknown } }
}

export function describeTxError(error: unknown, t: Translator): string {
  const err = error as EthersLikeError

  if (err?.code === 'ACTION_REJECTED') return t('err_userRejected')

  let name = err?.revert?.name || ''
  const data = typeof err?.data === 'string' ? err.data : (err?.info?.error?.data as string | undefined)
  if (!name && data && data !== '0x') {
    try {
      // Custom-error selectors are signature-based, not contract-scoped, so
      // one Interface built from all three ABIs decodes reverts regardless
      // of which contract actually threw them.
      name = new ethers.Interface(ALL_ABI_FRAGMENTS).parseError(data)?.name || ''
    } catch {
      // Unknown selector - fall through to the generic message.
    }
  }
  if (!name && err?.reason && err.reason !== 'require(false)') name = err.reason

  if (name) {
    const key = `err_${name}` as TranslationKey
    const label = t(key)
    return label === key ? name : label
  }

  // No decodable revert reason at all. This contract always reverts with
  // custom errors (which carry data), so a data-less CALL_EXCEPTION means
  // the deployed contract doesn't have the function we called. Providers
  // surface this differently: data undefined/"0x", hardhat's
  // "require(false)" reason, or MetaMask's "missing revert data" message.
  if (err?.code === 'CALL_EXCEPTION') return t('err_missingFunction')

  return err?.shortMessage || err?.reason || String(error)
}
