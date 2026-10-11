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

### Deploy the backend to Vercel

Import the GitHub repository into Vercel and set the project's **Root
Directory** to `server`. Vercel detects the Fastify entrypoint at
`src/index.ts`. Add these environment variables in the Vercel project settings:

- `DATABASE_URL`: the Neon PostgreSQL connection string, including
  `sslmode=require`
- `JWT_SECRET` and `JWT_REFRESH_SECRET`: different private values, each at
  least 32 characters
- `CORS_ORIGIN`: the exact origin of the Flutter Web app, if you deploy the web
  client; native Android/iOS clients do not need a browser origin
- `OTP_PROVIDER=msg91`, `MSG91_AUTH_KEY`, and `MSG91_TEMPLATE_ID` when enabling
  real OTP delivery; `mock` is for development only

Set the required variables for the **Production** environment, then redeploy.
`DATABASE_URL`, `JWT_SECRET`, and `JWT_REFRESH_SECRET` are mandatory; the two
JWT secrets must be different and at least 32 characters each. Do not use the
example placeholder values from `server\.env.example`.

Apply the database migrations once against the same Neon database before using
the deployment:

```powershell
Set-Location server
npm run db:migrate
```

After deploying, use the Vercel deployment URL as the Flutter API base URL. The
URL is compiled into the app, so rebuild it when the backend URL changes:

```powershell
Set-Location app
flutter run --dart-define=API_BASE_URL=https://your-backend.vercel.app
flutter build apk --release --dart-define=API_BASE_URL=https://your-backend.vercel.app
```

Push the backend deployment changes and redeploy. The app factory is named
`src/create-app.ts` so Vercel detects `src/index.ts`—not the factory—as the
Fastify entrypoint. Verify the deployment before building or installing the app
by opening `https://your-backend.vercel.app/health`. A working backend returns
HTTP 200 with `{"status":"ok"}`. If it still returns HTTP 500, inspect that
deployment's **Runtime Logs** and confirm the required environment variables
are set for its environment. Building an APK in GitHub Actions only compiles
the Flutter client; it does not deploy or verify the backend.

Chat messages use authenticated HTTP requests and refresh every four seconds
while a conversation is open, so the app does not depend on an in-memory
WebSocket connection across Vercel function instances.

## Flutter client

The Flutter client uses the backend OTP flow, profile onboarding, discovery,
chat/reveal requests, safety endpoints, account settings, and authenticated
media endpoints.

The Home screen also includes a daily 8:00 PM India-time meetup. Users can
register interest and optionally mark that they intend to reply quickly. At
8:00 PM, interested users check in; checked-in users who keep the app open are
shown in the online meetup list. Selecting someone sends a separate meetup chat
request. Accepting starts an anonymous conversation without revealing either
profile. Online status expires if the app stops sending its heartbeat.

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

### Build and download an Android APK with GitHub Actions

Push the workflow to GitHub, then open the repository's **Actions** tab and
select **Build Android APK**. Choose **Run workflow** and confirm. After the run
succeeds, open it and download `secret-friend-android-apk` from **Artifacts**.
The artifact contains `app-release.apk` and is available for 14 days. Pushes to
`main` or `master` that change app files also start a build automatically.

The APK uses the Vercel backend URL configured in
`.github/workflows/build-android-apk.yml`. Update that workflow if the backend
URL changes. Android release builds currently use the project's debug signing
key, which is fine for testing and direct installation but must be replaced
with a private release key before publishing through Google Play.
