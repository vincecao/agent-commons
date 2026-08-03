#!/usr/bin/env bash
# Backup/restore the gitignored private payload of agent-commons.
#
# The public repo (origin) carries the harness: sync CLI, profiles, examples.
# This script drives a SECOND git dir (.git-private) over the SAME worktree that
# tracks only the private payload and pushes it to a private remote.
#
# Payload paths are force-added: the worktree .gitignore hides them from the
# public repo, and worktree .gitignore rules outrank .git-private/info/exclude,
# so `add -f` with an explicit pathspec is the only reliable selector here.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PRIVATE_GIT_DIR="$ROOT/.git-private"
PRIVATE_REMOTE="${AGENT_COMMONS_PRIVATE_REMOTE:-https://github.com/vincecao/agent-commons-sync.git}"
PRIVATE_BRANCH=main

# Live private state. Everything here is gitignored in the public repo.
PAYLOAD=(rules skills "Agent Learning" .obsidian)

# Public-tracked or machine-local paths that must never enter the private repo.
PAYLOAD_EXCLUDES=(
  ':(exclude)skills/agent-commons'
  ':(exclude)skills/obsidian-vault'
  # Tracked in the public repo, so the private repo must not own them too.
  ':(exclude)**/.gitkeep'
  ':(exclude)**/node_modules/**'
  ':(exclude)**/.DS_Store'
  ':(exclude)**/*.backup.*'
)

pgit() { git --git-dir="$PRIVATE_GIT_DIR" --work-tree="$ROOT" "$@"; }

die() {
  echo "error: $*" >&2
  exit 1
}

configure() {
  pgit config core.bare false
  # Relative to $GIT_DIR, so the checkout stays portable across machines.
  pgit config core.worktree ..
  # The worktree is full of public-repo and build files; only tracked payload
  # changes are meaningful noise here.
  pgit config status.showUntrackedFiles no
  pgit config core.excludesFile /dev/null
  if pgit remote get-url origin >/dev/null 2>&1; then
    pgit remote set-url origin "$PRIVATE_REMOTE"
  else
    pgit remote add origin "$PRIVATE_REMOTE"
  fi
  # `git init/clone --bare` maps fetches onto refs/heads/*; this git dir is not
  # bare, so use the normal remote-tracking layout.
  pgit config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
}

cmd_init() {
  if [[ -d "$PRIVATE_GIT_DIR" ]]; then
    configure
    echo "private git dir already present: $PRIVATE_GIT_DIR"
    return
  fi
  git init --bare --initial-branch="$PRIVATE_BRANCH" "$PRIVATE_GIT_DIR" >/dev/null
  configure
  echo "initialized $PRIVATE_GIT_DIR -> $PRIVATE_REMOTE"
}

require_init() {
  [[ -d "$PRIVATE_GIT_DIR" ]] || die "no private git dir; run: $0 init"
}

cmd_save() {
  require_init
  local message="${1:-backup: private agent payload $(date -u +%Y-%m-%dT%H:%M:%SZ)}"
  pgit add -f -- "${PAYLOAD[@]}" "${PAYLOAD_EXCLUDES[@]}"
  if pgit diff --cached --quiet; then
    echo "no payload changes to commit"
  else
    pgit commit -q -m "$message"
    echo "committed: $(pgit log -1 --format='%h %s')"
  fi
  cmd_status
}

cmd_status() {
  require_init
  echo "tracked payload files: $(pgit ls-files | wc -l | tr -d ' ')"
  pgit status --short || true
}

cmd_push() {
  require_init
  pgit push -u origin "$PRIVATE_BRANCH"
}

cmd_pull() {
  require_init
  pgit pull --ff-only origin "$PRIVATE_BRANCH"
}

# Fresh machine: public repo is cloned, private payload is not there yet.
cmd_restore() {
  local force="${1:-}"
  if [[ -d "$PRIVATE_GIT_DIR" ]]; then
    configure
  else
    git clone --bare --branch "$PRIVATE_BRANCH" "$PRIVATE_REMOTE" "$PRIVATE_GIT_DIR" >/dev/null
    configure
  fi

  pgit fetch -q origin "$PRIVATE_BRANCH"
  pgit update-ref "refs/heads/$PRIVATE_BRANCH" "refs/remotes/origin/$PRIVATE_BRANCH"
  pgit symbolic-ref HEAD "refs/heads/$PRIVATE_BRANCH"

  # Load the backup into the index only; `diff --diff-filter=M` then names the
  # payload paths that already exist locally with different content. Missing
  # files show up as deletions and are safe to write.
  pgit read-tree "refs/heads/$PRIVATE_BRANCH"
  if [[ "$force" != "--force" ]]; then
    local conflicts
    conflicts="$(pgit diff --name-only --diff-filter=M)"
    if [[ -n "$conflicts" ]]; then
      printf 'local content differs from the backup:\n%s\n' "$conflicts" >&2
      die "restore would overwrite the files above; save them or re-run with --force"
    fi
  fi
  pgit checkout -q -f "$PRIVATE_BRANCH"
  pgit branch --set-upstream-to="origin/$PRIVATE_BRANCH" "$PRIVATE_BRANCH" >/dev/null 2>&1 || true
  echo "restored $(pgit ls-files | wc -l | tr -d ' ') payload files; next: pnpm install && pnpm sync"
}

case "${1:-}" in
  init) cmd_init ;;
  save) shift; cmd_save "${1:-}" ;;
  status) cmd_status ;;
  push) cmd_push ;;
  pull) cmd_pull ;;
  restore) shift; cmd_restore "${1:-}" ;;
  git) require_init; shift; pgit "$@" ;;
  *)
    cat >&2 <<USAGE
usage: $0 <command>

  init              create .git-private and point it at the private remote
  save [message]    stage + commit the private payload
  status            tracked payload count and dirty tracked files
  push              push the private branch to the private remote
  pull              fast-forward the private branch from the private remote
  restore [--force] clone/checkout the payload onto a fresh machine
  git <args...>     run any git command against the private repo

remote: $PRIVATE_REMOTE (override with AGENT_COMMONS_PRIVATE_REMOTE)
USAGE
    exit 1
    ;;
esac
