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
  console.log("    Setto Payment - Set Fee Recipient");
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

  console.log(`\nCurrent fee recipient: ${configData.feeRecipient}`);
  console.log(`Authority: ${configData.authority}`);

  // 3. Get new fee recipient address
  const { newFeeRecipientAddress } = await inquirer.prompt([
    {
      type: "input",
      name: "newFeeRecipientAddress",
      message: "Enter new fee recipient address:",
      validate: (input: string) => {
        if (!input) return "Fee recipient address is required";
        if (!isValidPublicKey(input)) return "Invalid Solana address";
        if (input === configData.feeRecipient) return "Same as current fee recipient";
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
  console.log(`Current fee recipient: ${configData.feeRecipient}`);
  console.log(`New fee recipient:     ${newFeeRecipientAddress}`);
  console.log("-".repeat(60));

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: "Proceed to update fee recipient?",
      default: false,
    },
  ]);

  if (!confirm) {
    console.log("Cancelled.");
    process.exit(0);
  }

  // 6. Execute
  console.log("\n⏳ Updating fee recipient...");

  const wallet = new anchor.Wallet(authorityKeypair);
  const program = loadProgram(connection, wallet);
  const configPda = getConfigPda(network);

  try {
    const tx = await program.methods
      .setFeeRecipient()
      .accounts({
        authority: authorityKeypair.publicKey,
        config: configPda,
        newFeeRecipient: new PublicKey(newFeeRecipientAddress),
      })
      .signers([authorityKeypair])
      .rpc();

    console.log("✅ Fee recipient updated successfully");
    printExplorerLink(network, tx);
  } catch (error) {
    console.error("❌ Failed to update fee recipient:", error);
    process.exit(1);
  }
}

main().catch(console.error);
