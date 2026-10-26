#!/usr/bin/env bash
# End-to-end test of the community uploads feature against a RUNNING worker.
#
# Local:
#   cd backend-worker
#   npx wrangler d1 migrations apply DB --local
#   npx wrangler dev            # (needs .dev.vars with TELEGRAM_*/DISCORD_* so uploads are accepted)
#   ./tests/community-e2e.sh    # in another shell
#
# Against a deployed instance:  BASE=https://api.bookracy.com ./tests/community-e2e.sh
#
# Exercises: account create -> upload (md5-verified, streamed) -> listing ->
# download (counter) -> popular sort -> set username -> leaderboard -> profile.
set -euo pipefail
BASE="${BASE:-http://localhost:8787}"
ADMIN="${ADMIN:-local-admin-test-key}"

pass() { printf '  \033[32mok\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1" >&2; exit 1; }
jget() { python3 -c 'import sys,json;d=json.load(sys.stdin)
for k in sys.argv[1].split("."):
    d=d[int(k)] if k.lstrip("-").isdigit() else d[k]
print(d)' "$1"; }

md5hex() { if command -v md5 >/dev/null 2>&1; then md5 -q "$1"; else md5sum "$1" | cut -d' ' -f1; fi; }
sha256hex() { if command -v shasum >/dev/null 2>&1; then printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1; else printf '%s' "$1" | sha256sum | cut -d' ' -f1; fi; }

printf '\n# Community E2E against %s\n' "$BASE"

printf '\n[1] create account\n'
KEY=$(curl -fsS -X POST "$BASE/api/account" | jget id)
[ "${#KEY}" -eq 64 ] && pass "account key minted" || fail "bad account key: $KEY"

printf '\n[2] build a ~1.5MB test file\n'
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
printf 'PK\x03\x04' > "$TMP"            # ZIP signature so it passes the .epub content guard
head -c 1500000 /dev/urandom >> "$TMP"
MD5=$(md5hex "$TMP")
pass "md5=$MD5 size=$(wc -c < "$TMP" | tr -d ' ')"

printf '\n[3] upload (Bearer + raw body, md5 verified server-side)\n'
UP=$(curl -fsS -X POST "$BASE/api/uploads?md5=$MD5&ext=epub&title=E2E%20Test%20Book&author=Tester&lang=en&year=2026" \
  -H "Authorization: Bearer $KEY" --data-binary @"$TMP")
echo "$UP"
[ "$(echo "$UP" | jget ok)" = "True" ] && pass "upload accepted" || fail "upload rejected"
[ "$(echo "$UP" | jget md5)" = "$MD5" ] && pass "returned md5 matches" || fail "md5 mismatch"

printf '\n[4] integrity: a lying md5 must be rejected\n'
BADCODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "$BASE/api/uploads?md5=ffffffffffffffffffffffffffffffff&ext=epub&title=Liar" \
  -H "Authorization: Bearer $KEY" --data-binary @"$TMP")
[ "$BADCODE" = "400" ] && pass "md5 mismatch rejected (400)" || fail "expected 400, got $BADCODE"

printf '\n[4b] content guard: a disguised executable is rejected\n'
EXEFILE="$(mktemp)"
printf 'MZ' > "$EXEFILE"
head -c 200 /dev/zero >> "$EXEFILE"
EXEMD5=$(md5hex "$EXEFILE")
GUARD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/uploads?md5=$EXEMD5&ext=epub&title=Sneaky" -H "Authorization: Bearer $KEY" --data-binary @"$EXEFILE")
rm -f "$EXEFILE"
[ "$GUARD" = "400" ] && pass "disguised executable rejected (400)" || fail "content guard didn't reject (HTTP $GUARD)"

printf '\n[5] listing (recent) contains the upload\n'
curl -fsS "$BASE/api/uploads?sort=recent" | grep -q "$MD5" && pass "found in listing" || fail "missing from listing"

printf '\n[5b] community uploads surface in /api/books (badged)\n'
curl -fsS "$BASE/api/books?query=E2E%20Test%20Book&lang=all" | MD5="$MD5" python3 -c 'import sys,json,os
md5=os.environ["MD5"]; res=json.load(sys.stdin).get("results",[]); hit=[r for r in res if r.get("md5")==md5]
assert hit, "uploaded book not in /api/books results"
assert hit[0].get("community") is True, "search result missing community flag"' && pass "in main search, badged community" || fail "search integration failed"

printf '\n[6] download the book (fires the counter)\n'
DLCODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/download/$MD5/E2E%20Test%20Book.epub")
[ "$DLCODE" = "200" ] && pass "download 200" || fail "download HTTP $DLCODE"

printf '\n[7] popular sort shows downloads >= 1\n'
sleep 1
DLN=$(curl -fsS "$BASE/api/uploads?sort=popular" | MD5="$MD5" python3 -c 'import sys,json,os
ups=json.load(sys.stdin)["uploads"]; m=os.environ["MD5"]
b=[u for u in ups if u["md5"]==m]; print(b[0]["downloads"] if b else -1)')
[ "$DLN" -ge 1 ] && pass "downloads=$DLN" || fail "counter not incremented (got $DLN)"

printf '\n[8] set username\n'
UNAME="t_${MD5:0:12}"   # unique per run (local D1 persists across runs)
UN=$(curl -fsS -X PUT "$BASE/api/profile" -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' -d "{\"username\":\"$UNAME\"}")
echo "$UN"
[ "$(echo "$UN" | jget username)" = "$UNAME" ] && pass "username set ($UNAME)" || fail "username not set"

printf '\n[9] leaderboard reflects the contributor\n'
LB=$(curl -fsS "$BASE/api/leaderboard")
echo "$LB" | grep -q "$UNAME" && pass "on leaderboard" || fail "not on leaderboard"

printf '\n[10] profile lists my upload + stats\n'
PROF=$(curl -fsS "$BASE/api/profile" -H "Authorization: Bearer $KEY")
[ "$(echo "$PROF" | jget books)" = "1" ] && pass "profile books=1" || fail "profile books wrong"
echo "$PROF" | grep -q "$MD5" && pass "profile lists upload" || fail "profile missing upload"

printf '\n[11] edit metadata on my own upload (PATCH)\n'
curl -fsS -X PATCH "$BASE/api/uploads/$MD5" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"title":"E2E Edited Title","author":"Tester2"}' >/dev/null
NEWT=$(curl -fsS "$BASE/api/profile" -H "Authorization: Bearer $KEY" | python3 -c 'import sys,json;u=json.load(sys.stdin)["uploads"];print(u[0]["title"] if u else "")')
[ "$NEWT" = "E2E Edited Title" ] && pass "metadata updated" || fail "edit failed (got: $NEWT)"

printf '\n[12] set a cover, then it serves\n'
COVER="$(mktemp)"
python3 -c 'import base64,sys;open(sys.argv[1],"wb").write(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="))' "$COVER"
curl -fsS -X POST "$BASE/api/uploads/$MD5/cover" -H "Authorization: Bearer $KEY" -H 'Content-Type: image/png' --data-binary @"$COVER" >/dev/null
rm -f "$COVER"
HASCOVER=$(curl -fsS "$BASE/api/profile" -H "Authorization: Bearer $KEY" | python3 -c 'import sys,json;u=json.load(sys.stdin)["uploads"];print("1" if (u and u[0]["book_image"]) else "0")')
[ "$HASCOVER" = "1" ] && pass "cover recorded on the book" || fail "cover not recorded"
CC=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/cover/$MD5/thumbnail.jpg")
[ "$CC" = "200" ] && pass "cover served (HTTP $CC)" || fail "cover not served (HTTP $CC)"

printf '\n[13] ownership: a stranger cannot edit/delete my upload\n'
STRANGER=$(curl -fsS -X POST "$BASE/api/account" | jget id)
SC=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/uploads/$MD5" -H "Authorization: Bearer $STRANGER")
[ "$SC" = "403" ] && pass "stranger delete blocked (403)" || fail "ownership not enforced (HTTP $SC)"

printf '\n[14] admin ban hides the contributor from the public listing\n'
CUID=$(sha256hex "$KEY")
curl -fsS -X POST "$BASE/api/admin/users/$CUID/ban" -H "X-Admin-Key: $ADMIN" -H 'Content-Type: application/json' -d '{"banned":true}' >/dev/null
INLIST=$(curl -fsS "$BASE/api/uploads" | grep -c "$MD5" || true)
[ "$INLIST" = "0" ] && pass "banned contributor hidden" || fail "banned book still listed"
BANNEDUP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/uploads?md5=$(md5hex "$TMP")&ext=epub&title=Blocked" -H "Authorization: Bearer $KEY" --data-binary @"$TMP")
[ "$BANNEDUP" = "403" ] && pass "banned contributor can't upload (403)" || fail "banned upload not blocked (HTTP $BANNEDUP)"
curl -fsS -X POST "$BASE/api/admin/users/$CUID/ban" -H "X-Admin-Key: $ADMIN" -H 'Content-Type: application/json' -d '{"banned":false}' >/dev/null
pass "unbanned"

printf '\n[15] admin endpoints are gated without the key\n'
GC=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/users")
if [ "$GC" = "403" ] || [ "$GC" = "404" ]; then pass "admin gated (HTTP $GC)"; else fail "admin NOT gated (HTTP $GC)"; fi

printf '\n[16] admin delete the book\n'
curl -fsS -X DELETE "$BASE/api/admin/uploads/$MD5" -H "X-Admin-Key: $ADMIN" >/dev/null
LEFT=$(curl -fsS "$BASE/api/profile" -H "Authorization: Bearer $KEY" | jget books)
[ "$LEFT" = "0" ] && pass "admin-deleted (profile books=0)" || fail "still present after admin delete ($LEFT)"

printf '\n[17] delete ALL my uploads\n'
curl -fsS -X POST "$BASE/api/uploads?md5=$MD5&ext=epub&title=Readded" -H "Authorization: Bearer $KEY" --data-binary @"$TMP" >/dev/null
DA=$(curl -fsS -X DELETE "$BASE/api/profile/uploads" -H "Authorization: Bearer $KEY" | jget deleted)
[ "$DA" -ge 1 ] && pass "delete-all removed $DA" || fail "delete-all failed ($DA)"

printf '\n\033[32mALL PASSED\033[0m\n'
