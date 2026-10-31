import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import { createApp } from "./server.mjs";

const app = createApp(() => env.HYPERDRIVE.connectionString);
app.listen(3001);
export default httpServerHandler({ port: 3001 });
