#!/bin/bash

cd "$(dirname "$0")/../.."

echo ""
echo "========================================"
echo "    Register Verified Build on Solscan"
echo "========================================"
echo ""

# Check solana-verify is installed
if ! command -v solana-verify &> /dev/null; then
    echo "solana-verify not found. Installing..."
    cargo install solana-verify
    if [ $? -ne 0 ]; then
        echo "Error: Failed to install solana-verify"
        echo "You may need to install libudev-dev first:"
        echo "  sudo apt-get install -y libudev-dev"
        exit 1
    fi
fi

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

# Get GitHub repo URL
echo ""
echo "Enter the GitHub repository URL where the source code is hosted."
echo "Example: https://github.com/your-org/your-repo"
echo ""
read -p "GitHub Repo URL: " REPO_URL

if [ -z "$REPO_URL" ]; then
    echo "Error: GitHub repo URL is required"
    exit 1
fi

# Get commit hash (optional)
echo ""
echo "Enter the commit hash to verify against (optional)."
echo "Leave empty to use the latest commit."
echo ""
read -p "Commit hash (or Enter for latest): " COMMIT_HASH

# Get keypair for signing (needs SOL for transaction)
echo ""
echo "A keypair with SOL is required to pay for the verification transaction."
echo ""
echo "Enter private key (base58):"
read -s PRIVATE_KEY
echo ""

if [ -z "$PRIVATE_KEY" ]; then
    echo "Error: Private key is required"
    exit 1
fi

# Convert base58 private key to JSON keypair file using Node.js
KEYPAIR_PATH="/tmp/.verify-keypair-$$.json"
node -e "
const bs58 = require('bs58');
const secretKey = bs58.decode('$PRIVATE_KEY');
console.log(JSON.stringify(Array.from(secretKey)));
" > "$KEYPAIR_PATH" 2>/dev/null

if [ $? -ne 0 ] || [ ! -s "$KEYPAIR_PATH" ]; then
    rm -f "$KEYPAIR_PATH"
    echo "Error: Invalid private key format"
    exit 1
fi

chmod 600 "$KEYPAIR_PATH"

# Get public key for display
PUBKEY=$(node -e "
const bs58 = require('bs58');
const { Keypair } = require('@solana/web3.js');
const secretKey = bs58.decode('$PRIVATE_KEY');
const keypair = Keypair.fromSecretKey(secretKey);
console.log(keypair.publicKey.toBase58());
" 2>/dev/null)

if [ -z "$PUBKEY" ]; then
    rm -f "$KEYPAIR_PATH"
    echo "Error: Could not derive public key"
    exit 1
fi

echo "Signer: $PUBKEY"

# Confirmation
echo ""
echo "========================================"
echo "    Registration Summary"
echo "========================================"
echo "Network:    $NETWORK"
echo "Program ID: $PROGRAM_ID"
echo "Repo URL:   $REPO_URL"
if [ -n "$COMMIT_HASH" ]; then
    echo "Commit:     $COMMIT_HASH"
fi
echo "Signer:     $PUBKEY"
echo "========================================"
echo ""
read -p "Proceed with registration? [y/N]: " confirm

if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "Registration cancelled."
    exit 0
fi

# Run solana-verify
echo ""
echo "Registering verified build..."
echo ""

if [ -n "$COMMIT_HASH" ]; then
    solana-verify verify-from-repo \
        --program-id "$PROGRAM_ID" \
        --url "$RPC_URL" \
        --keypair "$KEYPAIR_PATH" \
        --commit-hash "$COMMIT_HASH" \
        "$REPO_URL"
else
    solana-verify verify-from-repo \
        --program-id "$PROGRAM_ID" \
        --url "$RPC_URL" \
        --keypair "$KEYPAIR_PATH" \
        "$REPO_URL"
fi

RESULT=$?

# Cleanup temp keypair file
rm -f "$KEYPAIR_PATH"

if [ $RESULT -eq 0 ]; then
    echo ""
    echo "========================================"
    echo "    Registration Complete!"
    echo "========================================"
    echo ""
    echo "Your program should now show as 'Verified' on:"
    echo "  - Solscan: https://solscan.io/account/${PROGRAM_ID}?cluster=${NETWORK}"
    echo "  - Solana FM: https://solana.fm/address/${PROGRAM_ID}?cluster=${NETWORK}"
    echo ""
    echo "Note: It may take a few minutes for the verification to appear."
else
    echo ""
    echo "Error: Registration failed"
    echo "Make sure:"
    echo "  1. The GitHub repo is public"
    echo "  2. The source code matches the deployed program"
    echo "  3. The Anchor.toml has the correct anchor_version"
fi
echo ""
