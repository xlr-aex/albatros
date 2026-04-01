const initSqlJs = require('./node_modules/sql.js/dist/sql-wasm.js')

async function main() {
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  db.run('CREATE VIRTUAL TABLE articles_fts USING fts4(title, content_text, author)')
  
  const title = "How good os PORRP from learning standpoint? Can''t afford SANS"
  const content = "Hey guys, I want reviews for PORP. I am relatively good with OSINT but I want to up the ante. Sans sec 497 is way out of my budget."
  
  db.run("INSERT INTO articles_fts (title, content_text) VALUES ('" + title + "', '" + content + "')")
  
  const q = "osint*"
  try {
    const res = db.exec("SELECT snippet(articles_fts, '[[[', ']]]', '…', 1, 32) as s FROM articles_fts WHERE articles_fts MATCH '" + q + "'")
    console.log('Snippet Output:', res[0].values[0][0])
  } catch (e) {
    console.error('Error:', e.message)
  }
}
main()
