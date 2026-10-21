#!/usr/bin/env bash
# Run Zotero 10.0.6 headless (Xvfb) in a Linux sandbox with a fresh profile + data dir,
# side-loading one or more unpacked bootstrap plugins via proxy files.
# Verified 2026-10-21 on Ubuntu 26.04 aarch64 (docker sbx sandbox).
#
# Usage:
#   run-zotero-headless.sh install                 # one-time: apt deps + download/extract Zotero
#   run-zotero-headless.sh start <pluginDir> [...] # fresh profile/data, start, wait for :23119
#   run-zotero-headless.sh restart <pluginDir> ... # stop + start but KEEP data dir (library survives)
#   run-zotero-headless.sh stop
#   run-zotero-headless.sh log                     # path of the debug log (-ZoteroDebugText output)
#
# Each <pluginDir> must contain manifest.json (applications.zotero.id) + bootstrap.js.
# Env overrides: ZBASE (work dir, default <repo>/.zotero-headless), ZPORT (default 23119),
#   ZVERSION (default 10.0.6), ZOTERO_APP (an already-extracted app dir to symlink as $ZBASE/app
#   instead of running `install`; its parent's dl/ is not needed).
# Run one instance per ZBASE/ZPORT pair; `stop` only stops the instance of this ZBASE.
set -euo pipefail

ZBASE="${ZBASE:-$(cd "$(dirname "$0")/.." && pwd)/.zotero-headless}"
ZPORT="${ZPORT:-23119}"
ZVERSION="${ZVERSION:-10.0.6}"
APPDIR="$ZBASE/app"
PROFILE="$ZBASE/profile"
DATADIR="$ZBASE/data"
LOG="$ZBASE/zotero.log"
PIDFILE="$ZBASE/xvfb-run.pid"

arch_platform() {
  case "$(uname -m)" in
    x86_64) echo linux-x86_64 ;;
    aarch64|arm64) echo linux-arm64 ;;
    *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;;
  esac
}

cmd_install() {
  sudo apt-get update -qq
  # xz for the tarball; GTK3 & friends for libxul; Xvfb for a virtual display
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    xz-utils xvfb xauth libgtk-3-0t64 libxcursor1 libdbus-glib-1-2 libasound2t64 libx11-xcb1 libxtst6 \
    >/dev/null
  mkdir -p "$ZBASE/dl" "$APPDIR"
  local plat; plat="$(arch_platform)"
  local tarball="$ZBASE/dl/Zotero-$ZVERSION-$plat.tar.xz"
  if [ ! -s "$tarball" ]; then
    # redirects to https://download.zotero.org/client/release/<ver>/Zotero-<ver>_<plat>.tar.xz
    curl -fsSL -o "$tarball" \
      "https://www.zotero.org/download/client/dl?channel=release&platform=$plat&version=$ZVERSION"
  fi
  rm -rf "$APPDIR"/*
  tar xJf "$tarball" -C "$APPDIR"
  ls "$APPDIR"/Zotero_linux-*/zotero >/dev/null
  echo "installed: $(ls -d "$APPDIR"/Zotero_linux-*)"
}

zotero_bin() {
  if ! ls "$APPDIR"/Zotero_linux-*/zotero >/dev/null 2>&1 && [ -n "${ZOTERO_APP:-}" ]; then
    mkdir -p "$ZBASE"; rm -rf "$APPDIR"; ln -s "$(cd "$ZOTERO_APP" && pwd)" "$APPDIR"
  fi
  ls "$APPDIR"/Zotero_linux-*/zotero
}

write_profile() {
  mkdir -p "$PROFILE/extensions" "$DATADIR"
  rm -f "$PROFILE"/extensions/*
  # Prefs: auto-enable side-loaded profile extensions, no updates/sync/first-run UI
  cat > "$PROFILE/user.js" <<EOF
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("extensions.startupScanScopes", 15);
user_pref("app.update.enabled", false);
user_pref("app.update.auto", false);
user_pref("extensions.zotero.httpServer.port", $ZPORT);
user_pref("extensions.zotero.sync.autoSync", false);
user_pref("extensions.zotero.firstRun2", false);
user_pref("extensions.zotero.automaticScraperUpdates", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
EOF
  local d id
  for d in "$@"; do
    d="$(cd "$d" && pwd)"
    id="$(python3 -I -c 'import json,sys; m=json.load(open(sys.argv[1])); print(m["applications"]["zotero"]["id"])' "$d/manifest.json")"
    # Proxy file: file named <addon id> whose content is the absolute path of the unpacked plugin dir
    printf '%s' "$d" > "$PROFILE/extensions/$id"
    echo "plugin $id -> $d"
  done
  # Force a rescan of extensions on every start (so edited plugins / new proxy files are picked up)
  rm -f "$PROFILE/extensions.json" "$PROFILE/addonStartup.json.lz4"
}

cmd_stop() {
  # Avoid `pkill -f zotero` (it matches the calling shell's own command line); use exact name match.
  # Only stop the instance using THIS profile (parallel instances with other ZBASEs must survive).
  local runpid="" xpids=""
  if [ -f "$PIDFILE" ]; then
    runpid="$(cat "$PIDFILE")"
    xpids="$(pgrep -P "$runpid" -x Xvfb || true)"
  fi
  mine() { for pid in $(pgrep -x zotero-bin); do tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null | grep -qF -- "-profile $PROFILE " && echo $pid; done; }
  for pid in $(mine); do kill "$pid" 2>/dev/null || true; done
  for _ in $(seq 1 20); do [ -z "$(mine)" ] && break; sleep 0.5; done
  # Zotero first, then xvfb-run: killing xvfb-run first would leak its Xvfb server.
  if [ -n "$runpid" ]; then
    for _ in $(seq 1 10); do kill -0 "$runpid" 2>/dev/null || break; sleep 0.5; done
    kill $runpid $xpids 2>/dev/null || true
  fi
  rm -f "$PIDFILE" "$PROFILE/.parentlock" "$PROFILE/lock"
}

cmd_start() {
  local keep_data="${KEEP_DATA:-0}"
  cmd_stop
  if [ "$keep_data" != 1 ]; then rm -rf "$PROFILE" "$DATADIR"; fi
  write_profile "$@"
  : > "$LOG"
  # -datadir: absolute path (parent must exist); -ZoteroDebugText: debug log to stdout
  # -no-remote: don't hand off to another running instance
  setsid xvfb-run -a -s "-screen 0 1600x1000x24" "$(zotero_bin)" \
    -profile "$PROFILE" -datadir "$DATADIR" -no-remote -ZoteroDebugText \
    >"$LOG" 2>&1 < /dev/null &
  echo $! > "$PIDFILE"
  for i in $(seq 1 90); do
    if curl -s --noproxy '*' --max-time 2 "http://127.0.0.1:$ZPORT/connector/ping" >/dev/null 2>&1; then
      echo "Zotero up on 127.0.0.1:$ZPORT after ~${i}s (log: $LOG)"
      return 0
    fi
    sleep 1
  done
  echo "Zotero did not come up; tail of log:" >&2; tail -40 "$LOG" >&2; return 1
}

case "${1:-}" in
  install) cmd_install ;;
  start) shift; cmd_start "$@" ;;
  restart) shift; KEEP_DATA=1 cmd_start "$@" ;;
  stop) cmd_stop ;;
  log) echo "$LOG" ;;
  *) sed -n 2,16p "$0"; exit 1 ;;
esac
