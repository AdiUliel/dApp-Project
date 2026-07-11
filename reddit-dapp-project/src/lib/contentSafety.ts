// Client-side unsafe-content detection for posts and comments (English +
// Hebrew). Matches send the content into the on-chain moderator review queue
// instead of publishing directly.

const PROFANITY = [
  // English
  'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'bastard', 'dick', 'cock',
  'pussy', 'whore', 'slut', 'faggot', 'nigger', 'nigga', 'retard', 'wanker',
  'twat', 'prick', 'douche', 'jackass', 'motherfucker',
  // Hebrew
  'זונה', 'בן זונה', 'כוס אמק', 'כוסאמק', 'מניאק', 'זין', 'לך תזדיין',
  'תזדיין', 'שרמוטה', 'קוקסינל', 'מזדיין', 'חרא עליך', 'יא חרא',
]

const SELF_HARM = [
  // English
  'suicide', 'kill myself', 'end my life', 'self harm', 'self-harm',
  'want to die', 'better off dead', 'hurt myself', 'cutting myself',
  // Hebrew
  'התאבדות', 'להתאבד', 'אתאבד', 'לשים קץ לחיים', 'לפגוע בעצמי',
  'רוצה למות', 'לא רוצה לחיות', 'אין טעם לחיות', 'לחתוך את עצמי',
]

export type SafetyResult = {
  safe: boolean
  selfHarm: boolean
}

export function checkContentSafety(text: string): SafetyResult {
  const lower = text.toLowerCase()

  const selfHarm = SELF_HARM.some((phrase) => lower.includes(phrase))
  const profane = PROFANITY.some((word) => lower.includes(word))

  return {
    safe: !selfHarm && !profane,
    selfHarm,
  }
}
