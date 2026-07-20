import { useForum } from '@/context/useForum'
import { ChangeUsernameModal, RegisterUsernameModal } from '@/components/modals/UsernameModals'
import { CreateCommunityModal, CreateSubCommunityModal } from '@/components/modals/CommunityModals'
import { ReportModal } from '@/components/modals/ReportModal'
import { ReviewPromptModal } from '@/components/modals/ReviewPromptModal'
import { ModeratorActionsModal } from '@/components/moderation/ModeratorActionsModal'

/** Single mount point for every dialog, so App stays a plain layout shell. */
export function ForumModals() {
  const {
    showUsernameModal,
    showChangeUsernameModal,
    reportTarget,
    showCreateCommunityModal,
    showCreateSubCommunityModal,
    showModeratorActionsModal,
    reviewPrompt,
  } = useForum()

  return (
    <>
      {showUsernameModal && <RegisterUsernameModal />}
      {showChangeUsernameModal && <ChangeUsernameModal />}
      {reportTarget && <ReportModal />}
      {showCreateCommunityModal && <CreateCommunityModal />}
      {showCreateSubCommunityModal && <CreateSubCommunityModal />}
      {showModeratorActionsModal && <ModeratorActionsModal />}
      {reviewPrompt && <ReviewPromptModal />}
    </>
  )
}
