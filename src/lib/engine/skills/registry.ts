// Real Skills Registry — maps platform targets to the concrete generator skills
// that produce compilable source files. Each skill ID corresponds to a real
// generator function in the generators/ folder. No mock skills, no fake data.

export const SKILLS = {
  web: [
    "nextjs-app-router",        // generateNextjsApp() — App Router + layout + page
    "react-server-components",   // server components in app/dashboard/page.tsx
    "tailwind",                  // tailwind.config.ts + globals.css + postcss.config.js
    "prisma-sqlite",             // prisma/schema.prisma with SQLite datasource
    "next-auth",                 // lib/auth.ts + [...nextauth]/route.ts + middleware.ts (conditional)
    "crud-table",                // app/dashboard/<entity>/page.tsx with real table + form + delete
    "api-routes",                // app/api/<entity>/route.ts with GET/POST/DELETE
    "tsc-validation",            // tsconfig.json + next-env.d.ts for tsc --noEmit
    "npm-build",                 // package.json with build script
  ],
  windows: [
    "winui3-dotnet8",           // generateWinUI3App() — .sln + .csproj + App.xaml
    "xaml-datagrid-form",        // Views/MainWindow.xaml with GridView + add form
    "observable-object-relaycommand", // ViewModels/MainViewModel.cs with CommunityToolkit.Mvvm
    "efcore-sqlite-conditional", // Data/AppDbContext.cs (only when offline-sync detected)
    "sln-csproj-generation",     // MyApp.sln with valid VS header + GUID + GlobalSection
    "xml-validation",            // app.manifest + PublishProfiles/FolderProfile.pubxml
  ],
  android: [
    "kotlin-compose",           // generateAndroidApp() — settings.gradle.kts + app/build.gradle.kts
    "navigation-compose",        // MainActivity.kt with NavHost + 2 screens
    "room-conditional",          // data/local/Entity + Dao + AppDatabase (only when offline-sync)
    "hilt-di",                   // di/AppModule.kt + @HiltAndroidApp + @AndroidEntryPoint
    "lazycolumn-crud",           // ui/screens/<Entity>ListScreen.kt with LazyColumn + form + delete
    "material3",                 // ui/theme/Theme.kt with dynamic color scheme
    "gradle-kts-validation",     // gradle/libs.versions.toml + gradle-wrapper.properties
  ],
} as const;

export type SkillPlatform = keyof typeof SKILLS;
export type SkillId = (typeof SKILLS)[SkillPlatform][number];

/** Total skill count across all platforms. */
export const TOTAL_SKILLS: number = Object.values(SKILLS).reduce((n, arr) => n + arr.length, 0);

/** Get skills for a platform. */
export function getSkillsForPlatform(platform: string): readonly string[] {
  if (platform === "windows") return SKILLS.windows;
  if (platform === "android") return SKILLS.android;
  return SKILLS.web;
}

/** Check if a skill exists for a platform. */
export function hasSkill(platform: string, skillId: string): boolean {
  return getSkillsForPlatform(platform).includes(skillId as never);
}
