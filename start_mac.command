#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECK_ONLY="${1:-}"

find_python_command() {
  if command -v python3 >/dev/null 2>&1; then
    echo "python3"
    return 0
  fi
  if command -v python >/dev/null 2>&1; then
    echo "python"
    return 0
  fi
  return 1
}

install_uv_if_possible() {
  local python_cmd
  python_cmd="$(find_python_command || true)"
  if [[ -z "$python_cmd" ]]; then
    echo "[ERROR] 未检测到 uv，且当前系统也没有可用的 Python。请先安装 Python 3.8+，然后重新执行启动脚本。"
    exit 1
  fi

  echo "[提示] 当前未检测到 uv，但已检测到 Python: $python_cmd"
  read -r -p "[询问] 是否现在使用 uv 官方安装脚本自动安装 uv？请输入 Y 或 N: " install_choice
  if [[ "$install_choice" != "Y" && "$install_choice" != "y" ]]; then
    echo "[ERROR] 你已取消自动安装 uv。请手动安装 uv 后重新执行启动脚本。"
    exit 1
  fi

  echo "[提示] 将使用 uv 官方安装脚本自动安装 uv，请稍候..."
  if command -v curl >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- https://astral.sh/uv/install.sh | sh
  else
    echo "[ERROR] 自动安装 uv 失败：缺少 curl 或 wget。"
    echo "请先安装 curl/wget，或手动执行官方安装命令后重试。"
    exit 1
  fi

  export PATH="$HOME/.local/bin:$PATH"
  if ! command -v uv >/dev/null 2>&1; then
    echo "[ERROR] uv 安装完成后仍未加入当前 PATH。请重新打开终端后再试，或手动将 \$HOME/.local/bin 加入 PATH。"
    exit 1
  fi

  echo "[提示] uv 已自动安装完成。"
}

ensure_backend_env() {
  if [[ -d "$ROOT_DIR/backend/.venv" ]]; then
    return 0
  fi

  read -r -p "[询问] 未检测到 backend/.venv。是否现在自动执行 uv sync 初始化后端环境？请输入 Y 或 N: " backend_choice
  if [[ "$backend_choice" != "Y" && "$backend_choice" != "y" ]]; then
    echo "[ERROR] 你已取消初始化后端环境。请执行: cd \"$ROOT_DIR/backend\" && uv sync"
    exit 1
  fi

  echo "[提示] 正在初始化后端环境，请稍候..."
  (cd "$ROOT_DIR/backend" && uv sync) || {
    echo "[ERROR] 后端环境初始化失败。请执行: cd \"$ROOT_DIR/backend\" && uv sync"
    exit 1
  }
}

ensure_frontend_env() {
  if [[ -d "$ROOT_DIR/frontend/node_modules" ]]; then
    return 0
  fi

  read -r -p "[询问] 未检测到 frontend/node_modules。是否现在自动执行 npm install 初始化前端环境？请输入 Y 或 N: " frontend_choice
  if [[ "$frontend_choice" != "Y" && "$frontend_choice" != "y" ]]; then
    echo "[ERROR] 你已取消初始化前端环境。请执行: cd \"$ROOT_DIR/frontend\" && npm install"
    exit 1
  fi

  echo "[提示] 正在初始化前端环境，请稍候..."
  (cd "$ROOT_DIR/frontend" && npm install) || {
    echo "[ERROR] 前端环境初始化失败。请执行: cd \"$ROOT_DIR/frontend\" && npm install"
    exit 1
  }
}

echo "[1/6] 校验项目目录..."
[[ -f "$ROOT_DIR/backend/pyproject.toml" ]] || { echo "[ERROR] 未找到 backend/pyproject.toml，请确认脚本位于项目根目录。"; exit 1; }
[[ -f "$ROOT_DIR/frontend/package.json" ]] || { echo "[ERROR] 未找到 frontend/package.json，请确认脚本位于项目根目录。"; exit 1; }

echo "[2/6] 校验 uv..."
if ! command -v uv >/dev/null 2>&1; then
  install_uv_if_possible
fi

echo "[3/6] 校验 Node.js..."
command -v node >/dev/null 2>&1 || { echo "[ERROR] 未检测到 node。请先安装 Node.js 20+。"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "[ERROR] 未检测到 npm。请确认 Node.js 安装完整。"; exit 1; }

echo "[4/6] 校验后端运行环境..."
ensure_backend_env

echo "[5/6] 校验前端运行环境..."
ensure_frontend_env

echo "[6/7] 校验后端工具链..."
(cd "$ROOT_DIR/backend" && uv run python --version >/dev/null) || { echo "[ERROR] backend 环境存在，但无法执行 uv run python --version。请先执行: cd \"$ROOT_DIR/backend\" && uv sync"; exit 1; }

echo "[7/7] 校验前端工具链..."
(cd "$ROOT_DIR/frontend" && npm exec vite -- --version >/dev/null) || { echo "[ERROR] frontend 环境存在，但无法执行 npm exec vite -- --version。请先执行: cd \"$ROOT_DIR/frontend\" && npm install"; exit 1; }

echo "uv: $(uv --version)"
echo "python: $(cd "$ROOT_DIR/backend" && uv run python --version)"
echo "node: $(node --version)"
echo "npm: $(npm --version)"
echo "vite: $(cd "$ROOT_DIR/frontend" && npm exec vite -- --version | head -n 1)"

if [[ "$CHECK_ONLY" == "--check-only" ]]; then
  echo
  echo "环境校验通过。"
  echo "你现在可以执行 start_mac.command 启动前后端服务。"
  exit 0
fi

BACKEND_CMD="cd \"$ROOT_DIR/backend\" && uv run main.py"
FRONTEND_CMD="cd \"$ROOT_DIR/frontend\" && npm run dev"
RUNTIME_DIR="$ROOT_DIR/runtime"
mkdir -p "$RUNTIME_DIR"

BACKEND_LAUNCHER="$RUNTIME_DIR/start_backend_mac.sh"
FRONTEND_LAUNCHER="$RUNTIME_DIR/start_frontend_mac.sh"

cat > "$BACKEND_LAUNCHER" <<EOF
#!/bin/bash
set -euo pipefail
echo "========================================"
echo "后端服务窗口"
echo "这个窗口负责运行后端 API 服务。"
echo "系统使用期间请不要关闭该窗口。"
echo "如需停止后端，直接关闭此终端窗口即可。"
echo "健康检查地址: http://127.0.0.1:8000/api/health"
echo "========================================"
echo
cd "$ROOT_DIR/backend"
uv run main.py
EOF

cat > "$FRONTEND_LAUNCHER" <<EOF
#!/bin/bash
set -euo pipefail
echo "========================================"
echo "前端服务窗口"
echo "这个窗口负责运行前端页面服务。"
echo "系统使用期间请不要关闭该窗口。"
echo "如需停止前端，直接关闭此终端窗口即可。"
echo "访问地址: http://127.0.0.1:5173"
echo "========================================"
echo
cd "$ROOT_DIR/frontend"
npm run dev
EOF

chmod +x "$BACKEND_LAUNCHER" "$FRONTEND_LAUNCHER"

echo
echo "========================================"
echo "准备启动项目。"
echo "将打开两个终端窗口："
echo "1. 后端服务窗口"
echo "2. 前端服务窗口"
echo
echo "系统运行期间请不要关闭这两个终端窗口。"
echo "如果关闭终端，对应服务会停止。"
echo "如需停止服务，直接关闭对应终端窗口即可。"
echo "========================================"

( sleep 3; open "http://127.0.0.1:5173" ) >/dev/null 2>&1 &

if command -v osascript >/dev/null 2>&1; then
  FRONTEND_APPLE=$(printf '%s' "bash \"$FRONTEND_LAUNCHER\"" | sed 's/\\/\\\\/g; s/"/\\"/g')
  osascript <<EOF
tell application "Terminal"
    activate
    do script "$FRONTEND_APPLE"
end tell
EOF

  exec bash "$BACKEND_LAUNCHER"
else
  nohup bash "$FRONTEND_LAUNCHER" > "$RUNTIME_DIR/frontend.log" 2>&1 &
  exec bash "$BACKEND_LAUNCHER"
fi

echo
echo "启动命令已提交："
echo "后端: http://127.0.0.1:8000/api/health"
echo "前端: http://127.0.0.1:5173"
echo "浏览器将在前端启动后自动打开首页。"
