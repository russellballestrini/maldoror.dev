/**
 * Maldoror Agent Protocol Types
 *
 * WebSocket protocol for programmatic control of characters in the Maldoror world.
 */

// =============================================================================
// Core Types
// =============================================================================

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Position {
  x: number;
  y: number;
}

// =============================================================================
// Message Envelope
// =============================================================================

export interface AgentMessage<T extends string = string, P = unknown> {
  type: T;
  id?: string; // Request ID for correlating responses
  timestamp?: number;
  payload: P;
}

// =============================================================================
// Client -> Server Messages
// =============================================================================

export interface AuthenticatePayload {
  token: string;
  agentName?: string;
  agentVersion?: string;
}

export interface SubscribePayload {
  observations?: boolean;
  observationInterval?: number; // ms, default 500, min 100
  terrain?: boolean;
  terrainRadius?: number; // default 15
  chat?: boolean;
}

export interface UnsubscribePayload {
  observations?: boolean;
  chat?: boolean;
}

// Actions
export interface MoveActionPayload {
  action: 'move';
  direction: Direction;
}

export interface ChatActionPayload {
  action: 'chat';
  message: string;
}

export interface PlaceRoadActionPayload {
  action: 'place_road';
}

export interface WaitActionPayload {
  action: 'wait';
}

export type ActionPayload =
  | MoveActionPayload
  | ChatActionPayload
  | PlaceRoadActionPayload
  | WaitActionPayload;

// Client message types
export type AuthenticateMessage = AgentMessage<'authenticate', AuthenticatePayload>;
export type SubscribeMessage = AgentMessage<'subscribe', SubscribePayload>;
export type UnsubscribeMessage = AgentMessage<'unsubscribe', UnsubscribePayload>;
export type ActionMessage = AgentMessage<'action', ActionPayload>;

export type ClientMessage =
  | AuthenticateMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | ActionMessage;

// =============================================================================
// Server -> Client Messages
// =============================================================================

export interface AuthenticatedPayload {
  success: boolean;
  userId?: string;
  username?: string;
  error?: string;
  serverVersion?: string;
  tickRate?: number;
}

export interface ActionResponsePayload {
  success: boolean;
  error?: string;
  newPosition?: Position;
}

// Observation types
export interface SelfState {
  userId: string;
  x: number;
  y: number;
  direction: Direction;
}

export interface PlayerInfo {
  userId: string;
  username: string;
  x: number;
  y: number;
  direction: Direction;
  distance: number;
}

export interface NPCInfo {
  npcId: string;
  name: string;
  x: number;
  y: number;
  direction: Direction;
  distance: number;
}

export interface TileInfo {
  relX: number;
  relY: number;
  tileType: string;
  walkable: boolean;
  hasBuilding: boolean;
  hasRoad: boolean;
}

export interface TerrainInfo {
  centerX: number;
  centerY: number;
  radius: number;
  tiles: TileInfo[];
}

export interface ChatMessage {
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

export interface ObservationPayload {
  tick: number;
  self: SelfState;
  players: PlayerInfo[];
  npcs: NPCInfo[];
  terrain?: TerrainInfo;
  recentChat: ChatMessage[];
}

// Events
export interface PlayerEnteredPayload {
  event: 'player_entered';
  player: PlayerInfo;
}

export interface PlayerLeftPayload {
  event: 'player_left';
  player: { userId: string; username: string };
}

export interface ChatReceivedPayload {
  event: 'chat';
  message: ChatMessage;
}

export interface ServerNotificationPayload {
  event: 'server_restart' | 'rate_limited' | 'error';
  message?: string;
  retryAfter?: number;
}

export type EventPayload =
  | PlayerEnteredPayload
  | PlayerLeftPayload
  | ChatReceivedPayload
  | ServerNotificationPayload;

// Server message types
export type AuthenticatedMessage = AgentMessage<'authenticated', AuthenticatedPayload>;
export type ActionResponseMessage = AgentMessage<'action_response', ActionResponsePayload>;
export type ObservationMessage = AgentMessage<'observation', ObservationPayload>;
export type EventMessage = AgentMessage<'event', EventPayload>;

export type ServerMessage =
  | AuthenticatedMessage
  | ActionResponseMessage
  | ObservationMessage
  | EventMessage;

// =============================================================================
// Helper type guards
// =============================================================================

export function isObservation(msg: ServerMessage): msg is ObservationMessage {
  return msg.type === 'observation';
}

export function isEvent(msg: ServerMessage): msg is EventMessage {
  return msg.type === 'event';
}

export function isAuthenticated(msg: ServerMessage): msg is AuthenticatedMessage {
  return msg.type === 'authenticated';
}

export function isActionResponse(msg: ServerMessage): msg is ActionResponseMessage {
  return msg.type === 'action_response';
}
