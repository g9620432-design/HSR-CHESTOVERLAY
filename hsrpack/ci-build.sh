#!/usr/bin/env bash
# Сборка и публикация пакета данных «Персонажи и реликвии» для HSR Chest Overlay.
# Запускается GitHub Actions (.github/workflows/update.yml); локально: HSRPACK_KEY="$(cat private.pem)" bash hsrpack/ci-build.sh
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/.." && pwd)
WORK=${WORK:-${RUNNER_TEMP:-$ROOT/.work}/hsrpack}
SRC=$WORK/hsr-optimizer; OUT=$WORK/out
UPSTREAM=${UPSTREAM:-https://github.com/fribbels/hsr-optimizer.git}
REPO=${GITHUB_REPOSITORY:-}
say() { echo "== $*"; }
out() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1=$2" >> "$GITHUB_OUTPUT" || true; }

if [ -z "${HSRPACK_KEY:-}" ]; then
  if [ "${GITHUB_EVENT_NAME:-}" = push ]; then echo "::warning::Секрет HSRPACK_KEY ещё не добавлен — сборка пропущена. Добавьте его и запустите «Обновление данных» вручную."; out changed 0; exit 0; fi
  echo "::error::Не задан секрет HSRPACK_KEY. Откройте Settings → Secrets and variables → Actions и добавьте его (содержимое файла HSRPACK_KEY.txt)."
  exit 1
fi
if [ -f "$ROOT/app-release.json" ]; then
  # убираем невидимые символы (BOM, U+200B…), которые попадают при вставке текста в редактор GitHub
  node -e 'const fs=require("fs"),f=process.argv[1],s=fs.readFileSync(f,"utf8"),c=s.replace(/[\uFEFF\u200B-\u200D\u2060]/g,""); if(c!==s){fs.writeFileSync(f,c); console.log("== app-release.json: убраны невидимые символы");}' "$ROOT/app-release.json"
  node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!/^\d+\.\d+\.\d+$/.test(j.version||"")) throw new Error("version"); if(!/^https:\/\//.test(j.url||"")) throw new Error("url");' "$ROOT/app-release.json" \
    || { echo "::error::Ошибка в app-release.json — проверьте кавычки, запятые, поле version (например 1.7.0) и ссылку url (https://…)"; exit 1; }
fi
mkdir -p "$WORK"

say "1/4 Скачиваю HSR Optimizer"
rm -rf "$SRC"
git clone -q --depth 1 --filter=blob:none --sparse "$UPSTREAM" "$SRC"
git -C "$SRC" sparse-checkout set --no-cone $(grep -v '^#' "$HERE/sparse.txt" | tr -d '\r')
echo "   commit $(git -C "$SRC" rev-parse --short HEAD)"

say "2/4 Устанавливаю зависимости"
(cd "$SRC" && { npm ci --no-audit --no-fund --loglevel=error || npm install --no-audit --no-fund --loglevel=error; })
[ -d "$WORK/sharp/node_modules/sharp" ] || npm install --no-save --no-audit --no-fund --loglevel=error --prefix "$WORK/sharp" sharp

say "3/4 Собираю пакет"
REL=(); [ -f "$ROOT/app-release.json" ] && REL=(--app-release "$ROOT/app-release.json")
HSRPACK_SHARP="$WORK/sharp/node_modules/sharp" node "$HERE/build.mjs" --src "$SRC" --out "$OUT" "${REL[@]}"
# страница программы (сайт) — https://<ник>.github.io/<репозиторий>/
[ -f "$HERE/landing.html" ] && cp "$HERE/landing.html" "$OUT/index.html"
VERSION=$(node -p 'require(process.argv[1]).version' "$OUT/manifest.json")
out version "$VERSION"; out dir "$OUT"

say "4/4 Сравниваю с опубликованным"
PREV="$WORK/prev-manifest.json"; rm -f "$PREV"
if [ -n "$REPO" ]; then curl -fsSL "https://raw.githubusercontent.com/$REPO/pack/manifest.json?t=$(date +%s)" -o "$PREV" 2>/dev/null || rm -f "$PREV"; fi
# отпечаток: хэш содержимого из версии + хэши всех файлов, кроме meta.json (в нём дата сборки)
FP='const fs=require("fs");const f=(p)=>{try{const m=JSON.parse(fs.readFileSync(p,"utf8"));return [String(m.version).split("-").pop(),m.minApp,m.bridge,...Object.keys(m.files).filter(k=>k!=="meta.json").sort().map(k=>k+":"+m.files[k].sha256)].join("|")}catch(e){return ""}};process.stdout.write(f(process.argv[1])===f(process.argv[2])?"0":"1")'
CHANGED=$(node -e "$FP" "$OUT/manifest.json" "$PREV")
[ "${FORCE:-false}" = "true" ] && CHANGED=1
out changed "$CHANGED"
if [ "$CHANGED" != 1 ]; then say "Изменений нет — публикация не нужна ($VERSION)"; exit 0; fi
say "Новая версия данных: $VERSION"
if [ -z "$REPO" ] || [ -z "${GITHUB_TOKEN:-}" ]; then say "Локальный запуск: пакет в $OUT"; exit 0; fi

# ветка pack (зеркала jsDelivr и raw.githubusercontent) — всегда один коммит, чтобы репозиторий не разрастался
cd "$OUT"; touch .nojekyll
git init -q -b pack
git add -A
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -qm "Данные $VERSION"
git push -qf "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git" pack
rm -rf .git
# сбрасываем кэш jsDelivr, чтобы программа сразу увидела обновление
for f in manifest.json manifest.sig meta.json engine.mjs app.json; do curl -fsS -m 20 "https://purge.jsdelivr.net/gh/${REPO}@pack/$f" >/dev/null 2>&1 || true; done
say "Опубликовано"
