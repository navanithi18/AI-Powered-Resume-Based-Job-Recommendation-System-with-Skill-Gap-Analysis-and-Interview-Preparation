const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || 'YOUR_SUPABASE_TOKEN';
const PROJECT_REF = 'fgyqsxniynkmvxwyvcyt';

const sql = `
-- Drop existing policies on resumes bucket if any
DO $$ BEGIN
  DELETE FROM storage.policies WHERE bucket_id = 'resumes';
EXCEPTION WHEN OTHERS THEN END $$;

-- Policy to allow all authenticated users to upload
CREATE POLICY "Full access to authenticated" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'resumes')
  WITH CHECK (bucket_id = 'resumes');

-- Policy to allow all (anon) to read
CREATE POLICY "Public read access" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'resumes');

-- Ensure bucket is public
UPDATE storage.buckets SET public = true WHERE id = 'resumes';
`;

async function main() {
  console.log('Applying wide storage policies...');
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: sql })
    }
  );
  console.log("Status:", res.status);
  console.log("Body:", await res.text());
}
main();
