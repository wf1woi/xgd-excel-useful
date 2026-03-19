param(
    [switch]$CheckOnly
)

[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$Global:ProgressPreference = 'SilentlyContinue'
$script:CurrentStage = "Initialization"
$script:OfflineInstallerUrl = $null
$script:InstallDirectorySelections = @{}

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

function Compress-ConsecutivePathSegments {
    param([string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $root = [System.IO.Path]::GetPathRoot($fullPath)
    $relativePart = $fullPath.Substring($root.Length)
    if ([string]::IsNullOrWhiteSpace($relativePart)) {
        return $fullPath
    }

    $segments = $relativePart -split '[\\/]+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $compressedSegments = New-Object System.Collections.Generic.List[string]
    foreach ($segment in $segments) {
        if ($compressedSegments.Count -gt 0 -and $compressedSegments[$compressedSegments.Count - 1].Equals($segment, [System.StringComparison]::OrdinalIgnoreCase)) {
            continue
        }
        $compressedSegments.Add($segment)
    }

    if ($compressedSegments.Count -eq 0) {
        return $fullPath.TrimEnd('\')
    }

    return ($root.TrimEnd('\') + '\' + ($compressedSegments -join '\'))
}

function Test-DirectoryIsEmpty {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return $true
    }

    return -not (Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Get-InstallDirectoryChoice {
    param(
        [string]$ToolName,
        [string]$DefaultPath
    )

    if ($script:InstallDirectorySelections.ContainsKey($ToolName)) {
        return $script:InstallDirectorySelections[$ToolName]
    }

    while ($true) {
        Write-Info ("[INFO] Default install directory for {0}: {1}" -f $ToolName, $DefaultPath)
        $inputPath = Read-Host "Optional custom install directory for $ToolName. Press Enter to use the default path"
        if ([string]::IsNullOrWhiteSpace($inputPath)) {
            $script:InstallDirectorySelections[$ToolName] = $null
            return $null
        }

        if (-not [System.IO.Path]::IsPathRooted($inputPath)) {
            Write-Warn "[WARN] Please enter a full absolute path."
            continue
        }

        try {
            $normalizedPath = Compress-ConsecutivePathSegments -Path $inputPath
        } catch {
            Write-Warn "[WARN] The path is invalid. Please enter a valid Windows path."
            continue
        }

        if ($normalizedPath -ne ([System.IO.Path]::GetFullPath($inputPath))) {
            Write-Warn "[WARN] Repeated folder names were simplified."
            Write-Info "[INFO] Normalized path: $normalizedPath"
        }

        if (-not (Test-DirectoryIsEmpty -Path $normalizedPath)) {
            Write-Warn "[WARN] The selected directory is not empty. Choose an empty directory or press Enter for the default path."
            continue
        }

        $script:InstallDirectorySelections[$ToolName] = $normalizedPath
        return $normalizedPath
    }
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

function Test-IsWindowsStoreAlias {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $false
    }

    return $Path -like "*\AppData\Local\Microsoft\WindowsApps\python*.exe"
}

function Get-CommandVersion {
    param(
        [string]$CommandName,
        [string]$CommandPath = $null
    )

    if (Test-IsWindowsStoreAlias -Path $CommandPath) {
        return $null
    }

    try {
        $versionLine = (& $CommandName --version 2>&1 | Select-Object -First 1)
        if ($null -eq $versionLine) {
            return $null
        }

        $version = $versionLine.ToString().Trim()
        if ([string]::IsNullOrWhiteSpace($version)) {
            return $null
        }

        if ($version -match "Microsoft Store" -or $version -match "ms-windows-store") {
            return $null
        }

        return $version
    } catch {
        return $null
    }
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

    $command = Get-Command $commandName -ErrorAction SilentlyContinue | Select-Object -First 1
    $commandPath = if ($command) { $command.Source } else { $commandName }
    $version = Get-CommandVersion -CommandName $commandName -CommandPath $commandPath
    if (-not $version) {
        $executablePath = Find-ExistingExecutable -Patterns $KnownPaths
        if ($executablePath) {
            $knownPathVersion = "File found but version lookup failed"
            try {
                $knownPathVersionLine = (& $executablePath --version 2>&1 | Select-Object -First 1)
                if ($null -ne $knownPathVersionLine) {
                    $knownPathVersion = $knownPathVersionLine.ToString().Trim()
                }
            } catch {
            }

            return [PSCustomObject]@{
                Name = $Name
                Installed = $true
                PathConfigured = $false
                CommandName = $null
                ExecutablePath = $executablePath
                Version = $knownPathVersion
            }
        }

        return [PSCustomObject]@{
            Name = $Name
            Installed = $false
            PathConfigured = $false
            CommandName = $null
            ExecutablePath = $commandPath
            Version = $null
        }
    }

    return [PSCustomObject]@{
        Name = $Name
        Installed = $true
        PathConfigured = $true
        CommandName = $commandName
        ExecutablePath = $commandPath
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

function Get-GitLatestInstallerInfo {
    try {
        $release = Invoke-RestMethodWithRetry -Uri "https://api.github.com/repos/git-for-windows/git/releases/latest"
    } catch {
        Fail-AndExit "[ERROR] Could not read the latest Git for Windows release metadata."
    }

    $assetPattern = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture) {
        ([System.Runtime.InteropServices.Architecture]::Arm64) { '^Git-.*-arm64\.exe$' }
        ([System.Runtime.InteropServices.Architecture]::X86) { '^Git-.*-32-bit\.exe$' }
        default { '^Git-.*-64-bit\.exe$' }
    }

    $asset = $release.assets | Where-Object { $_.name -match $assetPattern } | Select-Object -First 1
    if (-not $asset) {
        Fail-AndExit "[ERROR] Could not detect the latest Git for Windows installer."
    }

    return [PSCustomObject]@{
        Version = $release.tag_name
        DownloadUrl = $asset.browser_download_url
        ReleaseUrl = $release.html_url
        FileName = $asset.name
    }
}

function Find-PythonManagerExecutable {
    Refresh-Path

    $command = Get-Command "pymanager" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command -and -not [string]::IsNullOrWhiteSpace($command.Source)) {
        return $command.Source
    }

    $knownManagerPaths = @(
        "$env:LOCALAPPDATA/Microsoft/WindowsApps/PythonSoftwareFoundation.PythonManager_*/pymanager.exe"
    )

    return Find-ExistingExecutable -Patterns $knownManagerPaths
}

function Install-Uv {
    $defaultInstallDir = Join-Path $env:USERPROFILE ".local\bin"
    $installDir = Get-InstallDirectoryChoice -ToolName "uv" -DefaultPath $defaultInstallDir
    Set-StageContext -Stage "Install uv" -OfflineUrl "https://docs.astral.sh/uv/getting-started/installation/"
    Write-Warn "[INFO] Installing uv using the official standalone installer."
    Write-Warn "[INFO] A UAC prompt or installer window may appear. Allow it and do not close this script window."
    if ($installDir) {
        Write-Info "[INFO] Custom uv install directory: $installDir"
    }
    Write-Step "[INSTALL] uv..."

    try {
        if ($installDir) {
            $escapedInstallDir = $installDir.Replace("'", "''")
            powershell -ExecutionPolicy ByPass -Command "& {`$env:UV_INSTALL_DIR='$escapedInstallDir'; irm https://astral.sh/uv/install.ps1 | iex }" | Out-Null
        } else {
            powershell -ExecutionPolicy ByPass -Command "irm https://astral.sh/uv/install.ps1 | iex" | Out-Null
        }
    } catch {
        Fail-AndExit "[ERROR] uv installation failed."
    }

    $uvUserBin = if ($installDir) { $installDir } else { $defaultInstallDir }
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
    $defaultInstallDir = Join-Path $env:ProgramFiles "nodejs"
    $installDir = Get-InstallDirectoryChoice -ToolName "Node.js" -DefaultPath $defaultInstallDir

    Set-StageContext -Stage "Download Node.js installer" -OfflineUrl $url
    Write-Warn "[INFO] Installing the current official Node.js LTS release: $version"
    if ($installDir) {
        Write-Info "[INFO] Custom Node.js install directory: $installDir"
    }
    Write-Step "[DOWNLOAD] Node.js installer..."
    try {
        Invoke-WebRequestWithRetry -Uri $url -OutFile $installerPath | Out-Null
    } catch {
        Fail-AndExit "[ERROR] Node.js installer download failed. Offline installer: $url"
    }

    Set-StageContext -Stage "Install Node.js" -OfflineUrl $url
    Write-Warn "[INFO] A UAC prompt or installer window may appear. Allow it and do not close this script window."
    Write-Step "[INSTALL] Node.js..."
    $msiArguments = @("/i", $installerPath, "/passive", "/norestart")
    if ($installDir) {
        $msiArguments += "INSTALLDIR=$installDir"
    }
    Invoke-ExternalCommand -FilePath "msiexec.exe" -Arguments $msiArguments -FailureMessage "[ERROR] Node.js installation failed."
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
    $gitInstaller = Get-GitLatestInstallerInfo
    $installerPath = Join-Path $env:TEMP $gitInstaller.FileName
    $defaultInstallDir = Join-Path $env:ProgramFiles "Git"
    $installDir = Get-InstallDirectoryChoice -ToolName "Git" -DefaultPath $defaultInstallDir

    Set-StageContext -Stage "Download Git installer" -OfflineUrl $gitInstaller.ReleaseUrl
    Write-Warn "[INFO] Installing the latest official Git for Windows release: $($gitInstaller.Version)"
    if ($installDir) {
        Write-Info "[INFO] Custom Git install directory: $installDir"
    }
    Write-Step "[DOWNLOAD] Git installer..."
    try {
        Invoke-WebRequestWithRetry -Uri $gitInstaller.DownloadUrl -OutFile $installerPath | Out-Null
    } catch {
        Fail-AndExit "[ERROR] Git installer download failed. Offline installer: $($gitInstaller.ReleaseUrl)"
    }

    $effectiveInstallDir = if ($installDir) { $installDir } else { $defaultInstallDir }
    $infPath = Join-Path $env:TEMP ("git_options_{0}.inf" -f ([guid]::NewGuid().ToString("N")))
    $infContent = @"
[Setup]
Lang=default
Dir=$effectiveInstallDir
Group=Git
NoIcons=0
SetupType=default
Components=gitlfs,assoc,assoc_sh,windowsterminal
Tasks=
EditorOption=VIM
CustomEditorPath=
DefaultBranchOption=main
PathOption=Cmd
SSHOption=OpenSSH
TortoiseOption=false
CURLOption=WinSSL
CRLFOption=CRLFCommitAsIs
BashTerminalOption=MinTTY
GitPullBehaviorOption=Merge
UseCredentialManager=Enabled
PerformanceTweaksFSCache=Enabled
EnableSymlinks=Disabled
EnablePseudoConsoleSupport=Disabled
EnableFSMonitor=Disabled
"@
    Set-Content -Path $infPath -Value $infContent -Encoding ASCII

    Set-StageContext -Stage "Install Git" -OfflineUrl $gitInstaller.ReleaseUrl
    Write-Warn "[INFO] Installing Git using the official Git for Windows unattended installer path."
    Write-Warn "[INFO] A UAC prompt or installer window may appear. Allow it and do not close this script window."
    Write-Step "[INSTALL] Git..."
    Invoke-ExternalCommand -FilePath $installerPath -Arguments @("/VERYSILENT", "/NORESTART", "/NOCANCEL", "/SP-", "/CLOSEAPPLICATIONS", "/RESTARTAPPLICATIONS", "/LOADINF=$infPath") -FailureMessage "[ERROR] Git installation failed."
    Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $infPath -Force -ErrorAction SilentlyContinue
    Set-StageContext -Stage "Verify Git" -OfflineUrl $gitInstaller.ReleaseUrl
    Write-Warn "[INFO] Waiting for Git installation result. This may take a few minutes."
    Write-Step "[VERIFY] Git..."
    return Wait-ForInstallResult -Name "Git" -Commands @("git")
}

function Install-Python {
    $version = Get-PythonLatestStableVersion
    $versionParts = $version.Split('.')
    $defaultInstallDir = Join-Path $env:LOCALAPPDATA ("Programs/Python/Python{0}{1}" -f $versionParts[0], $versionParts[1])
    $installDir = Get-InstallDirectoryChoice -ToolName "Python" -DefaultPath $defaultInstallDir

    if ((Get-Command winget -ErrorAction SilentlyContinue) -and -not $installDir) {
        Set-StageContext -Stage "Install Python Install Manager" -OfflineUrl "https://docs.python.org/3/using/windows.html"
        Write-Warn "[INFO] Installing Python Install Manager, then Python 3."
        Write-Warn "[INFO] A UAC prompt or installer window may appear. Allow it and do not close this script window."
        Write-Step "[INSTALL] Python Install Manager..."
        Invoke-ExternalCommand -FilePath "winget" -Arguments @("install", "9NQ7512CXL7T", "-e", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity") -FailureMessage "[ERROR] Python Install Manager installation failed."

        Refresh-Path
        $pythonManager = Find-PythonManagerExecutable
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
                try {
                    & $pythonManager install --refresh | Out-Null
                } catch {
                    Write-Warn "[WARN] Python command aliases were not refreshed in this terminal."
                }
            } catch {
                Write-Warn "[WARN] Python runtime installation did not finish in this terminal."
            }
        } else {
            Write-Warn "[WARN] Python Install Manager is not visible yet in this terminal."
        }
    } else {
        $arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq [System.Runtime.InteropServices.Architecture]::Arm64) { "arm64" } else { "amd64" }
        $installerName = "python-$version-$arch.exe"
        $url = "https://www.python.org/ftp/python/$version/$installerName"
        $installerPath = Join-Path $env:TEMP $installerName
        $effectiveInstallDir = if ($installDir) { $installDir } else { $defaultInstallDir }

        Set-StageContext -Stage "Download Python installer" -OfflineUrl $url
        if ($installDir) {
            Write-Warn "[INFO] Custom install directory was selected. Using the official Python installer."
            Write-Info "[INFO] Custom Python install directory: $installDir"
        } else {
            Write-Warn "[INFO] winget is not available. Falling back to the official Python installer."
        }
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
            "InstallLauncherAllUsers=0",
            "TargetDir=$effectiveInstallDir"
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

    function Test-IsWindowsStoreAlias {
        param([string]$Path)

        if ([string]::IsNullOrWhiteSpace($Path)) {
            return $false
        }

        return $Path -like "*\AppData\Local\Microsoft\WindowsApps\python*.exe"
    }

    foreach ($commandName in $Commands) {
        $command = Get-Command $commandName -ErrorAction SilentlyContinue
        if ($command) {
            try {
                if (Test-IsWindowsStoreAlias -Path $command.Source) {
                    Write-Host "[FAIL] $Name points to the Microsoft Store alias, not a real runtime." -ForegroundColor Red
                    Write-Host "     Path: $($command.Source)"
                    return
                }

                $versionLine = (& $command.Name --version 2>&1 | Select-Object -First 1)
                if ($null -eq $versionLine) {
                    throw "No version output"
                }

                $version = $versionLine.ToString().Trim()
                if ([string]::IsNullOrWhiteSpace($version) -or $version -match "Microsoft Store" -or $version -match "ms-windows-store") {
                    throw "Invalid version output"
                }
            } catch {
                Write-Host "[FAIL] $Name is present in PATH, but the runtime is not usable yet." -ForegroundColor Red
                Write-Host "     Path: $($command.Source)"
                return
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








