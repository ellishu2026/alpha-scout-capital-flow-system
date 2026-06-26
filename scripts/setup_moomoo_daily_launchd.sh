#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/Users/ellislunhugmail.com/alpha-scout-capital-flow-system"
LABEL="com.ellis.alphascout.moomoo-daily"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
UID_VALUE="$(id -u)"

cd "$PROJECT_DIR"
mkdir -p logs "${HOME}/Library/LaunchAgents"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${PROJECT_DIR}/scripts/run_moomoo_daily_collection_auto.sh</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>

  <key>StandardOutPath</key>
  <string>${PROJECT_DIR}/logs/launchd_moomoo_daily.out.log</string>

  <key>StandardErrorPath</key>
  <string>${PROJECT_DIR}/logs/launchd_moomoo_daily.err.log</string>

  <key>RunAtLoad</key>
  <false/>

  <key>StartCalendarInterval</key>
  <array>
    <dict>
      <key>Weekday</key>
      <integer>2</integer>
      <key>Hour</key>
      <integer>8</integer>
      <key>Minute</key>
      <integer>30</integer>
    </dict>
    <dict>
      <key>Weekday</key>
      <integer>3</integer>
      <key>Hour</key>
      <integer>8</integer>
      <key>Minute</key>
      <integer>30</integer>
    </dict>
    <dict>
      <key>Weekday</key>
      <integer>4</integer>
      <key>Hour</key>
      <integer>8</integer>
      <key>Minute</key>
      <integer>30</integer>
    </dict>
    <dict>
      <key>Weekday</key>
      <integer>5</integer>
      <key>Hour</key>
      <integer>8</integer>
      <key>Minute</key>
      <integer>30</integer>
    </dict>
    <dict>
      <key>Weekday</key>
      <integer>6</integer>
      <key>Hour</key>
      <integer>8</integer>
      <key>Minute</key>
      <integer>30</integer>
    </dict>
    <dict>
      <key>Weekday</key>
      <integer>2</integer>
      <key>Hour</key>
      <integer>10</integer>
      <key>Minute</key>
      <integer>0</integer>
    </dict>
    <dict>
      <key>Weekday</key>
      <integer>3</integer>
      <key>Hour</key>
      <integer>10</integer>
      <key>Minute</key>
      <integer>0</integer>
    </dict>
    <dict>
      <key>Weekday</key>
      <integer>4</integer>
      <key>Hour</key>
      <integer>10</integer>
      <key>Minute</key>
      <integer>0</integer>
    </dict>
    <dict>
      <key>Weekday</key>
      <integer>5</integer>
      <key>Hour</key>
      <integer>10</integer>
      <key>Minute</key>
      <integer>0</integer>
    </dict>
    <dict>
      <key>Weekday</key>
      <integer>6</integer>
      <key>Hour</key>
      <integer>10</integer>
      <key>Minute</key>
      <integer>0</integer>
    </dict>
  </array>
</dict>
</plist>
PLIST

launchctl bootout "gui/${UID_VALUE}" "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap "gui/${UID_VALUE}" "$PLIST_PATH"
launchctl enable "gui/${UID_VALUE}/${LABEL}"

echo "Installed launchd job: ${LABEL}"
echo "Plist: ${PLIST_PATH}"
echo
echo "Useful next commands:"
echo "launchctl print gui/\$(id -u)/${LABEL} | head -80"
echo "launchctl kickstart -k gui/\$(id -u)/${LABEL}"
echo "tail -180 logs/moomoo_daily_collection_\$(date +%Y-%m-%d).log"
