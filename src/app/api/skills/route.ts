import { NextResponse } from "next/server";
import { loadSkillsSync } from "@/lib/engine/skills/loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const skills = loadSkillsSync();
    return NextResponse.json({
      count: skills.length,
      skills: skills.map((s) => ({
        name: s.name,
        description: s.description,
        category: s.category,
        path: s.path,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to load skills: ${String(err)}`, count: 0, skills: [] },
      { status: 500 }
    );
  }
}
