CREATE TABLE "ai_token_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"estimated_cost_micros" integer,
	"provider" varchar(32) NOT NULL,
	"model" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_npc" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "personality" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "goals" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "visual_prompt" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_provider" varchar(32) DEFAULT 'openai';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_model" varchar(64) DEFAULT 'gpt-4o-mini';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "decision_interval_ms" integer DEFAULT 300000;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "spawn_x" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "spawn_y" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "roam_radius" integer DEFAULT 15;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "npc_creator_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_token_usage" ADD CONSTRAINT "ai_token_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_token_usage_user_id" ON "ai_token_usage" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_ai_token_usage_created_at" ON "ai_token_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_users_is_npc" ON "users" USING btree ("is_npc");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_npc_creator_id_users_id_fk" FOREIGN KEY ("npc_creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;