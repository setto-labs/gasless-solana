import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import inquirer from "inquirer";
import fs from "fs";
import path from "path";
import { execSync, spawnSync } from "child_process";
import bs58 from "bs58";

import {
  NETWORKS,
  NetworkKey,
  PDA_SEEDS,
  PROGRAM_NAME,
} from "../constants";

interface DeploymentResult {
  network: string;
  programId: string;
  deployer: string;
  timestamp: string;
}

const PROJECT_ROOT = path.resolve(__dirname, "../..");

function loadKeypairFromPrivateKey(privateKeyBase58: string): Keypair {
  const secretKey = bs58.decode(privateKeyBase58);
  return Keypair.fromSecretKey(secretKey);
}

async function checkSolBalance(connection: Connection, publicKey: PublicKey): Promise<number> {
  const balance = await connection.getBalance(publicKey);
  return balance / 1e9;
}

function updateLibRs(programId: string): void {
  const libRsPath = path.resolve(PROJECT_ROOT, "src/lib.rs");
  let content = fs.readFileSync(libRsPath, "utf8");

  // Replace declare_id! macro
  content = content.replace(
    /declare_id!\s*\(\s*"[^"]+"\s*\)/,
    `declare_id!("${programId}")`
  );

  fs.writeFileSync(libRsPath, content);
  console.log(`   Updated lib.rs with Program ID: ${programId}`);
}

function updateAnchorToml(network: NetworkKey, programId: string): void {
  const anchorTomlPath = path.resolve(PROJECT_ROOT, "Anchor.toml");
  let content = fs.readFileSync(anchorTomlPath, "utf8");

  // Update or add the network section
  const networkSection = network === "mainnet" ? "mainnet" : network;
  const regex = new RegExp(`\\[programs\\.${networkSection}\\]\\s*\\n[^\\[]*`, "g");
  const newSection = `[programs.${networkSection}]\n${PROGRAM_NAME} = "${programId}"\n\n`;

  if (content.match(regex)) {
    content = content.replace(regex, newSection);
  } else {
    // Add new section before [registry] or at end
    const registryIndex = content.indexOf("[registry]");
    if (registryIndex !== -1) {
      content = content.slice(0, registryIndex) + newSection + content.slice(registryIndex);
    } else {
      content += "\n" + newSection;
    }
  }

  fs.writeFileSync(anchorTomlPath, content);
  console.log(`   Updated Anchor.toml [programs.${networkSection}]`);
}

function updateIdl(programId: string): void {
  const idlPath = path.resolve(PROJECT_ROOT, "target/idl/setto_payment.json");
  if (!fs.existsSync(idlPath)) {
    console.log(`   IDL file not found, skipping IDL update`);
    return;
  }

  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  idl.address = programId;
  fs.writeFileSync(idlPath, JSON.stringify(idl, null, 2));
  console.log(`   Updated IDL with Program ID: ${programId}`);
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("    Setto Payment - Solana Program Deployment");
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

  if (network === "mainnet") {
    console.log("\n⚠️  WARNING: This is a MAINNET deployment!");
    const { confirmMainnet } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmMainnet",
        message: "Are you sure you want to deploy to MAINNET?",
        default: false,
      },
    ]);
    if (!confirmMainnet) {
      console.log("Deployment cancelled.");
      process.exit(0);
    }
  }

  // 2. Get Program Private Key (optional - for existing program address)
  console.log("\n--- Program Configuration ---");
  console.log("Leave empty to generate new Program ID\n");

  const { programPrivateKey } = await inquirer.prompt([
    {
      type: "password",
      name: "programPrivateKey",
      message: "Program private key (base58, or empty for new):",
      mask: "*",
      validate: (input: string) => {
        if (!input) return true; // Empty is OK - will generate new
        try {
          const keypair = loadKeypairFromPrivateKey(input);
          return keypair.publicKey ? true : "Invalid private key";
        } catch {
          return "Invalid base58 private key";
        }
      },
    },
  ]);

  let programKeypair: Keypair;
  let isNewProgram = false;

  if (programPrivateKey) {
    programKeypair = loadKeypairFromPrivateKey(programPrivateKey);
    console.log(`\nUsing existing Program ID: ${programKeypair.publicKey.toBase58()}`);
  } else {
    programKeypair = Keypair.generate();
    isNewProgram = true;
    console.log(`\nGenerated new Program ID: ${programKeypair.publicKey.toBase58()}`);
    console.log("⚠️  SAVE THIS PRIVATE KEY SECURELY:");
    console.log(`   ${bs58.encode(programKeypair.secretKey)}`);

    const { savedKey } = await inquirer.prompt([
      {
        type: "confirm",
        name: "savedKey",
        message: "Have you saved the Program private key?",
        default: false,
      },
    ]);
    if (!savedKey) {
      console.log("Please save the key and try again.");
      process.exit(0);
    }
  }

  const programId = programKeypair.publicKey.toBase58();

  // 3. Get deployer private key
  console.log("\n--- Deployer Configuration ---\n");

  const { deployerPrivateKey } = await inquirer.prompt([
    {
      type: "password",
      name: "deployerPrivateKey",
      message: "Deployer private key (base58, pays gas):",
      mask: "*",
      validate: (input: string) => {
        if (!input) return "Deployer private key is required";
        try {
          const keypair = loadKeypairFromPrivateKey(input);
          return keypair.publicKey ? true : "Invalid private key";
        } catch {
          return "Invalid base58 private key";
        }
      },
    },
  ]);

  const deployerKeypair = loadKeypairFromPrivateKey(deployerPrivateKey);
  const deployerAddress = deployerKeypair.publicKey.toBase58();
  console.log(`Deployer: ${deployerAddress}`);

  // Check balance
  const connection = new Connection(networkConfig.rpcUrl, "confirmed");
  const balance = await checkSolBalance(connection, deployerKeypair.publicKey);
  console.log(`Balance: ${balance.toFixed(4)} SOL`);

  if (balance < 3) {
    console.log("\n⚠️  WARNING: Balance might be low. Deployment requires ~3 SOL");
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

  // 4. Confirmation
  console.log("\n" + "=".repeat(60));
  console.log("    Deployment Summary");
  console.log("=".repeat(60));
  console.log(`Network:         ${networkConfig.name}`);
  console.log(`Program ID:      ${programId} ${isNewProgram ? "(NEW)" : "(EXISTING)"}`);
  console.log(`Deployer:        ${deployerAddress}`);
  console.log("=".repeat(60));
  console.log("\n⚠️  Note: Run './scripts/run/3-init.sh' after deployment to initialize config.");

  const { confirmDeploy } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmDeploy",
      message: "Proceed with deployment?",
      default: false,
    },
  ]);

  if (!confirmDeploy) {
    console.log("Deployment cancelled.");
    process.exit(0);
  }

  // 6. Update source files with Program ID
  console.log("\n📝 Updating Program ID in source files...");
  updateLibRs(programId);
  updateAnchorToml(network, programId);

  // 7. Check that .so file exists (must run ./scripts/run/1-build.sh first)
  const programSoPath = path.resolve(PROJECT_ROOT, "target/deploy/setto_payment.so");
  if (!fs.existsSync(programSoPath)) {
    console.error("\n❌ Program .so file not found!");
    console.error("   Run './scripts/run/1-build.sh' first to build with solana-verify.");
    process.exit(1);
  }
  console.log("✅ Found built program: target/deploy/setto_payment.so");

  // 8. Deploy program - use spawnSync with array args to prevent command injection
  console.log(`\n🚀 Deploying to ${networkConfig.name}...`);

  const deployerKeypairJson = JSON.stringify(Array.from(deployerKeypair.secretKey));
  const programKeypairJson = JSON.stringify(Array.from(programKeypair.secretKey));

  // Create temp files with restricted permissions
  const tempDir = "/tmp";
  const deployerTempPath = path.join(tempDir, `.deploy-${Date.now()}-deployer.json`);
  const programTempPath = path.join(tempDir, `.deploy-${Date.now()}-program.json`);

  try {
    // Write with restricted permissions (owner only)
    fs.writeFileSync(deployerTempPath, deployerKeypairJson, { mode: 0o600 });
    fs.writeFileSync(programTempPath, programKeypairJson, { mode: 0o600 });

    // Use spawnSync with array args - prevents command injection
    const deployProcess = spawnSync("solana", [
      "program",
      "deploy",
      programSoPath,
      "--url",
      networkConfig.rpcUrl,
      "--keypair",
      deployerTempPath,
      "--program-id",
      programTempPath,
      "--commitment",
      "confirmed",
    ], {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
    });

    if (deployProcess.status !== 0) {
      throw new Error("Deployment process failed");
    }

    console.log("✅ Program deployed");

    // Update IDL with correct program ID after successful deploy
    updateIdl(programId);
  } catch (error) {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  } finally {
    // Immediately delete temp files
    if (fs.existsSync(deployerTempPath)) {
      fs.unlinkSync(deployerTempPath);
    }
    if (fs.existsSync(programTempPath)) {
      fs.unlinkSync(programTempPath);
    }
  }

  // 9. Save deployment result (no private keys!)
  const deploymentResult: DeploymentResult = {
    network: networkConfig.name,
    programId: programId,
    deployer: deployerAddress,
    timestamp: new Date().toISOString(),
  };

  const deploymentsDir = path.resolve(PROJECT_ROOT, "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentFile = path.resolve(deploymentsDir, `solana-${network}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentResult, null, 2));
  console.log(`\n📄 Deployment saved to: ${deploymentFile}`);

  // 11. Print explorer links
  console.log("\n" + "=".repeat(60));
  console.log("    Deployment Complete!");
  console.log("=".repeat(60));
  console.log(`\n🔗 Explorer Links:`);
  const clusterParam = network === "mainnet" ? "" : `?cluster=${networkConfig.cluster}`;
  console.log(`   Program: ${networkConfig.explorer}/account/${programId}${clusterParam}`);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.CONFIG)],
    new PublicKey(programId)
  );
  console.log(`   Config:  ${networkConfig.explorer}/account/${configPda.toBase58()}${clusterParam}`);
  console.log("");
}

main().catch(console.error);
