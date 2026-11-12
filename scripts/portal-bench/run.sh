#!/usr/bin/env bash
# Local cBioPortal (Java 7.2.3, ClickHouse mode) against the shared ClickHouse Cloud service,
# connected as bench_portal so every query it sends is attributable in system.query_log.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ../../.env.local; set +a
PORT=${PORT:-8155}
HOST=$(echo "$CLICKHOUSE_BENCH_URL" | sed -E "s|^[a-z:]*//([^:/]+).*|\1|")
umask 077
{
  cat base.properties
  echo "spring.datasource.url=jdbc:clickhouse:https://$HOST:8443/$CLICKHOUSE_PORTAL_DB?ssl=true"
  echo "spring.datasource.username=$CLICKHOUSE_PORTAL_USER"
  echo "spring.datasource.password=$CLICKHOUSE_PORTAL_PASSWORD"
  echo "spring.datasource.driver-class-name=com.clickhouse.jdbc.ClickHouseDriver"
  echo "db.suppress_schema_version_mismatch_errors=false"
  if [ "${BENCH_CACHE:-off}" = on ]; then
    # Redis, as cbioportal.org runs; the image's ehcache option cannot load its XML on Java 21
    echo "persistence.cache_type=redis"
    echo "persistence.cache_type_clickhouse=redis"
    echo "redis.name=bench"
    echo "redis.leader_address=redis://cbio-bench-redis:6379"
    echo "redis.follower_address=redis://cbio-bench-redis-follower:6379"
    echo "redis.database=0"
    echo "redis.password=benchonly"
    echo "redis.ttl_mins=10000"
    echo "redis.clear_on_startup=true"
  else
    echo "persistence.cache_type=no-cache"
  fi
  echo "session.service.url="
} > application.properties
docker rm -f cbio-bench-portal >/dev/null 2>&1 || true
docker rm -f cbio-bench-redis cbio-bench-redis-follower >/dev/null 2>&1 || true
docker network inspect cbio-bench >/dev/null 2>&1 || docker network create cbio-bench >/dev/null
if [ "${BENCH_CACHE:-off}" = on ]; then
  # an empty Redis each start: the portal's cache starts cold
  docker run -d --rm --name cbio-bench-redis --network cbio-bench redis:7.4-alpine redis-server --requirepass benchonly --save "" --appendonly no >/dev/null
  docker run -d --rm --name cbio-bench-redis-follower --network cbio-bench redis:7.4-alpine redis-server --requirepass benchonly --masterauth benchonly \
    --replicaof cbio-bench-redis 6379 --save "" --appendonly no >/dev/null
fi
exec docker run --rm --name cbio-bench-portal -p 0.0.0.0:$PORT:8080 \
  --network cbio-bench -v "$PWD/application.properties:/cbioportal-webapp/application.properties:ro" \
  cbioportal/cbioportal:7.2.3 \
  java -Xms256m -Xmx2g -Djavax.cache.spi.CachingProvider=org.ehcache.jsr107.EhcacheCachingProvider -cp '/cbioportal-webapp:/cbioportal-webapp/lib/*' org.cbioportal.PortalApplication \
    --spring.config.location=file:/cbioportal-webapp/application.properties \
    --authenticate=false --clickhouse_mode=true --spring.profiles.active=clickhouse
