<#
.SYNOPSIS
  Retrains the dart-tip model end to end: one command, no questions.

.DESCRIPTION
  1. Pretrains on DeepDarts (data/deepdarts), unless runs/pretrain/best.pt
     already exists and -Pretrain is not given.
  2. If there are exports in data/oche/*.zip, fine-tunes on them from the
     pretrained weights and evaluates on the held-out test split of your board.
     With no exports, the pretrained model is the result (that is v1).
  3. Exports <Name>.onnx and its model card.
  4. With -Publish, uploads a draft release; the last two steps (commit the
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
    Step 'Pretrain on DeepDarts' @('-m', 'oche_ml.train', '--deepdarts', 'data/deepdarts', '--epochs', $PretrainEpochs, '--out', 'runs/pretrain')
    Step 'Evaluate on held-out DeepDarts sessions' @('-m', 'oche_ml.evaluate', '--checkpoint', $pretrained, '--deepdarts', 'data/deepdarts')
}

$checkpoint = $pretrained
$exports = @(Get-ChildItem 'data/oche/*.zip' -ErrorAction SilentlyContinue)
if ($exports.Count -gt 0) {
    Write-Host "`n$($exports.Count) export(s) of your board in data/oche" -ForegroundColor Cyan
    Step 'Fine-tune on your board' @('-m', 'oche_ml.train', '--oche', 'data/oche/*.zip', '--init', $pretrained,
        '--epochs', $FinetuneEpochs, '--lr', '3e-4', '--oche-repeat', $OcheRepeat, '--out', "runs/$Name")
    $checkpoint = "runs/$Name/best.pt"
    Step 'Evaluate on held-out visits of your board' @('-m', 'oche_ml.evaluate', '--checkpoint', $checkpoint, '--oche', 'data/oche/*.zip')
    Step 'Draw its answers on your photographs' @('-m', 'oche_ml.preview', '--oche', 'data/oche/*.zip', '--checkpoint', $checkpoint, '--out', "runs/$Name/preview")
} else {
    Write-Host "`nNo exports in data/oche: the model is the DeepDarts one." -ForegroundColor Yellow
}

Step 'Export to ONNX' @('-m', 'oche_ml.export', '--checkpoint', $checkpoint, '--name', $Name)

if ($Publish) {
    Step 'Upload a draft release' @('-m', 'oche_ml.publish', '--name', $Name)
} else {
    Write-Host "`nTo release it: .\retrain.ps1 was run without -Publish; run  python -m oche_ml.publish --name $Name" -ForegroundColor Yellow
}
