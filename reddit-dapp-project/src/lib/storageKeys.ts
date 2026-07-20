// localStorage key bases. Every key is additionally scoped at runtime by the
// deployment fingerprint (genesis block hash) - and, for the hide-for-me list,
// by account - so data from an older chain deployment, where post ids restart
// from 1, can never leak into a fresh one. See ForumProvider's scopedStorageKey.
export const COMMENTS_STORAGE_KEY = 'reppit_signed_comments_v1'
export const READ_NOTIFICATIONS_KEY = 'reppit_read_notifications_v1'
export const HIDDEN_POSTS_KEY = 'reppit_hidden_posts_v1'
