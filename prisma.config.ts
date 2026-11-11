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
    // Migrations need a direct (non-pooled) connection on Neon, so prefer
    // DATABASE_URL_UNPOOLED and fall back to DATABASE_URL (e.g. local Docker).
    url:
      process.env.DB_TARGET === "test"
        ? env("TEST_DATABASE_URL")
        : process.env.DATABASE_URL_UNPOOLED
          ? env("DATABASE_URL_UNPOOLED")
          : env("DATABASE_URL"),
  },
});
