/**
 * Delete non-north directional tiles for all buildings
 * Usage: pnpm tsx apps/ssh-world/src/scripts/delete-building-directions.ts
 */

import 'dotenv/config';
import { db, schema } from '@maldoror/db';
import { ne } from 'drizzle-orm';

async function main() {
  console.log('Deleting all non-north tiles from database...');

  await db.delete(schema.buildingTiles)
    .where(ne(schema.buildingTiles.direction, 'north'));

  console.log('Deleted all non-north tiles');

  const remaining = await db.select().from(schema.buildingTiles);
  console.log('Remaining tiles:', remaining.length);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
