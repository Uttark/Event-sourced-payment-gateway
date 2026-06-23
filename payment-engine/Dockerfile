# =============================================================================
# Stage 1: Builder
# =============================================================================
# Full environment with dev dependencies — the only stage that needs the
# TypeScript compiler, Prisma CLI, and all build tooling.
# The compiled output is copied into Stage 2; nothing else from this stage
# ends up in the final image.
# =============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# ── Install dependencies ──────────────────────────────────────────────────────
# Copy ONLY the manifest files first.
# Docker caches each instruction as a layer. By copying package files before
# source code, the expensive `npm ci` layer is only re-run when dependencies
# actually change — not on every source file edit.
COPY package*.json ./

# Copy the Prisma schema before installing because npm's postinstall script
# (or our explicit generate command below) needs the schema to produce the
# typed Prisma client. If schema.prisma isn't here, `prisma generate` fails.
COPY prisma ./prisma/

# Install ALL dependencies including TypeScript, ts-node, and the Prisma CLI.
# `npm ci` (clean install) is preferred over `npm install` in CI/build contexts
# because it uses package-lock.json for exact, reproducible installs.
RUN npm ci

# Generate the Prisma Client from the schema.
# This produces the typed query builder (node_modules/@prisma/client) and
# the native binary engine (node_modules/.prisma/client) that runs queries.
RUN npx prisma generate

# Now copy all source files and compile TypeScript → JavaScript.
# This step comes AFTER the install steps so source code changes don't
# invalidate the dependency cache layers above.
COPY . .

# `npm run build` calls `tsc --project tsconfig.json`.
# Output lands in the `dist/` directory per our tsconfig's `outDir` setting.
RUN npm run build


# =============================================================================
# Stage 2: Runner
# =============================================================================
# A lean production image. We start fresh from the same base and copy in
# only what the application needs to run. No TypeScript compiler, no source
# files, no test utilities — just the compiled output and runtime dependencies.
# =============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

# Create a non-root user to run the application.
# Running as root inside a container is a security risk — if the process is
# compromised, the attacker has root access to the container.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# ── Install production dependencies ──────────────────────────────────────────
COPY package*.json ./

# `--omit=dev` skips TypeScript, ts-node, prisma CLI, and all other dev tools.
# This significantly reduces the final image size.
RUN npm ci --omit=dev

# ── Copy the generated Prisma engine binaries ────────────────────────────────
# `npm ci --omit=dev` installs @prisma/client but does NOT run `prisma generate`.
# The native binary files (.node files inside node_modules/.prisma/client) were
# generated in the builder stage for the correct target OS (Linux Alpine).
# We copy them here so the Prisma client can execute queries at runtime.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# ── Copy the Prisma CLI for running migrations ───────────────────────────────
# The `migrate` service in docker-compose runs `prisma migrate deploy`.
# The CLI is a devDependency, so we copy just the binary from the builder.
# This keeps the image lean while still supporting the one-shot migrate container.
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

# ── Copy compiled application and schema ─────────────────────────────────────
# The compiled JavaScript from the builder stage.
COPY --from=builder /app/dist ./dist

# The Prisma schema is read at runtime to resolve types and validate queries.
COPY --from=builder /app/prisma ./prisma

# ── Permissions and exposure ──────────────────────────────────────────────────
# Give the non-root user ownership of the working directory.
RUN chown -R appuser:appgroup /app
USER appuser

# Document that the API server listens on port 3000.
# EXPOSE is informational — the actual host mapping is in docker-compose.yml.
EXPOSE 3000