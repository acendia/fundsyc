import { createClient } from "@supabase/supabase-js";

export const maxDocumentBytes = 10 * 1024 * 1024;
export function createDocumentStorage(url, key, bucket = "proposal-documents") {
  if (!url || !key) return null;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let ready;
  async function ensureBucket() {
    if (!ready) ready = (async () => {
      let { data, error } = await client.storage.getBucket(bucket);
      if (error && String(error.statusCode) !== "404") throw error;
      if (!data) {
        const result = await client.storage.createBucket(bucket, { public: false, fileSizeLimit: maxDocumentBytes });
        if (result.error) {
          const existing = await client.storage.getBucket(bucket);
          if (existing.error) throw result.error;
          data = existing.data;
        }
      }
      if (data?.public) throw new Error("Document storage must be private.");
    })().catch((error) => { ready = undefined; throw error; });
    await ready;
  }
  return {
    async upload(path, bytes, contentType) {
      await ensureBucket();
      const { error } = await client.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
      if (error) throw error;
    },
    async download(path) {
      await ensureBucket();
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error) throw error;
      return data;
    },
    async discard(path) {
      const { error } = await client.storage.from(bucket).remove([path]);
      if (error) throw error;
    },
  };
}
