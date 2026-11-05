#!/bin/sh
# 把整個 git 歷史（所有分支與 tag）打包成單一 bundle 檔，作為重建專案的備案。
# 用法：npm run backup:repo -- <備份資料夾>
# 還原：git clone <bundle 檔> fleet-chronometer，之後 npm install。
# bundle 只含已 commit 的內容；.gitignore 的快取（tools/*/.cache 等）可由各產生器重新抓取。
set -eu

dest="${1:-}"
if [ -z "$dest" ]; then
  echo "用法：npm run backup:repo -- <備份資料夾>（應放在專案以外，例如雲端同步資料夾或外接碟）" >&2
  exit 1
fi

root="$(git rev-parse --show-toplevel)"
mkdir -p "$dest"
dest="$(cd "$dest" && pwd)"
case "$dest/" in
  "$root"/*) rmdir "$dest" 2>/dev/null || true
             echo "備份資料夾不能在專案目錄內：$dest" >&2; exit 1 ;;
esac

if [ -n "$(git -C "$root" status --porcelain)" ]; then
  echo "注意：有未 commit 的變更，這些變更不會進入備份。" >&2
fi

file="$dest/fleet-chronometer-$(date +%Y%m%d-%H%M%S).bundle"
git -C "$root" bundle create "$file" --all
if ! git -C "$root" bundle verify "$file" >/dev/null 2>&1; then
  echo "bundle 驗證失敗：$file" >&2
  exit 1
fi
echo "已建立並驗證：$file"
