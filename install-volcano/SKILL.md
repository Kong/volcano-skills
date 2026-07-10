---
name: install-volcano
description: Install or upgrade the Volcano CLI from a plugin-shipped skills environment.
argument-hint: "[--local]"
disable-model-invocation: true
allowed-tools: Bash, Read
---

# Install or upgrade the Volcano CLI

Use this skill when the user asks to install, refresh, update, or set up Volcano from this plugin.

This installer is adaptive. When run from a Volcano plugin, it uses the plugin-carried `skills/` directory as the primary skills source and copies the plugin-carried `AGENTS.md` into `~/.volcano/AGENTS.md` as a stable fallback/reference. When run outside a plugin/manual pathway, it installs `AGENTS.md` and skills into `~/.volcano` so `~/.volcano/skills` remains discoverable.

## What to do

Run the shell block below. It is idempotent:

- If `volcano` is already on `PATH`, it runs `volcano upgrade`.
- If `volcano` is missing, it installs `@volcano.dev/cli` from npm by default.
- If npm is unavailable or the npm install fails, it falls back to the GitHub release download for the current OS/architecture.
- If `VOLCANO_WEB_URL` points at localhost, the GitHub fallback uses the `nightly` CLI channel for local development.
- It writes the CLI PATH helper under `~/.volcano/env`.
- Plugin installs: it copies the plugin-carried `AGENTS.md` to `~/.volcano/AGENTS.md` as a fallback and keeps skills in the plugin-carried `skills/` directory.
- Manual/non-plugin installs: it downloads `AGENTS.md` plus each skill into `~/.volcano/skills` so agents can discover them from the runtime location.

```sh
set -eu

VOLCANO_WEB_URL="${VOLCANO_WEB_URL:-https://volcano.dev}"
VOLCANO_WEB_URL="${VOLCANO_WEB_URL%/}"

log() { printf '%s\n' "volcano: $*"; }
warn() { printf '%s\n' "volcano: $*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

download() {
  url="$1"
  dest="$2"
  if have curl; then
    curl -fsSL "$url" -o "$dest"
  elif have wget; then
    wget -qO "$dest" "$url"
  else
    warn "need curl or wget to download the Volcano CLI"
    return 1
  fi
}

valid_agents_md() {
  file="$1"
  [ -s "$file" ] || return 1
  if head -c 200 "$file" | grep -qiE '<!doctype html|<html'; then
    return 1
  fi
  grep -q 'Volcano' "$file" 2>/dev/null
}

is_plugin_skills_dir() {
  dir="$1"
  [ -f "$dir/AGENTS.md" ] || return 1
  [ -f "$dir/index.json" ] || return 1
  [ -f "$dir/volcano-platform/SKILL.md" ] || return 1
  valid_agents_md "$dir/AGENTS.md"
}

find_plugin_skills_dir() {
  # Explicit override for local/dev testing or IDEs that know their install path.
  if [ -n "${VOLCANO_PLUGIN_SKILLS_DIR:-}" ] && is_plugin_skills_dir "$VOLCANO_PLUGIN_SKILLS_DIR"; then
    printf '%s\n' "$VOLCANO_PLUGIN_SKILLS_DIR"
    return 0
  fi

  # Fast local cases: running from a plugin checkout or from inside skills/.
  for dir in "$PWD" "$PWD/skills" "$(dirname "$PWD")/skills"; do
    if is_plugin_skills_dir "$dir"; then
      printf '%s\n' "$dir"
      return 0
    fi
  done

  # Common marketplace/cache roots. Kept narrow so install doesn't scan all of $HOME.
  for root in \
    "$HOME/.codex/plugins" \
    "$HOME/.claude/plugins" \
    "$HOME/.claude" \
    "$HOME/.cursor" \
    "$HOME/.config"; do
    [ -d "$root" ] || continue
    found="$(find "$root" -type f -path '*/skills/AGENTS.md' 2>/dev/null | while IFS= read -r file; do
      dir="$(dirname "$file")"
      if is_plugin_skills_dir "$dir"; then
        printf '%s\n' "$dir"
        break
      fi
    done)"
    if [ -n "$found" ]; then
      printf '%s\n' "$found"
      return 0
    fi
  done

  return 1
}

valid_markdown_download() {
  file="$1"
  [ -s "$file" ] || return 1
  if head -c 200 "$file" | grep -qiE '<!doctype html|<html'; then
    return 1
  fi
  return 0
}

install_manual_skills() {
  mkdir -p "$HOME/.volcano/skills"
  manifest="$(mktemp)"
  if ! download "$VOLCANO_WEB_URL/skills/index.json" "$manifest"; then
    rm -f "$manifest"
    warn "skills manifest unavailable at $VOLCANO_WEB_URL/skills/index.json; ~/.volcano/skills not updated"
    return 1
  fi
  if head -c 200 "$manifest" | grep -qiE '<!doctype html|<html'; then
    rm -f "$manifest"
    warn "$VOLCANO_WEB_URL/skills/index.json returned HTML, not a skills manifest; ~/.volcano/skills not updated"
    return 1
  fi

  names="$(grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' "$manifest" | sed 's/.*"\([^"]*\)"$/\1/')"
  rm -f "$manifest"
  if [ -z "$names" ]; then
    warn "skills manifest had no skill names; ~/.volcano/skills not updated"
    return 1
  fi

  for name in $names; do
    case "$name" in
      *[!A-Za-z0-9._-]*|'')
        warn "skipping invalid skill name from manifest: $name"
        continue
        ;;
    esac
    dir="$HOME/.volcano/skills/$name"
    tmp="$(mktemp)"
    if download "$VOLCANO_WEB_URL/skills/$name/SKILL.md" "$tmp" && valid_markdown_download "$tmp"; then
      mkdir -p "$dir"
      mv "$tmp" "$dir/SKILL.md"
      chmod 0644 "$dir/SKILL.md" 2>/dev/null || true
      log "installed runtime skill: ~/.volcano/skills/$name/SKILL.md"
    else
      rm -f "$tmp"
      warn "skill download failed or invalid: $name"
    fi
  done
}

install_volcano_content() {
  mkdir -p "$HOME/.volcano"

  if plugin_skills_dir="$(find_plugin_skills_dir 2>/dev/null)"; then
    cp "$plugin_skills_dir/AGENTS.md" "$HOME/.volcano/AGENTS.md"
    chmod 0644 "$HOME/.volcano/AGENTS.md" 2>/dev/null || true
    log "installed fallback AGENTS.md from plugin skills: $plugin_skills_dir/AGENTS.md -> $HOME/.volcano/AGENTS.md"
    log "using plugin-carried skills as primary source: $plugin_skills_dir"
    VOLCANO_RESOLVED_PLUGIN_SKILLS_DIR="$plugin_skills_dir"
    export VOLCANO_RESOLVED_PLUGIN_SKILLS_DIR
    return 0
  fi

  log "plugin-carried skills not found; installing runtime content under $HOME/.volcano"
  if ! valid_agents_md "$HOME/.volcano/AGENTS.md"; then
    tmp="$HOME/.volcano/AGENTS.md.tmp"
    download "$VOLCANO_WEB_URL/AGENTS.md" "$tmp"
    if ! valid_agents_md "$tmp"; then
      rm -f "$tmp"
      warn "$VOLCANO_WEB_URL/AGENTS.md did not return a valid Markdown AGENTS.md"
      return 1
    fi
    mv "$tmp" "$HOME/.volcano/AGENTS.md"
    chmod 0644 "$HOME/.volcano/AGENTS.md" 2>/dev/null || true
    log "installed runtime AGENTS.md to $HOME/.volcano/AGENTS.md"
  else
    log "using existing runtime AGENTS.md at $HOME/.volcano/AGENTS.md"
  fi

  install_manual_skills
}

upsert_block() {
  file="$1"
  body="$2"
  marker_begin="# >>> VOLCANO MANAGED BLOCK (do not edit) >>>"
  marker_end="# <<< VOLCANO MANAGED BLOCK <<<"
  mkdir -p "$(dirname "$file")"
  [ -f "$file" ] || : >"$file"

  if grep -qF "$marker_begin" "$file" 2>/dev/null; then
    action="updated"
  else
    action="added"
  fi

  tmp="$(mktemp)"
  awk -v b="$marker_begin" -v e="$marker_end" '
    $0==b {inblk=1; next}
    $0==e {inblk=0; next}
    !inblk {print}
  ' "$file" | awk 'NF{last=NR} {line[NR]=$0} END{for(i=1;i<=last;i++) print line[i]}' >"$tmp"
  mv "$tmp" "$file"
  [ -s "$file" ] && printf '\n' >>"$file"
  printf '%s\n%s\n%s\n' "$marker_begin" "$body" "$marker_end" >>"$file"
  log "$action managed Volcano block in $file"
}

wire_existing_claude_config() {
  # Claude Code supports @path imports. Only modify an existing global CLAUDE.md;
  # plugin skills remain primary, ~/.volcano/AGENTS.md is the fallback.
  [ -f "$HOME/.claude/CLAUDE.md" ] || return 0

  plugin_line=""
  if [ -n "${VOLCANO_RESOLVED_PLUGIN_SKILLS_DIR:-}" ] && is_plugin_skills_dir "$VOLCANO_RESOLVED_PLUGIN_SKILLS_DIR"; then
    plugin_line="@$VOLCANO_RESOLVED_PLUGIN_SKILLS_DIR/AGENTS.md"
  fi

  body="Before any Volcano work, read the Volcano plugin-carried instructions first, then use ~/.volcano/AGENTS.md as the stable fallback/reference copy. The plugin skills directory remains the primary source for volcano-* skills; ~/.volcano/AGENTS.md is maintained during install as the durable fallback instruction file.

$plugin_line
@~/.volcano/AGENTS.md"
  upsert_block "$HOME/.claude/CLAUDE.md" "$body"
}

ensure_cli_on_path() {
  cli_dir="$1"
  case ":$PATH:" in
    *":$cli_dir:"*) ;;
    *) PATH="$cli_dir:$PATH"; export PATH ;;
  esac

  env_file="$HOME/.volcano/env"
  mkdir -p "$(dirname "$env_file")"
  cat >"$env_file" <<ENV
# Generated by Volcano plugin install-volcano. Adds the Volcano CLI install directory to PATH.
# Source from your shell to make 'volcano' callable: . "$env_file"
case ":\$PATH:" in
  *":$cli_dir:"*) ;;
  *) export PATH="$cli_dir:\$PATH" ;;
esac
ENV

  marker_begin="# >>> volcano cli path >>>"
  marker_end="# <<< volcano cli path <<<"
  rc_added=""
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    [ -f "$rc" ] || continue
    if grep -qF "$marker_begin" "$rc" 2>/dev/null; then
      continue
    fi
    {
      printf '\n%s\n' "$marker_begin"
      printf '. "%s"\n' "$env_file"
      printf '%s\n' "$marker_end"
    } >>"$rc"
    rc_added="$rc_added $rc"
  done
  if [ -n "$rc_added" ]; then
    log "added Volcano PATH stub to:$rc_added"
  fi
}

npm_global_bin_dir() {
  if npm bin -g >/dev/null 2>&1; then
    npm bin -g
    return 0
  fi

  prefix="$(npm prefix -g 2>/dev/null || true)"
  [ -n "$prefix" ] || return 1
  case "$(uname -s | tr '[:upper:]' '[:lower:]')" in
    mingw*|msys*|cygwin*) printf '%s\n' "$prefix" ;;
    *) printf '%s/bin\n' "$prefix" ;;
  esac
}

npm_managed_cli_installed() {
  have npm && npm ls -g --depth=0 @volcano.dev/cli >/dev/null 2>&1
}

install_cli_from_npm() {
  if ! have npm; then
    warn "npm not found; falling back to GitHub release download"
    return 1
  fi

  pkg="${VOLCANO_CLI_NPM_PACKAGE:-@volcano.dev/cli@latest}"
  log "installing Volcano CLI from npm package $pkg"
  if ! npm install -g "$pkg"; then
    warn "npm install failed; falling back to GitHub release download"
    return 1
  fi

  bin_dir="$(npm_global_bin_dir 2>/dev/null || true)"
  if [ -n "$bin_dir" ]; then
    ensure_cli_on_path "$bin_dir"
  fi

  if have volcano; then
    log "installed Volcano CLI from npm: $(command -v volcano)"
    return 0
  fi

  warn "npm install completed but 'volcano' is not on PATH; falling back to GitHub release download"
  return 1
}

install_cli_from_release() {
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$os" in
    linux*) os="linux" ;;
    darwin*) os="macos" ;;
    mingw*|msys*|cygwin*) os="windows" ;;
    *) warn "unsupported OS '$os'; cannot install Volcano CLI from GitHub release"; return 1 ;;
  esac

  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) arch="amd64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) warn "unsupported arch '$arch'; cannot install Volcano CLI from GitHub release"; return 1 ;;
  esac

  ext=""
  [ "$os" = "windows" ] && ext=".exe"

  case "$VOLCANO_WEB_URL" in
    *localhost*|*127.0.0.1*)
      url="https://github.com/Kong/volcano-cli/releases/download/nightly/volcano-${os}-${arch}${ext}"
      log "local Volcano web origin detected; using nightly GitHub CLI fallback"
      ;;
    *)
      url="https://github.com/Kong/volcano-cli/releases/latest/download/volcano-${os}-${arch}${ext}"
      ;;
  esac

  dir="${VOLCANO_INSTALL_DIR:-}"
  if [ -z "$dir" ]; then
    if [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
      dir="/usr/local/bin"
    else
      dir="$HOME/.local/bin"
    fi
  fi
  mkdir -p "$dir"
  out="$dir/volcano${ext}"

  log "downloading Volcano CLI GitHub fallback ($os-$arch) from $url"
  download "$url" "$out"
  chmod 0755 "$out" 2>/dev/null || true
  ensure_cli_on_path "$dir"
  log "installed Volcano CLI GitHub fallback to $out"
}

if have volcano; then
  cli_path="$(command -v volcano)"
  ensure_cli_on_path "$(dirname "$cli_path")"
  log "found Volcano CLI at $cli_path"
  if npm_managed_cli_installed; then
    log "npm-managed Volcano CLI detected; refreshing through npm"
    install_cli_from_npm || warn "npm refresh failed; continuing with existing CLI"
  else
    log "upgrading non-npm Volcano CLI with: volcano upgrade"
    volcano upgrade || warn "volcano upgrade failed; continuing with existing CLI"
  fi
else
  log "Volcano CLI not found; installing from npm"
  install_cli_from_npm || install_cli_from_release
fi

if ! have volcano && [ -f "$HOME/.volcano/env" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.volcano/env"
fi

if have volcano; then
  log "Volcano CLI ready: $(command -v volcano)"
  volcano --version || true
else
  warn "Volcano CLI installation did not leave 'volcano' on PATH. Try: . \"$HOME/.volcano/env\""
  exit 1
fi

install_volcano_content
wire_existing_claude_config
```

## After install

1. Use the plugin-shipped Volcano skills for subsequent Volcano work.
2. Prefer the `volcano` CLI for Volcano actions. Use `volcano <area> --help` and `--json` where useful.
3. If the current shell cannot find `volcano`, run `. "$HOME/.volcano/env"` or open a new shell.

## Safety

Follow the safety model in the plugin-shipped `AGENTS.md`. Production deploys, deletions, secret/variable changes, permission/visibility changes, custom domains, and billing/account changes require explicit user confirmation.
