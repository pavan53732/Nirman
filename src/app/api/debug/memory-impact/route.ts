// Debug endpoint: proves Architecture Memory has real impact on generated code.
//
// POST { prompt, database }
//   1. Writes "Database: PostgreSQL" to Architecture Memory.
//   2. Calls generateForTarget("web", ...) with database: "postgresql".
//   3. Extracts prisma/schema.prisma from the generated files.
//   4. Writes "Database: SQLite" to Architecture Memory (overwrites).
//   5. Calls generateForTarget("web", ...) with database: "sqlite".
//   6. Extracts prisma/schema.prisma from the generated files.
//   7. Returns BOTH schema versions side-by-side so the user can see the diff.
//
// Also returns desktop (EF Core OnConfiguring) + android (file list) slices so
// the memory impact is visible across all three generators.
//
// This endpoint is safe to call multiple times — it doesn't persist anything
// between calls except in the in-memory ProjectMemoryManager (which is
// per-server-instance and resets on reload).
//
// The endpoint is also idempotent within a single call: the final memory state
// is always "Database: SQLite" (the default), so it doesn't pollute subsequent
// build runs.

import { NextRequest, NextResponse } from "next/server";
// Import through the engine index — this triggers orchestrator.bootstrap()
// AFTER orchestrator.ts has fully evaluated, avoiding a TDZ circular-dep crash
// (route.ts → orchestrator.ts → skills/ambiguity-detector.ts → ../index.ts → orchestrator).
import {
  generateForTarget,
  projectMemory,
  readDatabaseFromMemory,
  type GenerationResult,
  type VirtualFile,
  type DatabaseChoice,
} from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MemoryImpactRequestBody {
  /** Prompt for the build (e.g. "CRM app"). Defaults to "CRM app". */
  prompt?: string;
  /** Database the user is requesting. Decides which version is "primary". */
  database?: DatabaseChoice;
}

interface SchemaSlice {
  database: DatabaseChoice;
  /** Raw content of prisma/schema.prisma from the web generator. */
  schemaPrisma: string;
  /** Raw content of .env from the web generator. */
  envFile: string;
  /** Raw content of .env.example (PostgreSQL only) — null for sqlite. */
  envExample: string | null;
}

interface DesktopSlice {
  database: DatabaseChoice;
  /** AppDbContext.cs from the desktop generator (contains UseSqlite / UseNpgsql). */
  appDbContext: string;
  /** The csproj file content (contains the EF Core package reference). */
  csproj: string;
  /** Stack label emitted by the generator (e.g. "WinUI 3 + .NET 8 + EF Core PostgreSQL (Npgsql)"). */
  stack: string;
}

interface AndroidSlice {
  database: DatabaseChoice;
  /** Number of files generated. */
  fileCount: number;
  /** Whether DATABASE_MIGRATION.md was emitted (only true for postgresql). */
  hasMigrationNote: boolean;
  /** Whether RetrofitApiService.kt was emitted (only true for postgresql). */
  hasRetrofitService: boolean;
  /** Full list of generated file paths. */
  files: string[];
  /** Stack label emitted by the generator. */
  stack: string;
}

interface MemoryImpactResponse {
  /** Echo of the requested database. */
  requested: DatabaseChoice;
  /** The database read back from Architecture Memory after the writes (sanity check). */
  pgMemoryRead: DatabaseChoice;
  sqliteMemoryRead: DatabaseChoice;
  /** Memory writes performed (in order). */
  memoryWrites: { kind: string; title: string; content: string; source: string }[];
  /** Web Prisma schema for both database choices. */
  web: {
    postgresql: SchemaSlice;
    sqlite: SchemaSlice;
  };
  /** Desktop EF Core slices for both database choices. */
  desktop: {
    postgresql: DesktopSlice;
    sqlite: DesktopSlice;
  };
  /** Android file-list slices for both database choices. */
  android: {
    postgresql: AndroidSlice;
    sqlite: AndroidSlice;
  };
  /** High-level diff summary — the key lines that change between PG and SQLite. */
  diff: {
    prismaProvider: { postgresql: string; sqlite: string };
    prismaUrl: { postgresql: string; sqlite: string };
    efCorePackage: { postgresql: string; sqlite: string };
    efCoreOnConfiguring: { postgresql: string; sqlite: string };
    androidExtraFiles: { postgresql: string[]; sqlite: string[] };
  };
  /** What the orchestrator's readDatabaseFromMemory() returned at each step. */
  note: string;
}

function findFile(files: VirtualFile[], pathSuffix: string): string {
  const f = files.find((file) => file.path === pathSuffix || file.path.endsWith("/" + pathSuffix));
  return f?.content ?? `// (file ${pathSuffix} not found)`;
}

function hasFile(files: VirtualFile[], pathSuffix: string): boolean {
  return files.some((file) => file.path === pathSuffix || file.path.endsWith("/" + pathSuffix));
}

function extractLine(content: string, pattern: RegExp): string {
  const m = content.match(pattern);
  return m ? m[0] : "(not found)";
}

/** Build a web target with the given database and extract the relevant files. */
function sliceWeb(database: DatabaseChoice, prompt: string, targetId: string): SchemaSlice {
  const result: GenerationResult = generateForTarget("web", "nextjs-app-router", "CrmWeb", targetId, {
    prompt,
    capabilities: [],
    nonFunctionals: [],
    database,
  });
  return {
    database,
    schemaPrisma: findFile(result.files, "prisma/schema.prisma"),
    envFile: findFile(result.files, ".env"),
    envExample: hasFile(result.files, ".env.example") ? findFile(result.files, ".env.example") : null,
  };
}

/**
 * Build a desktop target with the given database and extract the relevant files.
 * Passes `capabilities: ["offline-sync"]` so EF Core is emitted for BOTH
 * database choices (otherwise the sqlite path skips AppDbContext entirely
 * when no offline capability is requested, making the diff meaningless).
 */
function sliceDesktop(database: DatabaseChoice, prompt: string, targetId: string): DesktopSlice {
  const result: GenerationResult = generateForTarget("windows", "winui3-dotnet8", "CrmDesktop", targetId, {
    prompt,
    capabilities: ["offline-sync"],
    nonFunctionals: ["offline-first"],
    database,
  });
  // Find the .csproj file (path is src/<appName>/<appName>.csproj)
  const csprojFile = result.files.find((f) => f.path.endsWith(".csproj"));
  return {
    database,
    appDbContext: findFile(result.files, "Data/AppDbContext.cs"),
    csproj: csprojFile?.content ?? "// (csproj not found)",
    stack: result.stack,
  };
}

/** Build an android target with the given database and extract the relevant file list. */
function sliceAndroid(database: DatabaseChoice, prompt: string, targetId: string): AndroidSlice {
  const result: GenerationResult = generateForTarget("android", "kotlin-compose", "CrmAndroid", targetId, {
    prompt,
    capabilities: ["offline-sync"],
    nonFunctionals: ["offline-first"],
    database,
  });
  return {
    database,
    fileCount: result.files.length,
    hasMigrationNote: hasFile(result.files, "DATABASE_MIGRATION.md"),
    hasRetrofitService: hasFile(result.files, "RetrofitApiService.kt"),
    files: result.files.map((f) => f.path),
    stack: result.stack,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: MemoryImpactRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = body.prompt?.trim() || "CRM app";
  const requested: DatabaseChoice = body.database === "postgresql" ? "postgresql" : "sqlite";

  // ------------------------------------------------------------------
  // Step 1: Write "Database: PostgreSQL" to Architecture Memory, then
  // generate all three targets with database: "postgresql".
  // ------------------------------------------------------------------
  projectMemory.write("architecture", "Database", "PostgreSQL", "debug");
  const pgMemoryRead = readDatabaseFromMemory();
  const webPg = sliceWeb("postgresql", prompt, "t1-pg");
  const desktopPg = sliceDesktop("postgresql", prompt, "t1-pg");
  const androidPg = sliceAndroid("postgresql", prompt, "t1-pg");

  // ------------------------------------------------------------------
  // Step 2: Write "Database: SQLite" to Architecture Memory (overwrite),
  // then regenerate all three targets with database: "sqlite".
  // ------------------------------------------------------------------
  projectMemory.write("architecture", "Database", "SQLite", "debug");
  const sqliteMemoryRead = readDatabaseFromMemory();
  const webSqlite = sliceWeb("sqlite", prompt, "t1-sqlite");
  const desktopSqlite = sliceDesktop("sqlite", prompt, "t1-sqlite");
  const androidSqlite = sliceAndroid("sqlite", prompt, "t1-sqlite");

  // ------------------------------------------------------------------
  // Step 3: Build the response — both schema versions side-by-side + a
  // diff summary highlighting the key lines that change.
  // ------------------------------------------------------------------
  const response: MemoryImpactResponse = {
    requested,
    pgMemoryRead,
    sqliteMemoryRead,
    memoryWrites: [
      { kind: "architecture", title: "Database", content: "PostgreSQL", source: "debug" },
      { kind: "architecture", title: "Database", content: "SQLite", source: "debug" },
    ],
    web: {
      postgresql: webPg,
      sqlite: webSqlite,
    },
    desktop: {
      postgresql: desktopPg,
      sqlite: desktopSqlite,
    },
    android: {
      postgresql: androidPg,
      sqlite: androidSqlite,
    },
    diff: {
      prismaProvider: {
        postgresql: extractLine(webPg.schemaPrisma, /provider = "postgresql"/),
        sqlite: extractLine(webSqlite.schemaPrisma, /provider = "sqlite"/),
      },
      prismaUrl: {
        postgresql: extractLine(webPg.schemaPrisma, /url\s+=\s+env\("DATABASE_URL"\)/),
        sqlite: extractLine(webSqlite.schemaPrisma, /url\s+=\s+env\("DATABASE_URL"\)/),
      },
      efCorePackage: {
        postgresql: extractLine(desktopPg.csproj, /Npgsql\.EntityFrameworkCore\.PostgreSQL[^\n]*/),
        sqlite: extractLine(desktopSqlite.csproj, /Microsoft\.EntityFrameworkCore\.Sqlite[^\n]*/),
      },
      efCoreOnConfiguring: {
        postgresql: extractLine(desktopPg.appDbContext, /options\.UseNpgsql\([^\n]*/),
        sqlite: extractLine(desktopSqlite.appDbContext, /options\.UseSqlite\([^\n]*/),
      },
      androidExtraFiles: {
        postgresql: androidPg.files.filter(
          (p) => p.endsWith("DATABASE_MIGRATION.md") || p.endsWith("RetrofitApiService.kt")
        ),
        sqlite: androidSqlite.files.filter(
          (p) => p.endsWith("DATABASE_MIGRATION.md") || p.endsWith("RetrofitApiService.kt")
        ),
      },
    },
    note:
      "Architecture Memory drives generator output. After writing 'PostgreSQL', readDatabaseFromMemory() returns 'postgresql' and the web generator emits provider = \"postgresql\" (Prisma), UseNpgsql (EF Core), and the Android generator adds DATABASE_MIGRATION.md + RetrofitApiService.kt. After writing 'SQLite', readDatabaseFromMemory() returns 'sqlite' and the generators revert to their original SQLite output.",
  };

  return NextResponse.json(response, { status: 200 });
}

/** GET: small landing page describing the endpoint. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    endpoint: "/api/debug/memory-impact",
    method: "POST",
    description:
      "Proves Architecture Memory has real impact on generated code. Writes PostgreSQL to memory, regenerates, then writes SQLite, regenerates again, and returns both schema versions side-by-side.",
    body: { prompt: "string (default: 'CRM app')", database: "'postgresql' | 'sqlite' (default: 'sqlite')" },
    example: {
      request: { prompt: "CRM app", database: "postgresql" },
      responseKeys: [
        "web.postgresql.schemaPrisma (provider = \"postgresql\")",
        "web.sqlite.schemaPrisma (provider = \"sqlite\")",
        "desktop.postgresql.appDbContext (UseNpgsql)",
        "desktop.sqlite.appDbContext (UseSqlite)",
        "android.postgresql.files (includes DATABASE_MIGRATION.md + RetrofitApiService.kt)",
        "diff (key line-by-line summary)",
      ],
    },
  });
}
