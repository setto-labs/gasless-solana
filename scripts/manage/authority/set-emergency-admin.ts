import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import inquirer from "inquirer";
import {
  NETWORKS,
  selectNetwork,
  getPrivateKey,
  getConfigData,
  getConfigPda,
  loadProgram,
  printExplorerLink,
  isValidPublicKey,
} from "../common";

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("    Setto Payment - Set Emergency Admin");
  console.log("=".repeat(60));

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

  console.log(`\nCurrent emergency admin: ${configData.emergencyAdmin}`);
  console.log(`Authority: ${configData.authority}`);

  // 3. Get new emergency admin address
  const { newEmergencyAdminAddress } = await inquirer.prompt([
    {
      type: "input",
      name: "newEmergencyAdminAddress",
      message: "Enter new emergency admin address:",
      validate: (input: string) => {
        if (!input) return "Emergency admin address is required";
        if (!isValidPublicKey(input)) return "Invalid Solana address";
        if (input === configData.emergencyAdmin) return "Same as current emergency admin";
        return true;
      },
    },
  ]);

  // 4. Get authority keypair
  const authorityKeypair = await getPrivateKey("authority");

  if (authorityKeypair.publicKey.toBase58() !== configData.authority) {
    console.log("\n❌ Provided key is not the authority.");
    console.log(`   Expected: ${configData.authority}`);
    console.log(`   Got: ${authorityKeypair.publicKey.toBase58()}`);
    process.exit(1);
  }

  // 5. Confirm
  console.log("\n" + "-".repeat(60));
  console.log(`Current emergency admin: ${configData.emergencyAdmin}`);
  console.log(`New emergency admin:     ${newEmergencyAdminAddress}`);
  console.log("-".repeat(60));

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: "Proceed to update emergency admin?",
      default: false,
    },
  ]);

  if (!confirm) {
    console.log("Cancelled.");
    process.exit(0);
  }

  // 6. Execute
  console.log("\n⏳ Updating emergency admin...");

  const wallet = new anchor.Wallet(authorityKeypair);
  const program = loadProgram(connection, wallet);
  const configPda = getConfigPda(network);

  try {
    const tx = await program.methods
      .setEmergencyAdmin()
      .accounts({
        authority: authorityKeypair.publicKey,
        config: configPda,
        newEmergencyAdmin: new PublicKey(newEmergencyAdminAddress),
      })
      .signers([authorityKeypair])
      .rpc();

    console.log("✅ Emergency admin updated successfully");
    printExplorerLink(network, tx);
  } catch (error) {
    console.error("❌ Failed to update emergency admin:", error);
    process.exit(1);
  }
}

main().catch(console.error);
