<#
.SYNOPSIS
  Retrains the dart-tip model end to end: one command, no questions.

.DESCRIPTION
  1. Pretrains on DeepDarts (data/deepdarts), unless runs/pretrain/best.pt
     already exists and -Pretrain is not given. DeepDarts is face-on: it
     teaches what a board and a dart look like, not where a tip is from the side.
  2. If data/dartscribe is there, fine-tunes on it (side-view cameras), unless
     runs/sideview/best.pt already exists and -Pretrain is not given.
  3. If there are exports in data/oche/*.zip, fine-tunes on them (together with
     dartscribe, so the side view is not forgotten) and evaluates on the
     held-out test split of your board. With no exports, the result of step 2
     (or 1) is the model.
  4. Exports <Name>.onnx and its model card.
  5. With -Publish, uploads a draft release; the last two steps (commit the
     card, run the workflow) are printed for you.

  Everything runs from ml/ with ml/.venv (see README.md, "Setup").

.EXAMPLE
  .\retrain.ps1 -Name tips-v1 -Publish          # v1: DeepDarts only
.EXAMPLE
  .\retrain.ps1 -Name tips-v2 -Publish          # fine-tune on data/oche/*.zip
.EXAMPLE
  .\retrain.ps1 -Name tips-v3 -Pretrain         # redo DeepDarts pretraining too
#>
param(
    [Parameter(Mandatory = $true)] [ValidatePattern('^[a-z0-9][a-z0-9.-]{0,40}$')] [string]$Name,
    [switch]$Pretrain,
    [int]$PretrainEpochs = 40,
    [int]$FinetuneEpochs = 60,
    [int]$OcheRepeat = 1,
    # Each worker holds about 0.7 GB; four ran this machine out of memory once.
    [int]$Workers = 2,
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw 'ml/.venv is missing: see README.md, "Setup (once)".' }

function Step([string]$title, [string[]]$arguments) {
    Write-Host "`n== $title" -ForegroundColor Cyan
    Write-Host "   python $($arguments -join ' ')"
    & $python @arguments
    if ($LASTEXITCODE -ne 0) { throw "$title failed (exit $LASTEXITCODE)" }
}

$pretrained = 'runs/pretrain/best.pt'
if ($Pretrain -or -not (Test-Path $pretrained)) {
    if (-not (Test-Path 'data/deepdarts')) { throw 'data/deepdarts is missing: see README.md, "Data".' }
    Step 'Pretrain on DeepDarts' @('-m', 'oche_ml.train', '--deepdarts', 'data/deepdarts', '--epochs', $PretrainEpochs, '--workers', $Workers, '--out', 'runs/pretrain')
    Step 'Evaluate on held-out DeepDarts sessions' @('-m', 'oche_ml.evaluate', '--checkpoint', $pretrained, '--deepdarts', 'data/deepdarts')
}

$checkpoint = $pretrained
$sideData = @()
if (Test-Path 'data/dartscribe/throws') {
    $sideData = @('--dartscribe', 'data/dartscribe')
    $sideview = 'runs/sideview/best.pt'
    if ($Pretrain -or -not (Test-Path $sideview)) {
        Step 'Fine-tune on side-view cameras (dartscribe)' (@('-m', 'oche_ml.train') + $sideData + @('--init', $pretrained,
            '--epochs', 40, '--lr', '3e-4', '--workers', $Workers, '--out', 'runs/sideview'))
        Step 'Evaluate on held-out dartscribe sessions' (@('-m', 'oche_ml.evaluate', '--checkpoint', $sideview) + $sideData)
    }
    $checkpoint = $sideview
} else {
    Write-Host "`nNo data/dartscribe: no side-view data, see README.md." -ForegroundColor Yellow
}

$exports = @(Get-ChildItem 'data/oche/*.zip' -ErrorAction SilentlyContinue)
if ($exports.Count -gt 0) {
    Write-Host "`n$($exports.Count) export(s) of your board in data/oche" -ForegroundColor Cyan
    Step 'Fine-tune on your board' (@('-m', 'oche_ml.train', '--oche', 'data/oche/*.zip') + $sideData + @('--init', $checkpoint,
        '--epochs', $FinetuneEpochs, '--lr', '3e-4', '--oche-repeat', $OcheRepeat, '--workers', $Workers, '--out', "runs/$Name"))
    $checkpoint = "runs/$Name/best.pt"
    Step 'Evaluate on held-out visits of your board' @('-m', 'oche_ml.evaluate', '--checkpoint', $checkpoint, '--oche', 'data/oche/*.zip')
    Step 'Draw its answers on your photographs' @('-m', 'oche_ml.preview', '--oche', 'data/oche/*.zip', '--checkpoint', $checkpoint, '--out', "runs/$Name/preview")
} else {
    Write-Host "`nNo exports in data/oche: the model is $checkpoint." -ForegroundColor Yellow
}

Step 'Export to ONNX' @('-m', 'oche_ml.export', '--checkpoint', $checkpoint, '--name', $Name)

if ($Publish) {
    Step 'Upload a draft release' @('-m', 'oche_ml.publish', '--name', $Name)
} else {
    Write-Host "`nTo release it: .\retrain.ps1 was run without -Publish; run  python -m oche_ml.publish --name $Name" -ForegroundColor Yellow
}
