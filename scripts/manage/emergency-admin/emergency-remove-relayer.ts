import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import inquirer from "inquirer";
import {
  NETWORKS,
  selectNetwork,
  getPrivateKey,
  getConfigData,
  getConfigPda,
  getRelayerPda,
  getRelayerData,
  loadProgram,
  printExplorerLink,
  isValidPublicKey,
} from "../common";

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("    Setto Payment - EMERGENCY Remove Relayer");
  console.log("=".repeat(60));
  console.log("\n⚠️  Use this only for urgent relayer removal!\n");

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

  // 3. Get relayer address to remove
  const { relayerAddress } = await inquirer.prompt([
    {
      type: "input",
      name: "relayerAddress",
      message: "Enter relayer address to REMOVE:",
      validate: (input: string) => {
        if (!input) return "Relayer address is required";
        if (!isValidPublicKey(input)) return "Invalid Solana address";
        return true;
      },
    },
  ]);

  const relayerPubkey = new PublicKey(relayerAddress);

  // Check if exists
  const existingData = await getRelayerData(connection, network, relayerPubkey);
  if (!existingData) {
    console.log(`\n❌ Relayer not found: ${relayerAddress}`);
    process.exit(1);
  }

  console.log(`\nFound relayer:`);
  console.log(`  Address: ${existingData.relayer}`);
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
  const relayerPda = getRelayerPda(network, relayerPubkey);

  // 6. Confirm
  console.log("\n" + "-".repeat(60));
  console.log(`⚠️  EMERGENCY REMOVING relayer: ${relayerAddress}`);
  console.log(`   PDA will be closed and rent returned to emergency admin`);
  console.log("-".repeat(60));

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: "⚠️  EMERGENCY: Proceed to REMOVE relayer?",
      default: false,
    },
  ]);

  if (!confirm) {
    console.log("Cancelled.");
    process.exit(0);
  }

  // 7. Execute
  console.log("\n⏳ Removing relayer (EMERGENCY)...");

  const wallet = new anchor.Wallet(emergencyAdminKeypair);
  const program = loadProgram(connection, wallet);
  const configPda = getConfigPda(network);

  try {
    const tx = await program.methods
      .emergencyRemoveRelayer()
      .accounts({
        emergencyAdmin: emergencyAdminKeypair.publicKey,
        config: configPda,
        relayerToRemove: relayerPubkey,
        relayerAccount: relayerPda,
      })
      .signers([emergencyAdminKeypair])
      .rpc();

    console.log("✅ EMERGENCY: Relayer removed successfully");
    printExplorerLink(network, tx);
  } catch (error) {
    console.error("❌ Failed to remove relayer:", error);
    process.exit(1);
  }
}

main().catch(console.error);
