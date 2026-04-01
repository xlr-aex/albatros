const html = '<p>Hey guys, I want reviews for PORP. I am relatively good with OSINT but I want to up the ante.</p>'
const q = 'osint'

const exact = q.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')
const words = q.split(/\\s+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'))
const allMatches = [exact, ...words].sort((a, b) => b.length - a.length)
const pattern = `(${allMatches.join('|')})`
console.log('REGEX:', `(?![^<]*>)${pattern}`)
const regex = new RegExp(`(?![^<]*>)${pattern}`, 'gi')
const replaced = html.replace(regex, '<mark>$1</mark>')

console.log('Original:', html)
console.log('Replaced:', replaced)

const html2 = 'I am relatively good with OSINT but I want to up the ante.'
const replaced2 = html2.replace(regex, '<mark>$1</mark>')
console.log('Replaced NO TAGS:', replaced2)

