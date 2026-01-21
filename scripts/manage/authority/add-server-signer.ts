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
  console.log("    Setto Payment - Add Server Signer");
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

  // 4. Get authority keypair
  const authorityKeypair = await getPrivateKey("authority");

  if (authorityKeypair.publicKey.toBase58() !== configData.authority) {
    console.log("\n❌ Provided key is not the authority.");
    console.log(`   Expected: ${configData.authority}`);
    console.log(`   Got: ${authorityKeypair.publicKey.toBase58()}`);
    process.exit(1);
  }

  // 5. Calculate PDA
  const serverSignerPda = getServerSignerPda(network, newServerSignerPubkey);

  // 6. Confirm
  console.log("\n" + "-".repeat(60));
  console.log(`New server signer: ${newServerSignerAddress}`);
  console.log(`PDA address:       ${serverSignerPda.toBase58()}`);
  console.log("-".repeat(60));

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: "Proceed to add server signer?",
      default: false,
    },
  ]);

  if (!confirm) {
    console.log("Cancelled.");
    process.exit(0);
  }

  // 7. Execute
  console.log("\n⏳ Adding server signer...");

  const wallet = new anchor.Wallet(authorityKeypair);
  const program = loadProgram(connection, wallet);
  const configPda = getConfigPda(network);

  try {
    const tx = await program.methods
      .addServerSigner()
      .accounts({
        authority: authorityKeypair.publicKey,
        config: configPda,
        newServerSigner: newServerSignerPubkey,
        serverSignerAccount: serverSignerPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authorityKeypair])
      .rpc();

    console.log("✅ Server signer added successfully");
    printExplorerLink(network, tx);
  } catch (error) {
    console.error("❌ Failed to add server signer:", error);
    process.exit(1);
  }
}

main().catch(console.error);
