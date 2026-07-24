ALTER TABLE "world_life_state" ADD COLUMN "surface_wetness" real DEFAULT 0.12 NOT NULL;--> statement-breakpoint
ALTER TABLE "world_life_state" ADD COLUMN "water_turbulence" real DEFAULT 0.08 NOT NULL;--> statement-breakpoint
ALTER TABLE "world_life_state" ADD COLUMN "vegetation_vitality" real DEFAULT 0.72 NOT NULL;--> statement-breakpoint
ALTER TABLE "world_life_state" ADD COLUMN "decay_pressure" real DEFAULT 0.1 NOT NULL;