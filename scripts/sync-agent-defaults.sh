#!/usr/bin/env bash
# Symlink shared agent defaults into agent-native config locations.
# Dynamic: scans rules/, skills/, and profiles/<agent>/ so future files need no script edits.
set -euo pipefail
shopt -s nullglob dotglob globstar

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_HOME="${HOME}"
STAMP="$(date +%Y%m%d%H%M%S)"
DRY_RUN=0
SELECTED="all"

usage() {
  printf '%s\n' \
    'usage: sync-agent-defaults.sh [--dry-run] [--home PATH] [--only claude|omp|agents|codex|all]' \
    '' \
    'Dynamic inputs:' \
    '  skills/*/SKILL.md        linked into enabled agent skill roots' \
    '  rules/*.md, rules/*.mdc  linked into enabled agent rule roots' \
    '  profiles/<agent>/**      linked into that agent profile root' \
    '' \
    'Sections:' \
    '  claude  profile: ~/.claude       skills: ~/.claude/skills       rules: ~/.claude/rules' \
    '  omp     profile: ~/.omp/agent    skills: ~/.omp/agent/skills    rules: ~/.omp/agent/rules' \
    '  agents  profile: ~/.agents       skills: ~/.agents/skills       rules: ~/.agents/rules' \
    '  codex   profile: ~/.codex        skills: ~/.codex/skills        rules: ~/.codex/rules' \
    '' \
    'Options:' \
    '  --dry-run       print actions without changing files' \
    '  --home PATH     target a different home directory; useful for tests' \
    '  --only NAME     link only one section; default: all' \
    '  -h, --help      show this help'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --home)
      [[ $# -ge 2 ]] || { echo 'ERROR: --home needs a path' >&2; exit 2; }
      TARGET_HOME="$2"
      shift 2
      ;;
    --only)
      [[ $# -ge 2 ]] || { echo 'ERROR: --only needs a section' >&2; exit 2; }
      SELECTED="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$SELECTED" in
  all|claude|omp|agents|codex) ;;
  *) echo "ERROR: unknown section: $SELECTED" >&2; exit 2 ;;
esac

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[dry-run]'
    local arg
    for arg in "$@"; do
      printf ' %q' "$arg"
    done
    printf '\n'
  else
    "$@"
  fi
}

section() {
  echo
  echo "== $1 =="
}

backup_path() {
  local dest="$1"
  local backup="$dest.backup.$STAMP"
  local n=1
  while [[ -e "$backup" || -L "$backup" ]]; do
    backup="$dest.backup.$STAMP.$n"
    n=$((n + 1))
  done
  printf '%s' "$backup"
}

link_path() {
  local src="$1"
  local dest="$2"

  if [[ ! -e "$src" ]]; then
    echo "ERROR: missing source: $src" >&2
    exit 1
  fi

  run mkdir -p "$(dirname "$dest")"

  if [[ -L "$dest" ]]; then
    local current
    current="$(readlink "$dest")"
    if [[ "$current" == "$src" ]]; then
      echo "ok     $dest -> $src"
      return 0
    fi
    echo "relink $dest -> $src (was $current)"
    run rm "$dest"
  elif [[ -e "$dest" ]]; then
    local backup
    backup="$(backup_path "$dest")"
    echo "backup $dest -> $backup"
    run mv "$dest" "$backup"
  else
    echo "link   $dest -> $src"
  fi

  run ln -s "$src" "$dest"
}

link_profile_tree() {
  local agent="$1"
  local dest_root="$2"
  local src_root="$ROOT/profiles/$agent"
  [[ -d "$src_root" ]] || return 0

  local src rel dest
  for src in "$src_root"/**/*; do
    [[ -f "$src" ]] || continue
    rel="${src#"$src_root/"}"
    dest="$dest_root/$rel"
    link_path "$src" "$dest"
  done
}

link_skills_tree() {
  local dest_root="$1"
  local skill_dir name
  [[ -d "$ROOT/skills" ]] || return 0

  for skill_dir in "$ROOT"/skills/*; do
    [[ -d "$skill_dir" ]] || continue
    [[ -f "$skill_dir/SKILL.md" ]] || continue
    name="$(basename "$skill_dir")"
    link_path "$skill_dir" "$dest_root/$name"
  done
}

link_rules_tree() {
  local dest_root="$1"
  local rule_file name
  [[ -d "$ROOT/rules" ]] || return 0

  for rule_file in "$ROOT"/rules/*.md "$ROOT"/rules/*.mdc; do
    [[ -f "$rule_file" ]] || continue
    name="$(basename "$rule_file")"
    link_path "$rule_file" "$dest_root/$name"
  done
}

link_agent() {
  local agent="$1"
  local profile_root="$2"
  local skills_root="$3"
  local rules_root="$4"

  section "$agent"
  link_profile_tree "$agent" "$profile_root"
  link_skills_tree "$skills_root"
  link_rules_tree "$rules_root"
}

should_link() {
  [[ "$SELECTED" == 'all' || "$SELECTED" == "$1" ]]
}

should_link claude && link_agent claude "$TARGET_HOME/.claude" "$TARGET_HOME/.claude/skills" "$TARGET_HOME/.claude/rules"
should_link omp && link_agent omp "$TARGET_HOME/.omp/agent" "$TARGET_HOME/.omp/agent/skills" "$TARGET_HOME/.omp/agent/rules"
should_link agents && link_agent agents "$TARGET_HOME/.agents" "$TARGET_HOME/.agents/skills" "$TARGET_HOME/.agents/rules"
should_link codex && link_agent codex "$TARGET_HOME/.codex" "$TARGET_HOME/.codex/skills" "$TARGET_HOME/.codex/rules"

echo
echo "Done. Agent defaults linked from $ROOT."
