CREATE TABLE "buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"anchor_x" integer NOT NULL,
	"anchor_y" integer NOT NULL,
	"prompt" text NOT NULL,
	"model_used" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_buildings_owner" ON "buildings" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_buildings_position" ON "buildings" USING btree ("anchor_x","anchor_y");