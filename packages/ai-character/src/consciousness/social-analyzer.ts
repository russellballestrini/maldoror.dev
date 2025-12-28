/**
 * Social Dynamics Analyzer
 *
 * Analyzes social situations, manages events, and facilitates emergent social behavior.
 * NPCs can propose gatherings, join events, and form social groups.
 */

import { db, schema } from '@maldoror/db';
import { eq, and, or, gte, desc, sql } from 'drizzle-orm';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { WorldEvent, SocialGathering, RecentChat, CognitiveAction } from './types.js';

type ChatHistoryRow = typeof schema.chatHistory.$inferSelect;

export class SocialAnalyzer {
  private openai: ReturnType<typeof createOpenAI>;

  constructor(apiKey: string) {
    this.openai = createOpenAI({ apiKey });
  }

  /**
   * Get active events near a location
   */
  async getNearbyEvents(x: number, y: number, radius = 50): Promise<WorldEvent[]> {
    const results = await db
      .select()
      .from(schema.worldEvents)
      .where(
        and(
          eq(schema.worldEvents.status, 'active'),
          sql`(${schema.worldEvents.location}->>'x')::int BETWEEN ${x - radius} AND ${x + radius}`,
          sql`(${schema.worldEvents.location}->>'y')::int BETWEEN ${y - radius} AND ${y + radius}`
        )
      )
      .orderBy(desc(schema.worldEvents.significance));

    return results.map(this.dbToWorldEvent);
  }

  /**
   * Get nearby social gatherings
   */
  async getNearbyGatherings(x: number, y: number, radius = 50): Promise<SocialGathering[]> {
    const results = await db
      .select()
      .from(schema.socialGatherings)
      .where(
        and(
          or(
            eq(schema.socialGatherings.status, 'planned'),
            eq(schema.socialGatherings.status, 'active')
          ),
          sql`(${schema.socialGatherings.location}->>'x')::int BETWEEN ${x - radius} AND ${x + radius}`,
          sql`(${schema.socialGatherings.location}->>'y')::int BETWEEN ${y - radius} AND ${y + radius}`
        )
      );

    return results.map(this.dbToGathering);
  }

  /**
   * Create a new social gathering
   */
  async createGathering(
    organizerId: string,
    organizerName: string,
    details: CognitiveAction['eventDetails']
  ): Promise<SocialGathering> {
    if (!details) throw new Error('Event details required');

    const [result] = await db
      .insert(schema.socialGatherings)
      .values({
        name: details.name,
        description: details.description,
        gatheringType: details.type,
        location: details.location,
        organizerId,
        invitedIds: [],
        attendeeIds: [organizerId],
        status: 'planned',
        scheduledFor: new Date(Date.now() + 5 * 60 * 1000), // 5 min from now
        mood: 'excited',
      })
      .returning();

    // Create world event for this gathering
    await db.insert(schema.worldEvents).values({
      eventType: 'gathering',
      title: details.name,
      description: `${organizerName} is organizing: ${details.description || details.name}`,
      location: details.location,
      initiatorId: organizerId,
      participants: [organizerId],
      status: 'planned',
      scheduledFor: new Date(Date.now() + 5 * 60 * 1000),
      significance: 0.6,
    });

    return this.dbToGathering(result!);
  }

  /**
   * Join an existing gathering
   */
  async joinGathering(gatheringId: string, userId: string): Promise<void> {
    const [gathering] = await db
      .select()
      .from(schema.socialGatherings)
      .where(eq(schema.socialGatherings.id, gatheringId))
      .limit(1);

    if (!gathering) return;

    const attendees = (gathering.attendeeIds as string[]) || [];
    if (!attendees.includes(userId)) {
      await db
        .update(schema.socialGatherings)
        .set({
          attendeeIds: [...attendees, userId],
          status: 'active',
        })
        .where(eq(schema.socialGatherings.id, gatheringId));
    }
  }

  /**
   * Get recent chat messages near a location
   */
  async getRecentChat(x: number, y: number, radius = 30, limit = 20): Promise<RecentChat[]> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const results = await db
      .select()
      .from(schema.chatHistory)
      .where(
        and(
          gte(schema.chatHistory.createdAt, fiveMinutesAgo),
          sql`(${schema.chatHistory.location}->>'x')::int BETWEEN ${x - radius} AND ${x + radius}`,
          sql`(${schema.chatHistory.location}->>'y')::int BETWEEN ${y - radius} AND ${y + radius}`
        )
      )
      .orderBy(desc(schema.chatHistory.createdAt))
      .limit(limit);

    return results.map((r: ChatHistoryRow) => ({
      senderId: r.senderId,
      senderName: r.senderName,
      message: r.message,
      location: r.location as { x: number; y: number },
      sentiment: r.sentiment || undefined,
      topics: (r.topics as string[]) || undefined,
      timestamp: r.createdAt,
    }));
  }

  /**
   * Store a chat message
   */
  async storeChatMessage(
    senderId: string,
    senderName: string,
    message: string,
    location: { x: number; y: number }
  ): Promise<void> {
    // Analyze message sentiment and topics
    const analysis = await this.analyzeMessage(message);

    await db.insert(schema.chatHistory).values({
      senderId,
      senderName,
      message,
      location,
      sentiment: analysis.sentiment,
      topics: analysis.topics,
      mentionedUserIds: analysis.mentions,
    });
  }

  /**
   * Analyze a chat message for sentiment and topics
   */
  private async analyzeMessage(message: string): Promise<{
    sentiment: number;
    topics: string[];
    mentions: string[];
  }> {
    try {
      const result = await generateText({
        model: this.openai('gpt-4o-mini'),
        system: `Analyze this chat message. Return JSON:
{
  "sentiment": -1 to 1 (negative to positive),
  "topics": ["topic1", "topic2"],
  "mentions": ["names mentioned"]
}`,
        prompt: message,
        maxTokens: 100,
        temperature: 0.3,
      });

      const json = JSON.parse(result.text.match(/\{[\s\S]*\}/)?.[0] || '{}');
      return {
        sentiment: json.sentiment || 0,
        topics: json.topics || [],
        mentions: json.mentions || [],
      };
    } catch {
      return { sentiment: 0, topics: [], mentions: [] };
    }
  }

  /**
   * Analyze social dynamics in an area (for world AI)
   */
  async analyzeSocialDynamics(x: number, y: number, radius = 50): Promise<{
    mood: string;
    activity: string;
    suggestions: string[];
  }> {
    const [chat, events, gatherings] = await Promise.all([
      this.getRecentChat(x, y, radius, 30),
      this.getNearbyEvents(x, y, radius),
      this.getNearbyGatherings(x, y, radius),
    ]);

    const avgSentiment = chat.length > 0
      ? chat.reduce((sum, c) => sum + (c.sentiment || 0), 0) / chat.length
      : 0;

    const allTopics = chat.flatMap(c => c.topics || []);
    const topicCounts = new Map<string, number>();
    for (const topic of allTopics) {
      topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
    }
    const hotTopics = [...topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([topic]) => topic);

    const mood = avgSentiment > 0.3 ? 'positive and lively' :
      avgSentiment < -0.3 ? 'tense or negative' :
      'calm and neutral';

    const activity = events.length > 0 || gatherings.length > 0
      ? `Active: ${[...events.map(e => e.title), ...gatherings.map(g => g.name)].join(', ')}`
      : chat.length > 5 ? 'Lots of conversation happening'
      : 'Quiet';

    const suggestions: string[] = [];
    if (chat.length < 3 && events.length === 0) {
      suggestions.push('This area could use some activity - consider starting a gathering');
    }
    if (avgSentiment < -0.2) {
      suggestions.push('The mood is low - someone could try to lift spirits');
    }
    if (hotTopics.length > 0) {
      suggestions.push(`People are talking about: ${hotTopics.join(', ')}`);
    }

    return { mood, activity, suggestions };
  }

  /**
   * Generate social event ideas based on current situation
   */
  async generateEventIdeas(
    npcName: string,
    npcPersonality: string,
    nearbyPeople: string[],
    location: { x: number; y: number }
  ): Promise<Array<{ name: string; type: SocialGathering['type']; description: string }>> {
    try {
      const result = await generateText({
        model: this.openai('gpt-4o-mini'),
        system: `You are helping ${npcName} come up with fun social event ideas.
Their personality: ${npcPersonality}

Generate 2-3 creative event ideas. Be imaginative!
Types: party, meeting, hangout, adventure, ritual

Return JSON array:
[{"name": "Event Name", "type": "party", "description": "Brief description"}]`,
        prompt: `Nearby people: ${nearbyPeople.join(', ') || 'various characters'}
Location: coordinates (${location.x}, ${location.y})

What interesting social events could ${npcName} propose?`,
        maxTokens: 300,
        temperature: 0.9,
      });

      const json = JSON.parse(result.text.match(/\[[\s\S]*\]/)?.[0] || '[]');
      return json;
    } catch {
      return [];
    }
  }

  private dbToWorldEvent(row: typeof schema.worldEvents.$inferSelect): WorldEvent {
    return {
      id: row.id,
      type: row.eventType as WorldEvent['type'],
      title: row.title,
      description: row.description,
      location: row.location as { x: number; y: number } | undefined,
      locationName: row.locationName || undefined,
      participants: (row.participants as string[]) || [],
      status: row.status as WorldEvent['status'],
      scheduledFor: row.scheduledFor || undefined,
      significance: row.significance || 0.5,
    };
  }

  private dbToGathering(row: typeof schema.socialGatherings.$inferSelect): SocialGathering {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      type: row.gatheringType as SocialGathering['type'],
      location: row.location as { x: number; y: number },
      locationName: row.locationName || undefined,
      organizerId: row.organizerId,
      attendees: (row.attendeeIds as string[]) || [],
      status: row.status as SocialGathering['status'],
      scheduledFor: row.scheduledFor || undefined,
      currentActivity: row.currentActivity || undefined,
      mood: row.mood || undefined,
    };
  }
}

export const createSocialAnalyzer = (apiKey: string) => new SocialAnalyzer(apiKey);
