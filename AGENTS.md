# AGENTS.md

## Project Overview

This project is a Node.js RESTful API backend.

The agent should treat this repository as a production-oriented API service. Prioritize correctness, maintainability, security, testability, and clear API behavior over quick patches.

## Tech Stack

* Runtime: Node.js
* Language: TypeScript
* API style: RESTful API
* Framework: Express / Fastify / NestJS
* Package manager: pnpm / npm / yarn
* Database: PostgreSQL / MySQL / MongoDB
* ORM / Query layer: Prisma / TypeORM / Drizzle / Mongoose
* Testing: Jest / Vitest / Supertest
* Validation: Zod / Joi / class-validator
* Linting and formatting: ESLint + Prettier

When the actual project files conflict with this section, follow the implementation already present in the repository.

## Setup Commands

Before making code changes, inspect `package.json` and use the commands defined there.

Common commands:

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm test:e2e
pnpm typecheck
```

If this project uses `npm`, use:

```bash
npm install
npm run dev
npm run build
npm run lint
npm test
```

If this project uses `yarn`, use:

```bash
yarn install
yarn dev
yarn build
yarn lint
yarn test
```

Do not introduce a new package manager unless explicitly requested.

## Development Workflow

Before implementing a task:

1. Read the relevant route, controller, service, repository, schema, and test files.
2. Understand the existing architecture before adding new patterns.
3. Prefer modifying existing modules over creating parallel abstractions.
4. Keep changes focused on the requested task.
5. Avoid large refactors unless the task requires them.
6. If behavior changes, update or add tests.
7. After code changes, run the smallest relevant verification command first, then broader checks if needed.

## Architecture Guidelines

Follow the existing project structure. If the structure is not clear, prefer this layering:

```text
src/
  app.ts
  server.ts
  config/
  routes/
  controllers/
  services/
  repositories/
  middlewares/
  validators/
  schemas/
  models/
  utils/
  types/
  tests/
```

Recommended responsibilities:

* `routes/`: Define URL paths and bind handlers.
* `controllers/`: Handle HTTP request/response mapping only.
* `services/`: Contain business logic.
* `repositories/`: Encapsulate database access.
* `middlewares/`: Authentication, authorization, error handling, request context, logging.
* `validators/` or `schemas/`: Request validation and DTO definitions.
* `config/`: Environment parsing and application configuration.
* `utils/`: Small reusable helpers only.

Avoid placing database queries directly inside route handlers unless the existing codebase already follows that pattern.

## REST API Design Rules

Use resource-oriented REST conventions:

* Use nouns for resources: `/users`, `/orders`, `/transactions`.
* Use HTTP methods consistently:

  * `GET` for reading
  * `POST` for creating
  * `PUT` or `PATCH` for updating
  * `DELETE` for deleting
* Use appropriate status codes:

  * `200` for successful reads or updates
  * `201` for successful creation
  * `204` for successful deletion with no body
  * `400` for invalid client input
  * `401` for unauthenticated requests
  * `403` for unauthorized requests
  * `404` for missing resources
  * `409` for conflicts
  * `422` for semantic validation errors, if the project uses it
  * `500` only for unexpected server errors

For list APIs, prefer explicit pagination:

```text
GET /resources?page=1&pageSize=20
GET /resources?cursor=xxx&limit=20
```

Follow the existing response format. If no format exists, prefer a consistent shape:

```json
{
  "data": {},
  "message": "Success"
}
```

For errors, prefer:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request payload",
    "details": []
  }
}
```

Do not silently change API response shapes without updating tests and documentation.

## Validation Rules

All external input must be validated before reaching business logic:

* Request body
* Query parameters
* Route parameters
* Headers used by business logic
* File uploads
* Webhook payloads

Prefer schema-based validation using the validation library already present in the project.

Do not trust client-provided IDs, roles, prices, permissions, timestamps, or ownership fields.

## Error Handling

Use centralized error handling.

Do not expose stack traces, raw database errors, tokens, secrets, or internal implementation details in API responses.

Expected errors should be represented with typed application errors, for example:

* `ValidationError`
* `UnauthorizedError`
* `ForbiddenError`
* `NotFoundError`
* `ConflictError`

Unexpected errors should be logged and returned as a generic server error.

## Authentication and Authorization

When touching protected endpoints:

1. Check authentication middleware.
2. Check authorization rules.
3. Verify resource ownership where applicable.
4. Add tests for unauthorized and forbidden access.

Never rely only on frontend restrictions.

## Database Guidelines

When changing database behavior:

* Check existing migrations and schema definitions first.
* Prefer migrations over manual schema changes.
* Keep data access inside repository or data-access modules.
* Avoid N+1 query patterns.
* Use transactions for multi-step writes that must remain consistent.
* Do not drop or rewrite production data unless explicitly requested.

If using Prisma:

```bash
pnpm prisma generate
pnpm prisma migrate dev
```

Only run migration commands when the task requires schema changes.

## Security Guidelines

Always consider security impact when modifying API behavior.

Required practices:

* Never hardcode secrets, API keys, private keys, tokens, passwords, or credentials.
* Use environment variables for configuration.
* Validate and sanitize external input.
* Avoid leaking sensitive data in logs.
* Do not log full authorization headers, cookies, passwords, private keys, or payment data.
* Use parameterized queries or ORM-safe APIs.
* Protect admin or internal endpoints with explicit authorization.
* Keep CORS, rate limiting, and security headers consistent with existing project setup.
* For webhook endpoints, verify signatures if the provider supports them.

If a change introduces a new security-sensitive dependency, explain why it is needed.

## Environment Variables

Environment variables should be documented in `.env.example`.

When adding a new variable:

1. Add it to `.env.example`.
2. Add validation in the config layer.
3. Avoid reading `process.env` directly across the codebase.
4. Never commit real secret values.

Example:

```text
DATABASE_URL=
JWT_SECRET=
PORT=3000
NODE_ENV=development
```

## Logging

Use the logger already present in the project.

Do not use `console.log` in production code unless the project already does so.

Logs should include enough context to debug issues, but must not include secrets or sensitive user data.

## Testing Instructions

Add or update tests for:

* New endpoints
* Changed response shapes
* Validation behavior
* Authentication and authorization
* Error paths
* Database write behavior
* Regression fixes

Prefer API-level tests for REST endpoints and unit tests for business logic.

Before finishing a task, run the most relevant checks:

```bash
pnpm test
pnpm lint
pnpm typecheck
```

If the full test suite is expensive, run targeted tests first and clearly mention what was run.

## Code Style

Follow the existing code style.

General preferences:

* Use TypeScript strict typing where possible.
* Avoid `any` unless unavoidable.
* Prefer explicit return types for exported functions.
* Keep controllers thin.
* Keep services focused on business logic.
* Keep database access out of controllers.
* Prefer dependency injection if the project already uses it.
* Avoid deeply nested conditionals.
* Prefer small pure helper functions for reusable logic.
* Use meaningful names over abbreviations.

Do not reformat unrelated files.

## Dependency Policy

Before adding a new dependency:

1. Check whether the project already has a suitable library.
2. Prefer small, well-maintained dependencies.
3. Avoid adding dependencies for trivial utilities.
4. Do not add production dependencies without a clear reason.
5. Update lockfiles consistently.

## API Documentation

If the project has API documentation, update it when endpoint behavior changes.

Possible documentation locations:

* `README.md`
* `docs/`
* OpenAPI / Swagger files
* Postman collections
* Bruno collections
* API markdown files

Document:

* Endpoint path
* Method
* Authentication requirement
* Request body
* Query parameters
* Response format
* Error cases

## Git and Pull Request Guidelines

Keep commits focused.

Before proposing completion, summarize:

* What changed
* Why it changed
* Tests or checks run
* Any risks or follow-up work

Do not include unrelated formatting, dependency upgrades, or refactors.

## Agent Behavior Rules

When working in this repository:

* Do not assume missing business rules. Infer from existing code and tests first.
* Do not remove existing validation, authorization, logging, or error handling unless explicitly asked.
* Do not weaken security to make tests pass.
* Do not modify generated files unless the generation command requires it.
* Do not change public API behavior without updating tests and documentation.
* Prefer minimal, reviewable changes.
* If multiple solutions are possible, choose the one most consistent with the current codebase.
* If a task is ambiguous, make a reasonable implementation based on existing patterns and clearly state the assumption.
