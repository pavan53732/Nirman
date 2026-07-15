// Docker Generation Skill — generates real Dockerfiles per target + docker-compose.yml.
// web → FROM node:20-alpine, multi-stage build
// desktop → FROM mcr.microsoft.com/dotnet/sdk:8.0 (build only — WinUI needs Windows)
// android → FROM openjdk:17 + Android SDK command-line tools

import type { VirtualFile } from "../generators";
import type { TargetSpec } from "../types";

export function generateDocker(projectName: string, targets: TargetSpec[]): VirtualFile[] {
  const files: VirtualFile[] = [];
  const services: string[] = [];

  for (const t of targets) {
    if (t.kind === "web") {
      files.push({
        path: `web-admin/Dockerfile`,
        language: "dockerfile",
        content: `# Web — Next.js production image
# Multi-stage build: install deps → build → minimal runtime
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm ci && npx prisma generate && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
`,
      });
      services.push(`  web:
    build:
      context: ./web-admin
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=file:./prod.db
      - NODE_ENV=production
    restart: unless-stopped`);
    }

    if (t.kind === "windows") {
      files.push({
        path: `desktop/Dockerfile`,
        language: "dockerfile",
        content: `# Desktop — WinUI 3 build environment (Linux container for compilation only)
# NOTE: WinUI 3 apps require Windows to RUN, but can compile on Linux with .NET SDK.
# Use this for CI/CD builds. For local execution, open the .sln in Visual Studio.
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Restore
COPY *.sln ./
COPY src/${projectName.replace(/[^a-zA-Z0-9]/g, "")}/${projectName.replace(/[^a-zA-Z0-9]/g, "")}.csproj ./src/${projectName.replace(/[^a-zA-Z0-9]/g, "")}/
RUN dotnet restore

# Build
COPY . .
RUN dotnet build --configuration Release --no-restore

# Test
RUN dotnet test --configuration Release --no-build --verbosity normal || true

# Publish
RUN dotnet publish src/${projectName.replace(/[^a-zA-Z0-9]/g, "")}/${projectName.replace(/[^a-zA-Z0-9]/g, "")}.csproj \\
    -c Release -o /app/publish \\
    /p:RuntimeIdentifier=linux-x64

# Runtime — minimal .NET runtime
FROM mcr.microsoft.com/dotnet/runtime:8.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish ./
# Note: WinUI 3 won't run on Linux, but console components will
ENTRYPOINT ["dotnet", "${projectName.replace(/[^a-zA-Z0-9]/g, "")}.dll"]
`,
      });
      services.push(`  desktop-build:
    build:
      context: ./desktop
      dockerfile: Dockerfile
    profiles: ["build-only"]
    volumes:
      - ./desktop-artifacts:/app/publish`);
    }

    if (t.kind === "android") {
      files.push({
        path: `android/Dockerfile`,
        language: "dockerfile",
        content: `# Android — Compose build environment with Android SDK
# Used for CI/CD APK builds. For local development, use Android Studio.
FROM openjdk:17-jdk AS android-build

# Install Android SDK command-line tools
ENV ANDROID_HOME=/opt/android-sdk
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
RUN mkdir -p $ANDROID_HOME/cmdline-tools && \\
    apt-get update && apt-get install -y wget unzip && \\
    wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O /tmp/cmdline-tools.zip && \\
    unzip -q /tmp/cmdline-tools.zip -d $ANDROID_HOME/cmdline-tools && \\
    mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest && \\
    rm /tmp/cmdline-tools.zip

# Accept SDK licenses and install platform + build tools
RUN yes | sdkmanager --licenses && \\
    sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"

WORKDIR /project
COPY . .
RUN chmod +x ./gradlew

# Build debug APK
RUN ./gradlew assembleDebug --no-daemon

# Output APK location
CMD ["./gradlew", "assembleDebug"]
`,
      });
      services.push(`  android-build:
    build:
      context: ./android
      dockerfile: Dockerfile
    profiles: ["build-only"]
    volumes:
      - ./android-artifacts:/project/app/build/outputs/apk/debug`);
    }
  }

  // docker-compose.yml
  if (services.length > 0) {
    files.push({
      path: `docker-compose.yml`,
      language: "yaml",
      content: `# Docker Compose for ${projectName}
# Usage:
#   docker compose up web              — start web app
#   docker compose --profile build-only up desktop-build  — build desktop
#   docker compose --profile build-only up android-build  — build APK

services:
${services.join("\n\n")}
`,
    });
  }

  // .dockerignore
  files.push({
    path: `.dockerignore`,
    language: "text",
    content: `node_modules
.next
.git
*.md
*.log
dist
build
bin
obj
`,
  });

  return files;
}
