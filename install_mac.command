#!/bin/bash
set -euo pipefail

CHECK_ONLY="${1:-}"
WORK_DIR="$(mktemp -d "/tmp/xgd-install.XXXXXX")"
CURRENT_STAGE="Initialization"
OFFLINE_INSTALLER_URL=""
CURRENT_TTY="$(tty 2>/dev/null || true)"

cleanup() {
  rm -rf "$WORK_DIR"
}

trap cleanup EXIT

write_step() {
  echo "$1"
}

write_warn() {
  echo "$1"
}

write_success() {
  echo "$1"
}

write_info() {
  echo "$1"
}

fail_and_exit() {
  local message="$1"
  echo "$message"
  echo "[RESULT] Failed stage: ${CURRENT_STAGE}"
  if [[ -n "$OFFLINE_INSTALLER_URL" ]]; then
    echo "[RESULT] Official offline installer: ${OFFLINE_INSTALLER_URL}"
  fi
  echo "[RESULT] Fix the issue above, then run install_mac.command again."
  exit 1
}

set_stage_context() {
  CURRENT_STAGE="$1"
  OFFLINE_INSTALLER_URL="${2:-}"
}

ask_yes_no() {
  local prompt="$1"
  local choice
  read -r -p "$prompt" choice
  [[ "$choice" == "Y" || "$choice" == "y" || "$choice" == "Yes" || "$choice" == "yes" ]]
}

get_installed_command() {
  local candidate
  for candidate in "$@"; do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

find_existing_executable() {
  local pattern
  for pattern in "$@"; do
    local path
    for path in $pattern; do
      if [[ -f "$path" ]]; then
        echo "$path"
        return 0
      fi
    done
  done
  return 1
}

get_tool_version() {
  local command_name="$1"
  "$command_name" --version 2>/dev/null | head -n 1
}

get_tool_status() {
  local name="$1"
  shift
  local commands=()
  local known_paths=()
  local mode="commands"
  local item

  for item in "$@"; do
    if [[ "$item" == "--paths" ]]; then
      mode="paths"
      continue
    fi

    if [[ "$mode" == "commands" ]]; then
      commands+=("$item")
    else
      known_paths+=("$item")
    fi
  done

  local command_name
  if command_name="$(get_installed_command "${commands[@]}")"; then
    printf 'installed|path_ok|%s|%s\n' "$command_name" "$(get_tool_version "$command_name")"
    return 0
  fi

  local executable_path
  if executable_path="$(find_existing_executable "${known_paths[@]}")"; then
    local version
    version="$(get_tool_version "$executable_path" || true)"
    if [[ -z "$version" ]]; then
      version="File found but version lookup failed"
    fi
    printf 'installed|path_missing|%s|%s\n' "$executable_path" "$version"
    return 0
  fi

  printf 'missing|||\n'
}

show_countdown() {
  local seconds="$1"
  local remaining
  for ((remaining=seconds; remaining>=1; remaining--)); do
    echo "Window closes in ${remaining} second(s)..."
    sleep 1
  done
}

close_terminal_tab_for_tty() {
  local target_tty="${1:-}"
  if [[ -z "$target_tty" || "$target_tty" == "not a tty" ]]; then
    return 0
  fi

  /usr/bin/osascript - "$target_tty" >/dev/null <<'EOF'
on run argv
  set targetTty to item 1 of argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        try
          if tty of t is targetTty then
            if (count of tabs of w) is 1 then
              close w saving no
            else
              close t saving no
            end if
            return
          end if
        end try
      end repeat
    end repeat
  end tell
end run
EOF
}

close_terminal_tab_for_tty_async() {
  local target_tty="${1:-}"
  local delay_seconds="${2:-1}"
  (
    sleep "$delay_seconds"
    close_terminal_tab_for_tty "$target_tty"
  ) >/dev/null 2>&1 &
}

wait_for_install_result() {
  local name="$1"
  shift
  local commands=("$@")
  local attempt=1

  while (( attempt <= 12 )); do
    local command_name
    if command_name="$(get_installed_command "${commands[@]}")"; then
      write_success "[DONE] $name installed: $(get_tool_version "$command_name")"
      return 0
    fi
    sleep 5
    attempt=$((attempt + 1))
  done

  write_warn "[WARN] $name is not visible in the current terminal yet. A new terminal check will run later."
  return 0
}

download_file() {
  local url="$1"
  local output="$2"
  local attempt
  for attempt in 1 2 3; do
    write_info "[NET] Download ${attempt}/3: ${url}"
    if curl --silent --show-error --fail --location --connect-timeout 15 --max-time 180 "$url" -o "$output"; then
      return 0
    fi

    if [[ $attempt -lt 3 ]]; then
      write_warn "[WARN] Download failed. Retrying in 5 seconds..."
      sleep 5
    fi
  done

  fail_and_exit "[ERROR] Download failed: $url"
}

fetch_url() {
  local url="$1"
  local attempt
  for attempt in 1 2 3; do
    write_info "[NET] Request ${attempt}/3: ${url}"
    if curl --silent --show-error --fail --location --connect-timeout 15 --max-time 60 "$url"; then
      return 0
    fi

    if [[ $attempt -lt 3 ]]; then
      write_warn "[WARN] Network request failed. Retrying in 5 seconds..."
      sleep 5
    fi
  done

  fail_and_exit "[ERROR] Network request failed: $url"
}

install_pkg() {
  local pkg_path="$1"
  sudo installer -pkg "$pkg_path" -target /
}

get_node_lts_version() {
  fetch_url "https://nodejs.org/dist/index.json" | /usr/bin/osascript -l JavaScript <<'EOF'
const input = $.NSString.alloc.initWithDataEncoding(
  $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile,
  $.NSUTF8StringEncoding
).js;
const releases = JSON.parse(input);
const lts = releases.find(item => item.lts);
if (!lts) {
  throw new Error("No LTS release found");
}
console.log(lts.version);
EOF
}

install_node() {
  local version
  version="$(get_node_lts_version)"
  local pkg_path="$WORK_DIR/node-${version}.pkg"
  local url="https://nodejs.org/dist/${version}/node-${version}.pkg"

  set_stage_context "Download Node.js installer" "$url"
  write_warn "[INFO] Installing the current official Node.js LTS release: ${version}"
  write_step "[DOWNLOAD] Node.js installer..."
  download_file "$url" "$pkg_path"
  set_stage_context "Install Node.js" "$url"
  write_warn "[INFO] A permission prompt or installer window may appear. Allow it and do not close this script window."
  write_step "[INSTALL] Node.js..."
  install_pkg "$pkg_path"
  set_stage_context "Verify Node.js" "$url"
  write_warn "[INFO] Waiting for Node.js installation result. This may take a few minutes."
  write_step "[VERIFY] Node.js..."
  wait_for_install_result "Node.js" "node"
}

install_git() {
  set_stage_context "Install Git / Apple Command Line Tools" "https://git-scm.com/book/en/v2/Getting-Started-Installing-Git"
  write_warn "[INFO] Triggering Apple Command Line Tools installation for Git."
  write_warn "[INFO] Git is provided by Apple Command Line Tools."
  write_warn "[INFO] A permission prompt or installer window may appear. Allow it and do not close this script window."
  write_step "[INSTALL] Git / Command Line Tools..."

  if ! xcode-select --install 2>/dev/null; then
    write_warn "[WARN] If macOS says Command Line Tools is already installed, continue with the next checks."
  fi

  set_stage_context "Verify Git" "https://git-scm.com/book/en/v2/Getting-Started-Installing-Git"
  write_warn "[INFO] Waiting for Git installation result. This may take a few minutes."
  write_step "[VERIFY] Git..."
  wait_for_install_result "Git" "git"
}

install_python() {
  local version
  version="$(fetch_url "https://www.python.org/downloads/macos/" | sed -n 's/.*Latest Python 3 Release - Python \([0-9.]*\).*/\1/p' | head -n 1)"
  if [[ -z "$version" ]]; then
    fail_and_exit "[ERROR] Could not detect the latest stable Python 3 version."
  fi

  local pkg_path="$WORK_DIR/python-${version}.pkg"
  local url="https://www.python.org/ftp/python/${version}/python-${version}-macos11.pkg"

  set_stage_context "Download Python installer" "$url"
  write_warn "[INFO] Installing the current official Python stable release: ${version}"
  write_step "[DOWNLOAD] Python installer..."
  download_file "$url" "$pkg_path"
  set_stage_context "Install Python" "$url"
  write_warn "[INFO] A permission prompt or installer window may appear. Allow it and do not close this script window."
  write_step "[INSTALL] Python..."
  install_pkg "$pkg_path"
  set_stage_context "Verify Python" "https://www.python.org/downloads/macos/"
  write_warn "[INFO] Waiting for Python installation result. This may take a few minutes."
  write_step "[VERIFY] Python..."
  wait_for_install_result "Python" "python3" "python"
}

ensure_tool_installed() {
  local name="$1"
  shift
  local installer_name="$1"
  shift
  local commands=()
  local known_paths=()
  local mode="commands"
  local item

  for item in "$@"; do
    if [[ "$item" == "--paths" ]]; then
      mode="paths"
      continue
    fi

    if [[ "$mode" == "commands" ]]; then
      commands+=("$item")
    else
      known_paths+=("$item")
    fi
  done

  local status path_state executable_path version
  IFS='|' read -r status path_state executable_path version <<< "$(get_tool_status "$name" "${commands[@]}" --paths "${known_paths[@]}")"

  if [[ "$status" == "installed" && "$path_state" == "path_ok" ]]; then
    write_success "[OK] $name: $version"
    return 0
  fi

  if [[ "$status" == "installed" && "$path_state" == "path_missing" ]]; then
    write_warn "[WARN] $name is installed, but PATH is not configured."
    write_warn "[WARN] Detected location: $executable_path"
    write_warn "[WARN] To avoid duplicate installs, the script will stop here for this tool."
    return 1
  fi

  write_warn "[MISSING] $name was not detected."
  if ! ask_yes_no "Start automatic installation for $name now? Type Y or N: "; then
    write_warn "[SKIP] $name installation skipped."
    return 1
  fi

  "$installer_name"
}

open_validation_terminal() {
  local validate_script
  validate_script="$(mktemp /tmp/xgd_env_validate.XXXXXX.sh)"

  cat > "$validate_script" <<'EOF'
#!/bin/bash
set -euo pipefail

test_tool() {
  local name="$1"
  shift
  local command_name
  for command_name in "$@"; do
    if command -v "$command_name" >/dev/null 2>&1; then
      echo "[OK] $name: $("$command_name" --version 2>/dev/null | head -n 1)"
      echo "     Path: $(command -v "$command_name")"
      return 0
    fi
  done

  echo "[FAIL] $name is not available in PATH."
  return 1
}

echo "Running validation in a new terminal..."
test_tool "Node.js" "node" || true
test_tool "Git" "git" || true
test_tool "Python" "python3" "python" || true
echo
echo "If all checks are OK here, PATH is working in a fresh terminal."
show_countdown() {
  local seconds="$1"
  local remaining
  for ((remaining=seconds; remaining>=1; remaining--)); do
    echo "Window closes in ${remaining} second(s)..."
    sleep 1
  done
}

show_countdown 5
rm -f -- "$0"
/usr/bin/osascript - "$(tty 2>/dev/null || true)" >/dev/null 2>&1 <<'APPLESCRIPT' &
on run argv
  set targetTty to item 1 of argv
  if targetTty is "" or targetTty is "not a tty" then
    return
  end if

  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        try
          if tty of t is targetTty then
            if (count of tabs of w) is 1 then
              close w saving no
            else
              close t saving no
            end if
            return
          end if
        end try
      end repeat
    end repeat
  end tell
end run
APPLESCRIPT
sleep 1
EOF

  chmod +x "$validate_script"
  /usr/bin/osascript >/dev/null <<EOF
tell application "Terminal"
  activate
  do script "bash \"$validate_script\""
end tell
EOF
}

write_step "[1/3] Check Node.js..."
node_ok=0
if ensure_tool_installed "Node.js" "install_node" "node" --paths "/usr/local/bin/node" "/opt/homebrew/bin/node"; then
  node_ok=1
fi

write_step "[2/3] Check Git..."
git_ok=0
if ensure_tool_installed "Git" "install_git" "git" --paths "/usr/bin/git" "/Library/Developer/CommandLineTools/usr/bin/git"; then
  git_ok=1
fi

write_step "[3/3] Check Python..."
python_ok=0
if ensure_tool_installed "Python" "install_python" "python3" "python" --paths "/usr/local/bin/python3" "/opt/homebrew/bin/python3" "/Library/Frameworks/Python.framework/Versions/*/bin/python3"; then
  python_ok=1
fi

echo
echo "Current detection result:"
IFS='|' read -r node_status node_path_state node_executable node_version <<< "$(get_tool_status "Node.js" "node" --paths "/usr/local/bin/node" "/opt/homebrew/bin/node")"
if [[ "$node_status" == "installed" && "$node_path_state" == "path_ok" ]]; then
  echo "- Node.js: $node_version"
elif [[ "$node_status" == "installed" ]]; then
  echo "- Node.js: installed, but PATH is not configured. Location: $node_executable"
else
  echo "- Node.js: missing"
fi

IFS='|' read -r git_status git_path_state git_executable git_version <<< "$(get_tool_status "Git" "git" --paths "/usr/bin/git" "/Library/Developer/CommandLineTools/usr/bin/git")"
if [[ "$git_status" == "installed" && "$git_path_state" == "path_ok" ]]; then
  echo "- Git: $git_version"
elif [[ "$git_status" == "installed" ]]; then
  echo "- Git: installed, but PATH is not configured. Location: $git_executable"
else
  echo "- Git: missing"
fi

IFS='|' read -r python_status python_path_state python_executable python_version <<< "$(get_tool_status "Python" "python3" "python" --paths "/usr/local/bin/python3" "/opt/homebrew/bin/python3" "/Library/Frameworks/Python.framework/Versions/*/bin/python3")"
if [[ "$python_status" == "installed" && "$python_path_state" == "path_ok" ]]; then
  echo "- Python: $python_version"
elif [[ "$python_status" == "installed" ]]; then
  echo "- Python: installed, but PATH is not configured. Location: $python_executable"
else
  echo "- Python: missing"
fi

if [[ "$CHECK_ONLY" == "--check-only" ]]; then
  exit 0
fi

if [[ $node_ok -ne 1 || $git_ok -ne 1 || $python_ok -ne 1 ]]; then
  if [[ "$node_path_state" == "path_missing" || "$git_path_state" == "path_missing" || "$python_path_state" == "path_missing" ]]; then
    write_warn "[RESULT] Some tools are installed, but PATH is not configured."
    write_warn "[RESULT] To avoid duplicate installs, the script stopped before final validation."
  else
    write_warn "[RESULT] Some tools are still missing. New terminal validation was skipped."
    write_warn "[RESULT] Complete the missing installations, then run install_mac.command again."
  fi
  exit 1
fi

echo
write_step "[VALIDATE] Open a new terminal and check PATH..."
open_validation_terminal
write_success "[DONE] Installation flow finished. Please review the new terminal window."
close_terminal_tab_for_tty_async "$CURRENT_TTY" 1
