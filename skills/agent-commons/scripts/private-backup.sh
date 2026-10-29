#!/usr/bin/env bash
# Backup/restore the private payload of agent-commons.
#
# The public repo (origin) carries the harness: sync CLI, profiles, examples.
# This script drives a SECOND git dir (.git-private) over the SAME worktree,
# tracking only what the public repo refuses to hold.
#
# Payload = every file the public repo ignores, minus build and machine junk.
# That keeps the split self-maintaining: privatizing a file means adding it to
# the public .gitignore, nothing else. Files are force-added because the
# worktree .gitignore outranks .git-private/info/exclude, so an ignore
# inversion inside this git dir would silently match nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PRIVATE_GIT_DIR="$ROOT/.git-private"
PRIVATE_REMOTE="${AGENT_COMMONS_PRIVATE_REMOTE:-https://github.com/vincecao/agent-commons-sync.git}"
PRIVATE_BRANCH=main

# Ignored, but rebuildable or machine-local: never worth backing up.
# Plain (non-`:(glob)`) pathspecs, so `*` also crosses directory separators and
# a bare `**/name` would NOT match `name` at the repo root.
PAYLOAD_EXCLUDES=(
  ':(exclude)*node_modules/*'
  ':(exclude)dist/*'
  ':(exclude)coverage/*'
  ':(exclude).vitest/*'
  ':(exclude)*tmp/*'
  ':(exclude).git-private/*'
  ':(exclude)*.DS_Store'
  ':(exclude)*.backup.*'
  ':(exclude).env'
  ':(exclude).env.*'
  ':(exclude)*.log'
  # review-state: keep lane-ledger.json, merged.json, review.json; skip raw lane transcripts and thread dumps
  ':(exclude)review-state/*.raw.txt'
  ':(exclude)review-state/*threads.txt'
  ':(exclude)review-state/*resp.json'
)

# Public-repo ignores are the source of truth; anything it tracks stays out.
payload_files() {
  git -C "$ROOT" ls-files --others --ignored --exclude-standard -z -- . "${PAYLOAD_EXCLUDES[@]}"
}

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
  payload_files | pgit add -f --pathspec-from-file=- --pathspec-file-nul
  # Stages content and deletions for payload files already tracked here; a file
  # that became public-tracked drops out of payload_files and must be untracked.
  pgit add -u
  local orphans
  orphans="$(comm -12 <(pgit ls-files | sort) <(git -C "$ROOT" ls-files | sort))"
  if [[ -n "$orphans" ]]; then
    printf '%s\n' "$orphans" | tr '\n' '\0' | pgit rm -q --cached --pathspec-from-file=- --pathspec-file-nul
    echo "untracked from private (now public): $(printf '%s' "$orphans" | tr '\n' ' ')"
  fi
  if pgit diff --cached --quiet; then
    echo "no payload changes to commit"
  else
    pgit commit -q -m "$message"
    echo "committed: $(pgit log -1 --format='%h %s')"
  fi
  cmd_status
}

# Payload files on disk that the private repo doesn't track yet (what `save` would add).
new_payload() {
  comm -23 <(payload_files | tr '\0' '\n' | sort) <(pgit ls-files | sort)
}

cmd_status() {
  require_init
  echo "tracked payload files: $(pgit ls-files | wc -l | tr -d ' ')"
  pgit status --short || true
  local fresh
  fresh="$(new_payload)"
  if [[ -n "$fresh" ]]; then
    echo "new (not saved yet; \`save\` will add):"
    printf '%s\n' "$fresh" | sed 's/^/ ?? /'
  fi
}

# save -> pull (fast-forward, else rebase) -> push. Never forces.
cmd_sync() {
  require_init
  cmd_save "${1:-}"
  pgit fetch -q origin "$PRIVATE_BRANCH"
  local behind ahead
  read -r behind ahead < <(pgit rev-list --left-right --count "origin/$PRIVATE_BRANCH...HEAD")
  if [[ "$behind" -gt 0 ]]; then
    if [[ "$ahead" -eq 0 ]]; then
      pgit merge -q --ff-only "origin/$PRIVATE_BRANCH"
      echo "pulled $behind commit(s) (fast-forward)"
    elif pgit rebase -q "origin/$PRIVATE_BRANCH" >/dev/null 2>&1; then
      echo "rebased $ahead local commit(s) onto $behind remote commit(s)"
    else
      pgit rebase --abort >/dev/null 2>&1 || true
      die "private repo conflict: local and remote both changed the same payload files. Nothing was pushed or lost. Resolve with: pnpm backup git pull --rebase origin $PRIVATE_BRANCH"
    fi
  fi
  read -r behind ahead < <(pgit rev-list --left-right --count "origin/$PRIVATE_BRANCH...HEAD")
  if [[ "$ahead" -gt 0 ]]; then
    pgit push -q -u origin "$PRIVATE_BRANCH"
    echo "pushed $ahead commit(s) to private remote"
  fi
  echo "private repo synced: $(pgit rev-parse --short HEAD)"
}

# One repo's state: "<label>: <status -sb line>" plus pending lines. Sets PENDING.
report_repo() {
  local label="$1"; shift
  local tag="${label%% *}" head counts behind ahead dirty
  head="$("$@" status -sb 2>/dev/null | head -1)"
  echo "$label: $head"
  if counts="$("$@" rev-list --left-right --count '@{upstream}...HEAD' 2>/dev/null)"; then
    read -r behind ahead <<<"$counts"
    [[ "$ahead" -gt 0 ]] && { echo "  pending ($tag): $ahead commit(s) to push"; PENDING=1; }
    [[ "$behind" -gt 0 ]] && { echo "  pending ($tag): $behind commit(s) to pull"; PENDING=1; }
  else
    echo "  pending ($tag): no upstream branch"; PENDING=1
  fi
  dirty="$("$@" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  [[ "$dirty" -gt 0 ]] && { echo "  pending ($tag): $dirty changed file(s)"; PENDING=1; }
  return 0
}

# check [--no-fetch] [--warn]: both repos' status + ahead/behind.
# --warn prints only problems (used by `pnpm sync`) and always exits 0.
cmd_check() {
  local fetch=1 warn=0 a
  for a in "$@"; do
    case "$a" in --no-fetch) fetch=0 ;; --warn) warn=1 ;; esac
  done
  PENDING=0
  local out fresh
  if [[ "$fetch" -eq 1 ]]; then
    git -C "$ROOT" fetch -q 2>/dev/null || echo "warning: could not fetch public remote"
    [[ -d "$PRIVATE_GIT_DIR" ]] && { pgit fetch -q origin 2>/dev/null || echo "warning: could not fetch private remote"; }
  fi
  out="$(report_repo "public  (agent-commons)" git -C "$ROOT")"
  if [[ -d "$PRIVATE_GIT_DIR" ]]; then
    out+=$'\n'"$(report_repo "private (agent-commons-sync)" pgit)"
    fresh="$(new_payload | wc -l | tr -d ' ')"
    [[ "$fresh" -gt 0 ]] && out+=$'\n'"  pending (private): $fresh new private file(s) not saved"
  else
    out+=$'\n'"private: not set up (pnpm backup init or restore)"
  fi
  if [[ "$warn" -eq 1 ]]; then
    local problems
    problems="$(grep -E 'pending|not set up' <<<"$out" || true)"
    [[ -n "$problems" ]] && printf 'agent-commons warning (sync still ran):\n%s\nrun `pnpm check` for details, `pnpm backup sync` to back up private content\n' "$problems" >&2
    return 0
  fi
  echo "$out"
  if grep -qE 'pending|not set up' <<<"$out"; then
    echo "NOT synced: see pending lines above"
    return 1
  fi
  echo "all synced"
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
  sync) shift; cmd_sync "${1:-}" ;;
  check) shift; cmd_check "$@" ;;
  pull) cmd_pull ;;
  restore) shift; cmd_restore "${1:-}" ;;
  git) require_init; shift; pgit "$@" ;;
  *)
    cat >&2 <<USAGE
usage: $0 <command>

  init              create .git-private and point it at the private remote
  save [message]    stage + commit the private payload
  status            tracked payload count, dirty tracked files, and new unsaved files
  sync [message]    save, then pull (fast-forward or rebase), then push; stops on conflict
  check [--no-fetch] both repos: status, ahead/behind, then "all synced" or what's pending
  push              push the private branch to the private remote
  pull              fast-forward the private branch from the private remote
  restore [--force] clone/checkout the payload onto a fresh machine
  git <args...>     run any git command against the private repo

remote: $PRIVATE_REMOTE (override with AGENT_COMMONS_PRIVATE_REMOTE)
USAGE
    exit 1
    ;;
esac
