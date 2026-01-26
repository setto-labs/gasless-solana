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
  console.log("    Setto Payment - Initialize Delegate PDA");
  console.log("    (One-time migration for existing deployments)");
  console.log("=".repeat(60));

  // 0. Check if IDL exists
  const idlPath = path.resolve(PROJECT_ROOT, "target/idl/setto_payment.json");
  if (!fs.existsSync(idlPath)) {
    console.log("\n❌ IDL not found. Run 'anchor build' first.");
    process.exit(1);
  }

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

  const programPubkey = new PublicKey(programId);

  // Check Config PDA (must exist)
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.CONFIG)],
    programPubkey
  );

  const configAccount = await connection.getAccountInfo(configPda);
  if (!configAccount) {
    console.log("\n❌ Config not initialized. Run 'npm run init' first.");
    process.exit(1);
  }

  // Check Delegate PDA
  const [delegatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("delegate")],
    programPubkey
  );

  const delegateAccount = await connection.getAccountInfo(delegatePda);
  if (delegateAccount) {
    console.log("\n✅ Delegate PDA already initialized at:", delegatePda.toBase58());
    process.exit(0);
  }

  // 3. Get authority private key
  console.log("\n--- Authority Configuration ---\n");
  console.log("Note: Authority must match the config.authority address.\n");

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

  // 4. Confirmation
  console.log("\n" + "=".repeat(60));
  console.log("    Initialize Delegate Summary");
  console.log("=".repeat(60));
  console.log(`Network:      ${networkConfig.name}`);
  console.log(`Program ID:   ${programId}`);
  console.log(`Config PDA:   ${configPda.toBase58()}`);
  console.log(`Delegate PDA: ${delegatePda.toBase58()}`);
  console.log(`Authority:    ${authorityAddress}`);
  console.log("=".repeat(60));

  const { confirmInit } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmInit",
      message: "Proceed with delegate initialization?",
      default: false,
    },
  ]);

  if (!confirmInit) {
    console.log("Initialization cancelled.");
    process.exit(0);
  }

  // 5. Initialize Delegate
  console.log("\n⚙️ Initializing delegate PDA...");

  try {
    const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
    idl.address = programId;

    const wallet = new anchor.Wallet(authorityKeypair);
    const provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    anchor.setProvider(provider);

    const program = new Program(idl, provider);

    const tx = await program.methods
      .initializeDelegate()
      .accounts({
        authority: authorityKeypair.publicKey,
        config: configPda,
        delegate: delegatePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authorityKeypair])
      .rpc();

    console.log(`✅ Delegate PDA initialized. TX: ${tx}`);

    // 6. Print explorer links
    console.log("\n" + "=".repeat(60));
    console.log("    Initialization Complete!");
    console.log("=".repeat(60));
    const clusterParam = network === "mainnet" ? "" : `?cluster=${networkConfig.cluster}`;
    console.log(`\n🔗 Explorer Links:`);
    console.log(`   Delegate: ${networkConfig.explorer}/account/${delegatePda.toBase58()}${clusterParam}`);
    console.log(`   TX:       ${networkConfig.explorer}/tx/${tx}${clusterParam}`);
    console.log("");

  } catch (error) {
    console.error("❌ Initialization failed:", error);
    process.exit(1);
  }
}

main().catch(console.error);
