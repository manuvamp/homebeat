import type { Household } from '@shared/types'

/** "1 alert", "3 alerts", "1 person", "2 people" (pass the plural when it isn't just +s). */
export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}
/** Just the word: pluralWord(2, 'moment') -> "moments". */
export function pluralWord(n: number, one: string, many = `${one}s`) {
  return n === 1 ? one : many
}

/** "Priya", "Priya and Rohan", "Priya, Rohan and Linda" */
export function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** Possessive: "Asha’s", "James’" */
export function possessive(name: string) {
  return /s$/i.test(name) ? `${name}’` : `${name}’s`
}

/** First name of "Maria (BrightCare)" -> "Maria". */
export function firstName(who: string) {
  return who.split(/[\s(]/)[0] || who
}

export function membersByOrder(h: Household) {
  return [...h.members].sort((a, b) => a.escalationOrder - b.escalationOrder)
}
export function primaryMember(h: Household) {
  return membersByOrder(h).find((m) => m.role === 'primary') ?? membersByOrder(h)[0]
}

/** Strip spaces etc. for a tel: link. */
export function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}
