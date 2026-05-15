#!/usr/bin/env bash
# Creates a standalone release artifact: dist/engrams-openclaw-v<version>.tar.gz
# The extracted artifact supports:
#   tar -xzf engrams-openclaw-v0.1.0.tar.gz
#   cd engrams-openclaw-v0.1.0
#   ./install.sh --yes
# No Git, npm install, TypeScript, or npm run check required by end users.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PACKAGE_DIR/../.." && pwd)"

VERSION="$(node -e "process.stdout.write(require('$PACKAGE_DIR/package.json').version)")"
ARTIFACT_NAME="engrams-openclaw-v${VERSION}"
STAGE_DIR="$REPO_ROOT/dist/standalone/$ARTIFACT_NAME"
DIST_DIR="$REPO_ROOT/dist"
TARBALL="$DIST_DIR/${ARTIFACT_NAME}.tar.gz"

echo "Building standalone artifact: $ARTIFACT_NAME"
echo "  package dir : $PACKAGE_DIR"
echo "  staging     : $STAGE_DIR"
echo "  tarball     : $TARBALL"

# ── 1. Clean staging area ─────────────────────────────────────────────────────
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
mkdir -p "$DIST_DIR"

# ── 2. Require built JS (build must have been run already) ────────────────────
if [ ! -f "$PACKAGE_DIR/dist/src/plugin.js" ]; then
  echo "Error: dist/src/plugin.js not found. Run 'npm run build' first." >&2
  exit 1
fi
if [ ! -f "$PACKAGE_DIR/dist/hooks/engrams/HOOK.md" ]; then
  echo "Error: dist/hooks/engrams/HOOK.md not found. Run 'npm run build' first." >&2
  exit 1
fi
if [ ! -f "$PACKAGE_DIR/dist/hooks/engrams/handler.js" ]; then
  echo "Error: dist/hooks/engrams/handler.js not found. Run 'npm run build' first." >&2
  exit 1
fi

# ── 3. Stage compiled adapter (dist/src + dist/hooks) ─────────────────────────
mkdir -p "$STAGE_DIR/dist"
cp -r "$PACKAGE_DIR/dist/src" "$STAGE_DIR/dist/src"
cp -r "$PACKAGE_DIR/dist/hooks" "$STAGE_DIR/dist/hooks"

# ── 4. Stage openclaw.plugin.json ─────────────────────────────────────────────
cp "$PACKAGE_DIR/openclaw.plugin.json" "$STAGE_DIR/openclaw.plugin.json"

# ── 5. Bundle @engrams/core runtime dependency ───────────────────────────────
CORE_SRC="$REPO_ROOT/packages/core"
CORE_DEST="$STAGE_DIR/node_modules/@engrams/core"
mkdir -p "$CORE_DEST/dist"
cp "$CORE_SRC/package.json" "$CORE_DEST/package.json"
cp -r "$CORE_SRC/dist/src" "$CORE_DEST/dist/src"

# ── 5b. Stage engrams-rebuild CLI wrapper ────────────────────────────────────
cat > "$STAGE_DIR/engrams-rebuild" << 'REBUILD_EOF'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/node_modules/@engrams/core/dist/src/cli.js" "$@"
REBUILD_EOF
chmod +x "$STAGE_DIR/engrams-rebuild"

# ── 6. Stage a minimal package.json for module resolution ─────────────────────
node -e "
const pkg = require('$PACKAGE_DIR/package.json');
const out = {
  name: 'engrams',
  version: pkg.version,
  type: pkg.type,
  main: pkg.main || 'dist/src/plugin.js',
  openclaw: pkg.openclaw
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
" > "$STAGE_DIR/package.json"

# ── 7. Stage standalone install.sh ────────────────────────────────────────────
cat > "$STAGE_DIR/install.sh" << 'INSTALL_EOF'
#!/usr/bin/env bash
set -euo pipefail

YES=0
DRY_RUN=0
UPGRADE=0

for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --upgrade) UPGRADE=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

ARTIFACT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_BIN="${OPENCLAW_BIN:-openclaw}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"

echo "Engrams OpenClaw adapter install plan:"
if [ "$UPGRADE" -eq 1 ]; then
  echo "- mode: upgrade (uninstall existing, then clean install)"
fi
echo "- install managed hook package from artifact directory: $ARTIFACT_DIR"
echo "- install plugin package from artifact directory: $ARTIFACT_DIR"
echo "- atomic: if plugin install fails, rollback hooks before exiting"
echo "- use OpenClaw CLI only; no direct config edits"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run only. No changes made."
  exit 0
fi

if ! command -v "$OPENCLAW_BIN" >/dev/null 2>&1; then
  echo "openclaw command not found. Set OPENCLAW_BIN=/path/to/openclaw." >&2
  exit 1
fi

if [ "$YES" -ne 1 ]; then
  echo "Refusing to install without --yes."
  exit 1
fi

# Check for existing install
EXISTING=0
if [ -d "$OPENCLAW_HOME/hooks/engrams" ] || [ -d "$OPENCLAW_HOME/extensions/engrams" ]; then
  EXISTING=1
fi

if [ "$EXISTING" -eq 1 ] && [ "$UPGRADE" -eq 0 ]; then
  echo "engrams is already installed. To upgrade, run: ./install.sh --upgrade --yes" >&2
  exit 1
fi

# Upgrade: uninstall existing installation first
if [ "$UPGRADE" -eq 1 ]; then
  echo "Removing existing engrams installation..."
  "$OPENCLAW_BIN" hooks disable engrams 2>/dev/null || true
  "$OPENCLAW_BIN" plugins uninstall engrams --force 2>/dev/null || true
  rm -rf "$OPENCLAW_HOME/hooks/engrams"
  rm -rf "$OPENCLAW_HOME/extensions/engrams"
  echo "Existing installation removed."
fi

# Normalize ownership when running as root
if [ "$(id -u)" -eq 0 ]; then
  chown -R 0:0 "$ARTIFACT_DIR"
fi

"$OPENCLAW_BIN" hooks install "$ARTIFACT_DIR"

if ! "$OPENCLAW_BIN" plugins install "$ARTIFACT_DIR" 2>/dev/null; then
  echo "Recovering from known OpenClaw install ordering issue..."
  if "$OPENCLAW_BIN" plugins enable engrams 2>/dev/null; then
    echo "Plugin enabled successfully."
  else
    echo "Plugin install failed; rolling back hooks..." >&2
    "$OPENCLAW_BIN" hooks disable engrams || true
    rm -rf "$OPENCLAW_HOME/hooks/engrams"
    rm -rf "$OPENCLAW_HOME/extensions/engrams"
    exit 1
  fi
fi

# Prompt for Engrams path
echo ""
read -rp "Path to your knowledge topics directory: " ENGRAMS_PATH
if [ -n "$ENGRAMS_PATH" ]; then
  echo "Configuring engrams plugin with path: $ENGRAMS_PATH"
  "$OPENCLAW_BIN" plugins config engrams path "$ENGRAMS_PATH" 2>/dev/null || \
    echo "Note: set 'path' manually in plugins.entries.engrams.config if the above failed."
fi

echo "Install complete. Restart OpenClaw gateway to load Engrams."
INSTALL_EOF
chmod +x "$STAGE_DIR/install.sh"

# ── 8. Stage standalone uninstall.sh ──────────────────────────────────────────
cat > "$STAGE_DIR/uninstall.sh" << 'UNINSTALL_EOF'
#!/usr/bin/env bash
set -euo pipefail

YES=0
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

OPENCLAW_BIN="${OPENCLAW_BIN:-openclaw}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"

echo "Engrams OpenClaw adapter uninstall plan:"
echo "- disable managed hook: engrams"
echo "- disable plugin: engrams"
echo "- remove hook files from $OPENCLAW_HOME/hooks/engrams"
echo "- remove extension files from $OPENCLAW_HOME/extensions/engrams"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run only. No changes made."
  exit 0
fi

if ! command -v "$OPENCLAW_BIN" >/dev/null 2>&1; then
  echo "openclaw command not found. Set OPENCLAW_BIN=/path/to/openclaw." >&2
  exit 1
fi

if [ "$YES" -ne 1 ]; then
  echo "Refusing to uninstall without --yes."
  exit 1
fi

FAILED=0

if ! "$OPENCLAW_BIN" hooks disable engrams; then
  echo "Failed to disable managed hook: engrams" >&2
  FAILED=1
fi

if ! "$OPENCLAW_BIN" plugins uninstall engrams --force; then
  echo "Failed to uninstall plugin: engrams" >&2
  FAILED=1
fi

# Clean up any remaining files
rm -rf "$OPENCLAW_HOME/hooks/engrams"
rm -rf "$OPENCLAW_HOME/extensions/engrams"

if [ "$FAILED" -ne 0 ]; then
  echo "Uninstall incomplete. Check OpenClaw CLI output above." >&2
  exit 1
fi

echo "Uninstall complete. Restart OpenClaw gateway to apply."
UNINSTALL_EOF
chmod +x "$STAGE_DIR/uninstall.sh"

# ── 9. Remove non-runtime build artifacts ─────────────────────────────────────
find "$STAGE_DIR" -name "*.js.map" -delete

# ── 10. Create tarball with single top-level directory ────────────────────────
# GNU tar supports --owner/--group; BSD tar (macOS) does not.
if tar --owner=0 --group=0 -cf /dev/null /dev/null 2>/dev/null; then
  (cd "$REPO_ROOT/dist/standalone" && tar --owner=0 --group=0 -czf "$TARBALL" "$ARTIFACT_NAME")
else
  (cd "$REPO_ROOT/dist/standalone" && tar -czf "$TARBALL" "$ARTIFACT_NAME")
fi

echo "Packaging complete: $TARBALL"
