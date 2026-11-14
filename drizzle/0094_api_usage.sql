CREATE TABLE "api_usage" (
	"day" date NOT NULL,
	"service" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "api_usage_day_service_pk" PRIMARY KEY("day","service")
);
--> statement-breakpoint
ALTER TABLE "api_usage" ENABLE ROW LEVEL SECURITY;
