import "dotenv/config";
import { defineConfig, env } from "prisma/config"; // Added 'env' here

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Prisma's built-in env helper reads the variable directly
    url: env("DIRECT_URL"), 
  },
});