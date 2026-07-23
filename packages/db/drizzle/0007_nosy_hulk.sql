ALTER TABLE "users" ADD COLUMN "npc_last_decision_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "player_state" ADD COLUMN "npc_motor_state" jsonb;