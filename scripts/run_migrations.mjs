import postgres from 'postgres';
import fs from 'fs';
import path from 'path';

const sql = postgres('postgresql://postgres:AJAY%401234navanithi@db.fgyqsxniynkmvxwyvcyt.supabase.co:5432/postgres', {
  ssl: 'require'
});

async function main() {
  try {
    const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
    const files = fs.readdirSync(migrationsDir).sort();
    
    for (const file of files) {
      if (file.endsWith('.sql')) {
        console.log(`Running migration: ${file}`);
        const filePath = path.join(migrationsDir, file);
        const query = fs.readFileSync(filePath, 'utf-8');
        await sql.unsafe(query);
        console.log(`Successfully completed: ${file}`);
      }
    }
  } catch (e) {
    console.error(`Migration failed:`, e);
  } finally {
    await sql.end();
  }
}

main();
