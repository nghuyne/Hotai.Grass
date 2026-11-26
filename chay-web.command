#!/bin/bash
# Mac: nhấp đúp để chạy web HoHai VN (cổng 8080) / 双击运行网站
cd "$(dirname "$0")" || exit 1
PORT=8080
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Chưa cài Node.js. Tải bản LTS tại https://nodejs.org rồi chạy lại."
  echo "  未安装 Node.js。请到 https://nodejs.org 下载 LTS 版本。"
  open "https://nodejs.org/"
  read -r -p "Nhấn Enter để đóng..."
  exit 1
fi
(sleep 2 && open "http://localhost:$PORT") &
node tools/serve.js "$PORT"
