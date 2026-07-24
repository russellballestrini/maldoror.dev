CREATE TABLE "npc_life_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" varchar(192) NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"world_minute" integer NOT NULL,
	"npc_id" uuid,
	"target_id" uuid,
	"x" integer,
	"y" integer,
	"cause" jsonb NOT NULL,
	"consequence" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "npc_life_state" (
	"npc_id" uuid PRIMARY KEY NOT NULL,
	"home_x" integer NOT NULL,
	"home_y" integer NOT NULL,
	"role" varchar(32) NOT NULL,
	"schedule" jsonb NOT NULL,
	"needs" jsonb NOT NULL,
	"current_activity" varchar(32) NOT NULL,
	"activity_started_world_minute" integer NOT NULL,
	"destination_x" integer NOT NULL,
	"destination_y" integer NOT NULL,
	"last_world_minute" integer NOT NULL,
	"last_encounter_world_minute" integer,
	"last_social_target_id" uuid,
	"state_version" integer DEFAULT 2 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_life_state" (
	"world_id" varchar(64) PRIMARY KEY NOT NULL,
	"world_seed" varchar(192) NOT NULL,
	"world_minute" integer NOT NULL,
	"weather" varchar(32) NOT NULL,
	"weather_intensity" real NOT NULL,
	"weather_until_world_minute" integer NOT NULL,
	"season" varchar(16) NOT NULL,
	"rng_state" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "npc_life_events" ADD CONSTRAINT "npc_life_events_npc_id_users_id_fk" FOREIGN KEY ("npc_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_life_events" ADD CONSTRAINT "npc_life_events_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_life_state" ADD CONSTRAINT "npc_life_state_npc_id_users_id_fk" FOREIGN KEY ("npc_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_life_state" ADD CONSTRAINT "npc_life_state_last_social_target_id_users_id_fk" FOREIGN KEY ("last_social_target_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_npc_life_events_dedupe" ON "npc_life_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_npc_life_events_world_minute" ON "npc_life_events" USING btree ("world_minute");--> statement-breakpoint
CREATE INDEX "idx_npc_life_events_npc" ON "npc_life_events" USING btree ("npc_id");--> statement-breakpoint
CREATE INDEX "idx_npc_life_events_type" ON "npc_life_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_npc_life_state_activity" ON "npc_life_state" USING btree ("current_activity");--> statement-breakpoint
CREATE INDEX "idx_npc_life_state_destination" ON "npc_life_state" USING btree ("destination_x","destination_y");