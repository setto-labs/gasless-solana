#!/bin/bash

cd "$(dirname "$0")/../.."

echo ""
echo "========================================"
echo "    Emergency Admin Scripts"
echo "========================================"
echo ""
echo "Select operation:"
echo "  1) Pause Contract"
echo "  2) Unpause Contract"
echo "  3) Emergency Add Server Signer"
echo "  4) Emergency Remove Server Signer"
echo ""
read -p "Enter choice [1-4]: " choice

case $choice in
  1) npx ts-node scripts/manage/emergency-admin/pause.ts ;;
  2) npx ts-node scripts/manage/emergency-admin/unpause.ts ;;
  3) npx ts-node scripts/manage/emergency-admin/emergency-add-server-signer.ts ;;
  4) npx ts-node scripts/manage/emergency-admin/emergency-remove-server-signer.ts ;;
  *) echo "Invalid choice" ;;
esac
