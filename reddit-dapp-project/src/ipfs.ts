const PINATA_JWT = import.meta.env.VITE_PINATA_JWT
const PINATA_GATEWAY_URL = 'https://gateway.pinata.cloud'

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

// Reads JSON back via Pinata's public gateway.
export async function getJson<T>(cid: string): Promise<T> {
  const response = await fetch(`${PINATA_GATEWAY_URL}/ipfs/${cid}`)

  if (!response.ok) {
    throw new Error(`IPFS gateway request failed with status ${response.status}`)
  }

  return response.json() as Promise<T>
}
