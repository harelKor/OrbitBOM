CREATE TABLE "deleted_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"did" text NOT NULL,
	"version_id" text NOT NULL,
	"member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_snapshots" (
	"key" text PRIMARY KEY NOT NULL,
	"robot_id" uuid NOT NULL,
	"plan" jsonb NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "robot_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"robot_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"systems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_comment_replies" ADD COLUMN "snip" jsonb;--> statement-breakpoint
ALTER TABLE "review_comment_replies" ADD COLUMN "part_key" text;--> statement-breakpoint
ALTER TABLE "review_comment_replies" ADD COLUMN "part_name" text;--> statement-breakpoint
ALTER TABLE "deleted_versions" ADD CONSTRAINT "deleted_versions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_snapshots" ADD CONSTRAINT "model_snapshots_robot_id_robots_id_fk" FOREIGN KEY ("robot_id") REFERENCES "public"."robots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "robot_versions" ADD CONSTRAINT "robot_versions_robot_id_robots_id_fk" FOREIGN KEY ("robot_id") REFERENCES "public"."robots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "robot_versions" ADD CONSTRAINT "robot_versions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deleted_versions_uq" ON "deleted_versions" USING btree ("did","version_id");--> statement-breakpoint
CREATE INDEX "model_snapshots_robot_idx" ON "model_snapshots" USING btree ("robot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "robot_versions_seq_uq" ON "robot_versions" USING btree ("robot_id","seq");--> statement-breakpoint
ALTER TABLE "model_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deleted_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "robot_versions" ENABLE ROW LEVEL SECURITY;
