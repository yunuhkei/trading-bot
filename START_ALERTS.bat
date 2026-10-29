@echo off
rem Windows: double-click this file to start your BUY/SELL alerts. Close the window to stop.
cd /d "%~dp0"
echo Installing / checking the bot's parts (first time takes a minute)...
python -m pip install -q -r requirements.txt
python -m bot alerts
pause
