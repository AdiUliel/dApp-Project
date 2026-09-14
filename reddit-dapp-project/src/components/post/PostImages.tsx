import { ImageGallery } from '@/components/media/ImageGallery'

/** Attached post images, addressed by CID and served from an IPFS gateway. */
export function PostImages({ postId, images }: { postId: string; images?: string[] }) {
  return <ImageGallery cids={images || []} idPrefix={`post-${postId}`} />
}
