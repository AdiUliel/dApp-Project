import { useForum } from '@/context/useForum'
import { WalletConnectButton } from '@/features/wallet/WalletConnectButton'
import { NotificationsDropdown } from '@/components/notifications/NotificationsDropdown'
import { formatAddress } from '@/lib/format'

/** Brand, global search, language toggle, notifications bell and wallet state. */
export function TopBar() {
  const {
    t,
    lang,
    setLang,
    setView,
    view,
    searchQuery,
    setSearchQuery,
    searchFilter,
    runSearch,
    walletAddress,
    username,
    bellCount,
    showNotificationsPanel,
    setShowNotificationsPanel,
    openProfile,
    handleConnectWallet,
    disconnect,
  } = useForum()

  return (
    <header className="topbar">
      <button className="brand-block brand-button" onClick={() => setView('home')}>
        <div className="brand-mark">R</div>
        <div>
          <h1>Reppit</h1>
          <p>{t('brandTagline')}</p>
        </div>
      </button>

      <div className="search-shell">
        <span>⌕</span>
        <input
          type="search"
          placeholder={t('searchPlaceholder')}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              runSearch(searchQuery, searchFilter)
            }
          }}
        />
      </div>

      <div className="topbar-actions">
        <div className="lang-toggle">
          <button className={`chip ${lang === 'en' ? 'active' : ''}`} onClick={() => setLang('en')}>
            EN
          </button>
          <button className={`chip ${lang === 'he' ? 'active' : ''}`} onClick={() => setLang('he')}>
            עב
          </button>
        </div>

        {walletAddress && (
          <div className="notifications-wrapper">
            <button
              className={`ghost-button topbar-nav-button bell-button ${showNotificationsPanel ? 'active-nav' : ''}`}
              onClick={() => setShowNotificationsPanel((previous) => !previous)}
              aria-label={t('notificationsTitle')}
              title={t('notificationsTitle')}
            >
              🔔
              {bellCount > 0 && <span className="notification-badge">{bellCount}</span>}
            </button>
            {showNotificationsPanel && <NotificationsDropdown />}
          </div>
        )}

        {walletAddress && (
          <button
            className={`ghost-button topbar-nav-button ${view === 'profile' ? 'active-nav' : ''}`}
            onClick={() => openProfile(walletAddress)}
          >
            @{username || formatAddress(walletAddress)}
          </button>
        )}

        <WalletConnectButton
          connected={Boolean(walletAddress)}
          formattedAddress={formatAddress(walletAddress)}
          connectedLabel={t('connected')}
          connectLabel={t('connectWallet')}
          disconnectLabel={t('disconnect')}
          onConnect={handleConnectWallet}
          onDisconnect={disconnect}
        />
      </div>
    </header>
  )
}
