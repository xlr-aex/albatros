const path = require('path')
const initSqlJs = require('./node_modules/sql.js/dist/sql-wasm.js')
const fs = require('fs')

async function main() {
  const SQL = await initSqlJs()
  // Load real database!
  // Database is usually at ~AppData/Roaming/Albatros/database.sqlite
  // Wait, I can just use the Electron App path, or if I don't know it, I can use a generic script.
  // Actually, I can just use grep to see where the DB is stored.
  console.log('Test script ready.')
}
main()
