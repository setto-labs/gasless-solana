#!/bin/bash

cd "$(dirname "$0")/../.."

echo ""
echo "========================================"
echo "    Generate IDL (anchor build)"
echo "========================================"
echo ""

# Check anchor CLI
if ! command -v anchor &> /dev/null; then
    echo "Error: anchor CLI is not installed"
    exit 1
fi

# Get program name from Cargo.toml
PROGRAM_NAME=$(grep '^name = ' Cargo.toml | head -1 | sed 's/name = "\([^"]*\)"/\1/' | tr '-' '_')

IDL_DIR="target/idl"
IDL_FILE="${IDL_DIR}/${PROGRAM_NAME}.json"

echo "Generating IDL for: $PROGRAM_NAME"
echo ""

# Run anchor build (generates IDL as side effect)
anchor build 2>&1 | tail -5

if [ -s "$IDL_FILE" ] && head -1 "$IDL_FILE" | grep -q "^{"; then
    echo ""
    echo "========================================"
    echo "    IDL Generated Successfully"
    echo "========================================"
    echo ""
    echo "File: $IDL_FILE"
    echo "Size: $(ls -lh "$IDL_FILE" | awk '{print $5}')"
    echo ""

    # List instruction names
    echo "Instructions:"
    grep -A1 '"instructions"' "$IDL_FILE" -A 1000 | grep '"name"' | head -20 | sed 's/.*"name": "\([^"]*\)".*/  - \1/'
    echo ""
else
    echo "Error: IDL generation failed"
    exit 1
fi

echo "Next step: Run './scripts/run/2-build.sh' to create verifiable build"
echo ""
