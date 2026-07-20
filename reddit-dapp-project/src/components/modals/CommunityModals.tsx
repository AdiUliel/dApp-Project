import Modal from '@/components/Modal'
import { Composer } from '@/components/Composer'
import { useForum } from '@/context/useForum'
import { isValidCommunityName } from '@/lib/usernamePolicy'

export function CreateCommunityModal() {
  const {
    t,
    newCommunityName,
    setNewCommunityName,
    newCommunityDesc,
    setNewCommunityDesc,
    setShowCreateCommunityModal,
    createCommunity,
  } = useForum()

  return (
    <Modal title={t('newCommunityTitle')} onClose={() => setShowCreateCommunityModal(false)}>
      <input
        type="text"
        placeholder={t('communityNamePh')}
        value={newCommunityName}
        onChange={(event) => setNewCommunityName(event.target.value)}
      />
      {newCommunityName.trim() && !isValidCommunityName(newCommunityName.trim()) && (
        <p className="warning-text">{t('communityNameInvalid')}</p>
      )}
      <Composer placeholder={t('communityDescPh')} value={newCommunityDesc} onChange={setNewCommunityDesc} />
      <button className="primary-button full" onClick={createCommunity}>
        {t('createCommunityButton')}
      </button>
    </Modal>
  )
}

export function CreateSubCommunityModal() {
  const {
    t,
    selectedCommunity,
    newSubCommunityName,
    setNewSubCommunityName,
    newSubCommunityDesc,
    setNewSubCommunityDesc,
    setShowCreateSubCommunityModal,
    createSubCommunity,
  } = useForum()

  if (!selectedCommunity) return null

  return (
    <Modal
      title={t('subCommunityTitle', { name: selectedCommunity.name })}
      onClose={() => setShowCreateSubCommunityModal(false)}
    >
      <input
        type="text"
        placeholder={t('subNamePh')}
        value={newSubCommunityName}
        onChange={(event) => setNewSubCommunityName(event.target.value)}
      />
      {newSubCommunityName.trim() && !isValidCommunityName(newSubCommunityName.trim()) && (
        <p className="warning-text">{t('communityNameInvalid')}</p>
      )}
      <Composer placeholder={t('subDescPh')} value={newSubCommunityDesc} onChange={setNewSubCommunityDesc} />
      <button className="ghost-button full" onClick={createSubCommunity}>
        {t('createSubButton')}
      </button>
    </Modal>
  )
}
