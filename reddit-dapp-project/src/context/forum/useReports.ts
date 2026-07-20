import { useState } from 'react'
import { fetchReports, waitForGraphBlock } from '@/services/graph'
import type { ForumCore } from './core'
import type { GraphReportThread } from '@/services/graph'
import type { ReportTarget } from '@/types/forum'

/**
 * Content reports for the current community. Anyone can file one; it goes
 * on-chain so every moderator of that community sees it.
 */
export function useReports(core: ForumCore) {
  const { t, getContract, setTemporaryStatus, failWith } = core

  const [reports, setReports] = useState<GraphReportThread[]>([])
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null)
  const [reportReason, setReportReason] = useState('')

  const loadReports = async (communityId: string) => {
    const graphReports = await fetchReports(communityId)
    setReports(graphReports || [])
  }

  const submitReport = async (communityId: string) => {
    if (!reportTarget) return
    const target = reportTarget
    const reason = reportReason.trim() || 'No reason given'
    setReportTarget(null)
    setReportReason('')

    try {
      const contract = await getContract(true, 'moderation')
      const tx =
        target.kind === 0
          ? await contract.reportPost(target.id.replace(/^[cp]-/, ''), reason)
          : await contract.reportComment(target.id.replace(/^[cp]-/, ''), reason)

      setTemporaryStatus(t('txSent'))
      const receipt = await tx.wait()
      await waitForGraphBlock(receipt.blockNumber)
      await loadReports(communityId)
      setTemporaryStatus(t('reportSent'))
    } catch (error) {
      console.error('Report failed:', error)
      failWith('reportFailed', error)
    }
  }

  // Moderator closes out a content's reports: it leaves the open queue. action
  // 1 = action taken (content handled), 0 = dismissed (report unfounded).
  const resolveReport = async (communityId: string, kind: 0 | 1, refId: string, action: 0 | 1) => {
    try {
      const contract = await getContract(true)
      const tx = await contract.resolveReport(kind, refId, action)
      setTemporaryStatus(t('txSent'))
      const receipt = await tx.wait()
      await waitForGraphBlock(receipt.blockNumber)
      await loadReports(communityId)
      setTemporaryStatus(action === 1 ? t('reportResolvedToast') : t('reportDismissedToast'))
    } catch (error) {
      console.error('Resolve report failed:', error)
      failWith('reportFailed', error)
    }
  }

  return {
    reports,
    reportTarget,
    setReportTarget,
    reportReason,
    setReportReason,
    loadReports,
    submitReport,
    resolveReport,
  }
}
