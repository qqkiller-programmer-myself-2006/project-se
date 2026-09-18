// Prisma 7 config (Stage 1). URL comes from the environment only — this stage
// creates no .env file and makes no database connection. validate / format /
// generate / migrate-diff-from-empty never connect; a later stage will point
// DATABASE_URL at a real MySQL for db pull / migrate.
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
