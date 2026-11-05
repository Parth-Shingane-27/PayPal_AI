import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { coreConfig } from "./config";

export type Tx = Prisma.TransactionClient;
/** Either the root client or a transaction client. */
export type Db = PrismaClient | Tx;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: coreConfig().DATABASE_URL });
  return new PrismaClient({ adapter });
}

/** One client per process (kept across Next.js dev reloads). */
export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
