const initSqlJs = require('sql.js');
const fs = require('fs');

(async () => {
  const SQL = await initSqlJs();
  const filebuffer = fs.readFileSync(process.env.APPDATA + '\\albatros\\albatros.db');
  const db = new SQL.Database(filebuffer);

  try {
    const res = db.exec("SELECT snippet(articles_fts, '[[', ']]', '...', -1, 64) FROM articles_fts WHERE articles_fts MATCH '\"apple\"*' ");
    console.log('Success:', res);
  } catch (e) {
    console.error('Error:', e);
  }
})();
