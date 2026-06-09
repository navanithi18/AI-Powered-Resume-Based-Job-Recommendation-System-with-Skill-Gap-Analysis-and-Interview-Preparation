import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const DIRECT_URL = Deno.env.get("DIRECT_URL")!;
    if (!DIRECT_URL) throw new Error("DIRECT_URL is not configured");

    const sql = postgres(DIRECT_URL, { ssl: 'require' });
    const { action, params } = await req.json();

    let result: any;

    switch (action) {
      // ===== PROFILES =====
      case "upsert_profile": {
        const { user_id, email, full_name } = params;
        result = await sql`
          INSERT INTO public.profiles (user_id, email, full_name)
          VALUES (${user_id}::uuid, ${email}, ${full_name})
          ON CONFLICT (user_id) DO UPDATE SET email = ${email}, full_name = ${full_name}, updated_at = now()
          RETURNING *
        `;
        break;
      }

      // ===== RESUMES =====
      case "create_resume": {
        const { user_id, file_name, file_url, target_role } = params;
        result = await sql`
          INSERT INTO public.resumes (user_id, file_name, file_url, target_role, status)
          VALUES (${user_id}::uuid, ${file_name}, ${file_url}, ${target_role || ''}, 'pending')
          RETURNING *
        `;
        break;
      }

      case "update_resume_status": {
        const { id, status, raw_text } = params;
        if (raw_text) {
          result = await sql`
            UPDATE resumes SET status = ${status}::analysis_status, raw_text = ${raw_text}, updated_at = now()
            WHERE id = ${id}::uuid RETURNING *
          `;
        } else {
          result = await sql`
            UPDATE public.resumes SET status = ${status}::analysis_status, updated_at = now()
            WHERE id = ${id}::uuid RETURNING *
          `;
        }
        break;
      }

      case "get_user_resumes": {
        const { user_id } = params;
        const resumes = await sql`SELECT * FROM public.resumes WHERE user_id = ${user_id}::uuid ORDER BY created_at DESC`;

        // Fetch related data for each resume
        const enriched = [];
        for (const resume of resumes) {
          const [analysis, jobs, gaps, questions] = await Promise.all([
            sql`SELECT * FROM public.resume_analysis WHERE resume_id = ${resume.id}::uuid`,
            sql`SELECT * FROM public.job_recommendations WHERE resume_id = ${resume.id}::uuid`,
            sql`SELECT * FROM public.skill_gaps WHERE resume_id = ${resume.id}::uuid`,
            sql`SELECT * FROM public.interview_questions WHERE resume_id = ${resume.id}::uuid`,
          ]);
          enriched.push({
            ...resume,
            resume_analysis: analysis,
            job_recommendations: jobs,
            skill_gaps: gaps,
            interview_questions: questions,
          });
        }
        result = enriched;
        break;
      }

      case "get_resume_by_id": {
        const { id } = params;
        const resumes = await sql`SELECT * FROM resumes WHERE id = ${id}::uuid`;
        if (resumes.length === 0) {
          result = null;
          break;
        }
        const resume = resumes[0];
        const [analysis, jobs, gaps, questions] = await Promise.all([
          sql`SELECT * FROM public.resume_analysis WHERE resume_id = ${resume.id}::uuid`,
          sql`SELECT * FROM public.job_recommendations WHERE resume_id = ${resume.id}::uuid`,
          sql`SELECT * FROM public.skill_gaps WHERE resume_id = ${resume.id}::uuid`,
          sql`SELECT * FROM public.interview_questions WHERE resume_id = ${resume.id}::uuid`,
        ]);
        result = {
          ...resume,
          resume_analysis: analysis,
          job_recommendations: jobs,
          skill_gaps: gaps,
          interview_questions: questions,
        };
        break;
      }

      // ===== RESUME ANALYSIS =====
      case "save_analysis": {
        const { resume_id, user_id, ats_score, extracted_skills, education, experience, projects, certifications, strengths, weaknesses, missing_keywords, improvement_tips } = params;
        result = await sql`
          INSERT INTO public.resume_analysis (resume_id, user_id, ats_score, extracted_skills, education, experience, projects, certifications, strengths, weaknesses, missing_keywords, improvement_tips)
          VALUES (${resume_id}::uuid, ${user_id}::uuid, ${ats_score}, ${JSON.stringify(extracted_skills)}, ${JSON.stringify(education)}, ${JSON.stringify(experience)}, ${JSON.stringify(projects)}, ${JSON.stringify(certifications)}, ${JSON.stringify(strengths)}, ${JSON.stringify(weaknesses)}, ${JSON.stringify(missing_keywords)}, ${JSON.stringify(improvement_tips)})
          RETURNING *
        `;
        break;
      }

      // ===== JOB RECOMMENDATIONS =====
      case "save_job_recommendations": {
        const { records } = params;
        result = [];
        for (const job of records) {
          const r = await sql`
            INSERT INTO public.job_recommendations (resume_id, user_id, job_title, company_type, match_percentage, matched_skills, required_skills, job_description, salary_range, apply_url)
            VALUES (${job.resume_id}::uuid, ${job.user_id}::uuid, ${job.job_title}, ${job.company_type}, ${job.match_percentage}, ${JSON.stringify(job.matched_skills || [])}, ${JSON.stringify(job.required_skills || [])}, ${job.job_description}, ${job.salary_range}, ${job.apply_url || ''})
            RETURNING *
          `;
          result.push(r[0]);
        }
        break;
      }

      case "delete_job_recommendations": {
        const { resume_id, user_id } = params;
        await sql`DELETE FROM public.job_recommendations WHERE resume_id = ${resume_id}::uuid AND user_id = ${user_id}::uuid`;
        result = { deleted: true };
        break;
      }

      // ===== SKILL GAPS =====
      case "save_skill_gaps": {
        const { records } = params;
        result = [];
        for (const gap of records) {
          const r = await sql`
            INSERT INTO public.skill_gaps (resume_id, user_id, skill_name, category, importance, learning_resources)
            VALUES (${gap.resume_id}::uuid, ${gap.user_id}::uuid, ${gap.skill_name}, ${gap.category}::skill_category, ${gap.importance}, ${JSON.stringify(gap.learning_resources)})
            RETURNING *
          `;
          result.push(r[0]);
        }
        break;
      }

      // ===== INTERVIEW QUESTIONS =====
      case "save_interview_questions": {
        const { records } = params;
        result = [];
        for (const q of records) {
          const r = await sql`
            INSERT INTO public.interview_questions (resume_id, user_id, job_role, question, category, difficulty, suggested_answer)
            VALUES (${q.resume_id}::uuid, ${q.user_id}::uuid, ${q.job_role}, ${q.question}, ${q.category}::question_category, ${q.difficulty}::question_difficulty, ${q.suggested_answer})
            RETURNING *
          `;
          result.push(r[0]);
        }
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Neon DB error:", error);
    const errorInfo = {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      details: String(error)
    };
    return new Response(JSON.stringify({ error: errorInfo }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
