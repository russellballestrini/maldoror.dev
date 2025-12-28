CREATE TABLE "npc_lineage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"npc_id" uuid NOT NULL,
	"parent1_id" uuid,
	"parent2_id" uuid,
	"generation" integer DEFAULT 0 NOT NULL,
	"family_name" varchar(64),
	"birth_at" timestamp with time zone DEFAULT now() NOT NULL,
	"birth_location_x" integer,
	"birth_location_y" integer,
	"lifecycle_stage" varchar(32) DEFAULT 'adult' NOT NULL,
	"expected_lifespan_hours" integer DEFAULT 168 NOT NULL,
	"death_at" timestamp with time zone,
	"cause_of_death" varchar(64),
	"genetic_traits" jsonb,
	"inherited_visual_prompt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "npc_lineage_npc_id_unique" UNIQUE("npc_id")
);
--> statement-breakpoint
CREATE TABLE "npc_reproduction_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposer_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"affection_level" real,
	"attraction_level" real,
	"trust_level" real,
	"proposal_message" text,
	"child_id" uuid,
	"birth_scheduled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_pending_proposal" UNIQUE("proposer_id","partner_id")
);
--> statement-breakpoint
CREATE TABLE "unified_activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" varchar(64) NOT NULL,
	"actor_type" varchar(16) NOT NULL,
	"activity_type" varchar(32) NOT NULL,
	"message" text,
	"action_details" jsonb,
	"location_x" integer,
	"location_y" integer,
	"is_public" varchar(8) DEFAULT 'true',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "npc_lineage" ADD CONSTRAINT "npc_lineage_npc_id_users_id_fk" FOREIGN KEY ("npc_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_lineage" ADD CONSTRAINT "npc_lineage_parent1_id_users_id_fk" FOREIGN KEY ("parent1_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_lineage" ADD CONSTRAINT "npc_lineage_parent2_id_users_id_fk" FOREIGN KEY ("parent2_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_reproduction_proposals" ADD CONSTRAINT "npc_reproduction_proposals_proposer_id_users_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_reproduction_proposals" ADD CONSTRAINT "npc_reproduction_proposals_partner_id_users_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_reproduction_proposals" ADD CONSTRAINT "npc_reproduction_proposals_child_id_users_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unified_activity_log" ADD CONSTRAINT "unified_activity_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_npc_lineage_npc_id" ON "npc_lineage" USING btree ("npc_id");--> statement-breakpoint
CREATE INDEX "idx_npc_lineage_parent1" ON "npc_lineage" USING btree ("parent1_id");--> statement-breakpoint
CREATE INDEX "idx_npc_lineage_parent2" ON "npc_lineage" USING btree ("parent2_id");--> statement-breakpoint
CREATE INDEX "idx_npc_lineage_lifecycle" ON "npc_lineage" USING btree ("lifecycle_stage");--> statement-breakpoint
CREATE INDEX "idx_npc_lineage_generation" ON "npc_lineage" USING btree ("generation");--> statement-breakpoint
CREATE INDEX "idx_npc_lineage_family" ON "npc_lineage" USING btree ("family_name");--> statement-breakpoint
CREATE INDEX "idx_npc_repro_proposer" ON "npc_reproduction_proposals" USING btree ("proposer_id");--> statement-breakpoint
CREATE INDEX "idx_npc_repro_partner" ON "npc_reproduction_proposals" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "idx_npc_repro_status" ON "npc_reproduction_proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_activity_log_actor" ON "unified_activity_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_activity_log_type" ON "unified_activity_log" USING btree ("activity_type");--> statement-breakpoint
CREATE INDEX "idx_activity_log_created_at" ON "unified_activity_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_activity_log_timeline" ON "unified_activity_log" USING btree ("created_at","activity_type");