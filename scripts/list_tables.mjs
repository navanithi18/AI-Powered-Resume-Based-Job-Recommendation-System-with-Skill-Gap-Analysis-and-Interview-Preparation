const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || 'YOUR_SUPABASE_TOKEN';
const PROJECT_REF = 'fgyqsxniynkmvxwyvcyt';

async function main() {
  const query = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'";
  console.log('Fetching public tables...');
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });
  
  if (!res.ok) {
    console.error(`Error: ${res.status} ${await res.text()}`);
    return;
  }

  const tables = await res.json();
  console.log('Tables:', tables.map(t => t.table_name).join(', '));
}
main();
