import { useRef, useState } from 'react'
import { addJson, getJson } from '@/services/ipfs'
import { isCommunityMetadata, isPostMetadata } from '@/lib/format'
import type { Community, IpfsMetadataRecord, PostMetadata } from '@/types/forum'

/**
 * Cache of IPFS-hosted post/community metadata, keyed by CID. Fetches are
 * de-duplicated through a ref so repeated render passes never re-request the
 * same CID.
 */
export function useIpfsMetadata() {
  const [ipfsCache, setIpfsCache] = useState<Record<string, IpfsMetadataRecord>>({})
  const requestedCids = useRef(new Set<string>())

  // Publishes metadata to IPFS and seeds the cache immediately so the UI doesn't
  // wait on a gateway round-trip for content we already have locally.
  const publishToIpfs = async (metadata: IpfsMetadataRecord) => {
    const cid = await addJson(metadata)
    requestedCids.current.add(cid)
    setIpfsCache((prev) => ({ ...prev, [cid]: metadata }))
    return cid
  }

  // Safe to call repeatedly; in-flight/cached CIDs are skipped.
  const fetchIpfsMetadata = (cid: string) => {
    if (!cid || requestedCids.current.has(cid)) return

    requestedCids.current.add(cid)

    getJson<IpfsMetadataRecord>(cid)
      .then((metadata) => setIpfsCache((prev) => ({ ...prev, [cid]: metadata })))
      .catch((error) => {
        console.error('Failed to load content from IPFS:', error)
        requestedCids.current.delete(cid)
      })
  }

  const getCommunityDescription = (community: Community) => {
    const metadata = ipfsCache[community.metadataCID]
    if (isCommunityMetadata(metadata)) return metadata.description
    return '...'
  }

  const getPostMetadata = (post: { id: string; contentCID: string }): PostMetadata => {
    const metadata = ipfsCache[post.contentCID]

    if (isPostMetadata(metadata)) {
      return metadata
    }

    return {
      title: `Post #${post.id}`,
      body: '...',
      tags: [],
    }
  }

  return { publishToIpfs, fetchIpfsMetadata, getCommunityDescription, getPostMetadata }
}
