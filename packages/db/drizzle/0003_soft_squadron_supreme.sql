CREATE TABLE "npcs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" varchar(64) NOT NULL,
	"prompt" text NOT NULL,
	"spawn_x" integer NOT NULL,
	"spawn_y" integer NOT NULL,
	"roam_radius" integer DEFAULT 15 NOT NULL,
	"player_affinity" integer DEFAULT 50 NOT NULL,
	"model_used" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"placed_by" uuid,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terrain_tiles" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"pixels" text NOT NULL,
	"walkable" boolean DEFAULT true NOT NULL,
	"resolutions" text,
	"animated" boolean DEFAULT false NOT NULL,
	"animation_frames" text,
	"animation_resolutions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "terrain_transitions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"from_terrain" varchar(32) NOT NULL,
	"to_terrain" varchar(32) NOT NULL,
	"tiles_generated" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"name" varchar(64),
	"permissions" jsonb,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "agent_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "building_tiles" DROP CONSTRAINT "uq_building_tiles";--> statement-breakpoint
ALTER TABLE "building_tiles" ADD COLUMN "direction" varchar(8) DEFAULT 'north' NOT NULL;--> statement-breakpoint
ALTER TABLE "npcs" ADD CONSTRAINT "npcs_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roads" ADD CONSTRAINT "roads_placed_by_users_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_npcs_creator" ON "npcs" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "idx_npcs_position" ON "npcs" USING btree ("spawn_x","spawn_y");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_roads_position" ON "roads" USING btree ("x","y");--> statement-breakpoint
CREATE INDEX "idx_roads_placed_by" ON "roads" USING btree ("placed_by");--> statement-breakpoint
CREATE INDEX "idx_agent_tokens_hash" ON "agent_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_agent_tokens_user" ON "agent_tokens" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "building_tiles" ADD CONSTRAINT "uq_building_tiles" UNIQUE("building_id","tile_x","tile_y","resolution","direction");