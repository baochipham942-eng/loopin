import { PrismaClient } from "@prisma/client";

/** Prisma 单例。测试用 setTestPrisma 注入独立 db。 */
export const prisma = new PrismaClient();
