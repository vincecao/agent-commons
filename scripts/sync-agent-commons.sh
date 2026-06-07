#!/usr/bin/env bash
# Symlink shared agent commons into agent-native config locations.
# Dynamic: scans rules/, skills/, and profiles/<agent>/ so future files need no script edits.
set -euo pipefail
shopt -s nullglob dotglob

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_HOME="${HOME}"
STAMP="$(date +%Y%m%d%H%M%S)"
DRY_RUN=0
SELECTED="all"
SUPPORTED="claude|omp|agents|codex|opencode|gemini|cursor|windsurf|all"

usage() {
  printf '%s\n' \
    "usage: sync-agent-commons.sh [--dry-run] [--home PATH] [--only $SUPPORTED]" \
    '' \
    'Dynamic inputs:' \
    '  skills/*/SKILL.md        linked into each section with a skill root' \
    '  rules/*.md, rules/*.mdc  linked into each section with a rule root' \
    '  profiles/<agent>/**      linked into that agent profile root' \
    '' \
    'Common sections:' \
    '  claude    ~/.claude' \
    '  omp       ~/.omp/agent' \
    '  agents    ~/.agents' \
    '  codex     ~/.codex' \
    '  opencode  ~/.config/opencode' \
    '  gemini    ~/.gemini' \
    '  cursor    ~/.cursor' \
    '  windsurf  ~/.codeium/windsurf' \
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
  all|claude|omp|agents|codex|opencode|gemini|cursor|windsurf) ;;
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

link_profile_dir() {
  local src_dir="$1"
  local dest_dir="$2"
  local src name

  for src in "$src_dir"/*; do
    [[ -e "$src" || -L "$src" ]] || continue
    name="$(basename "$src")"
    if [[ -d "$src" && ! -L "$src" ]]; then
      link_profile_dir "$src" "$dest_dir/$name"
    elif [[ -f "$src" || -L "$src" ]]; then
      link_path "$src" "$dest_dir/$name"
    fi
  done
}

link_profile_tree() {
  local agent="$1"
  local dest_root="$2"
  local src_root="$ROOT/profiles/$agent"
  [[ -d "$src_root" ]] || return 0

  link_profile_dir "$src_root" "$dest_root"
}

link_skills_tree() {
  local dest_root="$1"
  local skill_dir name
  [[ -n "$dest_root" ]] || return 0
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
  [[ -n "$dest_root" ]] || return 0
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
  local skills_root="${3:-}"
  local rules_root="${4:-}"

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
should_link opencode && link_agent opencode "$TARGET_HOME/.config/opencode" "$TARGET_HOME/.config/opencode/skills" ""
should_link gemini && link_agent gemini "$TARGET_HOME/.gemini" "" ""
should_link cursor && link_agent cursor "$TARGET_HOME/.cursor" "" "$TARGET_HOME/.cursor/rules"
should_link windsurf && link_agent windsurf "$TARGET_HOME/.codeium/windsurf" "" ""

echo
echo "Done. Agent commons linked from $ROOT."
