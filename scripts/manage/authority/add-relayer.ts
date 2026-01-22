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
  console.log("    Setto Payment - Add Relayer");
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

  console.log(`\nAuthority: ${configData.authority}`);

  // 3. Get new relayer address
  const { newRelayerAddress } = await inquirer.prompt([
    {
      type: "input",
      name: "newRelayerAddress",
      message: "Enter new relayer address:",
      validate: (input: string) => {
        if (!input) return "Relayer address is required";
        if (!isValidPublicKey(input)) return "Invalid Solana address";
        return true;
      },
    },
  ]);

  const newRelayerPubkey = new PublicKey(newRelayerAddress);

  // Check if already exists
  const existingData = await getRelayerData(connection, network, newRelayerPubkey);
  if (existingData) {
    console.log(`\n❌ Relayer already exists: ${newRelayerAddress}`);
    console.log(`   Active: ${existingData.isActive}`);
    process.exit(1);
  }

  // 4. Get authority keypair
  const authorityKeypair = await getPrivateKey("authority");

  if (authorityKeypair.publicKey.toBase58() !== configData.authority) {
    console.log("\n❌ Provided key is not the authority.");
    console.log(`   Expected: ${configData.authority}`);
    console.log(`   Got: ${authorityKeypair.publicKey.toBase58()}`);
    process.exit(1);
  }

  // 5. Calculate PDA
  const relayerPda = getRelayerPda(network, newRelayerPubkey);

  // 6. Confirm
  console.log("\n" + "-".repeat(60));
  console.log(`New relayer: ${newRelayerAddress}`);
  console.log(`PDA address: ${relayerPda.toBase58()}`);
  console.log("-".repeat(60));

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: "Proceed to add relayer?",
      default: false,
    },
  ]);

  if (!confirm) {
    console.log("Cancelled.");
    process.exit(0);
  }

  // 7. Execute
  console.log("\n⏳ Adding relayer...");

  const wallet = new anchor.Wallet(authorityKeypair);
  const program = loadProgram(connection, wallet);
  const configPda = getConfigPda(network);

  try {
    const tx = await program.methods
      .addRelayer()
      .accounts({
        authority: authorityKeypair.publicKey,
        config: configPda,
        newRelayer: newRelayerPubkey,
        relayerAccount: relayerPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authorityKeypair])
      .rpc();

    console.log("✅ Relayer added successfully");
    printExplorerLink(network, tx);
  } catch (error) {
    console.error("❌ Failed to add relayer:", error);
    process.exit(1);
  }
}

main().catch(console.error);
