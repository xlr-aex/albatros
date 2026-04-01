import fs from 'fs';
import path from 'path';
import initSqlJs from 'sql.js';
import { FeedService } from './src/main/services/FeedService';
import { ArticleService } from './src/main/services/ArticleService';
import { SyncEngine } from './src/main/sync/SyncEngine';

async function run() {
  const dbPath = path.join(process.env.APPDATA || '', 'albatros', 'albatros.db');
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  
  const feedService = new FeedService(db);
  const articleService = new ArticleService(db);
  const syncEngine = new SyncEngine(feedService, articleService);
  
  console.log('Syncing feed 1...');
  const res = await syncEngine.syncFeedById(1);
  console.log('Result:', res);
  // export db back if needed, but we don't care, we just want to see the error
}
run().catch(console.error);
