/**
 * NPC Consciousness System
 *
 * A sophisticated AI architecture for creating living, breathing NPCs
 * with memory, emotions, relationships, and emergent social behavior.
 *
 * Components:
 * - CognitiveEngine: Multi-phase decision making (Perception → Memory → Emotion → Reasoning → Planning)
 * - MemoryManager: Episodic memory storage and retrieval
 * - EmotionProcessor: Emotional state management and processing
 * - RelationshipManager: Relationship tracking and evolution
 * - SocialAnalyzer: Social dynamics and event management
 */

export * from './types.js';
export { CognitiveEngine } from './cognitive-engine.js';
export { MemoryManager, memoryManager } from './memory-manager.js';
export { EmotionProcessor, emotionProcessor } from './emotion-processor.js';
export { RelationshipManager, relationshipManager } from './relationship-manager.js';
export { SocialAnalyzer, createSocialAnalyzer } from './social-analyzer.js';

// Lifecycle & Lineage System
export { DEFAULT_LIFECYCLE_CONFIG, calculateLifespan, getStageBoundaries, getDecisionInterval } from './lifecycle-config.js';
export { LifecycleManager, lifecycleManager, type LifecycleTransition, type DeathEvent } from './lifecycle-manager.js';
export { LineageManager, lineageManager, type FamilyMember, type FamilyTree } from './lineage-manager.js';
export { PopulationController, populationController, type PopulationStats, type ReproductionModifiers } from './population-controller.js';
export { ReproductionManager, reproductionManager, type ReproductionEligibility, type ProposalResult, type AcceptanceResult } from './reproduction-manager.js';
export { ChildSpawner, childSpawner, type ParentInfo, type ChildBlueprint, type SpawnedChild } from './child-spawner.js';
