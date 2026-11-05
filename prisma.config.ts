import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // `DB_TARGET=test` points migrate commands at the integration-test database.
    url: process.env.DB_TARGET === "test" ? env("TEST_DATABASE_URL") : env("DATABASE_URL"),
  },
});
