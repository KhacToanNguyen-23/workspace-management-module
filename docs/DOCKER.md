# Docker

## Local full stack

Docker Compose starts the Firestore emulator, Java API and web app:

```bash
docker compose up --build
```

- Web app: `http://localhost:3000`
- Java API: `http://localhost:8080`
- Firestore emulator: `localhost:8085`

The Compose configuration uses development authentication, the mock user directory and the Firestore emulator. Sign in through the development email form. Stop the stack with `docker compose down`.

The existing `npm run db:up` command still starts only the Firestore emulator for running the Java and Vite development servers directly on the host.

## Build images separately

```bash
docker build -f backend/Dockerfile -t wb-module-backend ./backend
docker build -f web/Dockerfile -t wb-module-web .
```

The web image accepts Vite build arguments for `VITE_AUTH_MODE`, `VITE_API_BASE`, `VITE_ORG_DOMAIN`, `VITE_SSO_BASE_URL`, `VITE_SSO_CLIENT_ID`, and the `VITE_FIREBASE_*` settings. These values are embedded in the static frontend during image build; Firebase web configuration is public client configuration, not a place for server credentials. The backend uses Application Default Credentials unless `GOOGLE_APPLICATION_CREDENTIALS` is configured at runtime.

The images do not contain service-account files or other credentials. Provide production credentials through the deployment environment or a mounted secret, and configure the required Firestore project, auth mode, directory mode, CORS origin and frontend Firebase build settings for that environment.
