import postgres from 'postgres';

const DIRECT_URL = "postgresql://postgres:AJAY%401234navanithi@db.fgyqsxniynkmvxwyvcyt.supabase.co:5432/postgres";

async function main() {
  console.log('Connecting to db via postgresjs...');
  const sql = postgres(DIRECT_URL, { ssl: 'require' });
  
  try {
    const result = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    console.log('Tables found via direct connection:', result.map(r => r.table_name).join(', '));
    
    const resumes = await sql`SELECT count(*) FROM resumes`;
    console.log('Resumes count:', resumes[0].count);
    
  } catch (err) {
    console.error('Direct connection error:', err.message);
  } finally {
    await sql.end();
  }
}

main();
