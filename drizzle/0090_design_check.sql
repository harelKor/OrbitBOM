CREATE TABLE "design_check_ignores" (
	"robot_id" uuid NOT NULL,
	"pair" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_check_ignores_robot_id_pair_pk" PRIMARY KEY("robot_id","pair")
);
--> statement-breakpoint
CREATE TABLE "design_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"robot_id" uuid NOT NULL,
	"model" text DEFAULT 'final' NOT NULL,
	"sig" text NOT NULL,
	"results" jsonb NOT NULL,
	"ran_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "part_weights" (
	"key" text PRIMARY KEY NOT NULL,
	"grams" real NOT NULL,
	"set_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "robots" ADD COLUMN "check_limits" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "design_check_ignores" ADD CONSTRAINT "design_check_ignores_robot_id_robots_id_fk" FOREIGN KEY ("robot_id") REFERENCES "public"."robots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_check_ignores" ADD CONSTRAINT "design_check_ignores_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_checks" ADD CONSTRAINT "design_checks_robot_id_robots_id_fk" FOREIGN KEY ("robot_id") REFERENCES "public"."robots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_checks" ADD CONSTRAINT "design_checks_ran_by_members_id_fk" FOREIGN KEY ("ran_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_weights" ADD CONSTRAINT "part_weights_set_by_members_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_checks_robot_idx" ON "design_checks" USING btree ("robot_id","model","created_at");--> statement-breakpoint
ALTER TABLE "design_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "design_check_ignores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "part_weights" ENABLE ROW LEVEL SECURITY;
