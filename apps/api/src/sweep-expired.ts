import "dotenv/config";
import { prisma } from "./db.js";
import { runMaintenanceTask } from "./services/maintenance.js";

try {
  const result = await runMaintenanceTask(prisma, { task: "sweepExpired" });
  console.log(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
