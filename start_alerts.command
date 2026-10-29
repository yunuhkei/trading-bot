#!/bin/bash
# Mac: double-click this file to start your BUY/SELL alerts. Close the window to stop.
cd "$(dirname "$0")"
echo "Installing / checking the bot's parts (first time takes a minute)..."
python3 -m pip install -q -r requirements.txt
python3 -m bot alerts
