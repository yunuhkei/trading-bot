@echo off
rem Windows: drag a screenshot onto this file (or double-click and paste the path) to check a coin or stock.
cd /d "%~dp0"
set IMG=%~1
if "%IMG%"=="" set /p IMG=Drag the screenshot into this window and press Enter: 
python -m pip install -q -r requirements.txt
python -m bot chart "%IMG%"
pause
