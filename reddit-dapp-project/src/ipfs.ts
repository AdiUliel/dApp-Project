// IPFS access for the browser. WRITES go through our upload-service (which holds
// the Pinata JWT server-side) so no credential is ever shipped in this bundle.
// READS stay client-side via public gateways - no credential needed.
const UPLOAD_SERVICE_URL = import.meta.env.VITE_UPLOAD_SERVICE_URL || 'http://localhost:8787'

// Client-side mirror of upload-service/limits.js. This is only a first-pass
// filter for fast UX feedback; the service re-checks and is the real authority.
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB
export const MAX_IMAGES_PER_POST = 4
export const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

// Returns an i18n key describing why the file is rejected, or null if it's fine.
export function validateImageFile(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) return 'uploadBadType'
  if (file.size > MAX_FILE_SIZE_BYTES) return 'uploadTooLarge'
  return null
}

// Pinata's public gateway aggressively rate-limits unauthenticated reads
// (429s), which showed up as posts falling back to "Post #N" / "..." titles.
// Reads therefore try several public gateways; the first one that answers
// becomes preferred so images load from a known-good host too.
const GATEWAYS = [
  'https://gateway.pinata.cloud',
  'https://ipfs.io',
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

// Reads the service's JSON error body if present, else a generic message.
async function uploadError(response: Response): Promise<Error> {
  try {
    const body = await response.json()
    if (body && body.error) return new Error(body.error)
  } catch {
    // no JSON body
  }
  return new Error(`Upload service responded ${response.status}`)
}

// Pins JSON via the upload service so content survives independently of any local
// machine, and returns its CID.
export async function addJson(data: unknown): Promise<string> {
  const response = await fetch(`${UPLOAD_SERVICE_URL}/api/upload-json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!response.ok) throw await uploadError(response)

  const result = await response.json()
  return result.cid as string
}

// Reads JSON back via whichever public gateway answers first.
export async function getJson<T>(cid: string): Promise<T> {
  const response = await fetchFromAnyGateway(cid)
  return response.json() as Promise<T>
}

// Pins a binary file (image/GIF) via the upload service and returns its CID.
// Pre-validates locally so obvious rejects don't even hit the network.
export async function addFile(file: File): Promise<string> {
  const invalid = validateImageFile(file)
  if (invalid) throw new Error(invalid)

  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${UPLOAD_SERVICE_URL}/api/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) throw await uploadError(response)

  const result = await response.json()
  return result.cid as string
}

// Best-effort: tell the service these CIDs are now referenced on-chain, so its
// orphan cleanup never touches them. Failure here is non-fatal (the pin still
// exists; it just stays "pending" until confirmed or reaped).
export async function confirmUploads(cids: string[]): Promise<void> {
  const real = cids.filter(Boolean)
  if (real.length === 0) return
  try {
    await fetch(`${UPLOAD_SERVICE_URL}/api/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cids: real }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // non-fatal
  }
}

export function ipfsUrl(cid: string): string {
  return `${preferredGateway}/ipfs/${cid}`
}
