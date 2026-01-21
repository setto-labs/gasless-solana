#!/bin/bash

cd "$(dirname "$0")/../.."

echo ""
echo "========================================"
echo "    Verifiable Build (solana-verify)"
echo "========================================"
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed or not running"
    exit 1
fi

# Check solana-verify
if ! command -v solana-verify &> /dev/null; then
    echo "Error: solana-verify is not installed"
    echo "Install with: cargo install solana-verify"
    exit 1
fi

# Get program name from Cargo.toml
PROGRAM_NAME=$(grep '^name = ' Cargo.toml | head -1 | sed 's/name = "\([^"]*\)"/\1/' | tr '-' '_')

echo "Building program: $PROGRAM_NAME"
echo ""

# Run verifiable build using solana-verify
solana-verify build --library-name "$PROGRAM_NAME"

if [ $? -ne 0 ]; then
    echo ""
    echo "Error: Build failed"
    exit 1
fi

echo ""
echo "========================================"
echo "    Build Complete"
echo "========================================"
echo ""

# Get program name from Cargo.toml
PROGRAM_NAME=$(grep '^name = ' Cargo.toml | head -1 | sed 's/name = "\([^"]*\)"/\1/' | tr '-' '_')
SO_FILE="target/deploy/${PROGRAM_NAME}.so"

if [ ! -f "$SO_FILE" ]; then
    echo "Error: Built .so file not found: $SO_FILE"
    exit 1
fi

# Calculate hash
HASH=$(sha256sum "$SO_FILE" | awk '{print $1}')

echo "Program: $PROGRAM_NAME"
echo "File:    $SO_FILE"
echo "Size:    $(ls -lh "$SO_FILE" | awk '{print $5}')"
echo ""
echo "========================================"
echo "    Verifiable Build Hash"
echo "========================================"
echo ""
echo "SHA256: $HASH"
echo ""
echo "Save this hash for verification after deployment."
echo ""
