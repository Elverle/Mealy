# syntax=docker/dockerfile:1

# Node 24, almeno 24.22.1 (fix CVE-2026-111497); `ai` 7 richiede Node >= 22. Il tag è scritto per
# esteso nei due FROM perché Dependabot non risolve gli ARG; il gate CI legge la
# versione da qui, quindi va cambiata solo in questo file.
FROM node:24.22.2-alpine AS base
RUN apk add --no-cache libc6-compat \
  && npm install -g pnpm@11.14.0
WORKDIR /app

# --- Dipendenze (strato riusato finché non cambia il lockfile) ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# --- Build Next.js in modalità standalone ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_OUTPUT=standalone
RUN pnpm build

# --- Immagine finale: solo l'output standalone ---
FROM node:24.22.2-alpine AS runner
LABEL org.opencontainers.image.source="https://github.com/Elverle/Mealy"
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 nodejs \
  && adduser -S -u 1001 -G nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Le migrazioni SQL le legge `lib/db/bootstrap.ts` all'avvio: non fanno parte del bundle.
COPY --from=builder --chown=nextjs:nodejs /app/lib/db/migrations ./lib/db/migrations
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
