#!/bin/sh
# Executado dentro do container: compila /job/main.c e roda cada /job/in/N.
# Saídas em /job/out: compile.txt, compile.code, N.out, N.err, N.code, N.ms
cd /tmp
gcc -x c /job/main.c -o /tmp/a.out -lm -I/job/stub > /job/out/compile.txt 2>&1
echo $? > /job/out/compile.code
[ -x /tmp/a.out ] || exit 0
for f in /job/in/*; do
  [ -e "$f" ] || continue
  n=$(basename "$f")
  t0=$(date +%s%N)
  timeout -k 1 "$TIME_LIMIT" /tmp/a.out < "$f" > /tmp/o 2> /tmp/e
  echo $? > "/job/out/$n.code"
  t1=$(date +%s%N)
  echo $(( (t1 - t0) / 1000000 )) > "/job/out/$n.ms"
  head -c 65536 /tmp/o > "/job/out/$n.out"
  head -c 4096 /tmp/e > "/job/out/$n.err"
  rm -f /tmp/o /tmp/e
done
