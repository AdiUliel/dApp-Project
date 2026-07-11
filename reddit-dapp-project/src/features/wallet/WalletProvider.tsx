import { createContext, useEffect, useState, type ReactNode } from 'react'
import { ethers } from 'ethers'

export type WalletContextValue = {
  walletAddress: string
  getProvider: () => ethers.BrowserProvider
  getCurrentWalletAddress: () => Promise<string>
  connect: () => Promise<void>
  disconnect: () => Promise<void>
}

export const WalletContext = createContext<WalletContextValue | null>(null)

function getProvider() {
  if (!window.ethereum) {
    throw new Error('MetaMask is not installed')
  }
  return new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider)
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [walletAddress, setWalletAddress] = useState('')

  // Switching networks in MetaMask changes the contract/graph target; a full
  // reload is the simplest way to re-resolve cleanly.
  useEffect(() => {
    const ethereum = window.ethereum as
      | { on?: (e: string, cb: () => void) => void; removeListener?: (e: string, cb: () => void) => void }
      | undefined
    if (!ethereum?.on) return

    const onChainChanged = () => window.location.reload()
    ethereum.on('chainChanged', onChainChanged)
    return () => ethereum.removeListener?.('chainChanged', onChainChanged)
  }, [])

  const getCurrentWalletAddress = async () => {
    const provider = getProvider()
    const accounts = await provider.send('eth_accounts', [])
    return accounts && accounts.length > 0 ? accounts[0] : ''
  }

  const connect = async () => {
    const provider = getProvider()
    const accounts = await provider.send('eth_requestAccounts', [])
    setWalletAddress(accounts[0])
  }

  // Revokes the site's MetaMask permission so it no longer auto-connects,
  // then reloads to clear all in-memory state.
  const disconnect = async () => {
    try {
      const ethereum = window.ethereum as
        | { request?: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
        | undefined
      await ethereum?.request?.({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      })
    } catch {
      // Older wallets don't support revoke; the reload still drops the session.
    }
    window.location.reload()
  }

  const value: WalletContextValue = {
    walletAddress,
    getProvider,
    getCurrentWalletAddress,
    connect,
    disconnect,
  }

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}
