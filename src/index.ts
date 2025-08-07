import "./config/index.js";
import { generateEnvExample } from "./config/utils.js";
import { bootstrap } from "./server.js";

async function main() {
  if (process.env.NODE_ENV !== "production") {
    await generateEnvExample(); // вот он, генератор
  }
  await bootstrap();
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
