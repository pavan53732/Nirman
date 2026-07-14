// Skills Loader — reads real SKILL.md files from /skills/*/SKILL.md
// Server-side only: uses fs.readFileSync. Must only be imported from
// server-side API routes (src/app/api/*/route.ts), never from client components.

import fs from "fs";
import path from "path";

export interface SkillDef {
  name: string;
  description: string;
  content: string;
  path: string;
  category: string;
}

/**
 * Load all SKILL.md files from the /skills directory synchronously.
 */
export function loadSkillsSync(): SkillDef[] {
  const skillsDir = path.join(process.cwd(), "skills");

  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  const skills: SkillDef[] = [];

  for (const entry of entries) {
    const mdPath = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(mdPath)) continue;

    const raw = fs.readFileSync(mdPath, "utf-8");

    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    let name = entry.name;
    let description = "";

    if (fmMatch) {
      const fm = fmMatch[1];
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      const descMatch = fm.match(/^description:\s*(.+)$/m);
      if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
      if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, "");
    }

    skills.push({
      name,
      description,
      content: raw,
      path: mdPath,
      category: entry.name,
    });
  }

  return skills;
}

let _skills: SkillDef[] | null = null;

export function getSkills(): SkillDef[] {
  if (!_skills) {
    try {
      _skills = loadSkillsSync();
    } catch {
      _skills = [];
    }
  }
  return _skills;
}

export const SKILL_COUNT = getSkills().length;

export function getSkill(name: string): SkillDef | undefined {
  return getSkills().find(
    (s) => s.name.toLowerCase() === name.toLowerCase() || s.category.toLowerCase() === name.toLowerCase()
  );
}
