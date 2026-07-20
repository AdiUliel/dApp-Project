import Modal from '@/components/Modal'
import { useForum } from '@/context/useForum'
import type { TranslationKey } from '@/lib/i18n'

/** Availability / policy feedback shared by the register and change dialogs. */
function UsernameFeedback() {
  const { t, usernameInput, usernameAvailable, usernamePolicyError } = useForum()

  if (usernamePolicyError) {
    return <p className="warning-text">{t(`username_${usernamePolicyError}` as TranslationKey)}</p>
  }
  if (usernameInput.trim() && usernameAvailable !== null) {
    return (
      <p className={usernameAvailable ? 'muted-text' : 'warning-text'}>
        {usernameAvailable ? t('usernameAvailable') : t('usernameTaken')}
      </p>
    )
  }
  return null
}

/** First-run username registration. Deliberately not dismissible. */
export function RegisterUsernameModal() {
  const { t, usernameInput, setUsernameInput, usernameAvailable, usernamePolicyError, submitUsername } = useForum()

  return (
    <Modal title={t('chooseUsername')} dismissible={false}>
      <p>{t('usernameIntro')}</p>
      <input
        type="text"
        placeholder={t('usernamePh')}
        value={usernameInput}
        onChange={(event) => setUsernameInput(event.target.value)}
      />
      <UsernameFeedback />
      <button
        className="primary-button full"
        disabled={!usernameInput.trim() || Boolean(usernamePolicyError) || usernameAvailable === false}
        onClick={submitUsername}
      >
        {t('confirmUsername')}
      </button>
    </Modal>
  )
}

/** Rename, gated by the registry's on-chain cooldown. */
export function ChangeUsernameModal() {
  const {
    t,
    username,
    usernameInput,
    setUsernameInput,
    usernameAvailable,
    usernamePolicyError,
    changeCooldownRemaining,
    setShowChangeUsernameModal,
    submitUsernameChange,
  } = useForum()

  return (
    <Modal
      title={t('changeUsernameTitle')}
      onClose={() => {
        setShowChangeUsernameModal(false)
        setUsernameInput('')
      }}
    >
      <p>{t('changeUsernameBody', { old: username })}</p>
      {changeCooldownRemaining > 0 && (
        <p className="warning-text">
          {t('changeCooldownActive', { days: Math.ceil(changeCooldownRemaining / 86400) })}
        </p>
      )}
      <input
        type="text"
        placeholder={t('newUsernamePh')}
        value={usernameInput}
        onChange={(event) => setUsernameInput(event.target.value)}
      />
      <UsernameFeedback />
      <button
        className="primary-button full"
        disabled={
          !usernameInput.trim() ||
          Boolean(usernamePolicyError) ||
          usernameAvailable === false ||
          changeCooldownRemaining > 0
        }
        onClick={submitUsernameChange}
      >
        {t('confirmUsernameChange')}
      </button>
    </Modal>
  )
}
