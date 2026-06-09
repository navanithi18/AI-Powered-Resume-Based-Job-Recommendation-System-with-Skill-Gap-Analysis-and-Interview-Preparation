import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface JobResult {
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  salary?: string;
  matchedSkills: string[];
  matchPercentage: number;
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 3, backoff = 2000): Promise<Response> {
  let lastError: Error | null = null;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429) {
        console.log(`Rate limit hit (429). Retrying in ${backoff}ms... (Attempt ${i + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        backoff *= 2; // Exponential backoff
        continue;
      }
      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.log(`Fetch error. Retrying in ${backoff}ms... (Attempt ${i + 1}/${retries})`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      backoff *= 2;
    }
  }
  throw lastError || new Error(`Failed after ${retries} retries`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { skills, resumeId, userId, targetRole } = await req.json();

    const JSEARCH_API_KEY = "2e5fcfd0a1mshc1aa2b1fef52977p1ed805jsnc8ebd212ecab";
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const DIRECT_URL = Deno.env.get("DIRECT_URL");

    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
    if (!DIRECT_URL) throw new Error("DIRECT_URL is not configured");
    if (!skills || skills.length === 0) throw new Error("No skills provided");

    const sql = postgres(DIRECT_URL);

    // Normalize skills and create search query
    const normalizedSkills: string[] = skills.map((s: any) => typeof s === 'string' ? s : (s?.name || s?.skill || s?.title || String(s ?? '')));
    const topSkills = normalizedSkills.slice(0, 3).join(", ");
    const searchQuery = `${topSkills} developer in India`;

    console.log("Searching JSearch for:", searchQuery);

    const jsearchResponse = await fetch(`https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(searchQuery)}&num_pages=1&country=IN`, {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": JSEARCH_API_KEY,
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
      },
    });

    const allJobResults: JobResult[] = [];

    if (jsearchResponse.ok) {
      const searchData = await jsearchResponse.json();
      if (searchData.data && Array.isArray(searchData.data)) {
        for (const job of searchData.data) {
          const matchedSkills = normalizedSkills.filter((skill: string) =>
            (job.job_description || "").toLowerCase().includes(skill.toLowerCase())
          );
          // Calculate a realistic match percentage
          const matchPercentage = Math.min(98, Math.max(50, Math.round((matchedSkills.length / Math.max(1, normalizedSkills.length)) * 100) + 30));

          allJobResults.push({
            title: job.job_title || "Job Opening",
            company: job.employer_name || "Tech Company",
            location: `${job.job_city || 'India'}, ${job.job_country || 'IN'}`,
            description: (job.job_description || "").substring(0, 3000),
            url: job.job_apply_link || "",
            matchedSkills: matchedSkills.slice(0, 5),
            matchPercentage,
          });
        }
      }
    } else {
      console.error("JSearch API error:", await jsearchResponse.text());
    }

    const uniqueJobs = allJobResults.slice(0, 10);

    if (uniqueJobs.length > 0) {
      const enhancePrompt = `Given candidate skills (${normalizedSkills.join(", ")}), format these JSearch results into a consistent JSON array. IMPORTANT: Use the EXACT "url" provided as "applyUrl". Each object must have: jobTitle, companyType, companyName, location, matchPercentage(50-95), matchedSkills(string[]), requiredSkills(string[]), jobDescription(200+ words summary), salaryRange(INR or "Competitive"), applyUrl.

RAW RESULTS: ${JSON.stringify(uniqueJobs, null, 2)}`;

      const aiResponse = await fetchWithRetry("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-1.5-flash",
          messages: [
            { role: "system", content: "Job matching expert. Return only valid JSON array." },
            { role: "user", content: enhancePrompt },
          ],
        }),
      });

      if (aiResponse.ok) {
        const aiResult = await aiResponse.json();
        let enhancedText = aiResult.choices?.[0]?.message?.content || "";
        enhancedText = enhancedText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

        try {
          const enhancedJobs = JSON.parse(enhancedText);

          if (resumeId && userId && Array.isArray(enhancedJobs)) {
            await sql`DELETE FROM public.job_recommendations WHERE resume_id = ${resumeId}::uuid AND user_id = ${userId}::uuid`;

            for (const job of enhancedJobs) {
              await sql`INSERT INTO public.job_recommendations (resume_id, user_id, job_title, company_type, match_percentage, matched_skills, required_skills, job_description, salary_range, apply_url)
                VALUES (${resumeId}::uuid, ${userId}::uuid, ${job.jobTitle || "Job"}, ${job.companyName || "Top Company"}, ${job.matchPercentage || 70}, ${JSON.stringify(job.matchedSkills || [])}, ${JSON.stringify(job.requiredSkills || [])}, ${job.jobDescription || ""}, ${job.salaryRange || "Competitive"}, ${job.applyUrl || ""})`;
            }
          }

          return new Response(JSON.stringify({ success: true, jobs: enhancedJobs }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (parseError) {
          console.error("Parse error:", parseError);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, jobs: uniqueJobs }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function extractCompany(text: string): string {
  const linkedinMatch = text.match(/linkedin\.com\/company\/([^\/\?]+)/i);
  if (linkedinMatch) return linkedinMatch[1].replace(/-/g, " ");
  const indeedMatch = text.match(/indeed\.co\.in\/cmp\/([^\/\?]+)/i);
  if (indeedMatch) return indeedMatch[1].replace(/-/g, " ");
  return "Tech Company";
}

function extractIndiaLocation(text: string): string {
  const lower = text.toLowerCase();
  const cities = ["Bangalore", "Bengaluru", "Mumbai", "Delhi", "Gurgaon", "Gurugram", "Hyderabad", "Chennai", "Pune", "Kolkata", "Noida", "Ahmedabad"];
  for (const city of cities) {
    if (lower.includes(city.toLowerCase())) return `${city}, India`;
  }
  if (lower.includes("remote") && lower.includes("india")) return "Remote, India";
  return "India (Remote/Hybrid)";
}

function removeDuplicates(jobs: JobResult[]): JobResult[] {
  const seen = new Set<string>();
  return jobs.filter(job => {
    const key = `${job.title.toLowerCase()}-${job.company.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
