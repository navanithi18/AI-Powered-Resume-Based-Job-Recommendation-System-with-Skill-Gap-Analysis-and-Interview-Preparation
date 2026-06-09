const url = "https://fgyqsxniynkmvxwyvcyt.supabase.co/functions/v1/neon-db";
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZneXFzeG5peW5rbXZ4d3l2Y3l0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMzM1ODEsImV4cCI6MjA4OTkwOTU4MX0.mFE8MUKjkrZrF67cg_5rT-o6uwHJX2YnBb9f2uq08jg';

async function main() {
  const dummyUser = "b41f7d5a-90e6-4fa2-8722-46b1bbc3f16f";
  console.log(`Testing create_resume with user: ${dummyUser}`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ 
        action: 'create_resume', 
        params: { 
          user_id: dummyUser, 
          file_name: 'test.pdf', 
          file_url: 'https://test.com/test.pdf', 
          target_role: 'Software Engineer' 
        } 
      })
    });
    console.log("Status:", res.status);
    const body = await res.text();
    console.log("Body:", body);
  } catch (e) {
    console.error("Fetch failed:", e.message);
  }
}
main();
