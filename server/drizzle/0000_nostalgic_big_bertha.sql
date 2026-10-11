CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nickname" text NOT NULL,
	"gender" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_must_be_adults" CHECK ("users"."date_of_birth" <= CURRENT_DATE - INTERVAL '18 years')
);
