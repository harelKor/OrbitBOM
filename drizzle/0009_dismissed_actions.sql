CREATE TABLE "dismissed_actions" (
	"member_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dismissed_actions_member_id_visit_id_pk" PRIMARY KEY("member_id","visit_id")
);
--> statement-breakpoint
ALTER TABLE "dismissed_actions" ADD CONSTRAINT "dismissed_actions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Same lockdown as 0001: no policies, so Supabase's public API can't read the table.
ALTER TABLE "dismissed_actions" ENABLE ROW LEVEL SECURITY;