// Composition root. All state lives in ForumProvider (see
// context/useForumState.ts); everything below is layout.
import { ForumProvider } from '@/context/ForumProvider'
import { useForum } from '@/context/useForum'
import { WalletLandingCard } from '@/features/wallet/WalletConnectButton'
import { TopBar } from '@/components/layout/TopBar'
import { CommunitySidebar } from '@/components/layout/CommunitySidebar'
import { DetailsSidebar } from '@/components/layout/DetailsSidebar'
import { TrendingFeed } from '@/components/feed/TrendingFeed'
import { CommunityFeed } from '@/components/community/CommunityFeed'
import { SearchView } from '@/components/search/SearchView'
import { ProfileView } from '@/components/profile/ProfileView'
import { ForumModals } from '@/components/modals/ForumModals'
import './App.css'

function ForumShell() {
  const { lang, view, walletAddress, statusMessage, modNotification, t, handleConnectWallet } = useForum()

  return (
    <div className="app-shell" dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <TopBar />

      {modNotification && <div className="toast-message mod-alert">{modNotification}</div>}
      {statusMessage && <div className="toast-message">{statusMessage}</div>}

      {!walletAddress ? (
        <WalletLandingCard
          eyebrow={t('landingEyebrow')}
          title={t('landingTitle')}
          body={t('landingBody')}
          buttonLabel={t('connectWithMetaMask')}
          onConnect={handleConnectWallet}
        />
      ) : (
        <>
          {view === 'search' && <SearchView />}
          {view === 'profile' && <ProfileView />}
          {(view === 'home' || view === 'community') && (
            <main className="forum-layout">
              <CommunitySidebar />
              <section className="main-feed">{view === 'home' ? <TrendingFeed /> : <CommunityFeed />}</section>
              <DetailsSidebar />
            </main>
          )}

          <ForumModals />
        </>
      )}
    </div>
  )
}

function App() {
  return (
    <ForumProvider>
      <ForumShell />
    </ForumProvider>
  )
}

export default App
