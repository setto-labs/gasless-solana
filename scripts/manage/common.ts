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
  ANCHOR_TOML_SECTIONS,
  CONFIG_OFFSETS,
  SERVER_SIGNER_OFFSETS,
  RELAYER_OFFSETS,
  PDA_SEEDS,
  PROGRAM_NAME,
} from "../constants";

// Re-export for convenience
export { NETWORKS, NetworkKey };

/**
 * Anchor.toml에서 네트워크별 Program ID를 읽어옴
 */
export function getProgramIdFromAnchorToml(network: string): PublicKey {
  const anchorTomlPath = path.resolve(__dirname, "../../Anchor.toml");

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

export interface ConfigData {
  authority: string;
  emergencyAdmin: string;
  feeRecipient: string;
  paused: boolean;
  bump: number;
}

export interface ServerSignerData {
  signer: string;
  isActive: boolean;
  bump: number;
}

export function loadKeypairFromPrivateKey(privateKeyBase58: string): Keypair {
  const secretKey = bs58.decode(privateKeyBase58);
  return Keypair.fromSecretKey(secretKey);
}

export function isValidPublicKey(input: string): boolean {
  try {
    new PublicKey(input);
    return true;
  } catch {
    return false;
  }
}

export function parseConfigAccount(data: Buffer): ConfigData {
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

export function parseServerSignerAccount(data: Buffer): ServerSignerData {
  return {
    signer: new PublicKey(
      data.slice(SERVER_SIGNER_OFFSETS.SIGNER, SERVER_SIGNER_OFFSETS.SIGNER + 32)
    ).toBase58(),
    isActive: data[SERVER_SIGNER_OFFSETS.IS_ACTIVE] === 1,
    bump: data[SERVER_SIGNER_OFFSETS.BUMP],
  };
}

export async function selectNetwork(): Promise<NetworkKey> {
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
  return network;
}

export async function getPrivateKey(label: string): Promise<Keypair> {
  const { privateKey } = await inquirer.prompt([
    {
      type: "password",
      name: "privateKey",
      message: `Enter ${label} private key (base58):`,
      mask: "*",
      validate: (input: string) => {
        try {
          const keypair = loadKeypairFromPrivateKey(input);
          return keypair.publicKey ? true : "Invalid private key";
        } catch {
          return "Invalid base58 private key";
        }
      },
    },
  ]);
  return loadKeypairFromPrivateKey(privateKey);
}

export async function getConfigData(
  connection: Connection,
  network: NetworkKey
): Promise<ConfigData | null> {
  const programId = getProgramIdFromAnchorToml(network);
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.CONFIG)],
    programId
  );

  const configAccount = await connection.getAccountInfo(configPda);
  if (!configAccount) {
    return null;
  }

  return parseConfigAccount(configAccount.data);
}

export function getConfigPda(network: NetworkKey): PublicKey {
  const programId = getProgramIdFromAnchorToml(network);
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.CONFIG)],
    programId
  );
  return configPda;
}

export function getServerSignerPda(network: NetworkKey, signerPubkey: PublicKey): PublicKey {
  const programId = getProgramIdFromAnchorToml(network);
  const [serverSignerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.SERVER_SIGNER), signerPubkey.toBuffer()],
    programId
  );
  return serverSignerPda;
}

export async function getServerSignerData(
  connection: Connection,
  network: NetworkKey,
  signerPubkey: PublicKey
): Promise<ServerSignerData | null> {
  const serverSignerPda = getServerSignerPda(network, signerPubkey);
  const account = await connection.getAccountInfo(serverSignerPda);
  if (!account) {
    return null;
  }
  return parseServerSignerAccount(account.data);
}

export function loadProgram(connection: Connection, wallet: anchor.Wallet): Program {
  const idlPath = path.resolve(__dirname, "../../target/idl/setto_payment.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  return new Program(idl, provider);
}

export function printExplorerLink(network: NetworkKey, txSignature: string): void {
  const networkConfig = NETWORKS[network];
  const clusterParam = network === "mainnet" ? "" : `?cluster=${networkConfig.cluster}`;
  console.log(
    `\n🔗 Transaction: ${networkConfig.explorer}/tx/${txSignature}${clusterParam}`
  );
}

// Relayer functions
export interface RelayerData {
  relayer: string;
  isActive: boolean;
  bump: number;
}

export function parseRelayerAccount(data: Buffer): RelayerData {
  return {
    relayer: new PublicKey(
      data.subarray(RELAYER_OFFSETS.RELAYER, RELAYER_OFFSETS.RELAYER + 32)
    ).toBase58(),
    isActive: data[RELAYER_OFFSETS.IS_ACTIVE] === 1,
    bump: data[RELAYER_OFFSETS.BUMP],
  };
}

export function getRelayerPda(network: NetworkKey, relayerPubkey: PublicKey): PublicKey {
  const programId = getProgramIdFromAnchorToml(network);
  const [relayerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.RELAYER), relayerPubkey.toBuffer()],
    programId
  );
  return relayerPda;
}

export async function getRelayerData(
  connection: Connection,
  network: NetworkKey,
  relayerPubkey: PublicKey
): Promise<RelayerData | null> {
  const relayerPda = getRelayerPda(network, relayerPubkey);
  const account = await connection.getAccountInfo(relayerPda);
  if (!account) {
    return null;
  }
  return parseRelayerAccount(account.data);
}
