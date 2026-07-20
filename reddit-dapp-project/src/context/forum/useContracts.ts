import { useState } from 'react'
import { ethers } from 'ethers'
import {
  contractAddressForChain,
  moderationAddressForChain,
  NETWORK_NAMES,
  SEPOLIA_CHAIN_ID,
  usernameRegistryAddressForChain,
} from '@/lib/config'
import { setGraphEndpoint } from '@/services/graph'
import { CONTRACT_ABIS } from '@/lib/contracts'
import type { Translator } from '@/lib/i18n'
import type { WalletContextValue } from '@/features/wallet/WalletProvider'
import type { ContractName } from '@/types/forum'

const SEPOLIA_HEX = '0x' + SEPOLIA_CHAIN_ID.toString(16)

type Options = {
  t: Translator
  getProvider: WalletContextValue['getProvider']
  getCurrentWalletAddress: WalletContextValue['getCurrentWalletAddress']
  setTemporaryStatus: (message: string) => void
}

/**
 * Resolves the three contract addresses for whichever network MetaMask is on
 * and hands out ethers.Contract instances. Everything that touches the chain
 * goes through getContract.
 */
export function useContracts({ t, getProvider, getCurrentWalletAddress, setTemporaryStatus }: Options) {
  const [contractAddress, setContractAddress] = useState('')
  const [usernameRegistryAddress, setUsernameRegistryAddress] = useState('')
  const [moderationAddress, setModerationAddress] = useState('')

  // Asks MetaMask to switch to Sepolia (adding it first if the wallet doesn't
  // know it). On success MetaMask fires chainChanged, which reloads the app.
  const switchToSepolia = async () => {
    const ethereum = window.ethereum as
      | { request?: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
      | undefined
    if (!ethereum?.request) return false

    try {
      await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_HEX }] })
      return true
    } catch (error) {
      // 4902 = chain not added to the wallet yet; add it, then switching follows.
      if ((error as { code?: number })?.code === 4902) {
        try {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: SEPOLIA_HEX,
                chainName: 'Sepolia',
                nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
                rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
                blockExplorerUrls: ['https://sepolia.etherscan.io'],
              },
            ],
          })
          return true
        } catch {
          return false
        }
      }
      return false
    }
  }

  // Resolves all three contract addresses for the network MetaMask is
  // currently on, caches them in state, and points the Graph client at the
  // matching endpoint.
  const resolveAddresses = async () => {
    const provider = getProvider()
    const network = await provider.getNetwork()
    const chainId = Number(network.chainId)
    setGraphEndpoint(chainId)

    const forum = contractAddressForChain(chainId)
    if (!forum) {
      // Unknown network: offer to move the user onto Sepolia (the shared forum).
      const name = NETWORK_NAMES[chainId] || `chain ${chainId}`
      setTemporaryStatus(t('unsupportedNetwork', { network: name }))
      await switchToSepolia()
      throw new Error(`Unsupported network: ${chainId}`)
    }

    // Guard against a stale/mis-configured address: if nothing is deployed there
    // on the connected chain, every call would fail with opaque errors.
    const code = await provider.getCode(forum)
    if (code === '0x') {
      const name = NETWORK_NAMES[chainId] || `chain ${chainId}`
      setTemporaryStatus(t('contractNotDeployed', { network: name }))
      throw new Error(`No contract at ${forum} on ${name}`)
    }

    const usernameRegistry = usernameRegistryAddressForChain(chainId)
    const moderation = moderationAddressForChain(chainId)

    setContractAddress(forum)
    setUsernameRegistryAddress(usernameRegistry)
    setModerationAddress(moderation)

    return { forum, usernameRegistry, moderation }
  }

  const getContract = async (withSigner = false, contractName: ContractName = 'forum') => {
    const provider = getProvider()

    const cached =
      contractName === 'forum' ? contractAddress :
      contractName === 'usernameRegistry' ? usernameRegistryAddress :
      moderationAddress

    const address = cached || (await resolveAddresses())[contractName]
    const abi = CONTRACT_ABIS[contractName]

    if (withSigner) {
      const signer = await provider.getSigner()
      return new ethers.Contract(address, abi, signer)
    }

    return new ethers.Contract(address, abi, provider)
  }

  /** Re-reads membership straight from the chain, bypassing cached state. */
  const getLiveMembershipStatus = async (communityId: string) => {
    const account = await getCurrentWalletAddress()

    if (!account) {
      return { account: '', isMember: false, isBanned: false }
    }

    const contract = await getContract(false)
    const [isMember, isBanned] = await Promise.all([
      contract.isUserMemberOfCommunity(communityId, account),
      contract.isUserBannedFromCommunity(communityId, account),
    ])

    return { account, isMember, isBanned }
  }

  return { contractAddress, getContract, getLiveMembershipStatus }
}
