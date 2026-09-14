const PINATA_JWT = import.meta.env.VITE_PINATA_JWT

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB
export const MAX_IMAGES_PER_POST = 4
export const MAX_IMAGES_PER_COMMENT = 4

// A comment's images live in the contract's single `imageCid` string, which
// ForumModeration caps at 200 bytes. Several CIDs are stored comma-joined
// (4 CIDv0 = 187 bytes), and a lone CID - every older comment - still parses.
export const COMMENT_IMAGE_FIELD_MAX_BYTES = 200

export function joinImageCids(cids: string[]): string {
  return cids.filter(Boolean).join(',')
}

export function splitImageCids(field?: string | null): string[] {
  return (field || '')
    .split(',')
    .map((cid) => cid.trim())
    .filter(Boolean)
}
export const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

// Returns an i18n key describing why the file is rejected, or null if it's fine.
export function validateImageFile(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) return 'uploadBadType'
  if (file.size > MAX_FILE_SIZE_BYTES) return 'uploadTooLarge'
  return null
}

// No single public gateway serves everything reliably, so reads try several.
// Measured on real forum content: Pinata's public gateway serves post JSON and
// older files well but can hang for a long time on a freshly pinned image,
// while Filebase served that same fresh image within seconds yet timed out on
// post JSON. ipfs.io failed every probe (504s after minutes) and was dropped.
// JSON reads remember the first gateway that answers; images fall back per
// image instead (see ipfsGatewayUrls / IpfsImage).
const GATEWAYS = [
  'https://gateway.pinata.cloud',
  'https://ipfs.filebase.io',
  'https://dweb.link',
  'https://w3s.link',
]

let preferredGateway = GATEWAYS[0]

async function fetchFromAnyGateway(cid: string): Promise<Response> {
  const ordered = [preferredGateway, ...GATEWAYS.filter((gateway) => gateway !== preferredGateway)]
  let lastError: unknown = new Error('No IPFS gateway reachable')

  for (const gateway of ordered) {
    try {
      const response = await fetch(`${gateway}/ipfs/${cid}`, { signal: AbortSignal.timeout(8000) })
      if (response.ok) {
        preferredGateway = gateway
        return response
      }
      lastError = new Error(`IPFS gateway ${gateway} responded ${response.status}`)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
}

// Pins JSON to Pinata so content survives independently of any local machine, and returns its CID.
export async function addJson(data: unknown): Promise<string> {
  const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pinataContent: data }),
  })

  if (!response.ok) {
    throw new Error(`Pinata pin request failed with status ${response.status}`)
  }

  const result = await response.json()
  return result.IpfsHash as string
}

// Reads JSON back via whichever public gateway answers first.
export async function getJson<T>(cid: string): Promise<T> {
  const response = await fetchFromAnyGateway(cid)
  return response.json() as Promise<T>
}

// Pins a binary file (image/GIF) to Pinata and returns its CID.
// Pre-validates locally so obvious rejects don't even hit the network.
export async function addFile(file: File): Promise<string> {
  const invalid = validateImageFile(file)
  if (invalid) throw new Error(invalid)

  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Pinata file pin failed with status ${response.status}`)
  }

  const result = await response.json()
  return result.IpfsHash as string
}

export function ipfsUrl(cid: string): string {
  return `${preferredGateway}/ipfs/${cid}`
}

/** Every gateway URL for a CID, the currently preferred gateway first. */
export function ipfsGatewayUrls(cid: string): string[] {
  const ordered = [preferredGateway, ...GATEWAYS.filter((gateway) => gateway !== preferredGateway)]
  return ordered.map((gateway) => `${gateway}/ipfs/${cid}`)
}
