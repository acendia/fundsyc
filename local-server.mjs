import { createApp } from "./server.mjs";

const app = createApp(() => process.env.DATABASE_URL);
app.listen(3001, "127.0.0.1", () => console.log("api running at http://127.0.0.1:3001"));
