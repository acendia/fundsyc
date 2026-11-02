import { execFileSync } from "node:child_process";
import { createApp } from "./app.mjs";

let status = "";
try { status = execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { console.error("start local supabase before starting the app"); process.exit(1); }
const value = (name) => status.match(new RegExp(`^${name}="([^"]+)"`, "m"))?.[1];
const app = createApp(() => value("DB_URL"), { authUrl: value("API_URL"), authKey: value("ANON_KEY") });
app.listen(3001, "127.0.0.1", () => console.log("api running at http://127.0.0.1:3001"));
