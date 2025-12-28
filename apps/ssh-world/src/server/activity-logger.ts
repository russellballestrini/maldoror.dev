/**
 * Unified Activity Logger
 *
 * Provides a single timeline of all activities (chat, actions, lifecycle events)
 * for display on the /chat page and storage in the database.
 */

import { db, schema } from '@maldoror/db';
import { desc } from 'drizzle-orm';

// Activity types (matches database schema)
export type ActivityType =
  | 'chat'
  | 'emote'
  | 'move'
  | 'propose_event'
  | 'join_event'
  | 'propose_family'
  | 'accept_family'
  | 'reject_family'
  | 'birth'
  | 'death'
  | 'mourn'
  | 'stage_change';

// In-memory buffer for fast access (also persisted to DB)
const MAX_ACTIVITY_ENTRIES = 500;

export interface UnifiedActivityEntry {
  id: string;
  timestamp: Date;
  actorId: string;
  actorName: string;
  actorType: 'player' | 'auton';
  activityType: ActivityType;
  message?: string;
  actionDetails?: {
    direction?: string;
    fromX?: number;
    fromY?: number;
    toX?: number;
    toY?: number;
    eventId?: string;
    eventName?: string;
    partnerId?: string;
    partnerName?: string;
    parent1Id?: string;
    parent1Name?: string;
    parent2Id?: string;
    parent2Name?: string;
    childId?: string;
    childName?: string;
    causeOfDeath?: string;
    deceasedId?: string;
    deceasedName?: string;
    oldStage?: string;
    newStage?: string;
    emotion?: string;
  };
  locationX?: number;
  locationY?: number;
}

const activityBuffer: UnifiedActivityEntry[] = [];

/**
 * Add an activity to the unified log
 */
export async function addUnifiedActivity(
  entry: Omit<UnifiedActivityEntry, 'id' | 'timestamp'>
): Promise<void> {
  const now = new Date();
  const id = crypto.randomUUID();

  // Add to in-memory buffer
  activityBuffer.push({
    ...entry,
    id,
    timestamp: now,
  });

  // Trim buffer if needed
  while (activityBuffer.length > MAX_ACTIVITY_ENTRIES) {
    activityBuffer.shift();
  }

  // Also persist to database
  try {
    await db.insert(schema.unifiedActivityLog).values({
      actorId: entry.actorId,
      actorName: entry.actorName,
      actorType: entry.actorType,
      activityType: entry.activityType,
      message: entry.message,
      actionDetails: entry.actionDetails,
      locationX: entry.locationX,
      locationY: entry.locationY,
    });
  } catch (error) {
    // Log but don't fail if DB insert fails
    console.error('[ActivityLogger] Failed to persist activity:', error);
  }
}

/**
 * Get recent activities from the buffer
 */
export function getUnifiedActivities(limit: number = 100): UnifiedActivityEntry[] {
  return activityBuffer.slice(-limit).reverse();
}

/**
 * Get activities from the database (for longer history)
 */
export async function getActivitiesFromDb(limit: number = 100): Promise<UnifiedActivityEntry[]> {
  const rows = await db
    .select()
    .from(schema.unifiedActivityLog)
    .orderBy(desc(schema.unifiedActivityLog.createdAt))
    .limit(limit);

  type ActivityRow = typeof schema.unifiedActivityLog.$inferSelect;
  return rows.map((row: ActivityRow): UnifiedActivityEntry => ({
    id: row.id,
    timestamp: row.createdAt,
    actorId: row.actorId,
    actorName: row.actorName,
    actorType: row.actorType as 'player' | 'auton',
    activityType: row.activityType as ActivityType,
    message: row.message || undefined,
    actionDetails: row.actionDetails as UnifiedActivityEntry['actionDetails'],
    locationX: row.locationX || undefined,
    locationY: row.locationY || undefined,
  }));
}

/**
 * Format an activity for display
 */
export function formatActivityForDisplay(activity: UnifiedActivityEntry): string {
  const { activityType, message, actionDetails } = activity;

  switch (activityType) {
    case 'chat':
      return message || '';

    case 'emote':
      return `*${message || 'emotes'}*`;

    case 'move':
      const dir = actionDetails?.direction || 'somewhere';
      return `*moves ${dir}*`;

    case 'propose_event':
      return `*proposes ${actionDetails?.eventName || 'an event'}*`;

    case 'join_event':
      return `*joins ${actionDetails?.eventName || 'an event'}*`;

    case 'propose_family':
      return `*proposes having a family with ${actionDetails?.partnerName || 'someone'}*`;

    case 'accept_family':
      return `*accepts ${actionDetails?.partnerName || 'their partner'}'s proposal*`;

    case 'reject_family':
      return `*declines ${actionDetails?.partnerName || 'their partner'}'s proposal*`;

    case 'birth':
      const parents = actionDetails?.parent1Name && actionDetails?.parent2Name
        ? `(parents: ${actionDetails.parent1Name} & ${actionDetails.parent2Name})`
        : '';
      return `*${actionDetails?.childName || 'a baby'} was born* ${parents}`;

    case 'death':
      return `*passed away peacefully*`;

    case 'mourn':
      return `*mourns for ${actionDetails?.deceasedName || 'a loved one'}*`;

    case 'stage_change':
      return `*grew from ${actionDetails?.oldStage || 'younger'} to ${actionDetails?.newStage || 'older'}*`;

    default:
      return message || `*${activityType}*`;
  }
}

/**
 * Helper to log a chat message as unified activity
 */
export async function logChatActivity(
  senderId: string,
  senderName: string,
  senderType: 'player' | 'auton',
  message: string,
  position?: { x: number; y: number }
): Promise<void> {
  await addUnifiedActivity({
    actorId: senderId,
    actorName: senderName,
    actorType: senderType,
    activityType: 'chat',
    message,
    locationX: position?.x,
    locationY: position?.y,
  });
}

/**
 * Helper to log an emote as unified activity
 */
export async function logEmoteActivity(
  actorId: string,
  actorName: string,
  actorType: 'player' | 'auton',
  emote: string,
  position?: { x: number; y: number }
): Promise<void> {
  await addUnifiedActivity({
    actorId,
    actorName,
    actorType,
    activityType: 'emote',
    message: emote,
    locationX: position?.x,
    locationY: position?.y,
  });
}

/**
 * Helper to log a movement as unified activity
 */
export async function logMoveActivity(
  actorId: string,
  actorName: string,
  actorType: 'player' | 'auton',
  direction: string,
  from: { x: number; y: number },
  to: { x: number; y: number }
): Promise<void> {
  await addUnifiedActivity({
    actorId,
    actorName,
    actorType,
    activityType: 'move',
    actionDetails: {
      direction,
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
    },
    locationX: to.x,
    locationY: to.y,
  });
}

/**
 * Helper to log a birth event
 */
export async function logBirthActivity(
  parent1Id: string,
  parent1Name: string,
  parent2Id: string,
  parent2Name: string,
  childId: string,
  childName: string,
  position: { x: number; y: number }
): Promise<void> {
  await addUnifiedActivity({
    actorId: childId,
    actorName: childName,
    actorType: 'auton',
    activityType: 'birth',
    actionDetails: {
      parent1Id,
      parent1Name,
      parent2Id,
      parent2Name,
      childId,
      childName,
    },
    locationX: position.x,
    locationY: position.y,
  });
}

/**
 * Helper to log a death event
 */
export async function logDeathActivity(
  deceasedId: string,
  deceasedName: string,
  causeOfDeath: string,
  position?: { x: number; y: number }
): Promise<void> {
  await addUnifiedActivity({
    actorId: deceasedId,
    actorName: deceasedName,
    actorType: 'auton',
    activityType: 'death',
    actionDetails: {
      causeOfDeath,
      deceasedId,
      deceasedName,
    },
    locationX: position?.x,
    locationY: position?.y,
  });
}

/**
 * Helper to log a lifecycle stage change
 */
export async function logStageChangeActivity(
  npcId: string,
  npcName: string,
  oldStage: string,
  newStage: string,
  position?: { x: number; y: number }
): Promise<void> {
  await addUnifiedActivity({
    actorId: npcId,
    actorName: npcName,
    actorType: 'auton',
    activityType: 'stage_change',
    actionDetails: {
      oldStage,
      newStage,
    },
    locationX: position?.x,
    locationY: position?.y,
  });
}
