import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import { createApp } from "./app.mjs";

const app = createApp(() => env.HYPERDRIVE.connectionString, { authUrl: env.SUPABASE_URL, authKey: env.SUPABASE_PUBLISHABLE_KEY });
app.listen(3001);
export default httpServerHandler({ port: 3001 });
