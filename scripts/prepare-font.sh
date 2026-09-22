#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
font_target="$project_dir/public/fonts/chill-round/ChillRoundFRegular.woff2"
if [ -s "$font_target" ]; then
  exit 0
fi

font_work_dir="$(mktemp -d)"
curl --fail --location --retry 2 --silent --show-error \
  --output "$font_work_dir/font.zip" \
  https://github.com/Warren2060/ChillRound/releases/download/v3.200/ChillRoundF_v3.200.zip
printf '%s  %s\n' 7a061e39cc8f377ce122f0ae68d1fe3ef43d78431388362c61ea8d695722d267 "$font_work_dir/font.zip" | sha256sum --check --status
unzip -p "$font_work_dir/font.zip" ChillRoundF_v3.200/ChillRoundFRegular.ttf > "$font_work_dir/font.ttf"
mkdir -p "$(dirname "$font_target")"
python3 -m fontTools.ttLib.woff2 compress "$font_work_dir/font.ttf" -o "$font_target"
