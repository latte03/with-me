#!/bin/bash
# 路径与端口的单一来源：cmd/* 一律 source 这里，不要各自复制常量。
# fnOS 把包内 app/ 的内容平铺到 target/（TRIM_APPDEST），所以二进制与前端产物直接在根下。
APP_NAME=with-me
APP_ROOT="${TRIM_APPDEST:-/var/apps/${APP_NAME}/target}"
APP_VAR="${TRIM_PKGVAR:-/var/appdata/${APP_NAME}}"
APP_PORT="${TRIM_SERVICE_PORT:-8099}"
APP_BIN="$APP_ROOT/withme"
APP_WEB="$APP_ROOT/dist"
APP_DATA="$APP_VAR/data"
APP_LOG="$APP_VAR/info.log"
APP_PID="$APP_VAR/app.pid"
# 包用户的 HOME 不存在，进程里任何往 ~ 写东西的行为都会 EACCES
export HOME="$APP_VAR"
