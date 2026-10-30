#!/bin/bash
# Mac: double-click, then drag a screenshot into the window and press Enter.
cd "$(dirname "$0")"
read -r -p "Drag the screenshot into this window and press Enter: " IMG
IMG="${IMG%\"}"; IMG="${IMG#\"}"; IMG="${IMG//\\ / }"
python3 -m pip install -q -r requirements.txt
python3 -m bot chart "$IMG"
