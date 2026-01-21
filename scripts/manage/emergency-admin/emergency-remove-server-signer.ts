import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import inquirer from "inquirer";
import {
  NETWORKS,
  selectNetwork,
  getPrivateKey,
  getConfigData,
  getConfigPda,
  getServerSignerPda,
  getServerSignerData,
  loadProgram,
  printExplorerLink,
  isValidPublicKey,
} from "../common";

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("    Setto Payment - EMERGENCY Remove Server Signer");
  console.log("=".repeat(60));
  console.log("\n⚠️  Use this only when signing key is leaked!\n");

  // 1. Select network
  const network = await selectNetwork();
  const networkConfig = NETWORKS[network];

  // 2. Connect and check current state
  const connection = new Connection(networkConfig.rpcUrl, "confirmed");
  const configData = await getConfigData(connection, network);

  if (!configData) {
    console.log("\n❌ Config not initialized. Deploy first.");
    process.exit(1);
  }

  console.log(`Emergency Admin: ${configData.emergencyAdmin}`);

  // 3. Get server signer address to remove
  const { serverSignerAddress } = await inquirer.prompt([
    {
      type: "input",
      name: "serverSignerAddress",
      message: "Enter server signer address to REMOVE:",
      validate: (input: string) => {
        if (!input) return "Server signer address is required";
        if (!isValidPublicKey(input)) return "Invalid Solana address";
        return true;
      },
    },
  ]);

  const serverSignerPubkey = new PublicKey(serverSignerAddress);

  // Check if exists
  const existingData = await getServerSignerData(connection, network, serverSignerPubkey);
  if (!existingData) {
    console.log(`\n❌ Server signer not found: ${serverSignerAddress}`);
    process.exit(1);
  }

  console.log(`\nFound server signer:`);
  console.log(`  Address: ${existingData.signer}`);
  console.log(`  Active:  ${existingData.isActive}`);

  // 4. Get emergency admin keypair
  const emergencyAdminKeypair = await getPrivateKey("emergency admin");

  if (emergencyAdminKeypair.publicKey.toBase58() !== configData.emergencyAdmin) {
    console.log("\n❌ Provided key is not the emergency admin.");
    console.log(`   Expected: ${configData.emergencyAdmin}`);
    console.log(`   Got: ${emergencyAdminKeypair.publicKey.toBase58()}`);
    process.exit(1);
  }

  // 5. Calculate PDA
  const serverSignerPda = getServerSignerPda(network, serverSignerPubkey);

  // 6. Confirm
  console.log("\n" + "-".repeat(60));
  console.log(`⚠️  EMERGENCY REMOVING server signer: ${serverSignerAddress}`);
  console.log(`   PDA will be closed and rent returned to emergency admin`);
  console.log("-".repeat(60));

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: "⚠️  EMERGENCY: Proceed to REMOVE server signer?",
      default: false,
    },
  ]);

  if (!confirm) {
    console.log("Cancelled.");
    process.exit(0);
  }

  // 7. Execute
  console.log("\n⏳ Removing server signer (EMERGENCY)...");

  const wallet = new anchor.Wallet(emergencyAdminKeypair);
  const program = loadProgram(connection, wallet);
  const configPda = getConfigPda(network);

  try {
    const tx = await program.methods
      .emergencyRemoveServerSigner()
      .accounts({
        emergencyAdmin: emergencyAdminKeypair.publicKey,
        config: configPda,
        serverSignerToRemove: serverSignerPubkey,
        serverSignerAccount: serverSignerPda,
      })
      .signers([emergencyAdminKeypair])
      .rpc();

    console.log("✅ EMERGENCY: Server signer removed successfully");
    printExplorerLink(network, tx);
  } catch (error) {
    console.error("❌ Failed to remove server signer:", error);
    process.exit(1);
  }
}

main().catch(console.error);
