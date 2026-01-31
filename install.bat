@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

set VENV_DIR=.venv
set PY=%VENV_DIR%\Scripts\python.exe

if not exist "%PY%" (
  echo [install] Criando venv em %VENV_DIR%...
  py -3.10 -m venv "%VENV_DIR%" 2>nul
  if errorlevel 1 (
    python -m venv "%VENV_DIR%"
  )
)

echo [install] Atualizando pip...
"%PY%" -m pip install --upgrade pip

echo [install] Instalando dependencias...
"%PY%" -m pip install -r requirements.txt

echo [install] Baixando modelo MarianMT PT->EN (Helsinki-NLP/opus-mt-pt-en)...
"%PY%" -c "import os;from transformers import AutoTokenizer, AutoModelForSeq2SeqLM; tok=(os.getenv('HUGGINGFACE_HUB_TOKEN') or os.getenv('HUGGINGFACE_TOKEN') or os.getenv('HF_TOKEN') or '').strip() or None; auth=(tok if tok else False); AutoTokenizer.from_pretrained('Helsinki-NLP/opus-mt-pt-en', token=auth); AutoModelForSeq2SeqLM.from_pretrained('Helsinki-NLP/opus-mt-pt-en', token=auth)"

if not exist ".env" (
  echo.
  if not "%FREESOUND_TOKEN%"=="" (
    > .env echo FREESOUND_TOKEN=%FREESOUND_TOKEN%
    echo [install] .env criado a partir da variavel de ambiente FREESOUND_TOKEN.
  ) else (
    echo [install] FREESOUND_TOKEN nao definido. Crie um arquivo .env depois.
  )
)

echo.
echo [install] OK.
endlocal
exit /b 0
