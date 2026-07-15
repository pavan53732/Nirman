import { NextResponse } from "next/server";
import { getSkill } from "@/lib/engine/skills/loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/skill-content?name=<skill-name>
 * Returns the full SKILL.md content string for a given skill name (or
 * category directory name). The loader reads real files from the skills
 * directory (skills/<name>/SKILL.md) via fs.readFileSync, so this route
 * is server-only.
 *
 * Response:
 *   200 { name, content }
 *   404 { error: "Skill not found", name }
 *   500 { error: "..." }
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name")?.trim();
    if (!name) {
      return NextResponse.json(
        { error: "Missing 'name' query parameter" },
        { status: 400 }
      );
    }

    const skill = getSkill(name);
    if (!skill) {
      return NextResponse.json(
        { error: `Skill not found: ${name}`, name },
        { status: 404 }
      );
    }

    return NextResponse.json({
      name: skill.name,
      category: skill.category,
      content: skill.content,
      length: skill.content.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to load skill content: ${String(err)}` },
      { status: 500 }
    );
  }
}
