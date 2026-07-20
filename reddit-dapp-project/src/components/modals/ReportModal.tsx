import Modal from '@/components/Modal'
import { useForum } from '@/context/useForum'

/** Anyone can report a post or comment; the report goes on-chain for moderators. */
export function ReportModal() {
  const { t, reportReason, setReportReason, setReportTarget, submitReport } = useForum()

  return (
    <Modal title={t('reportTitle')} onClose={() => setReportTarget(null)}>
      <p className="muted-text">{t('reportBody')}</p>
      <textarea
        placeholder={t('reportReasonPh')}
        value={reportReason}
        onChange={(event) => setReportReason(event.target.value)}
      />
      <button className="danger-button full" onClick={submitReport}>
        {t('reportSubmit')}
      </button>
    </Modal>
  )
}
