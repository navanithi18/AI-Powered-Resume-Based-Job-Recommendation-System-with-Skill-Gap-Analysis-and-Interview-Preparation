const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || 'YOUR_SUPABASE_TOKEN';
const PROJECT_REF = 'fgyqsxniynkmvxwyvcyt';

async function main() {
  console.log(`Fetching secrets from project: ${PROJECT_REF}...`);
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets`, {
    headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
  });
  
  if (!res.ok) {
    console.error(`Error: ${res.status} ${await res.text()}`);
    return;
  }

  const secrets = await res.json();
  const direct = secrets.find(s => s.name === 'DIRECT_URL');
  console.log('DIRECT_URL present:', !!direct);
  if (direct) {
    // We can't see the value for security, but we know it's there.
    console.log('DIRECT_URL Name:', direct.name);
  }
}
main();
