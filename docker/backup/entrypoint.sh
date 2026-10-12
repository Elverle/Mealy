#!/bin/sh
# Entrypoint del servizio `backup`: pianifica backup.sh con il crond di busybox e resta in primo piano.
set -eu

BACKUP_CRON="${BACKUP_CRON:-0 3 * * *}"

mkdir -p /backups
# L'output del job va sullo stdout del processo 1 (crond), cioè nei log del container.
echo "${BACKUP_CRON} sh /opt/backup/backup.sh daily > /proc/1/fd/1 2>&1" > /etc/crontabs/root

echo "[backup] pianificato: '${BACKUP_CRON}' (fuso ${TZ:-UTC}), conservati gli ultimi ${BACKUP_KEEP:-7} dump"
exec crond -f -l 8 -L /dev/stdout
