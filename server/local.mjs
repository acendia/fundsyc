import { createApp } from "./app.mjs";

const app = createApp(() => process.env.DATABASE_URL, { demoInvitations: true });
app.listen(3001, "127.0.0.1", () => console.log("api running at http://127.0.0.1:3001"));
