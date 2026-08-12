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
