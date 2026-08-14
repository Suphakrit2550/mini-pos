#!/bin/bash
# backup.sh — สำรองข้อมูลอัตโนมัติ (thin wrapper เรียก scripts/backup.js)
# launchd เรียกใช้ทุก 4 ชั่วโมง — ดึงข้อมูลทุกตารางจาก Supabase มาเก็บเป็น
# JSON snapshot พร้อมก็อปรูปสินค้าจาก public/uploads/ ไปด้วย
# แล้วเก็บไว้ที่ ~/mini-pos-backups/<วันที่_เวลา>/ (เก็บย้อนหลัง 30 ชุดล่าสุด)
set -euo pipefail

PROJECT_DIR="/Users/suphakritouamsiri/mini-pos"
cd "$PROJECT_DIR"
node --env-file=.env scripts/backup.js
