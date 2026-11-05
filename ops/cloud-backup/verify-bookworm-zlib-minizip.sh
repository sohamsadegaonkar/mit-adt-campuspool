#!/bin/sh
# Narrow CVE-2023-45853 evidence: Debian Bookworm's zlib1g has no MiniZip.
set -eu
actual="$(dpkg-query -W -f='${Version}' zlib1g)"
test "$actual" = '1:1.2.13.dfsg-1' || { echo 'ZLIB_VERSION_UNREVIEWED' >&2; exit 1; }
for pkg in minizip libminizip1 libminizip1t64; do
  if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed'; then
    echo 'MINIZIP_PACKAGE_PRESENT' >&2; exit 1
  fi
done
for dir in /usr/lib /usr/local/lib /opt/campuspool; do
  [ -d "$dir" ] || continue
  hits="$(find "$dir" \( -iname 'libminizip*' -o -name minizip -o -name zip.c \) -print)"
  [ -z "$hits" ] || { echo 'MINIZIP_FILE_PRESENT' >&2; exit 1; }
done
zlib="$(find /usr/lib -type f -name 'libz.so.1.2.*' -print -quit)"
test -n "$zlib" && test -f "$zlib" || { echo 'ZLIB_LIBRARY_MISSING' >&2; exit 1; }
if grep -a -q 'zipOpenNewFileInZip4_64' "$zlib"; then
  echo 'VULNERABLE_MINIZIP_SYMBOL_PRESENT' >&2; exit 1
fi
echo 'BOOKWORM_ZLIB_MINIZIP_NOT_BUILT_PASS'
