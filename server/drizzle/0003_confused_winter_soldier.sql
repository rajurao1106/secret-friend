CREATE TABLE "conversation_mutes" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_mutes_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "details" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_flagged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_mutes" ADD CONSTRAINT "conversation_mutes_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_mutes" ADD CONSTRAINT "conversation_mutes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_reported_id_idx" ON "reports" USING btree ("reported_id");
--> statement-breakpoint
CREATE VIEW "reports_review_queue" AS
SELECT
  "reported_id",
  COUNT(DISTINCT "reporter_id") AS "unique_reporters",
  MAX("created_at") AS "last_reported_at"
FROM "reports"
GROUP BY "reported_id"
HAVING COUNT(DISTINCT "reporter_id") >= 3;