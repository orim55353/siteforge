import { createClient } from "@supabase/supabase-js";

const BUCKET = "preview-pages";

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  }
  return createClient(url, key);
}

/**
 * Upload rendered HTML to Supabase Storage.
 * Returns the public URL of the uploaded file.
 */
export async function uploadToSupabase(slug: string, html: string): Promise<string> {
  const supabase = getSupabaseClient();
  const filePath = `${slug}.html`;

  const body = new Blob([html], { type: "text/html" });

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, body, {
      contentType: "text/html",
      upsert: true,
    });

  if (error) {
    throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }

  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(filePath);

  return urlData.publicUrl;
}
