import { Connection, PublicKey } from "@solana/web3.js";
import inquirer from "inquirer";
import fs from "fs";
import path from "path";

import {
  NETWORKS,
  NetworkKey,
  CONFIG_OFFSETS,
  SERVER_SIGNER_OFFSETS,
  RELAYER_OFFSETS,
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
      data.subarray(CONFIG_OFFSETS.AUTHORITY, CONFIG_OFFSETS.AUTHORITY + 32)
    ).toBase58(),
    emergencyAdmin: new PublicKey(
      data.subarray(CONFIG_OFFSETS.EMERGENCY_ADMIN, CONFIG_OFFSETS.EMERGENCY_ADMIN + 32)
    ).toBase58(),
    feeRecipient: new PublicKey(
      data.subarray(CONFIG_OFFSETS.FEE_RECIPIENT, CONFIG_OFFSETS.FEE_RECIPIENT + 32)
    ).toBase58(),
    paused: data[CONFIG_OFFSETS.PAUSED] === 1,
    bump: data[CONFIG_OFFSETS.BUMP],
  };
}

interface ServerSignerData {
  signer: string;
  isActive: boolean;
  bump: number;
}

function parseServerSignerAccount(data: Buffer): ServerSignerData {
  return {
    signer: new PublicKey(
      data.subarray(SERVER_SIGNER_OFFSETS.SIGNER, SERVER_SIGNER_OFFSETS.SIGNER + 32)
    ).toBase58(),
    isActive: data[SERVER_SIGNER_OFFSETS.IS_ACTIVE] === 1,
    bump: data[SERVER_SIGNER_OFFSETS.BUMP],
  };
}

interface RelayerData {
  relayer: string;
  isActive: boolean;
  bump: number;
}

function parseRelayerAccount(data: Buffer): RelayerData {
  return {
    relayer: new PublicKey(
      data.subarray(RELAYER_OFFSETS.RELAYER, RELAYER_OFFSETS.RELAYER + 32)
    ).toBase58(),
    isActive: data[RELAYER_OFFSETS.IS_ACTIVE] === 1,
    bump: data[RELAYER_OFFSETS.BUMP],
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

  // Discriminators from IDL (first 8 bytes of account data)
  const SERVER_SIGNER_DISCRIMINATOR = Buffer.from([45, 255, 4, 21, 31, 92, 155, 235]);
  const RELAYER_DISCRIMINATOR = Buffer.from([168, 116, 52, 174, 161, 196, 71, 218]);

  // 5. Fetch all 42-byte accounts (both ServerSigner and Relayer have same size)
  const allAccounts = await connection.getProgramAccounts(programId, {
    filters: [{ dataSize: 42 }],
  });

  // 6. Display Server Signers (filter by discriminator)
  console.log("\n" + "-".repeat(60));
  console.log("Server Signers (All)");
  console.log("-".repeat(60));

  const serverSigners = allAccounts
    .filter((account) => {
      const discriminator = account.account.data.subarray(0, 8);
      return discriminator.equals(SERVER_SIGNER_DISCRIMINATOR);
    })
    .map((account) => ({
      pda: account.pubkey.toBase58(),
      data: parseServerSignerAccount(account.account.data),
    }));

  if (serverSigners.length === 0) {
    console.log("  No ServerSigners registered");
  } else {
    serverSigners.forEach((s, i) => {
      const status = s.data.isActive ? "✅ ACTIVE" : "❌ INACTIVE";
      console.log(`  ${i + 1}. ${s.data.signer} ${status}`);
    });
  }

  // 7. Display Relayers (filter by discriminator)
  console.log("\n" + "-".repeat(60));
  console.log("Relayers (All)");
  console.log("-".repeat(60));

  const relayers = allAccounts
    .filter((account) => {
      const discriminator = account.account.data.subarray(0, 8);
      return discriminator.equals(RELAYER_DISCRIMINATOR);
    })
    .map((account) => ({
      pda: account.pubkey.toBase58(),
      data: parseRelayerAccount(account.account.data),
    }));

  if (relayers.length === 0) {
    console.log("  No Relayers registered");
  } else {
    relayers.forEach((r, i) => {
      const status = r.data.isActive ? "✅ ACTIVE" : "❌ INACTIVE";
      console.log(`  ${i + 1}. ${r.data.relayer} ${status}`);
    });
  }

  // 7. Explorer links
  const clusterParam = network === "mainnet" ? "" : `?cluster=${networkConfig.cluster}`;
  console.log("\n" + "-".repeat(60));
  console.log("Explorer Links");
  console.log("-".repeat(60));
  console.log(`Program: ${networkConfig.explorer}/account/${programId.toBase58()}${clusterParam}`);
  console.log(`Config:  ${networkConfig.explorer}/account/${configPda.toBase58()}${clusterParam}`);

  console.log("\n" + "=".repeat(60) + "\n");
}

main().catch(console.error);
