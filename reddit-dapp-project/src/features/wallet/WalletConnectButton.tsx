// Presentational wallet-status widgets - kept translation-agnostic (labels
// come in as already-resolved strings) to match the Modal/Composer convention.

type WalletConnectButtonProps = {
  connected: boolean
  formattedAddress: string
  connectedLabel: string
  connectLabel: string
  disconnectLabel: string
  onConnect: () => void
  onDisconnect: () => void
}

export function WalletConnectButton({
  connected,
  formattedAddress,
  connectedLabel,
  connectLabel,
  disconnectLabel,
  onConnect,
  onDisconnect,
}: WalletConnectButtonProps) {
  return (
    <div className="wallet-panel">
      {connected ? (
        <>
          <span className="status-dot" />
          <span className="wallet-label">{connectedLabel}</span>
          <code>{formattedAddress}</code>
          <button className="ghost-button disconnect-button" onClick={onDisconnect}>
            {disconnectLabel}
          </button>
        </>
      ) : (
        <button className="primary-button" onClick={onConnect}>
          {connectLabel}
        </button>
      )}
    </div>
  )
}

type WalletLandingCardProps = {
  eyebrow: string
  title: string
  body: string
  buttonLabel: string
  onConnect: () => void
}

export function WalletLandingCard({ eyebrow, title, body, buttonLabel, onConnect }: WalletLandingCardProps) {
  return (
    <main className="landing-card">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{body}</p>
      <button className="primary-button large" onClick={onConnect}>
        {buttonLabel}
      </button>
    </main>
  )
}
