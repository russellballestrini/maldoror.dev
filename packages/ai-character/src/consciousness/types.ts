/**
 * Consciousness Types
 *
 * Type definitions for the advanced NPC consciousness system.
 * Covers memory, emotions, relationships, goals, and cognitive processes.
 */

// ============ LIFECYCLE SYSTEM ============

export type LifecycleStage = 'baby' | 'child' | 'adult' | 'elder' | 'deceased';

export interface LineageInfo {
  npcId: string;
  parent1Id?: string;
  parent2Id?: string;
  parent1Name?: string;
  parent2Name?: string;
  generation: number;
  familyName?: string;
  stage: LifecycleStage;
  birthAt: Date;
  deathAt?: Date;
  expectedLifespanHours: number;
  ageHours: number;
  siblings: string[];
  children: string[];
  geneticTraits?: {
    dominantColors?: string[];
    recessiveColors?: string[];
    physicalFeatures?: string[];
    personalityTendencies?: string[];
  };
}

export interface ReproductionProposal {
  id: string;
  proposerId: string;
  proposerName?: string;
  partnerId: string;
  partnerName?: string;
  status: 'pending' | 'accepted' | 'rejected' | 'completed' | 'cancelled' | 'expired';
  proposedAt: Date;
  respondedAt?: Date;
  affectionLevel?: number;
  attractionLevel?: number;
  trustLevel?: number;
  proposalMessage?: string;
  childId?: string;
  birthScheduledAt?: Date;
}

export interface LifecycleConfig {
  babyDurationHours: number;
  childDurationHours: number;
  elderDurationHours: number;
  baseLifespanHours: number;
  lifespanVariancePercent: number;
  reproductionCooldownHours: number;
  gestationPeriodMinutes: number;
  softPopulationCap: number;
  hardPopulationCap: number;
  minPopulation: number;
  decisionIntervalByStage: {
    baby: number;
    child: number;
    adult: number;
    elder: number;
  };
}

// ============ MEMORY SYSTEM ============

export interface Memory {
  id: string;
  type: 'event' | 'conversation' | 'observation' | 'reflection' | 'plan';
  summary: string;
  details?: string;
  location?: { x: number; y: number };
  participants: string[];
  emotionalValence: number; // -1 to 1
  emotionalIntensity: number; // 0 to 1
  primaryEmotion?: string;
  importance: number; // 0 to 1
  tags: string[];
  createdAt: Date;
}

export interface MemoryQuery {
  npcId: string;
  types?: Memory['type'][];
  participantId?: string;
  emotionType?: string;
  minImportance?: number;
  limit?: number;
  recentFirst?: boolean;
  searchTerm?: string;
}

// ============ EMOTIONAL SYSTEM ============

export interface EmotionState {
  // Core emotions (intensity 0-1)
  joy: number;
  sadness: number;
  anger: number;
  fear: number;
  surprise: number;
  disgust: number;
  love: number;
  curiosity: number;
  boredom: number;
  loneliness: number;
  excitement: number;
  contentment: number;
  anxiety: number;
  pride: number;
  shame: number;
  jealousy: number;
  gratitude: number;
  hope: number;
}

export interface EmotionalNeeds {
  social: number;      // Need for interaction (0 = satisfied, 1 = desperate)
  exploration: number; // Need for novelty
  rest: number;        // Need for calm
  expression: number;  // Need to express self
  belonging: number;   // Need to be part of group
  recognition: number; // Need to be noticed
  safety: number;      // Need to feel secure
  intimacy: number;    // Need for close connection
}

export interface MoodState {
  valence: number; // -1 (negative) to 1 (positive)
  energy: number;  // 0 (lethargic) to 1 (energetic)
}

export interface FullEmotionalState {
  mood: MoodState;
  emotions: Partial<EmotionState>;
  needs: Partial<EmotionalNeeds>;
  currentFocus?: string;
  innerMonologue?: string;
}

// ============ RELATIONSHIP SYSTEM ============

export interface Relationship {
  id: string;
  targetId: string;
  targetName?: string;

  // Core dimensions (-1 to 1)
  familiarity: number;  // How well do I know them?
  affection: number;    // Do I like them?
  trust: number;        // Can I rely on them?
  respect: number;      // Do I admire them?
  attraction: number;   // Romantic/aesthetic attraction
  rivalry: number;      // Competitive feelings

  // Status
  type: 'stranger' | 'acquaintance' | 'friend' | 'close_friend' | 'rival' | 'enemy' | 'lover' | 'family';

  // History
  interactionCount: number;
  lastInteraction?: Date;
  firstMet: Date;

  // Qualitative
  impressions: string[];
  sharedExperiences: string[];
  currentFeeling?: string;
}

export interface RelationshipUpdate {
  familiarity?: number;
  affection?: number;
  trust?: number;
  respect?: number;
  attraction?: number;
  rivalry?: number;
  newImpression?: string;
  newExperience?: string;
  currentFeeling?: string;
}

// ============ GOAL SYSTEM ============

export interface Goal {
  id: string;
  type: 'innate' | 'emergent' | 'social' | 'exploration' | 'relationship' | 'event';
  description: string;
  motivation?: string;
  priority: number; // 0 to 1
  timeframe: 'immediate' | 'short' | 'medium' | 'long';
  status: 'active' | 'completed' | 'abandoned' | 'blocked';
  progress: number; // 0 to 1
  steps: string[];
  targetLocation?: { x: number; y: number };
  targetUserId?: string;
  expiresAt?: Date;
  createdAt: Date;
}

// ============ WORLD STATE ============

export interface VisibleEntity {
  id: string;
  name: string;
  type: 'player' | 'npc';
  x: number;
  y: number;
  distance: number;
  isNpc?: boolean;
}

export interface WorldEvent {
  id: string;
  type: 'gathering' | 'conflict' | 'discovery' | 'celebration' | 'arrival' | 'departure';
  title: string;
  description: string;
  location?: { x: number; y: number };
  locationName?: string;
  participants: string[];
  status: 'planned' | 'active' | 'completed' | 'cancelled';
  scheduledFor?: Date;
  significance: number;
}

export interface SocialGathering {
  id: string;
  name: string;
  description?: string;
  type: 'party' | 'meeting' | 'hangout' | 'adventure' | 'ritual';
  location: { x: number; y: number };
  locationName?: string;
  organizerId: string;
  organizerName?: string;
  attendees: string[];
  status: 'planned' | 'active' | 'completed' | 'cancelled';
  scheduledFor?: Date;
  currentActivity?: string;
  mood?: string;
}

export interface RecentChat {
  senderId: string;
  senderName: string;
  message: string;
  location: { x: number; y: number };
  sentiment?: number;
  topics?: string[];
  timestamp: Date;
}

// ============ COGNITIVE CONTEXT ============

export interface CognitiveContext {
  // Identity
  self: {
    id: string;
    name: string;
    personality: string;
    visualAppearance?: string;
  };

  // Lifecycle (optional, for NPCs with lineage)
  lifecycle?: {
    stage: LifecycleStage;
    ageHours: number;
    generation: number;
    familyName?: string;
    parent1Name?: string;
    parent2Name?: string;
    siblingNames: string[];
    childrenNames: string[];
  };

  // Pending proposals to respond to
  pendingFamilyProposals?: ReproductionProposal[];

  // Recent deaths of known entities
  recentDeaths?: Array<{
    deceasedId: string;
    deceasedName: string;
    relationship: string;
    deathAt: Date;
  }>;

  // Current state
  position: { x: number; y: number };
  direction: string;

  // Emotional state
  emotionalState: FullEmotionalState;

  // What I see
  visibleEntities: VisibleEntity[];
  nearbyLandmarks?: string[];

  // What I know
  relationships: Map<string, Relationship>;
  recentMemories: Memory[];
  activeGoals: Goal[];

  // World state
  activeEvents: WorldEvent[];
  nearbyGatherings: SocialGathering[];
  recentChat: RecentChat[];

  // Time context
  currentTime: Date;
  timeSinceLastDecision: number; // milliseconds
}

// ============ COGNITIVE PHASES ============

export interface PerceptionResult {
  summary: string;
  significantEntities: Array<{
    id: string;
    name: string;
    significance: string;
    relationship?: string;
  }>;
  environmentalNotes: string[];
  emotionalResonance?: string;
}

export interface MemoryRetrievalResult {
  relevantMemories: Array<{
    memory: Memory;
    relevance: string;
  }>;
  relationshipContext: Map<string, string>; // entityId -> summary
  patternRecognition?: string;
}

export interface EmotionalProcessingResult {
  currentMood: string;
  dominantEmotions: string[];
  emotionalNeeds: string[];
  innerThoughts: string;
  emotionalGoals?: string[];
}

export interface ReasoningResult {
  situationAssessment: string;
  options: Array<{
    action: string;
    reasoning: string;
    emotionalFit: number;
    socialImpact: string;
  }>;
  recommendations: string[];
  concerns?: string[];
}

export interface PlanningResult {
  immediateActions: CognitiveAction[];
  shortTermGoals?: Goal[];
  socialInitiatives?: string[];
  innerMonologue: string;
}

// ============ ACTIONS ============

export interface CognitiveAction {
  type:
    | 'move'
    | 'chat'
    | 'emote'
    | 'wait'
    | 'propose_event'
    | 'join_event'
    | 'leave_event'
    | 'approach'
    | 'avoid'
    // Reproduction actions
    | 'propose_family'
    | 'accept_family'
    | 'reject_family'
    // Grief actions
    | 'mourn';
  direction?: 'up' | 'down' | 'left' | 'right';
  message?: string;
  emote?: string;
  targetId?: string;
  eventDetails?: {
    name: string;
    type: SocialGathering['type'];
    location: { x: number; y: number };
    description?: string;
  };
  // For family actions
  familyDetails?: {
    partnerId: string;
    partnerName: string;
    proposalId?: string;
  };
  // For mourn action
  deceasedDetails?: {
    deceasedId: string;
    deceasedName: string;
    relationship: string;
  };
  reasoning?: string;
}

// ============ DECISION RESULT ============

export interface CognitiveDecisionResult {
  // Cognitive process outputs
  perception: PerceptionResult;
  memoryRetrieval?: MemoryRetrievalResult;
  emotionalProcessing: EmotionalProcessingResult;
  reasoning: ReasoningResult;
  planning: PlanningResult;

  // Final actions
  actions: CognitiveAction[];

  // State updates
  newMemory?: Omit<Memory, 'id' | 'createdAt'>;
  emotionalChanges?: Partial<EmotionState>;
  relationshipUpdates?: Map<string, RelationshipUpdate>;
  newGoal?: Omit<Goal, 'id' | 'createdAt'>;

  // Debug/monitoring
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    provider: string;
    model: string;
  };
  fullPrompt?: string;
  fullResponse?: string;
}

// ============ ENGINE CONFIG ============

export interface CognitiveEngineConfig {
  npcId: string;
  personality: string;
  goals: string[];
  visualAppearance?: string;

  // AI settings
  provider: 'openai' | 'anthropic';
  model: string;
  apiKey: string;

  // Cognitive settings
  memoryDepth?: number;        // How many memories to consider
  emotionalSensitivity?: number; // How much emotions affect decisions
  socialDrive?: number;         // How much they seek social interaction
  creativityLevel?: number;     // How creative/unpredictable they are
  reflectionFrequency?: number; // How often to do deep reflection

  // Feature flags
  enableReflection?: boolean;
  enableEventProposal?: boolean;
  enableDeepReasoning?: boolean;
}
