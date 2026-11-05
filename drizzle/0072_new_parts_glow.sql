CREATE TABLE "page_seen" (
	"member_id" uuid NOT NULL,
	"page" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_seen_member_id_page_pk" PRIMARY KEY("member_id","page")
);
--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "stage_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "page_seen" ADD CONSTRAINT "page_seen_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "page_seen" ENABLE ROW LEVEL SECURITY;
