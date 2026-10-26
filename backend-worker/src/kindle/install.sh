#!/bin/sh
# Bookracy for Kindle — installer.
# Installs a small Bookracy search/download app into KUAL on a jailbroken Kindle.
# Everything (search, download resolution, caching) is powered by the Bookracy
# backend, so there are no third-party mirrors to configure here.
#
# Install on the Kindle (in kterm):
#     curl __API_URL__/kindle/install.sh | sh
#
# __API_URL__ is replaced with the live backend origin when this file is served.

set -e

API_URL="__API_URL__"
INSTALL_DIR="/mnt/us/extensions/bookracy"
BIN_DIR="$INSTALL_DIR/bin"
CONFIG_FILE="$BIN_DIR/bookracy_config"
TEMP_CONFIG="/mnt/us/bookracy_config.bak"

if ! { [ -f "/etc/prettyversion.txt" ] || [ -d "/mnt/us" ] || pgrep "lipc-daemon" >/dev/null 2>&1; }; then
    printf "This doesn't look like a Kindle. Continue anyway? [y/N]: "
    read -r ans
    case "$ans" in
        y|Y) : ;;
        *) exit 1 ;;
    esac
fi

echo "Installing Bookracy for Kindle..."

# Keep the user's settings across reinstalls / updates.
if [ -f "$CONFIG_FILE" ]; then
    cp -f "$CONFIG_FILE" "$TEMP_CONFIG" 2>/dev/null || true
fi

rm -rf "$INSTALL_DIR"
mkdir -p "$BIN_DIR"

# --- KUAL launcher entry -----------------------------------------------------
cat > "$INSTALL_DIR/config.xml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<extension>
    <information>
        <name>Bookracy</name>
        <version>1.0</version>
        <author>Bookracy</author>
        <id>bookracy</id>
    </information>
    <menus>
        <menu type="json" dynamic="true">menu.json</menu>
    </menus>
</extension>
XML

cat > "$INSTALL_DIR/menu.json" <<'JSON'
{
    "items": [
        {"name": "Bookracy", "action": "sh run.sh"}
    ]
}
JSON

cat > "$INSTALL_DIR/run.sh" <<'RUN'
#!/bin/sh
/mnt/us/extensions/kterm/bin/kterm -e "sh /mnt/us/extensions/bookracy/bin/bookracy.sh" -k 1 -o U -s 7
RUN

# --- App itself --------------------------------------------------------------
echo "Downloading app..."
if ! curl -s -L -o "$BIN_DIR/bookracy.sh" "$API_URL/kindle/bookracy.sh"; then
    echo "Failed to download the app from $API_URL" >&2
    exit 1
fi
if [ ! -s "$BIN_DIR/bookracy.sh" ]; then
    echo "Downloaded app was empty — aborting." >&2
    exit 1
fi
chmod +x "$BIN_DIR/bookracy.sh" 2>/dev/null || true

# Restore preserved settings.
if [ -f "$TEMP_CONFIG" ]; then
    mv -f "$TEMP_CONFIG" "$CONFIG_FILE"
fi

echo ""
echo "Done! Open KUAL and tap \"Bookracy\"."
echo "Don't see it yet? Exit and re-enter KUAL (or reboot the Kindle)."
