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
  console.log("    Setto Payment - Transfer Authority");
  console.log("=".repeat(60));
  console.log("\n⚠️  WARNING: This action is IRREVERSIBLE!");
  console.log("   Make sure you have access to the new authority wallet.\n");

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

  console.log(`\nCurrent authority: ${configData.authority}`);

  // 3. Get new authority address
  const { newAuthorityAddress } = await inquirer.prompt([
    {
      type: "input",
      name: "newAuthorityAddress",
      message: "Enter new authority address:",
      validate: (input: string) => {
        if (!input) return "Authority address is required";
        if (!isValidPublicKey(input)) return "Invalid Solana address";
        if (input === configData.authority) return "Same as current authority";
        return true;
      },
    },
  ]);

  // 4. Get current authority keypair
  console.log("\nEnter CURRENT authority private key to authorize transfer:");
  const authorityKeypair = await getPrivateKey("authority");

  if (authorityKeypair.publicKey.toBase58() !== configData.authority) {
    console.log("\n❌ Provided key is not the current authority.");
    console.log(`   Expected: ${configData.authority}`);
    console.log(`   Got: ${authorityKeypair.publicKey.toBase58()}`);
    process.exit(1);
  }

  // 5. Double confirm (critical operation)
  console.log("\n" + "!".repeat(60));
  console.log("    CRITICAL: Authority Transfer");
  console.log("!".repeat(60));
  console.log(`\nCurrent authority: ${configData.authority}`);
  console.log(`New authority:     ${newAuthorityAddress}`);
  console.log("\nThis action is IRREVERSIBLE. You will lose control of this program");
  console.log("unless you have access to the new authority wallet.");

  const { confirm1 } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm1",
      message: "Do you understand this is irreversible?",
      default: false,
    },
  ]);

  if (!confirm1) {
    console.log("Cancelled.");
    process.exit(0);
  }

  const { confirm2 } = await inquirer.prompt([
    {
      type: "input",
      name: "confirm2",
      message: "Type 'TRANSFER' to confirm:",
      validate: (input: string) => input === "TRANSFER" || "Please type TRANSFER exactly",
    },
  ]);

  // 6. Execute
  console.log("\n⏳ Transferring authority...");

  const wallet = new anchor.Wallet(authorityKeypair);
  const program = loadProgram(connection, wallet);
  const configPda = getConfigPda(network);

  try {
    const tx = await program.methods
      .transferAuthority()
      .accounts({
        authority: authorityKeypair.publicKey,
        config: configPda,
        newAuthority: new PublicKey(newAuthorityAddress),
      })
      .signers([authorityKeypair])
      .rpc();

    console.log("✅ Authority transferred successfully");
    console.log(`\n🔑 New authority: ${newAuthorityAddress}`);
    printExplorerLink(network, tx);
  } catch (error) {
    console.error("❌ Failed to transfer authority:", error);
    process.exit(1);
  }
}

main().catch(console.error);
