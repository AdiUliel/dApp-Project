// Client-side username rules. The contract enforces charset, length, and the
// reserved-token rules on-chain; profanity screening only happens here.

const FORMAT_REGEX = /^[A-Za-z0-9_]{3,20}$/

// Blocked when standing alone: the whole name, a prefix followed by a
// non-letter (mod_dan, admin123), or a suffix preceded by a non-letter (x_mod).
// Embedded in longer words (modern, model) stays legal.
const RESERVED_TOKENS = ['mod', 'admin', 'gm', 'moderator']

const PROFANITY_SUBSTRINGS = [
  'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'bastard', 'dick', 'cock',
  'pussy', 'whore', 'slut', 'faggot', 'nigger', 'nigga', 'retard', 'wanker',
  'twat', 'prick', 'douche', 'jackass', 'dildo', 'boobs', 'penis', 'vagina',
  'porn', 'sex', 'rape', 'nazi', 'hitler', 'kys',
]

const isLetter = (char: string) => /[a-z]/.test(char)

const hasReservedToken = (lowerName: string, token: string): boolean => {
  if (lowerName === token) return true

  if (lowerName.startsWith(token) && lowerName.length > token.length && !isLetter(lowerName[token.length])) {
    return true
  }

  if (
    lowerName.endsWith(token) &&
    lowerName.length > token.length &&
    !isLetter(lowerName[lowerName.length - token.length - 1])
  ) {
    return true
  }

  return false
}

export type UsernameError = 'tooShort' | 'tooLong' | 'badChars' | 'reserved' | 'profanity'

// Returns an error code (translated by the caller), or null when acceptable.
export function validateUsername(name: string): UsernameError | null {
  if (name.length < 3) return 'tooShort'
  if (name.length > 20) return 'tooLong'

  if (!FORMAT_REGEX.test(name)) {
    return 'badChars'
  }

  const lower = name.toLowerCase()

  for (const token of RESERVED_TOKENS) {
    if (hasReservedToken(lower, token)) {
      return 'reserved'
    }
  }

  for (const word of PROFANITY_SUBSTRINGS) {
    if (lower.includes(word)) {
      return 'profanity'
    }
  }

  return null
}

// Community names share the contract rule: 3-30 chars, [A-Za-z0-9_-].
export function isValidCommunityName(name: string): boolean {
  return /^[A-Za-z0-9_-]{3,30}$/.test(name)
}
