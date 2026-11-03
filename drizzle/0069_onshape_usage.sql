CREATE TABLE "onshape_usage" (
	"day" date PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"background" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onshape_usage" ENABLE ROW LEVEL SECURITY;
