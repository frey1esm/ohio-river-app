# Builds and runs the app inside a modern Debian/glibc userspace,
# independent of whatever the host OS ships — this exists specifically
# because the target server (AlmaLinux 8, glibc 2.28) is too old for
# Next.js's native Turbopack/SWC binary, which needs glibc 2.29+. The
# container brings its own glibc, so this has nothing to do with the host's.

# ---- deps: install dependencies only, cached separately from source changes ----
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: full source + production build ----
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner: minimal runtime image ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# `output: "standalone"` (next.config.ts) produces a self-contained
# server.js and a trimmed node_modules here — public/ and .next/static
# aren't included in it automatically and must be copied in separately
# (documented Next.js standalone-output requirement).
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
