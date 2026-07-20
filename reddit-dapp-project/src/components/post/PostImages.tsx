import { ipfsUrl } from '@/services/ipfs'

/** Attached post images, addressed by CID and served from an IPFS gateway. */
export function PostImages({ postId, images }: { postId: string; images?: string[] }) {
  if (!images || images.length === 0) return null

  return (
    <div className="post-images">
      {images.map((cid) => (
        <img className="post-image" key={`${postId}-${cid}`} src={ipfsUrl(cid)} alt="" loading="lazy" />
      ))}
    </div>
  )
}
