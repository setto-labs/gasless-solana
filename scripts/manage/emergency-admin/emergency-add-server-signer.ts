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
  console.log("    Setto Payment - EMERGENCY Add Server Signer");
  console.log("=".repeat(60));
  console.log("\n⚠️  Use this only for urgent key rotation!\n");

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

  // 3. Get new server signer address
  const { newServerSignerAddress } = await inquirer.prompt([
    {
      type: "input",
      name: "newServerSignerAddress",
      message: "Enter new server signer address:",
      validate: (input: string) => {
        if (!input) return "Server signer address is required";
        if (!isValidPublicKey(input)) return "Invalid Solana address";
        return true;
      },
    },
  ]);

  const newServerSignerPubkey = new PublicKey(newServerSignerAddress);

  // Check if already exists
  const existingData = await getServerSignerData(connection, network, newServerSignerPubkey);
  if (existingData) {
    console.log(`\n❌ Server signer already exists: ${newServerSignerAddress}`);
    console.log(`   Active: ${existingData.isActive}`);
    process.exit(1);
  }

  // 4. Get emergency admin keypair
  const emergencyAdminKeypair = await getPrivateKey("emergency admin");

  if (emergencyAdminKeypair.publicKey.toBase58() !== configData.emergencyAdmin) {
    console.log("\n❌ Provided key is not the emergency admin.");
    console.log(`   Expected: ${configData.emergencyAdmin}`);
    console.log(`   Got: ${emergencyAdminKeypair.publicKey.toBase58()}`);
    process.exit(1);
  }

  // 5. Calculate PDA
  const serverSignerPda = getServerSignerPda(network, newServerSignerPubkey);

  // 6. Confirm
  console.log("\n" + "-".repeat(60));
  console.log(`EMERGENCY Add server signer: ${newServerSignerAddress}`);
  console.log(`PDA address:                 ${serverSignerPda.toBase58()}`);
  console.log("-".repeat(60));

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: "⚠️  EMERGENCY: Proceed to add server signer?",
      default: false,
    },
  ]);

  if (!confirm) {
    console.log("Cancelled.");
    process.exit(0);
  }

  // 7. Execute
  console.log("\n⏳ Adding server signer (EMERGENCY)...");

  const wallet = new anchor.Wallet(emergencyAdminKeypair);
  const program = loadProgram(connection, wallet);
  const configPda = getConfigPda(network);

  try {
    const tx = await program.methods
      .emergencyAddServerSigner()
      .accounts({
        emergencyAdmin: emergencyAdminKeypair.publicKey,
        config: configPda,
        newServerSigner: newServerSignerPubkey,
        serverSignerAccount: serverSignerPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([emergencyAdminKeypair])
      .rpc();

    console.log("✅ EMERGENCY: Server signer added successfully");
    printExplorerLink(network, tx);
  } catch (error) {
    console.error("❌ Failed to add server signer:", error);
    process.exit(1);
  }
}

main().catch(console.error);
