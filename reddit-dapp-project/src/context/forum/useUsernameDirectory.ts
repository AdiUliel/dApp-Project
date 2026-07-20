import { useEffect, useRef, useState } from 'react'
import { validateUsername } from '@/lib/usernamePolicy'
import { formatAddress } from '@/lib/format'
import { EMPTY_ADDRESS } from '@/lib/contracts'
import type { TranslationKey } from '@/lib/i18n'
import type { ForumCore } from './core'

/**
 * The username registry: the viewer's own name, the address -> name cache used
 * for display everywhere, and registration/rename with live availability
 * checking.
 */
export function useUsernameDirectory(core: ForumCore, onRenamed: () => void) {
  const { t, walletAddress, getContract, setTemporaryStatus, failWith } = core

  const [username, setUsername] = useState('')
  const [showUsernameModal, setShowUsernameModal] = useState(false)
  const [showChangeUsernameModal, setShowChangeUsernameModal] = useState(false)
  const [usernameInput, setUsernameInput] = useState('')
  const [availabilityResult, setAvailabilityResult] = useState<boolean | null>(null)
  const [changeCooldownRemaining, setChangeCooldownRemaining] = useState(0)
  const [usernamesCache, setUsernamesCache] = useState<Record<string, string>>({})
  const requestedUsernameAddresses = useRef(new Set<string>())

  // Debounced availability probe while the user types.
  useEffect(() => {
    const name = usernameInput.trim()
    if (!name) return

    let cancelled = false
    const timeoutId = setTimeout(() => {
      getContract(false, 'usernameRegistry')
        .then((contract) => contract.isUsernameAvailable(name))
        .then((available: boolean) => {
          if (!cancelled) setAvailabilityResult(available)
        })
        .catch(() => {
          if (!cancelled) setAvailabilityResult(null)
        })
    }, 400)

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [usernameInput])

  // An availability answer only means anything for a non-empty input. Deriving
  // that here beats clearing the state synchronously inside the effect above.
  const usernameAvailable = usernameInput.trim() ? availabilityResult : null

  // Safe to call repeatedly; in-flight/cached addresses are skipped.
  const fetchUsername = (address: string) => {
    if (!address || requestedUsernameAddresses.current.has(address)) return

    requestedUsernameAddresses.current.add(address)

    getContract(false, 'usernameRegistry')
      .then((contract) => contract.getUsername(address))
      .then((name: string) => {
        if (name) setUsernamesCache((prev) => ({ ...prev, [address]: name }))
      })
      .catch((error) => {
        console.error('Failed to load username:', error)
        requestedUsernameAddresses.current.delete(address)
      })
  }

  const loadUsername = async (account: string) => {
    try {
      const contract = await getContract(false, 'usernameRegistry')
      const name = await contract.getUsername(account)
      setUsername(name)
      setShowUsernameModal(!name)
    } catch (error) {
      console.error('Failed to load my username:', error)
    }
  }

  const submitUsername = async () => {
    const name = usernameInput.trim()
    const policyError = validateUsername(name)

    if (policyError) {
      alert(t(`username_${policyError}` as TranslationKey))
      return
    }

    try {
      const contract = await getContract(true, 'usernameRegistry')
      const tx = await contract.registerUsername(name)
      setTemporaryStatus(t('registering'))
      await tx.wait()

      setUsername(name)
      setUsernamesCache((prev) => ({ ...prev, [walletAddress]: name }))
      setShowUsernameModal(false)
      setUsernameInput('')
      setTemporaryStatus(t('registered', { name }))
    } catch (error) {
      console.error('Username registration failed:', error)
      failWith('registerFailed', error)
    }
  }

  const submitUsernameChange = async () => {
    const name = usernameInput.trim()
    const policyError = validateUsername(name)

    if (policyError) {
      alert(t(`username_${policyError}` as TranslationKey))
      return
    }

    try {
      const contract = await getContract(true, 'usernameRegistry')
      const tx = await contract.changeUsername(name)
      setTemporaryStatus(t('changing'))
      await tx.wait()

      const oldName = username
      setUsername(name)
      setUsernamesCache((prev) => ({ ...prev, [walletAddress]: name }))
      setShowChangeUsernameModal(false)
      setUsernameInput('')
      setTemporaryStatus(t('changed', { old: oldName, new: name }))
      onRenamed()
    } catch (error) {
      console.error('Username change failed:', error)
      failWith('changeFailed', error)
    }
  }

  // Accepts a username (with or without @) or a full 0x address and resolves
  // it to an address via the username registry.
  const resolveUserInput = async (input: string): Promise<string | null> => {
    const trimmed = input.trim().replace(/^@/, '')

    if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
      return trimmed
    }

    try {
      const contract = await getContract(false, 'usernameRegistry')
      const address = await contract.getAddressByUsername(trimmed)
      if (address && address !== EMPTY_ADDRESS) return address
    } catch (error) {
      console.error('Username lookup failed:', error)
    }

    return null
  }

  const formatUser = (address: string) => usernamesCache[address] || formatAddress(address)

  const usernamePolicyError = usernameInput.trim() ? validateUsername(usernameInput.trim()) : null

  return {
    username,
    usernamesCache,
    usernameInput,
    setUsernameInput,
    usernameAvailable,
    usernamePolicyError,
    changeCooldownRemaining,
    setChangeCooldownRemaining,
    showUsernameModal,
    showChangeUsernameModal,
    setShowChangeUsernameModal,
    fetchUsername,
    loadUsername,
    submitUsername,
    submitUsernameChange,
    resolveUserInput,
    formatUser,
  }
}
