import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: process.env["RAK_DATABASE_URL"] ?? "../../state/rak.sqlite" },
  strict: true,
  verbose: true,
});
