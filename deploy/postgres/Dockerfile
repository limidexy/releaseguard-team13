FROM postgres:17-alpine
# Copy bootstrap into the Linux image instead of executing a host bind-mounted
# script: ZIP permissions and Docker Desktop mounts differ across platforms.
COPY --chmod=0644 deploy/postgres/init.sh /docker-entrypoint-initdb.d/00-init.sh
COPY --chmod=0644 deploy/postgres/init.sql /bootstrap.sql
