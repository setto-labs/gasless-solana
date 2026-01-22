#!/bin/bash

cd "$(dirname "$0")/../.."

echo ""
echo "========================================"
echo "    IDL Deploy / Upgrade"
echo "========================================"
echo ""

# Check IDL file exists
IDL_FILE="target/idl/setto_payment.json"
if [ ! -f "$IDL_FILE" ]; then
    echo "Error: $IDL_FILE not found!"
    echo "Run './scripts/run/1-build.sh' first."
    exit 1
fi

echo "Found: $IDL_FILE"
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

# Get keypair (upgrade authority)
echo ""
echo "Enter the upgrade authority private key (base58)."
echo "This must be the same key used to deploy/upgrade the program."
echo ""
read -s -p "Private key: " PRIVATE_KEY
echo ""

if [ -z "$PRIVATE_KEY" ]; then
    echo "Error: Private key is required"
    exit 1
fi

# Convert base58 private key to JSON keypair file
KEYPAIR_PATH="/tmp/.idl-keypair-$$.json"
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

echo "Authority: $PUBKEY"

# Check if IDL already exists on-chain
echo ""
echo "Checking if IDL already exists on-chain..."

# Try to fetch existing IDL
anchor idl fetch "$PROGRAM_ID" --provider.cluster "$NETWORK" > /tmp/existing-idl-$$.json 2>/dev/null
IDL_EXISTS=$?

if [ $IDL_EXISTS -eq 0 ] && [ -s /tmp/existing-idl-$$.json ]; then
    IDL_ACTION="upgrade"
    echo "IDL exists on-chain. Will upgrade."
else
    IDL_ACTION="init"
    echo "No IDL found on-chain. Will initialize."
fi

rm -f /tmp/existing-idl-$$.json

# Confirmation
echo ""
echo "========================================"
echo "    IDL Deployment Summary"
echo "========================================"
echo "Network:    $NETWORK"
echo "Program ID: $PROGRAM_ID"
echo "IDL File:   $IDL_FILE"
echo "Action:     $IDL_ACTION"
echo "Authority:  $PUBKEY"
echo "========================================"
echo ""
read -p "Proceed with IDL $IDL_ACTION? [y/N]: " confirm

if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    rm -f "$KEYPAIR_PATH"
    echo "IDL deployment cancelled."
    exit 0
fi

# Deploy IDL
echo ""
echo "Deploying IDL..."
echo ""

if [ "$IDL_ACTION" = "init" ]; then
    anchor idl init \
        --filepath "$IDL_FILE" \
        --provider.cluster "$NETWORK" \
        --provider.wallet "$KEYPAIR_PATH" \
        "$PROGRAM_ID"
else
    anchor idl upgrade \
        --filepath "$IDL_FILE" \
        --provider.cluster "$NETWORK" \
        --provider.wallet "$KEYPAIR_PATH" \
        "$PROGRAM_ID"
fi

RESULT=$?

# Cleanup
rm -f "$KEYPAIR_PATH"

if [ $RESULT -eq 0 ]; then
    echo ""
    echo "========================================"
    echo "    IDL Deployment Complete!"
    echo "========================================"
    echo ""
    echo "IDL has been deployed to $NETWORK."
    echo ""
    echo "Wallets and explorers can now parse your program's instructions:"
    echo "  - Solscan: https://solscan.io/account/${PROGRAM_ID}?cluster=${NETWORK}"
    echo "  - Solana Explorer: https://explorer.solana.com/address/${PROGRAM_ID}?cluster=${NETWORK}"
    echo ""
    echo "This helps reduce 'Unknown Program' warnings in wallets."
else
    echo ""
    echo "Error: IDL deployment failed"
    echo ""
    echo "Common issues:"
    echo "  1. Wrong authority key (must match program upgrade authority)"
    echo "  2. Insufficient SOL for transaction fee"
    echo "  3. Network connectivity issues"
fi
echo ""
