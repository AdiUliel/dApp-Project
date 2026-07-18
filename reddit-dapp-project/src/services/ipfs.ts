const PINATA_JWT = import.meta.env.VITE_PINATA_JWT

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
