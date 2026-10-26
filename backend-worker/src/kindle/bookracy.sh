#!/bin/sh
# Bookracy for Kindle — search and download books straight to a jailbroken Kindle.
# Runs in kterm. Powered entirely by the Bookracy backend (search + download +
# caching all happen server-side); this client is just a thin terminal UI.
#
# __API_URL__ is replaced with the live backend origin when this file is served
# from /kindle/bookracy.sh, so the installed copy is already pointed at the API.

API_URL="__API_URL__"
BASE_DIR="/mnt/us"
SCRIPT_DIR="$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")"
CONFIG_FILE="$SCRIPT_DIR/bookracy_config"
RESULTS_FILE="/tmp/bookracy_results.txt"
RESULTS_PER_PAGE=20
KINDLE_DOCUMENTS="$BASE_DIR/documents"
TAB="$(printf '\t')"

# User overrides (download folder, results per page, backend url) live here.
[ -f "$CONFIG_FILE" ] && . "$CONFIG_FILE"

save_config() {
    {
        echo "KINDLE_DOCUMENTS=\"$KINDLE_DOCUMENTS\""
        echo "API_URL=\"$API_URL\""
        echo "RESULTS_PER_PAGE=\"$RESULTS_PER_PAGE\""
    } > "$CONFIG_FILE"
}

clear_screen() {
    clear 2>/dev/null || printf '\033[H\033[2J'
}

banner() {
    clear_screen
    echo "=================================="
    echo "        Bookracy  (Kindle)        "
    echo "=================================="
    echo ""
}

# Percent-encode a string for a query parameter, byte-accurate so UTF-8 (accented
# / non-English titles) survives. awk under LC_ALL=C treats the input as raw
# bytes, so each UTF-8 byte is encoded individually; spaces become '+'.
urlencode() {
    printf '%s' "$1" | LC_ALL=C awk '
        BEGIN {
            for (i = 0; i < 256; i++) ord[sprintf("%c", i)] = i
            safe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~"
            for (i = 1; i <= length(safe); i++) is_safe[substr(safe, i, 1)] = 1
        }
        {
            n = length($0)
            for (i = 1; i <= n; i++) {
                c = substr($0, i, 1)
                if (c == " ") printf "+"
                else if (is_safe[c]) printf "%s", c
                else printf "%%%02X", ord[c]
            }
        }
    '
}

sanitize_filename() {
    echo "$1" | sed -e 's/[^[:alnum:]._-]/_/g' | cut -c1-120
}

download_book() {
    _md5="$1"
    _ext="$2"
    _title="$3"

    if [ -z "$_md5" ]; then
        echo "Invalid selection."
        return 1
    fi

    if [ ! -d "$KINDLE_DOCUMENTS" ]; then
        mkdir -p "$KINDLE_DOCUMENTS" 2>/dev/null || {
            echo "Can't create download folder: $KINDLE_DOCUMENTS"
            return 1
        }
    fi
    if [ ! -w "$KINDLE_DOCUMENTS" ]; then
        echo "No write permission in $KINDLE_DOCUMENTS"
        return 1
    fi

    _name="$(sanitize_filename "$_title")"
    [ -z "$_name" ] && _name="$_md5"
    [ -n "$_ext" ] && _name="$_name.$_ext"

    # The filename in the URL only drives server-side MIME detection, so it just
    # has to carry the right extension; the real file is resolved from the md5.
    _urlname="book"
    [ -n "$_ext" ] && _urlname="book.$_ext"

    _dest="$KINDLE_DOCUMENTS/$_name"

    echo ""
    echo "Downloading: $_title"
    echo "Saving to:   $_dest"
    echo ""
    if curl -f -# -L -o "$_dest" "$API_URL/download/$_md5/$_urlname"; then
        echo ""
        echo "Done. Saved to $_dest"
        return 0
    fi

    rm -f "$_dest" 2>/dev/null
    echo ""
    echo "Download failed (the book may be temporarily unavailable). Try another."
    return 1
}

search_menu() {
    query=""
    page=1

    while true; do
        if [ -z "$query" ]; then
            banner
            printf "Enter search query (or q to go back): "
            read -r query
            case "$query" in
                ""|q|Q) return 0 ;;
            esac
            page=1
        fi

        banner
        echo "Searching: $query  (page $page) ..."
        enc="$(urlencode "$query")"
        curl -s -L "$API_URL/api/books?format=text&limit=$RESULTS_PER_PAGE&page=$page&query=$enc" > "$RESULTS_FILE" 2>/dev/null

        first="$(head -n 1 "$RESULTS_FILE" 2>/dev/null | cut -f1)"
        count="$(grep -c . "$RESULTS_FILE" 2>/dev/null || echo 0)"

        banner
        echo "Query: $query     Page: $page"
        echo "----------------------------------"
        if [ "$first" = "ERR" ]; then
            echo "Search error. Please try again."
            count=0
        elif [ "$count" -eq 0 ]; then
            echo "No results found."
        else
            i=1
            while IFS="$TAB" read -r md5 ext size lang author title; do
                [ -z "$md5" ] && continue
                printf "%2d. %s\n" "$i" "$title"
                printf "    %s  -  %s  %s\n" "${author:-Unknown}" "${ext:-?}" "$size"
                i=$((i + 1))
            done < "$RESULTS_FILE"
        fi
        echo "----------------------------------"
        echo "[#]=download   n=next   p=prev   s=new search   q=back"
        printf "Choice: "
        read -r choice

        case "$choice" in
            q|Q) return 0 ;;
            s|S) query="" ;;
            n|N) page=$((page + 1)) ;;
            p|P) [ "$page" -gt 1 ] && page=$((page - 1)) ;;
            ''|*[!0-9]*) echo "Invalid choice."; sleep 1 ;;
            *)
                if [ "$choice" -ge 1 ] && [ "$choice" -le "$count" ]; then
                    line="$(sed -n "${choice}p" "$RESULTS_FILE")"
                    sel_md5="$(printf '%s' "$line" | cut -f1)"
                    sel_ext="$(printf '%s' "$line" | cut -f2)"
                    sel_title="$(printf '%s' "$line" | cut -f6)"
                    download_book "$sel_md5" "$sel_ext" "$sel_title"
                    printf "\nPress Enter to continue..."
                    read -r _
                else
                    echo "Out of range."
                    sleep 1
                fi
                ;;
        esac
    done
}

settings_menu() {
    while true; do
        banner
        echo "Settings"
        echo "----------------------------------"
        echo "1. Download folder : $KINDLE_DOCUMENTS"
        echo "2. Results per page: $RESULTS_PER_PAGE"
        echo "3. Backend URL     : $API_URL"
        echo "q. Back"
        echo ""
        printf "Choice: "
        read -r c
        case "$c" in
            1)
                printf "New folder name (under %s): " "$BASE_DIR"
                read -r d
                if [ -n "$d" ]; then
                    KINDLE_DOCUMENTS="$BASE_DIR/$d"
                    mkdir -p "$KINDLE_DOCUMENTS" 2>/dev/null
                    save_config
                fi
                ;;
            2)
                printf "Results per page (1-50): "
                read -r r
                if [ "$r" -ge 1 ] 2>/dev/null && [ "$r" -le 50 ] 2>/dev/null; then
                    RESULTS_PER_PAGE="$r"
                    save_config
                fi
                ;;
            3)
                printf "Backend URL [%s]: " "$API_URL"
                read -r u
                [ -n "$u" ] && { API_URL="$u"; save_config; }
                ;;
            q|Q) return 0 ;;
            *) ;;
        esac
    done
}

[ -f "$CONFIG_FILE" ] || save_config

while true; do
    banner
    echo "1. Search & download books"
    echo "2. Settings"
    echo "q. Exit"
    echo ""
    printf "Choice: "
    read -r main_choice
    case "$main_choice" in
        1) search_menu ;;
        2) settings_menu ;;
        q|Q) clear_screen; exit 0 ;;
        *) ;;
    esac
done
