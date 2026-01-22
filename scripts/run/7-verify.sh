#!/bin/bash

cd "$(dirname "$0")/../.."

echo ""
echo "========================================"
echo "    Verify On-chain Program"
echo "========================================"
echo ""

# Get program name from Cargo.toml
PROGRAM_NAME=$(grep '^name = ' Cargo.toml | head -1 | sed 's/name = "\([^"]*\)"/\1/' | tr '-' '_')
SO_FILE="target/deploy/${PROGRAM_NAME}.so"

# Check local build exists
if [ ! -f "$SO_FILE" ]; then
    echo "Error: Local build not found: $SO_FILE"
    echo "Run './scripts/run/build.sh' first"
    exit 1
fi

# Calculate local hash
LOCAL_HASH=$(sha256sum "$SO_FILE" | awk '{print $1}')

echo "Local Build:"
echo "  File: $SO_FILE"
echo "  SHA256: $LOCAL_HASH"
echo ""

# Select network
echo "Select network:"
echo "  1) Devnet"
echo "  2) Mainnet"
echo ""
read -p "Enter choice [1-2]: " network_choice

case $network_choice in
    1)
        NETWORK="devnet"
        RPC_URL="https://api.devnet.solana.com"
        ;;
    2)
        NETWORK="mainnet"
        RPC_URL="https://api.mainnet-beta.solana.com"
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

# Get program ID from deployment file or prompt
DEPLOYMENT_FILE="deployments/solana-${NETWORK}.json"
if [ -f "$DEPLOYMENT_FILE" ]; then
    PROGRAM_ID=$(grep '"programId"' "$DEPLOYMENT_FILE" | sed 's/.*: *"\([^"]*\)".*/\1/')
    echo ""
    echo "Found deployment: $PROGRAM_ID"
    read -p "Use this Program ID? [Y/n]: " use_existing
    if [ "$use_existing" = "n" ] || [ "$use_existing" = "N" ]; then
        read -p "Enter Program ID: " PROGRAM_ID
    fi
else
    echo ""
    read -p "Enter Program ID: " PROGRAM_ID
fi

if [ -z "$PROGRAM_ID" ]; then
    echo "Error: Program ID is required"
    exit 1
fi

echo ""
echo "Fetching on-chain program..."

# Download on-chain program
TEMP_FILE="/tmp/onchain_${PROGRAM_ID}.so"
solana program dump "$PROGRAM_ID" "$TEMP_FILE" --url "$RPC_URL" 2>/dev/null

if [ $? -ne 0 ]; then
    echo "Error: Failed to fetch program from $NETWORK"
    exit 1
fi

# Calculate on-chain hash
ONCHAIN_HASH=$(sha256sum "$TEMP_FILE" | awk '{print $1}')

echo ""
echo "On-chain Program ($NETWORK):"
echo "  Program ID: $PROGRAM_ID"
echo "  SHA256: $ONCHAIN_HASH"
echo ""

# Clean up
rm -f "$TEMP_FILE"

# Compare
echo "========================================"
echo "    Verification Result"
echo "========================================"
echo ""

if [ "$LOCAL_HASH" = "$ONCHAIN_HASH" ]; then
    echo "VERIFIED: Hashes match!"
    echo ""
    echo "The on-chain program matches the local verifiable build."
else
    echo "MISMATCH: Hashes do not match!"
    echo ""
    echo "  Local:    $LOCAL_HASH"
    echo "  On-chain: $ONCHAIN_HASH"
    echo ""
    echo "The on-chain program does NOT match the local build."
    echo "This could mean:"
    echo "  - Different source code was deployed"
    echo "  - Different build environment was used"
    echo "  - Program was upgraded after this build"
fi
echo ""
