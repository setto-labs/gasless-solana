import { Connection, PublicKey } from "@solana/web3.js";
import inquirer from "inquirer";
import fs from "fs";
import path from "path";

import {
  NETWORKS,
  NetworkKey,
  CONFIG_OFFSETS,
  PDA_SEEDS,
  ANCHOR_TOML_SECTIONS,
  PROGRAM_NAME,
} from "./constants";

/**
 * Anchor.toml에서 네트워크별 Program ID를 읽어옴
 */
function getProgramIdFromAnchorToml(network: string): PublicKey {
  const anchorTomlPath = path.resolve(__dirname, "../Anchor.toml");

  if (!fs.existsSync(anchorTomlPath)) {
    throw new Error("Anchor.toml not found. Run from solana-program directory.");
  }

  const content = fs.readFileSync(anchorTomlPath, "utf8");
  const section = ANCHOR_TOML_SECTIONS[network] || ANCHOR_TOML_SECTIONS.devnet;

  // Parse [programs.{network}] section
  const sectionRegex = new RegExp(
    `\\[${section.replace(".", "\\.")}\\][\\s\\S]*?${PROGRAM_NAME}\\s*=\\s*"([^"]+)"`
  );
  const match = content.match(sectionRegex);

  if (!match) {
    throw new Error(`Program ID for ${network} not found in Anchor.toml. Deploy first.`);
  }

  return new PublicKey(match[1]);
}

interface ConfigData {
  authority: string;
  emergencyAdmin: string;
  feeRecipient: string;
  paused: boolean;
  bump: number;
}

function parseConfigAccount(data: Buffer): ConfigData {
  return {
    authority: new PublicKey(
      data.slice(CONFIG_OFFSETS.AUTHORITY, CONFIG_OFFSETS.AUTHORITY + 32)
    ).toBase58(),
    emergencyAdmin: new PublicKey(
      data.slice(CONFIG_OFFSETS.EMERGENCY_ADMIN, CONFIG_OFFSETS.EMERGENCY_ADMIN + 32)
    ).toBase58(),
    feeRecipient: new PublicKey(
      data.slice(CONFIG_OFFSETS.FEE_RECIPIENT, CONFIG_OFFSETS.FEE_RECIPIENT + 32)
    ).toBase58(),
    paused: data[CONFIG_OFFSETS.PAUSED] === 1,
    bump: data[CONFIG_OFFSETS.BUMP],
  };
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("    Setto Payment - Program Status");
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

  console.log(`\nChecking ${networkConfig.name}...`);

  // Get Program ID from Anchor.toml
  const programId = getProgramIdFromAnchorToml(network);

  // 2. Check program
  console.log("\n" + "-".repeat(60));
  console.log("Program");
  console.log("-".repeat(60));
  console.log(`Address: ${programId.toBase58()}`);

  const programAccount = await connection.getAccountInfo(programId);
  if (!programAccount) {
    console.log("Status:  ❌ NOT DEPLOYED");
    process.exit(0);
  }

  console.log("Status:  ✅ DEPLOYED");
  console.log(`Size:    ${programAccount.data.length} bytes`);

  // 3. Check config
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.CONFIG)],
    programId
  );

  console.log("\n" + "-".repeat(60));
  console.log("Config PDA");
  console.log("-".repeat(60));
  console.log(`Address: ${configPda.toBase58()}`);

  const configAccount = await connection.getAccountInfo(configPda);
  if (!configAccount) {
    console.log("Status:  ❌ NOT INITIALIZED");
    process.exit(0);
  }

  console.log("Status:  ✅ INITIALIZED");

  // 4. Parse and display config
  const configData = parseConfigAccount(configAccount.data);

  console.log("\n" + "-".repeat(60));
  console.log("Configuration");
  console.log("-".repeat(60));
  console.log(`Authority:       ${configData.authority}`);
  console.log(`Emergency Admin: ${configData.emergencyAdmin}`);
  console.log(`Fee Recipient:   ${configData.feeRecipient}`);
  console.log(`Paused:          ${configData.paused ? "YES ⚠️" : "NO ✅"}`);
  console.log("");
  console.log("Note: Server signers are stored as separate PDA accounts.");
  console.log("      Use 'add-server-signer' / 'remove-server-signer' to manage.");

  // 5. Explorer links
  const clusterParam = network === "mainnet" ? "" : `?cluster=${networkConfig.cluster}`;
  console.log("\n" + "-".repeat(60));
  console.log("Explorer Links");
  console.log("-".repeat(60));
  console.log(`Program: ${networkConfig.explorer}/account/${programId.toBase58()}${clusterParam}`);
  console.log(`Config:  ${networkConfig.explorer}/account/${configPda.toBase58()}${clusterParam}`);

  console.log("\n" + "=".repeat(60) + "\n");
}

main().catch(console.error);
