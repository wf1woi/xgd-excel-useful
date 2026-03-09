[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CheckOnly = $false
if ($args -contains "--check-only") {
    $CheckOnly = $true
}

function Write-Step {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Cyan
}

function Fail-AndExit {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Red
    exit 1
}

function Get-PythonCommand {
    if (Get-Command python -ErrorAction SilentlyContinue) {
        return "python"
    }
    if (Get-Command py -ErrorAction SilentlyContinue) {
        return "py"
    }
    return $null
}

function Install-UvIfPossible {
    $pythonCmd = Get-PythonCommand
    if (-not $pythonCmd) {
        Fail-AndExit "[错误] 未检测到 uv，且当前系统也没有可用的 Python。请先安装 Python 3.8+，然后重新执行启动脚本。"
    }

    Write-Host "[提示] 当前未检测到 uv，但已检测到 Python: $pythonCmd" -ForegroundColor Yellow
    $installChoice = Read-Host "[询问] 是否现在使用 uv 官方安装脚本自动安装 uv？请输入 Y 或 N"
    if ($installChoice -notin @("Y", "y")) {
        Fail-AndExit "[错误] 你已取消自动安装 uv。请手动安装 uv 后重新执行启动脚本。"
    }

    Write-Host "[提示] 将使用 uv 官方安装脚本自动安装 uv，请稍候..." -ForegroundColor Yellow
    try {
        powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
    } catch {
        Fail-AndExit "[错误] 自动安装 uv 失败。请手动执行官方安装命令后重试：powershell -ExecutionPolicy ByPass -c `"irm https://astral.sh/uv/install.ps1 | iex`""
    }

    $userBin = Join-Path $HOME ".local\bin"
    if (Test-Path $userBin) {
        $env:PATH = "$userBin;$env:PATH"
    }

    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
        Fail-AndExit "[错误] uv 安装完成后仍未加入当前 PATH。请重新打开终端后再试，或手动将 $userBin 加入 PATH。"
    }

    Write-Host "[提示] uv 已自动安装完成。" -ForegroundColor Green
}

function Ensure-BackendEnv {
    if (Test-Path "$RootDir/backend/.venv") {
        return
    }

    $backendChoice = Read-Host "[询问] 未检测到 backend/.venv。是否现在自动执行 uv sync 初始化后端环境？请输入 Y 或 N"
    if ($backendChoice -notin @("Y", "y")) {
        Fail-AndExit "[错误] 你已取消初始化后端环境。请执行：cd `"$RootDir/backend`" ; uv sync"
    }

    Write-Host "[提示] 正在初始化后端环境，请稍候..." -ForegroundColor Yellow
    try {
        & uv sync --directory "$RootDir/backend"
    } catch {
        Fail-AndExit "[错误] 后端环境初始化失败。请执行：cd `"$RootDir/backend`" ; uv sync"
    }
}

function Ensure-FrontendEnv {
    if (Test-Path "$RootDir/frontend/node_modules") {
        return
    }

    $frontendChoice = Read-Host "[询问] 未检测到 frontend/node_modules。是否现在自动执行 npm install 初始化前端环境？请输入 Y 或 N"
    if ($frontendChoice -notin @("Y", "y")) {
        Fail-AndExit "[错误] 你已取消初始化前端环境。请执行：cd `"$RootDir/frontend`" ; npm install"
    }

    Write-Host "[提示] 正在初始化前端环境，请稍候..." -ForegroundColor Yellow
    try {
        & npm install --prefix "$RootDir/frontend"
    } catch {
        Fail-AndExit "[错误] 前端环境初始化失败。请执行：cd `"$RootDir/frontend`" ; npm install"
    }
}

Write-Step "[1/7] 校验项目目录..."
if (-not (Test-Path "$RootDir/backend/pyproject.toml")) {
    Fail-AndExit "[错误] 未找到 backend/pyproject.toml，请确认脚本位于项目根目录。"
}
if (-not (Test-Path "$RootDir/frontend/package.json")) {
    Fail-AndExit "[错误] 未找到 frontend/package.json，请确认脚本位于项目根目录。"
}

Write-Step "[2/7] 校验 uv..."
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Install-UvIfPossible
}

Write-Step "[3/7] 校验 Node.js..."
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail-AndExit "[错误] 未检测到 node。请先安装 Node.js 20+。"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Fail-AndExit "[错误] 未检测到 npm。请确认 Node.js 安装完整。"
}

Write-Step "[4/7] 校验后端运行环境..."
Ensure-BackendEnv

Write-Step "[5/7] 校验前端运行环境..."
Ensure-FrontendEnv

Write-Step "[6/7] 校验后端工具链..."
try {
    $pythonVersion = (& uv run --directory "$RootDir/backend" python --version).Trim()
} catch {
    Fail-AndExit "[错误] backend 环境存在，但无法执行 uv run python --version。请先执行：cd `"$RootDir/backend`" ; uv sync"
}

Write-Step "[7/7] 校验前端工具链..."
try {
    $viteVersion = (& npm exec --prefix "$RootDir/frontend" vite -- --version | Select-Object -First 1).Trim()
} catch {
    Fail-AndExit "[错误] frontend 环境存在，但无法执行 npm exec vite -- --version。请先执行：cd `"$RootDir/frontend`" ; npm install"
}

$uvVersion = (& uv --version).Trim()
$nodeVersion = (& node --version).Trim()
$npmVersion = (& npm --version).Trim()

Write-Host ""
Write-Host "版本信息：" -ForegroundColor Green
Write-Host "uv: $uvVersion"
Write-Host "python: $pythonVersion"
Write-Host "node: $nodeVersion"
Write-Host "npm: $npmVersion"
Write-Host "vite: $viteVersion"

if ($CheckOnly) {
    Write-Host ""
    Write-Host "环境校验通过。" -ForegroundColor Green
    Write-Host "你现在可以双击 start_windows.bat 启动前后端服务。"
    exit 0
}

$backendCmd = @"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding(`$false)
`$OutputEncoding = [Console]::OutputEncoding
Set-Location '$RootDir/backend'
`$Host.UI.RawUI.WindowTitle = 'xgd-excel-useful - 后端服务'
Write-Host '========================================' -ForegroundColor Yellow
Write-Host '后端服务窗口' -ForegroundColor Yellow
Write-Host '这个窗口负责运行后端 API 服务。'
Write-Host '系统使用期间请不要关闭该窗口。'
Write-Host '如需停止后端，直接关闭此终端窗口即可。'
Write-Host '健康检查地址: http://127.0.0.1:8000/api/health'
Write-Host '========================================' -ForegroundColor Yellow
Write-Host ''
uv run main.py
"@

$frontendCmd = @"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding(`$false)
`$OutputEncoding = [Console]::OutputEncoding
Set-Location '$RootDir/frontend'
`$Host.UI.RawUI.WindowTitle = 'xgd-excel-useful - 前端服务'
Write-Host '========================================' -ForegroundColor Yellow
Write-Host '前端服务窗口' -ForegroundColor Yellow
Write-Host '这个窗口负责运行前端页面服务。'
Write-Host '系统使用期间请不要关闭该窗口。'
Write-Host '如需停止前端，直接关闭此终端窗口即可。'
Write-Host '访问地址: http://127.0.0.1:5173'
Write-Host '========================================' -ForegroundColor Yellow
Write-Host ''
npm run dev
"@

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "准备启动项目。"
Write-Host "将打开两个终端窗口："
Write-Host "1. 后端服务窗口"
Write-Host "2. 前端服务窗口"
Write-Host ""
Write-Host "系统运行期间请不要关闭这两个终端窗口。"
Write-Host "如果关闭终端，对应服务会停止。"
Write-Host "如需停止服务，直接关闭对应终端窗口即可。"
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", $backendCmd
)

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", $frontendCmd
)

Start-Process powershell -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:5173'"
)

Write-Host "已提交启动命令：" -ForegroundColor Green
Write-Host "后端: http://127.0.0.1:8000/api/health"
Write-Host "前端: http://127.0.0.1:5173"
Write-Host "浏览器将在前端启动后自动打开首页。"
