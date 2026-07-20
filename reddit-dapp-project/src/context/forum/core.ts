// Shared services every forum domain hook needs. Passing one `core` object
// keeps the hook signatures short and makes the dependency direction explicit:
// domain hooks depend on core, never the other way round.
import type { ethers } from 'ethers'
import type { TranslationKey, Translator } from '@/lib/i18n'
import type { WalletContextValue } from '@/features/wallet/WalletProvider'
import type { ContractName } from '@/types/forum'

export type GetContract = (withSigner?: boolean, contractName?: ContractName) => Promise<ethers.Contract>

export type ForumCore = {
  t: Translator
  walletAddress: string
  getProvider: WalletContextValue['getProvider']
  getCurrentWalletAddress: WalletContextValue['getCurrentWalletAddress']
  getContract: GetContract
  setTemporaryStatus: (message: string) => void
  /** Standard failure alert: what failed + the decoded revert reason. */
  failWith: (key: TranslationKey, error: unknown) => void
}
