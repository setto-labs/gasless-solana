import * as anchor from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import inquirer from "inquirer";
import {
  NETWORKS,
  selectNetwork,
  getPrivateKey,
  getConfigData,
  getConfigPda,
  loadProgram,
  printExplorerLink,
} from "../common";

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("    Setto Payment - Pause Program");
  console.log("=".repeat(60));

  // 1. Select network
  const network = await selectNetwork();
  const networkConfig = NETWORKS[network];

  if (network === "mainnet") {
    console.log("\n⚠️  WARNING: This will PAUSE the program on MAINNET!");
  }

  // 2. Connect and check current state
  const connection = new Connection(networkConfig.rpcUrl, "confirmed");
  const configData = await getConfigData(connection, network);

  if (!configData) {
    console.log("\n❌ Config not initialized. Deploy first.");
    process.exit(1);
  }

  console.log(`\nCurrent state: ${configData.paused ? "PAUSED ⚠️" : "ACTIVE ✅"}`);
  console.log(`Emergency Admin: ${configData.emergencyAdmin}`);

  if (configData.paused) {
    console.log("\n⚠️ Program is already paused.");
    process.exit(0);
  }

  // 3. Get emergency admin keypair
  const emergencyAdminKeypair = await getPrivateKey("emergency admin");

  if (emergencyAdminKeypair.publicKey.toBase58() !== configData.emergencyAdmin) {
    console.log("\n❌ Provided key is not the emergency admin.");
    console.log(`   Expected: ${configData.emergencyAdmin}`);
    console.log(`   Got: ${emergencyAdminKeypair.publicKey.toBase58()}`);
    process.exit(1);
  }

  // 4. Confirm
  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: "Proceed to PAUSE the program?",
      default: false,
    },
  ]);

  if (!confirm) {
    console.log("Cancelled.");
    process.exit(0);
  }

  // 5. Execute
  console.log("\n⏳ Pausing program...");

  const wallet = new anchor.Wallet(emergencyAdminKeypair);
  const program = loadProgram(connection, wallet);
  const configPda = getConfigPda(network);

  try {
    const tx = await program.methods
      .pause()
      .accounts({
        emergencyAdmin: emergencyAdminKeypair.publicKey,
        config: configPda,
      })
      .signers([emergencyAdminKeypair])
      .rpc();

    console.log("✅ Program PAUSED successfully");
    printExplorerLink(network, tx);
  } catch (error) {
    console.error("❌ Failed to pause:", error);
    process.exit(1);
  }
}

main().catch(console.error);
