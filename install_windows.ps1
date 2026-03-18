param(
    [switch]$CheckOnly
)

[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$Global:ProgressPreference = 'SilentlyContinue'
$script:CurrentStage = "Initialization"
$script:OfflineInstallerUrl = $null

function Write-Step {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Cyan
}

function Write-Warn {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Yellow
}

function Write-Success {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Green
}

function Write-Info {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Gray
}

function Fail-AndExit {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Red
    Write-Host "[RESULT] Failed stage: $script:CurrentStage" -ForegroundColor Yellow
    if (-not [string]::IsNullOrWhiteSpace($script:OfflineInstallerUrl)) {
        Write-Host "[RESULT] Official offline installer: $script:OfflineInstallerUrl" -ForegroundColor Yellow
    }
    Write-Host "[RESULT] Fix the issue above, then run install_windows.bat again." -ForegroundColor Yellow
    exit 1
}

function Set-StageContext {
    param(
        [string]$Stage,
        [string]$OfflineUrl = $null
    )

    $script:CurrentStage = $Stage
    $script:OfflineInstallerUrl = $OfflineUrl
}

function Ask-YesNo {
    param([string]$Prompt)

    $choice = Read-Host $Prompt
    return $choice -in @("Y", "y", "Yes", "yes")
}

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ([string]::IsNullOrWhiteSpace($machinePath)) {
        $env:Path = $userPath
        return
    }
    if ([string]::IsNullOrWhiteSpace($userPath)) {
        $env:Path = $machinePath
        return
    }
    $env:Path = "$machinePath;$userPath"
}

function Get-InstalledCommand {
    param([string[]]$Candidates)

    foreach ($candidate in $Candidates) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($command) {
            return $command.Name
        }
    }
    return $null
}

function Find-ExistingExecutable {
    param([string[]]$Patterns)

    foreach ($pattern in $Patterns) {
        $matched = Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($matched) {
            return $matched.FullName
        }
    }
    return $null
}

function Get-ToolStatus {
    param(
        [string]$Name,
        [string[]]$Commands,
        [string[]]$KnownPaths = @()
    )

    Refresh-Path
    $commandName = Get-InstalledCommand -Candidates $Commands
    if (-not $commandName) {
        $executablePath = Find-ExistingExecutable -Patterns $KnownPaths
        if ($executablePath) {
            $version = "File found but version lookup failed"
            try {
                $version = (& $executablePath --version | Select-Object -First 1).Trim()
            } catch {
            }

            return [PSCustomObject]@{
                Name = $Name
                Installed = $true
                PathConfigured = $false
                CommandName = $null
                ExecutablePath = $executablePath
                Version = $version
            }
        }

        return [PSCustomObject]@{
            Name = $Name
            Installed = $false
            PathConfigured = $false
            CommandName = $null
            ExecutablePath = $null
            Version = $null
        }
    }

    try {
        $version = (& $commandName --version | Select-Object -First 1).Trim()
    } catch {
        $version = "Command found but version lookup failed"
    }

    return [PSCustomObject]@{
        Name = $Name
        Installed = $true
        PathConfigured = $true
        CommandName = $commandName
        ExecutablePath = $commandName
        Version = $version
    }
}

function Wait-ForInstallResult {
    param(
        [string]$Name,
        [string[]]$Commands,
        [int]$MaxAttempts = 12,
        [int]$DelaySeconds = 5
    )

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        Refresh-Path
        $status = Get-ToolStatus -Name $Name -Commands $Commands
        if ($status.Installed) {
            Write-Success "[DONE] $Name installed: $($status.Version)"
            return $true
        }
        Start-Sleep -Seconds $DelaySeconds
    }

    Write-Warn "[WARN] $Name is not visible in the current terminal yet. A new terminal check will run later."
    return $true
}

function Invoke-ExternalCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$FailureMessage
    )

    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -PassThru -Wait -WindowStyle Normal
    if ($process.ExitCode -ne 0) {
        Fail-AndExit "$FailureMessage Exit code: $($process.ExitCode)"
    }
}

function Invoke-WebRequestWithRetry {
    param(
        [string]$Uri,
        [string]$OutFile = "",
        [int]$MaxAttempts = 3,
        [int]$TimeoutSeconds = 30
    )

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            Write-Info ("[NET] Request {0}/{1}: {2}" -f $attempt, $MaxAttempts, $Uri)
            if ([string]::IsNullOrWhiteSpace($OutFile)) {
                return Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec $TimeoutSeconds
            }

            Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing -TimeoutSec $TimeoutSeconds
            return $true
        } catch {
            if ($attempt -eq $MaxAttempts) {
                throw
            }

            Write-Warn "[WARN] Network request failed. Retrying in 5 seconds..."
            Start-Sleep -Seconds 5
        }
    }
}

function Invoke-RestMethodWithRetry {
    param(
        [string]$Uri,
        [int]$MaxAttempts = 3,
        [int]$TimeoutSeconds = 30
    )

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            Write-Info ("[NET] Request {0}/{1}: {2}" -f $attempt, $MaxAttempts, $Uri)
            return Invoke-RestMethod -Uri $Uri -TimeoutSec $TimeoutSeconds
        } catch {
            if ($attempt -eq $MaxAttempts) {
                throw
            }

            Write-Warn "[WARN] Network request failed. Retrying in 5 seconds..."
            Start-Sleep -Seconds 5
        }
    }
}

function Get-NodeLatestLtsVersion {
    try {
        $releases = Invoke-RestMethodWithRetry -Uri "https://nodejs.org/dist/index.json"
    } catch {
        Fail-AndExit "[ERROR] Could not read the Node.js release list from the official site."
    }

    $ltsRelease = $releases | Where-Object { $_.lts } | Select-Object -First 1
    if (-not $ltsRelease) {
        Fail-AndExit "[ERROR] Could not detect the latest Node.js LTS release."
    }

    return [string]$ltsRelease.version
}

function Get-PythonLatestStableVersion {
    try {
        $response = Invoke-WebRequestWithRetry -Uri "https://www.python.org/downloads/windows/"
    } catch {
        Fail-AndExit "[ERROR] Could not read the Python Windows downloads page."
    }

    $match = [regex]::Match($response.Content, 'Latest Python 3 Release - Python ([0-9]+\.[0-9]+\.[0-9]+)')
    if (-not $match.Success) {
        Fail-AndExit "[ERROR] Could not detect the latest stable Python 3 version."
    }

    return $match.Groups[1].Value
}

function Install-Uv {
    Set-StageContext -Stage "Install uv" -OfflineUrl "https://docs.astral.sh/uv/getting-started/installation/"
    Write-Warn "[INFO] Installing uv using the official standalone installer."
    Write-Warn "[INFO] A UAC prompt or installer window may appear. Allow it and do not close this script window."
    Write-Step "[INSTALL] uv..."

    try {
        powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex" | Out-Null
    } catch {
        Fail-AndExit "[ERROR] uv installation failed."
    }

    $uvUserBin = Join-Path $HOME ".local\bin"
    if (Test-Path $uvUserBin) {
        $env:Path = "$uvUserBin;$env:Path"
    }

    Set-StageContext -Stage "Verify uv" -OfflineUrl "https://docs.astral.sh/uv/getting-started/installation/"
    Write-Warn "[INFO] Waiting for uv installation result. This may take a few minutes."
    Write-Step "[VERIFY] uv..."
    return Wait-ForInstallResult -Name "uv" -Commands @("uv")
}

function Install-Node {
    $version = Get-NodeLatestLtsVersion
    $arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq [System.Runtime.InteropServices.Architecture]::Arm64) { "arm64" } else { "x64" }
    $url = "https://nodejs.org/dist/$version/node-$version-$arch.msi"
    $installerPath = Join-Path $env:TEMP "node-$version-$arch.msi"

    Set-StageContext -Stage "Download Node.js installer" -OfflineUrl $url
    Write-Warn "[INFO] Installing the current official Node.js LTS release: $version"
    Write-Step "[DOWNLOAD] Node.js installer..."
    try {
        Invoke-WebRequestWithRetry -Uri $url -OutFile $installerPath | Out-Null
    } catch {
        Fail-AndExit "[ERROR] Node.js installer download failed. Offline installer: $url"
    }

    Set-StageContext -Stage "Install Node.js" -OfflineUrl $url
    Write-Warn "[INFO] A UAC prompt or installer window may appear. Allow it and do not close this script window."
    Write-Step "[INSTALL] Node.js..."
    Invoke-ExternalCommand -FilePath "msiexec.exe" -Arguments @("/i", $installerPath, "/passive", "/norestart") -FailureMessage "[ERROR] Node.js installation failed."
    Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
    Set-StageContext -Stage "Verify Node.js" -OfflineUrl $url
    Write-Warn "[INFO] Waiting for Node.js installation result. This may take a few minutes."
    Write-Step "[VERIFY] Node.js..."
    $nodeReady = Wait-ForInstallResult -Name "Node.js" -Commands @("node")
    Write-Step "[VERIFY] npm..."
    $npmReady = Wait-ForInstallResult -Name "npm" -Commands @("npm")
    return ($nodeReady -and $npmReady)
}

function Install-Git {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Fail-AndExit "[ERROR] winget is not available. Git auto-install currently requires the official winget path."
    }

    Set-StageContext -Stage "Install Git" -OfflineUrl "https://git-scm.com/download/win"
    Write-Warn "[INFO] Installing Git using the official winget path shown on the Git site."
    Write-Warn "[INFO] A UAC prompt or installer window may appear. Allow it and do not close this script window."
    Write-Step "[INSTALL] Git..."
    Invoke-ExternalCommand -FilePath "winget" -Arguments @("install", "--id", "Git.Git", "-e", "--source", "winget", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity") -FailureMessage "[ERROR] Git installation failed."
    Set-StageContext -Stage "Verify Git" -OfflineUrl "https://git-scm.com/download/win"
    Write-Warn "[INFO] Waiting for Git installation result. This may take a few minutes."
    Write-Step "[VERIFY] Git..."
    return Wait-ForInstallResult -Name "Git" -Commands @("git")
}

function Install-Python {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Set-StageContext -Stage "Install Python Install Manager" -OfflineUrl "https://docs.python.org/3/using/windows.html"
        Write-Warn "[INFO] Installing Python Install Manager, then Python 3."
        Write-Warn "[INFO] A UAC prompt or installer window may appear. Allow it and do not close this script window."
        Write-Step "[INSTALL] Python Install Manager..."
        Invoke-ExternalCommand -FilePath "winget" -Arguments @("install", "9NQ7512CXL7T", "-e", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity") -FailureMessage "[ERROR] Python Install Manager installation failed."

        Refresh-Path
        $pythonManager = Get-InstalledCommand -Candidates @("pymanager", "py")
        if ($pythonManager) {
            try {
                Set-StageContext -Stage "Configure Python Install Manager" -OfflineUrl "https://docs.python.org/3/using/windows.html"
                Write-Step "[CONFIGURE] Python Install Manager..."
                & $pythonManager install --configure -y | Out-Null
            } catch {
                Write-Warn "[WARN] Python Install Manager configuration did not finish in this terminal."
            }

            try {
                Set-StageContext -Stage "Install Python 3 via Python Install Manager" -OfflineUrl "https://docs.python.org/3/using/windows.html"
                Write-Step "[INSTALL] Python 3..."
                & $pythonManager install 3 | Out-Null
            } catch {
                Write-Warn "[WARN] Python runtime installation did not finish in this terminal."
            }
        } else {
            Write-Warn "[WARN] pymanager/py is not visible yet in this terminal."
        }
    } else {
        $version = Get-PythonLatestStableVersion
        $arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq [System.Runtime.InteropServices.Architecture]::Arm64) { "arm64" } else { "amd64" }
        $installerName = "python-$version-$arch.exe"
        $url = "https://www.python.org/ftp/python/$version/$installerName"
        $installerPath = Join-Path $env:TEMP $installerName

        Set-StageContext -Stage "Download Python installer" -OfflineUrl $url
        Write-Warn "[INFO] winget is not available. Falling back to the official Python installer."
        Write-Warn "[INFO] Installing Python stable release: $version"
        Write-Step "[DOWNLOAD] Python installer..."
        try {
            Invoke-WebRequestWithRetry -Uri $url -OutFile $installerPath | Out-Null
        } catch {
            Fail-AndExit "[ERROR] Python installer download failed. Offline installer: $url"
        }

        Set-StageContext -Stage "Install Python" -OfflineUrl $url
        Write-Warn "[INFO] A UAC prompt or installer window may appear. Allow it and do not close this script window."
        Write-Step "[INSTALL] Python..."
        Invoke-ExternalCommand -FilePath $installerPath -Arguments @(
            "/quiet",
            "InstallAllUsers=0",
            "PrependPath=1",
            "Include_test=0",
            "Include_launcher=1",
            "InstallLauncherAllUsers=0"
        ) -FailureMessage "[ERROR] Python installer execution failed."

        Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
    }

    Set-StageContext -Stage "Verify Python" -OfflineUrl "https://www.python.org/downloads/windows/"
    Write-Warn "[INFO] Waiting for Python installation result. This may take a few minutes."
    Write-Step "[VERIFY] Python..."
    return Wait-ForInstallResult -Name "Python" -Commands @("python", "py")
}

function Ensure-ToolInstalled {
    param(
        [string]$Name,
        [string[]]$Commands,
        [string[]]$KnownPaths,
        [scriptblock]$Installer
    )

    $status = Get-ToolStatus -Name $Name -Commands $Commands -KnownPaths $KnownPaths
    if ($status.Installed -and $status.PathConfigured) {
        Write-Success "[OK] ${Name}: $($status.Version)"
        return $true
    }

    if ($status.Installed -and -not $status.PathConfigured) {
        Write-Warn "[WARN] ${Name} is installed, but PATH is not configured."
        Write-Warn "[WARN] Detected location: $($status.ExecutablePath)"
        Write-Warn "[WARN] To avoid duplicate installs, the script will stop here for this tool."
        return $false
    }

    Write-Warn "[MISSING] $Name was not detected."
    if (-not (Ask-YesNo -Prompt "Start automatic installation for $Name now? Type Y or N")) {
        Write-Warn "[SKIP] $Name installation skipped."
        return $false
    }

    return (& $Installer)
}

function Open-ValidationTerminal {
    $validateScript = Join-Path $env:TEMP ("xgd_env_validate_{0}.ps1" -f ([guid]::NewGuid().ToString("N")))
    $scriptContent = @'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

function Test-Tool {
    param(
        [string]$Name,
        [string[]]$Commands
    )

    foreach ($commandName in $Commands) {
        $command = Get-Command $commandName -ErrorAction SilentlyContinue
        if ($command) {
            try {
                $version = (& $command.Name --version | Select-Object -First 1).Trim()
            } catch {
                $version = "Version lookup failed"
            }

            Write-Host ("[OK] {0}: {1}" -f $Name, $version) -ForegroundColor Green
            Write-Host "     Path: $($command.Source)"
            return
        }
    }

    Write-Host "[FAIL] $Name is not available in PATH." -ForegroundColor Red
}

function Show-Countdown {
    param([int]$Seconds)

    for ($remaining = $Seconds; $remaining -ge 1; $remaining--) {
        Write-Host ("Window closes in {0} second(s)..." -f $remaining) -ForegroundColor Yellow
        Start-Sleep -Seconds 1
    }
}

Write-Host "Running validation in a new terminal..." -ForegroundColor Cyan
Test-Tool -Name "Node.js" -Commands @("node")
Test-Tool -Name "npm" -Commands @("npm")
Test-Tool -Name "Git" -Commands @("git")
Test-Tool -Name "Python" -Commands @("python", "py")
Test-Tool -Name "uv" -Commands @("uv")
Write-Host ""
Write-Host "If all checks are OK here, PATH is working in a fresh terminal." -ForegroundColor Yellow
Show-Countdown -Seconds 5
Remove-Item -Path $PSCommandPath -Force -ErrorAction SilentlyContinue
'@

    Set-Content -Path $validateScript -Value $scriptContent -Encoding UTF8
    Start-Process powershell -ArgumentList @("-ExecutionPolicy", "Bypass", "-File", $validateScript) | Out-Null
}

Write-Step "[1/5] Check Node.js..."
$nodeOk = Ensure-ToolInstalled -Name "Node.js" -Commands @("node") -KnownPaths @(
    "C:/Program Files/nodejs/node.exe",
    "C:/Program Files (x86)/nodejs/node.exe"
) -Installer ${function:Install-Node}

Write-Step "[2/5] Check npm..."
$npmOk = Ensure-ToolInstalled -Name "npm" -Commands @("npm") -KnownPaths @(
    "C:/Program Files/nodejs/npm.cmd",
    "C:/Program Files/nodejs/npm",
    "C:/Program Files (x86)/nodejs/npm.cmd",
    "C:/Program Files (x86)/nodejs/npm"
) -Installer ${function:Install-Node}

Write-Step "[3/5] Check Git..."
$gitOk = Ensure-ToolInstalled -Name "Git" -Commands @("git") -KnownPaths @(
    "C:/Program Files/Git/cmd/git.exe",
    "C:/Program Files/Git/bin/git.exe",
    "C:/Program Files (x86)/Git/cmd/git.exe",
    "C:/Program Files (x86)/Git/bin/git.exe"
) -Installer ${function:Install-Git}

Write-Step "[4/5] Check Python..."
$pythonOk = Ensure-ToolInstalled -Name "Python" -Commands @("python", "py") -KnownPaths @(
    "$env:LOCALAPPDATA/Programs/Python/Python*/python.exe",
    "C:/Program Files/Python*/python.exe",
    "C:/Windows/py.exe"
) -Installer ${function:Install-Python}

Write-Step "[5/5] Check uv..."
$uvOk = Ensure-ToolInstalled -Name "uv" -Commands @("uv") -KnownPaths @(
    "$env:USERPROFILE/.local/bin/uv.exe"
) -Installer ${function:Install-Uv}

$results = @(
    Get-ToolStatus -Name "Node.js" -Commands @("node") -KnownPaths @(
        "C:/Program Files/nodejs/node.exe",
        "C:/Program Files (x86)/nodejs/node.exe"
    )
    Get-ToolStatus -Name "npm" -Commands @("npm") -KnownPaths @(
        "C:/Program Files/nodejs/npm.cmd",
        "C:/Program Files/nodejs/npm",
        "C:/Program Files (x86)/nodejs/npm.cmd",
        "C:/Program Files (x86)/nodejs/npm"
    )
    Get-ToolStatus -Name "Git" -Commands @("git") -KnownPaths @(
        "C:/Program Files/Git/cmd/git.exe",
        "C:/Program Files/Git/bin/git.exe",
        "C:/Program Files (x86)/Git/cmd/git.exe",
        "C:/Program Files (x86)/Git/bin/git.exe"
    )
    Get-ToolStatus -Name "Python" -Commands @("python", "py") -KnownPaths @(
        "$env:LOCALAPPDATA/Programs/Python/Python*/python.exe",
        "C:/Program Files/Python*/python.exe",
        "C:/Windows/py.exe"
    )
    Get-ToolStatus -Name "uv" -Commands @("uv") -KnownPaths @(
        "$env:USERPROFILE/.local/bin/uv.exe"
    )
)

Write-Host ""
Write-Host "Current detection result:" -ForegroundColor Cyan
foreach ($result in $results) {
    if ($result.Installed -and $result.PathConfigured) {
        Write-Host "- $($result.Name): $($result.Version)"
    } elseif ($result.Installed) {
        Write-Host "- $($result.Name): installed, but PATH is not configured. Location: $($result.ExecutablePath)"
    } else {
        Write-Host "- $($result.Name): missing"
    }
}

if ($CheckOnly) {
    exit 0
}

if (($results | Where-Object { -not $_.Installed }).Count -gt 0) {
    Set-StageContext -Stage "Final validation"
    Write-Warn "[RESULT] Some tools are still missing. New terminal validation was skipped."
    Write-Warn "[RESULT] Complete the missing installations, then run install_windows.ps1 again."
    exit 1
}

if (($results | Where-Object { $_.Installed -and -not $_.PathConfigured }).Count -gt 0) {
    Set-StageContext -Stage "Final validation"
    Write-Warn "[RESULT] Some tools are installed, but PATH is not configured."
    Write-Warn "[RESULT] To avoid duplicate installs, the script stopped before final validation."
    exit 1
}

Write-Host ""
Write-Step "[VALIDATE] Open a new terminal and check PATH..."
Open-ValidationTerminal
Write-Success "[DONE] Installation flow finished. Please review the new terminal window."








