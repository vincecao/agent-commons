import { join } from "node:path";

export const SECTION_NAMES = ["claude", "omp", "agents", "codex", "opencode", "gemini", "cursor"] as const;
export type SectionName = (typeof SECTION_NAMES)[number];
export type SectionSelection = SectionName | "all";

type SectionRoot<TPath> = TPath | null;

interface SectionRoots<TPath> {
  readonly profileRoot: TPath;
  readonly skillsRoot: SectionRoot<TPath>;
  readonly rulesRoot: SectionRoot<TPath>;
}

type SectionConfig = SectionRoots<readonly string[]>;

export interface AgentSection extends SectionRoots<string> {
  readonly name: SectionName;
}

const SECTION_CONFIGS = {
  claude: {
    profileRoot: [".claude"],
    skillsRoot: [".claude", "skills"],
    rulesRoot: [".claude", "rules"],
  },
  omp: {
    profileRoot: [".omp", "agent"],
    skillsRoot: [".omp", "agent", "skills"],
    rulesRoot: [".omp", "agent", "rules"],
  },
  agents: {
    profileRoot: [".agents"],
    skillsRoot: [".agents", "skills"],
    rulesRoot: [".agents", "rules"],
  },
  codex: {
    profileRoot: [".codex"],
    skillsRoot: [".codex", "skills"],
    rulesRoot: [".codex", "rules"],
  },
  opencode: {
    profileRoot: [".config", "opencode"],
    skillsRoot: [".config", "opencode", "skills"],
    rulesRoot: null,
  },
  gemini: {
    profileRoot: [".gemini"],
    skillsRoot: null,
    rulesRoot: null,
  },
  cursor: {
    profileRoot: [".cursor"],
    skillsRoot: null,
    rulesRoot: [".cursor", "rules"],
  },
} as const satisfies Record<SectionName, SectionConfig>;

export function defaultSections(home: string): readonly AgentSection[] {
  return SECTION_NAMES.map(name => {
    const section = SECTION_CONFIGS[name];

    return {
      name,
      profileRoot: join(home, ...section.profileRoot),
      skillsRoot: section.skillsRoot && join(home, ...section.skillsRoot),
      rulesRoot: section.rulesRoot && join(home, ...section.rulesRoot),
    };
  });
}

export function isSectionSelection(value: string): value is SectionSelection {
  return value === "all" || SECTION_NAMES.includes(value as SectionName);
}
