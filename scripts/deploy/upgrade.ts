import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import inquirer from "inquirer";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import bs58 from "bs58";

import { NETWORKS, NetworkKey } from "../constants";

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

async function checkSolBalance(connection: Connection, publicKey: PublicKey): Promise<number> {
  const balance = await connection.getBalance(publicKey);
  return balance / 1e9;
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("    Setto Payment - Program Upgrade");
  console.log("=".repeat(60));

  // 1. Check .so file exists
  const programSoPath = path.resolve(PROJECT_ROOT, "target/deploy/setto_payment.so");
  if (!fs.existsSync(programSoPath)) {
    console.error("\n❌ Program .so file not found!");
    console.error("   Run './scripts/run/1-build.sh' first to build with solana-verify.");
    process.exit(1);
  }
  console.log("\n✅ Found built program: target/deploy/setto_payment.so");

  // 2. Select network
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

  if (network === "mainnet") {
    console.log("\n⚠️  WARNING: This is a MAINNET upgrade!");
    const { confirmMainnet } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmMainnet",
        message: "Are you sure you want to upgrade on MAINNET?",
        default: false,
      },
    ]);
    if (!confirmMainnet) {
      console.log("Upgrade cancelled.");
      process.exit(0);
    }
  }

  // 3. Get Program ID to upgrade
  const { programId } = await inquirer.prompt([
    {
      type: "input",
      name: "programId",
      message: "Program ID to upgrade:",
      validate: (input: string) => isValidPublicKey(input) || "Invalid Program ID",
    },
  ]);

  // Verify program exists and is upgradeable
  const connection = new Connection(networkConfig.rpcUrl, "confirmed");
  const programPubkey = new PublicKey(programId);
  const programInfo = await connection.getAccountInfo(programPubkey);

  if (!programInfo) {
    console.error("\n❌ Program not found on chain!");
    process.exit(1);
  }

  console.log(`\n✅ Program found: ${programId}`);

  // 4. Get upgrade authority private key
  console.log("\n--- Upgrade Authority ---\n");

  const { authorityPrivateKey } = await inquirer.prompt([
    {
      type: "password",
      name: "authorityPrivateKey",
      message: "Upgrade authority private key (base58):",
      mask: "*",
      validate: (input: string) => {
        if (!input) return "Private key is required";
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

  // Check balance
  const balance = await checkSolBalance(connection, authorityKeypair.publicKey);
  console.log(`Balance: ${balance.toFixed(4)} SOL`);

  if (balance < 2.2) {
    console.log("\n⚠️  WARNING: Balance might be low. Upgrade requires ~2.2 SOL temporarily.");
    console.log("   (SOL will be returned after upgrade completes)");
    const { continueAnyway } = await inquirer.prompt([
      {
        type: "confirm",
        name: "continueAnyway",
        message: "Continue anyway?",
        default: false,
      },
    ]);
    if (!continueAnyway) {
      process.exit(0);
    }
  }

  // 5. Confirmation
  console.log("\n" + "=".repeat(60));
  console.log("    Upgrade Summary");
  console.log("=".repeat(60));
  console.log(`Network:     ${networkConfig.name}`);
  console.log(`Program ID:  ${programId}`);
  console.log(`Authority:   ${authorityAddress}`);
  console.log(`Balance:     ${balance.toFixed(4)} SOL`);
  console.log("=".repeat(60));

  const { confirmUpgrade } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmUpgrade",
      message: "Proceed with upgrade?",
      default: false,
    },
  ]);

  if (!confirmUpgrade) {
    console.log("Upgrade cancelled.");
    process.exit(0);
  }

  // 6. Write authority keypair to temp file
  console.log(`\n🚀 Upgrading program on ${networkConfig.name}...`);

  const authorityKeypairJson = JSON.stringify(Array.from(authorityKeypair.secretKey));
  const tempDir = "/tmp";
  const authorityTempPath = path.join(tempDir, `.upgrade-${Date.now()}-authority.json`);

  try {
    fs.writeFileSync(authorityTempPath, authorityKeypairJson, { mode: 0o600 });

    // Use solana program deploy with --program-id as pubkey string (triggers upgrade)
    const upgradeProcess = spawnSync("solana", [
      "program",
      "deploy",
      programSoPath,
      "--url",
      networkConfig.rpcUrl,
      "--keypair",
      authorityTempPath,
      "--program-id",
      programId,  // Use pubkey string, not keypair file - this triggers upgrade mode
      "--commitment",
      "confirmed",
    ], {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
    });

    if (upgradeProcess.status !== 0) {
      throw new Error("Upgrade process failed");
    }

    console.log("✅ Program upgraded successfully!");

    // 7. Fix IDL address if needed
    const idlPath = path.resolve(PROJECT_ROOT, "target/idl/setto_payment.json");
    if (fs.existsSync(idlPath)) {
      const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
      if (idl.address !== programId) {
        idl.address = programId;
        fs.writeFileSync(idlPath, JSON.stringify(idl, null, 2));
        console.log("✅ IDL address updated to match program ID");
      }
    }

    // 8. Print explorer links
    console.log("\n" + "=".repeat(60));
    console.log("    Upgrade Complete!");
    console.log("=".repeat(60));
    const clusterParam = network === "mainnet" ? "" : `?cluster=${networkConfig.cluster}`;
    console.log(`\n🔗 Explorer Links:`);
    console.log(`   Program: ${networkConfig.explorer}/account/${programId}${clusterParam}`);
    console.log("");
    console.log("Next steps:");
    console.log("  1. Run './scripts/run/6-verify.sh' to verify the build");
    console.log("");

  } catch (error) {
    console.error("❌ Upgrade failed:", error);
    process.exit(1);
  } finally {
    // Delete temp file
    if (fs.existsSync(authorityTempPath)) {
      fs.unlinkSync(authorityTempPath);
    }
  }
}

main().catch(console.error);
