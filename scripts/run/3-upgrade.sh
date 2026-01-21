#!/bin/bash

cd "$(dirname "$0")/../.."

echo ""
echo "========================================"
echo "    Program Upgrade"
echo "========================================"
echo ""

# Check that .so file exists
SO_FILE="target/deploy/setto_payment.so"
if [ ! -f "$SO_FILE" ]; then
    echo "Error: $SO_FILE not found!"
    echo "Run './scripts/run/1-build.sh' first."
    exit 1
fi

echo "Found: $SO_FILE"
echo ""

# Run upgrade script
npm run upgrade
