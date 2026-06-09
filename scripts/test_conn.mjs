const url = "https://fgyqsxniynkmvxwyvcyt.supabase.co/functions/v1/neon-db";
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZneXFzeG5peW5rbXZ4d3l2Y3l0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMzM1ODEsImV4cCI6MjA4OTkwOTU4MX0.mFE8MUKjkrZrF67cg_5rT-o6uwHJX2YnBb9f2uq08jg';

async function main() {
  console.log('Testing connection...');
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: 'get_user_resumes', params: { user_id: '00000000-0000-0000-0000-000000000000' } })
    });
    console.log("Status:", res.status);
    console.log("Body:", await res.text());
  } catch (e) {
    console.error("Fetch failed:", e.message);
  }
}
main();
