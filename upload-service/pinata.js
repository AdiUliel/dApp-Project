// Server-side Pinata client. The JWT lives ONLY here (process.env), never in the
// browser bundle. Uses Node's global fetch/FormData/Blob (Node 18+).
'use strict'

const PINATA_API = 'https://api.pinata.cloud'

function jwt() {
  const token = process.env.PINATA_JWT
  if (!token) {
    throw new Error('PINATA_JWT is not set on the upload service')
  }
  return token
}

async function pinFile(buffer, filename, mimeType) {
  const form = new FormData()
  form.append('file', new Blob([buffer], { type: mimeType }), filename)

  const response = await fetch(`${PINATA_API}/pinning/pinFileToIPFS`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt()}` },
    body: form,
  })

  if (!response.ok) {
    throw new Error(`Pinata file pin failed with status ${response.status}`)
  }

  const result = await response.json()
  return result.IpfsHash
}

async function pinJson(content) {
  const response = await fetch(`${PINATA_API}/pinning/pinJSONToIPFS`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pinataContent: content }),
  })

  if (!response.ok) {
    throw new Error(`Pinata JSON pin failed with status ${response.status}`)
  }

  const result = await response.json()
  return result.IpfsHash
}

// Used by orphan cleanup to release pins that were never confirmed on-chain.
async function unpin(cid) {
  const response = await fetch(`${PINATA_API}/pinning/unpin/${cid}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${jwt()}` },
  })
  // 200 = unpinned; Pinata returns an error if the CID isn't pinned any more,
  // which for cleanup purposes is fine (already gone).
  return response.ok
}

module.exports = { pinFile, pinJson, unpin }
