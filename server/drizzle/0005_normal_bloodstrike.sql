CREATE TABLE "meetup_participations" (
	"event_date" date NOT NULL,
	"user_id" uuid NOT NULL,
	"interested" boolean DEFAULT true NOT NULL,
	"quick_reply" boolean DEFAULT false NOT NULL,
	"checked_in_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meetup_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_date" date NOT NULL,
	"from_user" uuid NOT NULL,
	"to_user" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetup_requests_distinct_users" CHECK ("meetup_requests"."from_user" <> "meetup_requests"."to_user"),
	CONSTRAINT "meetup_requests_status_valid" CHECK ("meetup_requests"."status" in ('pending', 'accepted', 'declined'))
);
--> statement-breakpoint
CREATE TABLE "user_presence" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meetup_participations" ADD CONSTRAINT "meetup_participations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetup_requests" ADD CONSTRAINT "meetup_requests_from_user_users_id_fk" FOREIGN KEY ("from_user") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetup_requests" ADD CONSTRAINT "meetup_requests_to_user_users_id_fk" FOREIGN KEY ("to_user") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetup_requests" ADD CONSTRAINT "meetup_requests_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_presence" ADD CONSTRAINT "user_presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meetup_participations_event_user_idx" ON "meetup_participations" USING btree ("event_date","user_id");--> statement-breakpoint
CREATE INDEX "meetup_participations_event_interested_idx" ON "meetup_participations" USING btree ("event_date","interested");--> statement-breakpoint
CREATE UNIQUE INDEX "meetup_requests_event_pair_idx" ON "meetup_requests" USING btree ("event_date","from_user","to_user");--> statement-breakpoint
CREATE INDEX "meetup_requests_to_status_idx" ON "meetup_requests" USING btree ("to_user","status");--> statement-breakpoint
CREATE INDEX "meetup_requests_from_event_idx" ON "meetup_requests" USING btree ("from_user","event_date");