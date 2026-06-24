#!/usr/bin/env bash
set -euo pipefail

# This uses the Mac's current system timezone.
# Make sure Mac timezone is Singapore if you want Singapore 08:00.

sudo pmset repeat wakeorpoweron MTWRFSU 08:00:00
pmset -g sched
