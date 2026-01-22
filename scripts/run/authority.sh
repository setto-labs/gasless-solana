#!/bin/bash

cd "$(dirname "$0")/../.."

echo ""
echo "========================================"
echo "    Authority Management Scripts"
echo "========================================"
echo ""
echo "Select operation:"
echo "  1) Transfer Authority"
echo "  2) Set Emergency Admin"
echo "  3) Add Server Signer"
echo "  4) Remove Server Signer"
echo "  5) Add Relayer"
echo "  6) Remove Relayer"
echo "  7) Set Fee Recipient"
echo ""
read -p "Enter choice [1-7]: " choice

case $choice in
  1) npx ts-node scripts/manage/authority/transfer-authority.ts ;;
  2) npx ts-node scripts/manage/authority/set-emergency-admin.ts ;;
  3) npx ts-node scripts/manage/authority/add-server-signer.ts ;;
  4) npx ts-node scripts/manage/authority/remove-server-signer.ts ;;
  5) npx ts-node scripts/manage/authority/add-relayer.ts ;;
  6) npx ts-node scripts/manage/authority/remove-relayer.ts ;;
  7) npx ts-node scripts/manage/authority/set-fee-recipient.ts ;;
  *) echo "Invalid choice" ;;
esac
