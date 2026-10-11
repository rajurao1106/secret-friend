# Secret Friend

An anonymous friendship app monorepo with a Flutter client and a Fastify,
TypeScript, PostgreSQL, and Drizzle backend.

## Prerequisites

- Flutter SDK
- Node.js 22 or newer and npm

## Backend

The backend uses PostgreSQL through Drizzle. You can use a Neon database or a
local PostgreSQL instance. Copy the environment template and set `DATABASE_URL`
to the connection string for your database:

```powershell
Copy-Item server\.env.example server\.env
Set-Location server
npm install
npm run db:migrate
npm run dev
```

For Neon, copy the PostgreSQL connection string from the Neon dashboard into
`DATABASE_URL` in `server\.env`, including its `sslmode=require` parameter.
Keep this connection string private. Set `JWT_SECRET` and
`JWT_REFRESH_SECRET` to private values of at least 32 characters before
starting the service. `OTP_PROVIDER=mock` writes test OTPs to the server
console. Add `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
`CLOUDINARY_API_SECRET` to enable private Cloudinary media uploads; media
storage is unavailable until all three values are configured. For local
development, the included `server\docker-compose.yml` can start PostgreSQL
with Docker. The migrations are in `server\drizzle`;
`npm run db:generate` creates new migrations after schema changes, and
`npm run db:migrate` applies pending migrations.

Authenticated media uploads use `POST /media/presign`, then a multipart `POST`
to the returned Cloudinary URL using its `fields`, followed by
`POST /media/confirm` with the returned `uploadId`. Media download URLs are
signed and expire after five minutes; private profile and gallery media are
only issued after a reveal.

The health check is available at `http://127.0.0.1:3001/health` with the
workspace's configured backend port. Authentication
routes are `POST /auth/send-otp`, `POST /auth/verify-otp`, `POST /auth/refresh`,
and `POST /auth/logout`. Authenticated account deletion uses `DELETE /me`.
Run `npm test`, `npm run typecheck`, and `npm run build` from `server` to
validate the backend.

## Flutter client

The Flutter client uses the backend OTP flow, profile onboarding, discovery,
chat/reveal requests, safety endpoints, account settings, and authenticated
media endpoints. In mock OTP mode, read the code printed in the server console.
Keep the API server running while using the app.

For Flutter Web, development mode accepts localhost and 127.0.0.1 origins on
any port, so Flutter's automatically selected web port works. Set
`CORS_ORIGIN` to the exact web origin when deploying outside local development.
The root npm scripts start the backend and Flutter Web client together on a
stable local port (after completing backend setup and running `flutter pub get`
in `app`):

```powershell
npm run dev
```

For the Android emulator, use its host-machine address:

```powershell
Set-Location app
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3001
```

For a physical phone, replace `10.0.2.2` with the computer's reachable LAN IP
and ensure both devices can reach each other. Kundali score calculation still
requires a chart provider on the backend; until then that optional feature is
not available.
