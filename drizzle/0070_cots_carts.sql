CREATE TABLE "cots_cart_members" (
	"cart_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	CONSTRAINT "cots_cart_members_cart_id_part_id_pk" PRIMARY KEY("cart_id","part_id")
);
--> statement-breakpoint
CREATE TABLE "cots_carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cots_cart_members" ADD CONSTRAINT "cots_cart_members_cart_id_cots_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."cots_carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cots_cart_members" ADD CONSTRAINT "cots_cart_members_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cots_carts" ADD CONSTRAINT "cots_carts_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cots_cart_members_part_uq" ON "cots_cart_members" USING btree ("part_id");--> statement-breakpoint
ALTER TABLE "cots_carts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cots_cart_members" ENABLE ROW LEVEL SECURITY;
