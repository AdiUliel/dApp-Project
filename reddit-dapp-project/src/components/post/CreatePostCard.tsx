import { useForum } from '@/context/useForum'
import { Composer } from '@/components/Composer'
import { MAX_IMAGES_PER_POST, validateImageFile } from '@/services/ipfs'
import type { TranslationKey } from '@/lib/i18n'

/** Post composer shown inside a community when "write post" is toggled on. */
export function CreatePostCard() {
  const {
    t,
    selectedCommunity,
    postTitle,
    setPostTitle,
    postBody,
    setPostBody,
    postTags,
    setPostTags,
    postImages,
    setPostImages,
    uploadingMedia,
    createPost,
  } = useForum()

  if (!selectedCommunity) return null

  return (
    <section className="panel create-post-card secondary-create-card">
      <div className="section-heading row-heading">
        <div>
          <span className="eyebrow">{t('newPostEyebrow')}</span>
          <h2>{t('publishPost')}</h2>
        </div>
        <span className="counter-pill">{t('activityPill')}</span>
      </div>

      {!selectedCommunity.isMember && <p className="warning-text">{t('joinBeforePosting')}</p>}

      <input
        type="text"
        placeholder={t('postTitlePh')}
        value={postTitle}
        onChange={(event) => setPostTitle(event.target.value)}
      />
      <Composer
        rich
        className="post-body-input"
        placeholder={t('postBodyPh')}
        value={postBody}
        onChange={setPostBody}
      />
      <input
        type="text"
        placeholder={t('postTagsPh')}
        value={postTags}
        onChange={(event) => setPostTags(event.target.value)}
      />

      <label className="file-input-label">
        {t('attachImages')}
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files || [])
            event.target.value = ''
            // First-pass client filter (the upload service re-checks): drop
            // wrong types / oversized files and cap the count.
            const accepted: File[] = []
            for (const file of files) {
              if (postImages.length + accepted.length >= MAX_IMAGES_PER_POST) {
                alert(t('uploadTooMany', { max: MAX_IMAGES_PER_POST }))
                break
              }
              const err = validateImageFile(file)
              if (err) {
                alert(t(err as TranslationKey, { name: file.name }))
                continue
              }
              accepted.push(file)
            }
            if (accepted.length > 0) setPostImages((previous) => [...previous, ...accepted])
          }}
        />
      </label>

      {postImages.length > 0 && (
        <div className="image-previews">
          {postImages.map((file, index) => (
            <div className="image-preview" key={`${file.name}-${index}`}>
              <img src={URL.createObjectURL(file)} alt={file.name} />
              <button
                className="ghost-button"
                onClick={() => setPostImages((previous) => previous.filter((_, i) => i !== index))}
              >
                {t('removeImage')}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="form-footer">
        <small>{t('storedOnIpfs')}</small>
        <button className="primary-button" disabled={uploadingMedia} onClick={createPost}>
          {uploadingMedia ? t('uploadingImages') : t('publish')}
        </button>
      </div>
    </section>
  )
}
