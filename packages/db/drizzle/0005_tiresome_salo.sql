CREATE TABLE "chat_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"sender_name" varchar(64) NOT NULL,
	"message" text NOT NULL,
	"location" jsonb,
	"message_type" varchar(32) DEFAULT 'chat',
	"sentiment" real,
	"topics" jsonb DEFAULT '[]'::jsonb,
	"mentioned_user_ids" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "npc_emotional_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"npc_id" uuid NOT NULL,
	"mood_valence" real DEFAULT 0.3,
	"mood_energy" real DEFAULT 0.5,
	"emotions" jsonb DEFAULT '{}'::jsonb,
	"needs" jsonb DEFAULT '{"social":0.5,"exploration":0.5}'::jsonb,
	"current_focus" text,
	"inner_monologue" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "npc_emotional_state_npc_id_unique" UNIQUE("npc_id")
);
--> statement-breakpoint
CREATE TABLE "npc_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"npc_id" uuid NOT NULL,
	"goal_type" varchar(32) NOT NULL,
	"description" text NOT NULL,
	"motivation" text,
	"priority" real DEFAULT 0.5,
	"timeframe" varchar(32) DEFAULT 'short',
	"status" varchar(32) DEFAULT 'active',
	"progress" real DEFAULT 0,
	"steps" jsonb DEFAULT '[]'::jsonb,
	"target_location" jsonb,
	"target_user_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "npc_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"npc_id" uuid NOT NULL,
	"memory_type" varchar(32) NOT NULL,
	"summary" text NOT NULL,
	"details" text,
	"location" jsonb,
	"participants" jsonb DEFAULT '[]'::jsonb,
	"emotional_valence" real DEFAULT 0,
	"emotional_intensity" real DEFAULT 0.5,
	"primary_emotion" varchar(32),
	"importance" real DEFAULT 0.5,
	"access_count" integer DEFAULT 0,
	"last_accessed_at" timestamp with time zone,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "npc_reflections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"npc_id" uuid NOT NULL,
	"reflection_type" varchar(32) NOT NULL,
	"content" text NOT NULL,
	"trigger" text,
	"insights" jsonb DEFAULT '[]'::jsonb,
	"worldview_changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "npc_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"npc_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"familiarity" real DEFAULT 0,
	"affection" real DEFAULT 0,
	"trust" real DEFAULT 0,
	"respect" real DEFAULT 0,
	"attraction" real DEFAULT 0,
	"rivalry" real DEFAULT 0,
	"relationship_type" varchar(32) DEFAULT 'stranger',
	"interaction_count" integer DEFAULT 0,
	"last_interaction_at" timestamp with time zone,
	"first_met_at" timestamp with time zone DEFAULT now() NOT NULL,
	"impressions" jsonb DEFAULT '[]'::jsonb,
	"shared_experiences" jsonb DEFAULT '[]'::jsonb,
	"current_feeling" varchar(64),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_npc_relationship" UNIQUE("npc_id","target_id")
);
--> statement-breakpoint
CREATE TABLE "social_gatherings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"gathering_type" varchar(32) NOT NULL,
	"location" jsonb NOT NULL,
	"location_name" varchar(128),
	"organizer_id" uuid NOT NULL,
	"invited_ids" jsonb DEFAULT '[]'::jsonb,
	"attendee_ids" jsonb DEFAULT '[]'::jsonb,
	"max_attendees" integer,
	"scheduled_for" timestamp with time zone,
	"duration" integer,
	"status" varchar(32) DEFAULT 'planned',
	"current_activity" varchar(128),
	"mood" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"location" jsonb,
	"location_name" varchar(128),
	"initiator_id" uuid,
	"participants" jsonb DEFAULT '[]'::jsonb,
	"status" varchar(32) DEFAULT 'active',
	"scheduled_for" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"significance" real DEFAULT 0.5,
	"outcomes" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_history" ADD CONSTRAINT "chat_history_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_emotional_state" ADD CONSTRAINT "npc_emotional_state_npc_id_users_id_fk" FOREIGN KEY ("npc_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_goals" ADD CONSTRAINT "npc_goals_npc_id_users_id_fk" FOREIGN KEY ("npc_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_goals" ADD CONSTRAINT "npc_goals_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_memories" ADD CONSTRAINT "npc_memories_npc_id_users_id_fk" FOREIGN KEY ("npc_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_reflections" ADD CONSTRAINT "npc_reflections_npc_id_users_id_fk" FOREIGN KEY ("npc_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_relationships" ADD CONSTRAINT "npc_relationships_npc_id_users_id_fk" FOREIGN KEY ("npc_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_relationships" ADD CONSTRAINT "npc_relationships_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_gatherings" ADD CONSTRAINT "social_gatherings_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_events" ADD CONSTRAINT "world_events_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_chat_history_sender" ON "chat_history" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "idx_chat_history_created_at" ON "chat_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_chat_history_location" ON "chat_history" USING btree ("location");--> statement-breakpoint
CREATE INDEX "idx_npc_emotional_state_npc_id" ON "npc_emotional_state" USING btree ("npc_id");--> statement-breakpoint
CREATE INDEX "idx_npc_goals_npc_id" ON "npc_goals" USING btree ("npc_id");--> statement-breakpoint
CREATE INDEX "idx_npc_goals_status" ON "npc_goals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_npc_goals_priority" ON "npc_goals" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "idx_npc_memories_npc_id" ON "npc_memories" USING btree ("npc_id");--> statement-breakpoint
CREATE INDEX "idx_npc_memories_created_at" ON "npc_memories" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_npc_memories_importance" ON "npc_memories" USING btree ("importance");--> statement-breakpoint
CREATE INDEX "idx_npc_memories_type" ON "npc_memories" USING btree ("memory_type");--> statement-breakpoint
CREATE INDEX "idx_npc_reflections_npc_id" ON "npc_reflections" USING btree ("npc_id");--> statement-breakpoint
CREATE INDEX "idx_npc_reflections_created_at" ON "npc_reflections" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_npc_relationships_npc_id" ON "npc_relationships" USING btree ("npc_id");--> statement-breakpoint
CREATE INDEX "idx_npc_relationships_target_id" ON "npc_relationships" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "idx_social_gatherings_organizer" ON "social_gatherings" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "idx_social_gatherings_status" ON "social_gatherings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_social_gatherings_scheduled" ON "social_gatherings" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "idx_world_events_type" ON "world_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_world_events_status" ON "world_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_world_events_created_at" ON "world_events" USING btree ("created_at");