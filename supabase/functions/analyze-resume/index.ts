import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import postgres from "https://deno.land/x/postgresjs/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

function fallbackTextExtraction(fileBytes: Uint8Array, fileName: string): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(fileBytes);
    const parts: string[] = [];
    const emails = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    parts.push(...emails);
    const phones = text.match(/[\+]?[(]?[0-9]{1,3}[)]?[-\s\.]?[0-9]{3,4}[-\s\.]?[0-9]{4,6}/g) || [];
    parts.push(...phones);
    if (fileName.toLowerCase().includes('.docx')) {
      const wt = text.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
      wt.forEach(m => { const c = m.replace(/<[^>]+>/g, '').trim(); if (c.length > 2) parts.push(c); });
    }
    const readable = text.match(/[A-Za-z][A-Za-z\s,.\-'@0-9]{10,100}/g) || [];
    parts.push(...readable);
    return [...new Set(parts)].join(' ').replace(/\s+/g, ' ').trim();
  } catch { return ''; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resumeId, userId, fileName, filePath, targetRole } = await req.json();
    console.log("Starting analysis for:", resumeId, fileName);

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const DIRECT_URL = Deno.env.get("DIRECT_URL");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
    if (!DIRECT_URL) throw new Error("DIRECT_URL is not configured");

    const sql = postgres(DIRECT_URL);
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await sql`UPDATE public.resumes SET status = 'processing'::analysis_status WHERE id = ${resumeId}::uuid`;

    // Step 1: Download and extract text
    let resumeText = '';
    if (filePath) {
      const { data: signedData, error: signedError } = await supabase.storage
        .from('resumes')
        .createSignedUrl(filePath, 60);
      if (signedError) throw new Error('Failed to create signed URL');

      const fileResponse = await fetch(signedData.signedUrl);
      if (!fileResponse.ok) throw new Error('Failed to download resume file');

      const fileBytes = new Uint8Array(await fileResponse.arrayBuffer());

      // For .txt files, decode directly
      if (fileName.toLowerCase().endsWith('.txt')) {
        resumeText = new TextDecoder('utf-8').decode(fileBytes).trim();
      } else {
        // For PDF/DOCX, send as base64 to AI for extraction
        let binaryString = '';
        const chunkSize = 8192;
        for (let i = 0; i < fileBytes.length; i += chunkSize) {
          const chunk = fileBytes.slice(i, i + chunkSize);
          binaryString += String.fromCharCode(...chunk);
        }
        const base64Data = btoa(binaryString);
        const mimeType = fileName.toLowerCase().endsWith('.pdf')
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

        try {
          const extractResponse = await fetchWithRetry("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${GEMINI_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-1.5-flash",
              messages: [
                {
                  role: "user", content: [
                    { type: "text", text: "Extract ALL text content from this document. Return ONLY the extracted text, no formatting or JSON." },
                    { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } }
                  ]
                },
              ],
            }),
          });

          if (extractResponse.ok) {
            const result = await extractResponse.json();
            resumeText = (result.choices?.[0]?.message?.content || '').trim();
          } else {
            resumeText = fallbackTextExtraction(fileBytes, fileName);
          }
        } catch {
          resumeText = fallbackTextExtraction(fileBytes, fileName);
        }
      }
    }

    console.log("Extracted text length:", resumeText.length);

    if (resumeText.length < 50) {
      resumeText = `Resume file: ${fileName}. Limited text extraction available.`;
    }

    const truncatedText = resumeText.length > 8000 ? resumeText.substring(0, 8000) : resumeText;

    // Step 2: SINGLE combined AI call for NLP + Analysis (saves ~20s)
    const combinedPrompt = `You are a strict ATS (Applicant Tracking System) analyzer. 
      Your task is to analyze the following resume strictly against the target role: "${targetRole || 'General Profile'}".

      CRITICAL RULES:
      1. The "atsScore" MUST reflect how well this specific resume matches the "${targetRole || 'General Profile'}" role.
      2. If the resume is completely irrelevant to the target role (e.g., a "Chef" resume for a "Software Engineer" role), the score MUST be below 20.
      3. Be highly critical. Do not give high scores unless the skills and experience explicitly match the target role.
      4. If no target role is provided, analyze based on the candidate's most prominent experience.

      Return a single JSON object with:
1. "personalInfo": { name, email, phone, location, linkedin }
2. "skills": { "technical": [], "tools": [], "softSkills": [], "certifications": [] }
3. "experience": [{ company, role, duration, highlights[] }]
4. "education": [{ institution, degree, year }]
5. "projects": [{ name, description, technologies[] }]
8. "weaknesses": string[] (CRITICAL: List specific missing qualifications for ${targetRole || 'the role'})
9. "missingKeywords": string[] (Industry standard keywords for ${targetRole || ''})
10. "improvementTips": string[] (How to pivot this resume towards a ${targetRole || ''} career)
...
NOTE: If the resume content is primarily about a different field than ${targetRole}, you MUST keep the atsScore extremely low (below 30) regardless of how well-written the resume is.
...
RESUME TEXT:
${truncatedText}`;

    console.log("Sending combined AI analysis request...");

    const analysisResponse = await fetchWithRetry("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GEMINI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-1.5-flash",
        messages: [
          { role: "system", content: "Expert career coach and resume analyst. Return only valid JSON, no markdown." },
          { role: "user", content: combinedPrompt },
        ],
      }),
    });

    if (!analysisResponse.ok) {
      const status = analysisResponse.status;
      console.error("AI analysis failed with status:", status);
      if (status === 429) {
        await sql`UPDATE public.resumes SET status = 'failed'::analysis_status WHERE id = ${resumeId}::uuid`;
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI analysis failed: ${status}`);
    }

    const analysisResult = await analysisResponse.json();
    let analysisText = analysisResult.choices?.[0]?.message?.content || "";
    analysisText = analysisText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const analysis = JSON.parse(analysisText);

    console.log("AI analysis complete, ATS score:", analysis.atsScore);

    const allSkills = [
      ...(analysis.skills?.technical || []),
      ...(analysis.skills?.tools || []),
      ...(analysis.skills?.softSkills || []),
      ...(analysis.skills?.certifications || []),
    ].filter((s: string, i: number, arr: string[]) => s && arr.indexOf(s) === i);

    // Step 3: Save to Neon (parallel inserts)
    const savePromises = [];

    savePromises.push(
      sql`INSERT INTO public.resume_analysis (resume_id, user_id, ats_score, extracted_skills, education, experience, projects, certifications, strengths, weaknesses, missing_keywords, improvement_tips)
        VALUES (${resumeId}::uuid, ${userId}::uuid, ${analysis.atsScore || 65}, ${JSON.stringify(allSkills)}, ${JSON.stringify(analysis.education || [])}, ${JSON.stringify(analysis.experience || [])}, ${JSON.stringify(analysis.projects || [])}, ${JSON.stringify(analysis.skills?.certifications || [])}, ${JSON.stringify(analysis.strengths || [])}, ${JSON.stringify(analysis.weaknesses || [])}, ${JSON.stringify(analysis.missingKeywords || [])}, ${JSON.stringify(analysis.improvementTips || [])})`
    );

    if (analysis.skillGaps?.length > 0) {
      for (const gap of analysis.skillGaps) {
        savePromises.push(
          sql`INSERT INTO public.skill_gaps (resume_id, user_id, skill_name, category, importance, learning_resources)
            VALUES (${resumeId}::uuid, ${userId}::uuid, ${gap.skillName}, ${gap.category || 'technical'}::skill_category, ${gap.importance || 'medium'}, ${JSON.stringify(gap.learningResources || [])})`
        );
      }
    }

    if (analysis.interviewQuestions?.length > 0) {
      for (const q of analysis.interviewQuestions) {
        savePromises.push(
          sql`INSERT INTO public.interview_questions (resume_id, user_id, job_role, question, category, difficulty, suggested_answer)
            VALUES (${resumeId}::uuid, ${userId}::uuid, ${q.jobRole || 'General'}, ${q.question}, ${q.category || 'technical'}::question_category, ${q.difficulty || 'intermediate'}::question_difficulty, ${q.suggestedAnswer || ''})`
        );
      }
    }

    savePromises.push(
      sql`UPDATE resumes SET raw_text = ${truncatedText.substring(0, 5000)}, status = 'completed'::analysis_status WHERE id = ${resumeId}::uuid`
    );

    await Promise.all(savePromises);
    console.log("All data saved to Neon");

    // Step 4: Trigger job scraping (fire-and-forget, don't await)
    fetch(`${supabaseUrl}/functions/v1/scrape-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
      body: JSON.stringify({ skills: allSkills.slice(0, 10), resumeId, userId, targetRole }),
    }).catch(e => console.error('Job scraping trigger error:', e));

    return new Response(JSON.stringify({ success: true, analysis: { ...analysis, extractedSkills: allSkills } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error:", error);
    try {
      const DIRECT_URL = Deno.env.get("DIRECT_URL");
      if (DIRECT_URL) {
        const sql = postgres(DIRECT_URL);
        const { resumeId } = await req.clone().json();
        if (resumeId) await sql`UPDATE public.resumes SET status = 'failed'::analysis_status WHERE id = ${resumeId}::uuid`;
      }
    } catch { }
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
