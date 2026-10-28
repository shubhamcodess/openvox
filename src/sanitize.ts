/** Turns raw speech-to-text into a clean question for the LLM. */

// Phrases small speech models invent out of silence or room noise.
const PHANTOM = /^(?:you|thank you(?: so much| very much)?(?: for watching)?|thanks(?: for watching)?|bye|okay|ok|so|oh|uh|um|hmm+|mm+|the|\.+|\[[^\]]*\]|\([^)]*\)|♪.*)[.!?\s]*$/i

const FILLER = /\b(?:u+h+m*|u+m+|e+r+m*|a+h+m+|h+m+|mm+-?hm+)\b[,.]?\s*/gi

export function sanitize(raw: string): string {
  let t = raw
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ') // [BLANK_AUDIO], (music)
    .replace(FILLER, ' ')
    .replace(/\b(\w+(?:\s\w+)?)(?:[,\s]+\1\b)+/gi, '$1') // "the the", "is it, is it" stutters
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?]){2,}/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.;:-]+/, '')
    .trim()
  if (!t || PHANTOM.test(t) || !/[a-z0-9]/i.test(t)) return ''
  t = t[0].toUpperCase() + t.slice(1)
  return t
}

const DANGLING = /\b(?:and|but|or|so|because|then|also|plus|the|a|an|of|to|for|with|about|in|on|at|from|by|is|are|was|were|does|do|did|can|could|would|should|will|what|which|who|how|why|where|when|that|if|like|my|your|its|their|his|her|um|uh)$/i

/**
 * How long to keep waiting for more speech after a pause, judged from what has been said so far.
 * Sounds finished: send soon. Sounds unfinished (trailing "and", "the", a comma): wait much longer.
 */
export function patience(text: string): { grace: number; unfinished: boolean } {
  const t = text.trim()
  if (!t) return { grace: 1400, unfinished: true }
  if (/[,;:]$|\.{2,}$|…$/.test(t) || DANGLING.test(t.replace(/[.!?]+$/, ''))) return { grace: 2800, unfinished: true }
  if (/[.!?]$/.test(t)) return { grace: 900, unfinished: false }
  return { grace: t.split(/\s+/).length < 4 ? 2000 : 1400, unfinished: false }
}
