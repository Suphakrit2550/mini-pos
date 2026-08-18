#!/bin/bash
# backup.sh — สำรองข้อมูลอัตโนมัติ (thin wrapper เรียก scripts/backup.js)
# launchd เรียกใช้ทุก 4 ชั่วโมง — ดึงข้อมูลทุกตารางจาก Supabase มาเก็บเป็น
# JSON snapshot พร้อมก็อปรูปสินค้าจาก public/uploads/ ไปด้วย
# แล้วเก็บไว้ที่ ~/mini-pos-backups/<วันที่_เวลา>/ (เก็บย้อนหลัง 30 ชุดล่าสุด)
set -euo pipefail

PROJECT_DIR="/Users/suphakritouamsiri/mini-pos"
cd "$PROJECT_DIR"
# launchd runs this with a minimal environment that doesn't include
# /usr/local/bin in PATH, so plain `node` fails with "command not found" —
# this silently broke every scheduled backup from 2026-08-14 onward. The
# absolute path sidesteps PATH resolution entirely.
/usr/local/bin/node --env-file=.env scripts/backup.js
