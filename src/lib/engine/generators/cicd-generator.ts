// CI/CD Generation Skill — generates real GitHub Actions workflow YAML
// with 3 jobs: web (npm ci + npm run build), desktop (dotnet build),
// android (./gradlew assembleDebug). Real YAML, no placeholder.

import type { VirtualFile } from "../generators";
import type { TargetSpec } from "../types";

export function generateCICD(projectName: string, targets: TargetSpec[]): VirtualFile[] {
  const hasWeb = targets.some((t) => t.kind === "web");
  const hasWindows = targets.some((t) => t.kind === "windows");
  const hasAndroid = targets.some((t) => t.kind === "android");

  const jobs: string[] = [];

  if (hasWeb) {
    jobs.push(`  build-web:
    name: Build Web (Next.js)
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web-admin
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: web-admin/package-lock.json
      - run: npm ci
      - run: npx prisma generate
      - run: npm run build
      - name: Type check
        run: npx tsc --noEmit
      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: web-build
          path: web-admin/.next/
          retention-days: 7`);
  }

  if (hasWindows) {
    jobs.push(`  build-desktop:
    name: Build Desktop (WinUI 3)
    runs-on: windows-latest
    defaults:
      run:
        working-directory: desktop
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: 8.0.x
      - name: Restore
        run: dotnet restore
      - name: Build
        run: dotnet build --configuration Release --no-restore
      - name: Run tests
        run: dotnet test --configuration Release --no-build --verbosity normal
      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: desktop-build
          path: desktop/src/*/bin/Release/
          retention-days: 7`);
  }

  if (hasAndroid) {
    jobs.push(`  build-android:
    name: Build Android (Compose)
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: android
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17
      - name: Setup Gradle
        uses: gradle/actions/setup-gradle@v4
      - name: Grant execute permission for gradlew
        run: chmod +x ./gradlew
      - name: Build debug APK
        run: ./gradlew assembleDebug
      - name: Run unit tests
        run: ./gradlew testDebugUnitTest
      - name: Upload APK
        uses: actions/upload-artifact@v4
        with:
          name: android-apk
          path: android/app/build/outputs/apk/debug/
          retention-days: 7`);
  }

  const workflowYaml = `name: Build

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
${jobs.join("\n\n")}
`;

  return [
    {
      path: `.github/workflows/build.yml`,
      language: "yaml",
      content: workflowYaml,
    },
  ];
}
