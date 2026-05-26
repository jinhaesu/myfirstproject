# myfirstproject MCP 서버 Railway 자동 배포 스크립트
# 사용법:
#   1. 먼저 `! railway login` 으로 인증
#   2. .\deploy.ps1 실행
#
# 옵션:
#   .\deploy.ps1 -BackendUrl "https://my-backend.up.railway.app" -McpApiKey "secret-key"

param(
    [string]$ProjectName = "myfirstproject-mcp",
    [string]$ServiceName = "mcp-server",
    [string]$BackendUrl = "",
    [string]$McpApiKey = "",
    [switch]$SkipDomain = $false
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
    Write-Host "`n>> $msg" -ForegroundColor Cyan
}
function Write-Ok($msg) {
    Write-Host "   OK $msg" -ForegroundColor Green
}
function Write-Warn($msg) {
    Write-Host "   ! $msg" -ForegroundColor Yellow
}

# 1. Railway CLI 체크
Write-Step "Railway CLI 확인"
$cliVer = railway --version 2>$null
if (-not $cliVer) {
    Write-Error "Railway CLI 설치 필요"
    exit 1
}
Write-Ok $cliVer

# 2. 로그인 체크
Write-Step "Railway 로그인 확인"
$whoami = railway whoami 2>&1
if ($whoami -match "Unauthorized") {
    Write-Error "로그인 만료. 메인 채팅에서 ! railway login 실행 후 다시 시도하세요."
    exit 1
}
Write-Ok $whoami

# 3. 환경변수 입력
if (-not $BackendUrl) {
    $BackendUrl = Read-Host "ANALYTICS_API_URL (백엔드 URL, 예: https://myfirstproject-production.up.railway.app)"
}
if (-not $BackendUrl) {
    Write-Error "BackendUrl 필수"
    exit 1
}

if (-not $McpApiKey) {
    Write-Warn "MCP_API_KEY 미지정 -> 랜덤 키 생성"
    $McpApiKey = -join ((1..32) | ForEach-Object { '{0:X}' -f (Get-Random -Max 16) })
    Write-Ok "Generated key: $McpApiKey"
}

# 4. 디렉토리 이동
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir
Write-Ok "Working dir: $scriptDir"

# 5. Project link 또는 create
Write-Step "Railway 프로젝트 연결"
$linkInfo = railway status --json 2>&1 | Out-String
if ($linkInfo -match "Project Token not found" -or $linkInfo -match "not linked" -or $LASTEXITCODE -ne 0) {
    Write-Warn "프로젝트 미연결 -> 새 프로젝트 생성"
    $initOut = railway init --name $ProjectName 2>&1
    Write-Host $initOut
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "init 실패. 기존 프로젝트가 있다면 railway link 로 수동 연결 후 재실행:"
        Write-Warn "  railway link"
        exit 1
    }
    Write-Ok "프로젝트 생성: $ProjectName"
} else {
    Write-Ok "기존 연결 발견"
    Write-Host $linkInfo
}

# 6. 환경변수 설정
Write-Step "환경변수 설정"
railway variables --set "ANALYTICS_API_URL=$BackendUrl" --set "MCP_API_KEY=$McpApiKey" --set "PORT=3002" 2>&1 | Out-Host
Write-Ok "환경변수 설정 완료"

# 7. 배포
Write-Step "Dockerfile 기반 배포 시작 (railway up)"
railway up --detach 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) {
    Write-Warn "배포 명령 실패. 로그 확인: railway logs"
    exit 1
}
Write-Ok "배포 시작됨"

# 8. 도메인 생성
if (-not $SkipDomain) {
    Write-Step "퍼블릭 도메인 생성"
    Start-Sleep -Seconds 5
    $domainOut = railway domain 2>&1 | Out-String
    Write-Host $domainOut
}

# 9. 결과 안내
Write-Step "완료"
Write-Host @"

다음 단계:
1. 빌드/배포 로그:
   railway logs

2. 클라이언트의 .mcp.json 에 등록:
   {
     "mcpServers": {
       "analytics": {
         "url": "https://<생성된 도메인>/mcp/sse?key=$McpApiKey&token=<USER_JWT>"
       }
     }
   }

3. Health check:
   curl https://<생성된 도메인>/health

MCP_API_KEY = $McpApiKey  (안전한 곳에 저장)
"@ -ForegroundColor White
