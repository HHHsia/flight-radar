import "dotenv/config";
import { createTursoClient } from "../db/repositories.js";
import { loadEnvironment, getTursoConnectionConfig } from "../config/env.js";

async function main(): Promise<void> {
  const env = loadEnvironment();
  const client = createTursoClient(getTursoConnectionConfig(env));

  const before = await client.execute(`
    SELECT id, origin_airport_code, destination_airport_code, is_active
    FROM tracked_destinations
    ORDER BY id
  `);

  console.log(`[deactivate-all-tracked-destinations] rows before: ${before.rows.length}`);

  await client.execute(`
    UPDATE tracked_destinations
    SET is_active = 0,
        updated_at = CURRENT_TIMESTAMP
  `);

  const after = await client.execute(`
    SELECT id, origin_airport_code, destination_airport_code, is_active
    FROM tracked_destinations
    ORDER BY id
  `);

  console.log(`[deactivate-all-tracked-destinations] all routes set to is_active = 0`);
  for (const row of after.rows) {
    console.log(
      `- ${String(row.id)}: ${String(row.origin_airport_code)} -> ${String(row.destination_airport_code)} (active=${String(row.is_active)})`
    );
  }

  await client.close();
}

void main().catch((error) => {
  console.error("[deactivate-all-tracked-destinations] failed", error);
  process.exitCode = 1;
});
