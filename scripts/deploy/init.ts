import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import inquirer from "inquirer";
import fs from "fs";
import path from "path";
import bs58 from "bs58";

import {
  NETWORKS,
  NetworkKey,
  PDA_SEEDS,
} from "../constants";

const PROJECT_ROOT = path.resolve(__dirname, "../..");

function loadKeypairFromPrivateKey(privateKeyBase58: string): Keypair {
  const secretKey = bs58.decode(privateKeyBase58);
  return Keypair.fromSecretKey(secretKey);
}

function isValidPublicKey(input: string): boolean {
  try {
    new PublicKey(input);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("    Setto Payment - Initialize Config");
  console.log("=".repeat(60));

  // 1. Select network
  const { network } = await inquirer.prompt<{ network: NetworkKey }>([
    {
      type: "list",
      name: "network",
      message: "Select network:",
      choices: Object.entries(NETWORKS).map(([key, net]) => ({
        name: `${net.name} (${net.cluster})`,
        value: key,
      })),
    },
  ]);

  const networkConfig = NETWORKS[network];
  const connection = new Connection(networkConfig.rpcUrl, "confirmed");

  // 2. Get Program ID
  const { programId } = await inquirer.prompt([
    {
      type: "input",
      name: "programId",
      message: "Program ID:",
      validate: (input: string) => isValidPublicKey(input) || "Invalid Program ID",
    },
  ]);

  // Check Config PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.CONFIG)],
    new PublicKey(programId)
  );

  const configAccount = await connection.getAccountInfo(configPda);
  if (configAccount) {
    console.log("\n⚠️  Config already initialized at:", configPda.toBase58());
    console.log("Use 'npm run authority' to modify config values.");
    process.exit(0);
  }

  // 3. Get authority private key
  console.log("\n--- Authority Configuration ---\n");

  const { authorityPrivateKey } = await inquirer.prompt([
    {
      type: "password",
      name: "authorityPrivateKey",
      message: "Authority private key (base58, pays gas):",
      mask: "*",
      validate: (input: string) => {
        if (!input) return "Authority private key is required";
        try {
          const keypair = loadKeypairFromPrivateKey(input);
          return keypair.publicKey ? true : "Invalid private key";
        } catch {
          return "Invalid base58 private key";
        }
      },
    },
  ]);

  const authorityKeypair = loadKeypairFromPrivateKey(authorityPrivateKey);
  const authorityAddress = authorityKeypair.publicKey.toBase58();
  console.log(`Authority: ${authorityAddress}`);

  // 4. Get role addresses
  console.log("\n--- Role Configuration ---\n");

  const { emergencyAdminAddress } = await inquirer.prompt([
    {
      type: "input",
      name: "emergencyAdminAddress",
      message: "Emergency Admin address:",
      default: authorityAddress,
      validate: (input: string) => isValidPublicKey(input) || "Invalid Solana address",
    },
  ]);

  const { serverSignerAddress } = await inquirer.prompt([
    {
      type: "input",
      name: "serverSignerAddress",
      message: "Initial Server Signer address (Ed25519):",
      validate: (input: string) => {
        if (!input) return "Server signer address is required";
        return isValidPublicKey(input) || "Invalid Solana address";
      },
    },
  ]);

  const { feeRecipientAddress } = await inquirer.prompt([
    {
      type: "input",
      name: "feeRecipientAddress",
      message: "Fee Recipient address:",
      validate: (input: string) => {
        if (!input) return "Fee recipient address is required";
        return isValidPublicKey(input) || "Invalid Solana address";
      },
    },
  ]);

  // Calculate ServerSigner PDA
  const serverSignerPubkey = new PublicKey(serverSignerAddress);
  const [serverSignerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.SERVER_SIGNER), serverSignerPubkey.toBuffer()],
    new PublicKey(programId)
  );

  // 5. Confirmation
  console.log("\n" + "=".repeat(60));
  console.log("    Initialization Summary");
  console.log("=".repeat(60));
  console.log(`Network:         ${networkConfig.name}`);
  console.log(`Program ID:      ${programId}`);
  console.log(`Config PDA:      ${configPda.toBase58()}`);
  console.log(`Authority:       ${authorityAddress}`);
  console.log(`Emergency Admin: ${emergencyAdminAddress}`);
  console.log(`Server Signer:   ${serverSignerAddress}`);
  console.log(`  (PDA):         ${serverSignerPda.toBase58()}`);
  console.log(`Fee Recipient:   ${feeRecipientAddress}`);
  console.log("=".repeat(60));

  const { confirmInit } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmInit",
      message: "Proceed with initialization?",
      default: false,
    },
  ]);

  if (!confirmInit) {
    console.log("Initialization cancelled.");
    process.exit(0);
  }

  // 6. Initialize
  console.log("\n⚙️ Initializing program config...");

  try {
    const idlPath = path.resolve(PROJECT_ROOT, "target/idl/setto_payment.json");
    const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

    // Override IDL address with user-provided programId (supports multi-network)
    idl.address = programId;

    const wallet = new anchor.Wallet(authorityKeypair);
    const provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    anchor.setProvider(provider);

    const program = new Program(idl, provider);

    const tx = await program.methods
      .initialize()
      .accounts({
        authority: authorityKeypair.publicKey,
        config: configPda,
        emergencyAdmin: new PublicKey(emergencyAdminAddress),
        serverSigner: serverSignerPubkey,
        serverSignerAccount: serverSignerPda,
        feeRecipient: new PublicKey(feeRecipientAddress),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authorityKeypair])
      .rpc();

    console.log(`✅ Config initialized. TX: ${tx}`);

    // 7. Print explorer links
    console.log("\n" + "=".repeat(60));
    console.log("    Initialization Complete!");
    console.log("=".repeat(60));
    const clusterParam = network === "mainnet" ? "" : `?cluster=${networkConfig.cluster}`;
    console.log(`\n🔗 Explorer Links:`);
    console.log(`   Config: ${networkConfig.explorer}/account/${configPda.toBase58()}${clusterParam}`);
    console.log(`   ServerSigner: ${networkConfig.explorer}/account/${serverSignerPda.toBase58()}${clusterParam}`);
    console.log(`   TX:     ${networkConfig.explorer}/tx/${tx}${clusterParam}`);
    console.log("");

  } catch (error) {
    console.error("❌ Initialization failed:", error);
    process.exit(1);
  }
}

main().catch(console.error);
