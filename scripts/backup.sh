#backup.sh = กันข้อมูลหาย,
# backup.sh — สำรองข้อมูลอัตโนมัติ
# ตัวนี้คือสิ่งที่ launchd เรียกใช้ทุก 4 ชั่วโมงตามที่ตั้งไว้ก่อนหน้านี้ (หรือรันเองได้ตลอดอย่างที่ผมเพิ่งรันให้ก่อนหน้านี้) ทำ 3 อย่าง:
# 1. snapshot ฐานข้อมูลแบบปลอดภัย ด้วยคำสั่ง VACUUM INTO — คัดลอกข้อมูลได้ถูกต้องแม้เซิร์ฟเวอร์กำลังเขียนข้อมูลอยู่พอดี (ต่างจากการก็อปปี้ไฟล์ตรงๆ ที่เสี่ยงได้ไฟล์เสีย)
# 2. dump เป็น .sql อ่านด้วยตาเปล่าได้ กู้คืนง่ายถ้าจำเป็น
# 3. ก็อปรูปสินค้าทั้งหมด จาก public/uploads/ ไปด้วย
# แล้วเก็บไว้ที่ ~/mini-pos-backups/<วันที่_เวลา>/ — เก็บย้อนหลังแค่ 30 ชุดล่าสุด ที่เก่ากว่านั้นลบทิ้งอัตโนมัติ


#!/bin/bash
set -euo pipefail

PROJECT_DIR="/Users/suphakritouamsiri/mini-pos"
DB_PATH="$PROJECT_DIR/server/data/pos.db"
UPLOADS_DIR="$PROJECT_DIR/public/uploads"
BACKUP_DIR="$HOME/mini-pos-backups"
KEEP=30

if [ ! -f "$DB_PATH" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') skip: no database yet at $DB_PATH"
  exit 0
fi

TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
DEST="$BACKUP_DIR/$TIMESTAMP"
mkdir -p "$DEST"

# VACUUM INTO takes a consistent snapshot even while the server is actively
# writing (WAL mode) — safe, unlike a plain file copy which can grab a
# half-written page and produce a corrupt backup.
sqlite3 "$DB_PATH" "VACUUM INTO '$DEST/pos.db'"
sqlite3 "$DB_PATH" ".dump" > "$DEST/pos.sql"

if [ -d "$UPLOADS_DIR" ]; then
  cp -R "$UPLOADS_DIR" "$DEST/uploads"
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') backup completed: $DEST"

# Keep only the most recent $KEEP backups
cd "$BACKUP_DIR"
ls -1dt */ 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  echo "$(date '+%Y-%m-%d %H:%M:%S') pruning old backup: $old"
  rm -rf "$old"
done
