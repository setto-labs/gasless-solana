/**
 * Solana Program Scripts - Constants & Configuration
 * 모든 스크립트에서 공통으로 사용하는 상수 정의
 */

// Solana Network Types
export const SOLANA_CLUSTER = {
  MAINNET: "mainnet-beta",
  DEVNET: "devnet",
  LOCALNET: "localnet",
} as const;

export type SolanaCluster = (typeof SOLANA_CLUSTER)[keyof typeof SOLANA_CLUSTER];

// Network Key (사용자 선택용)
export type NetworkKey = "mainnet" | "devnet";

// RPC Endpoints
export const RPC_ENDPOINTS = {
  mainnet: "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
} as const;

// Block Explorer
export const EXPLORER_URL = "https://solscan.io" as const;

// Network Configuration
export interface NetworkConfig {
  readonly name: string;
  readonly cluster: SolanaCluster;
  readonly rpcUrl: string;
  readonly explorer: string;
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  mainnet: {
    name: "Solana Mainnet",
    cluster: SOLANA_CLUSTER.MAINNET,
    rpcUrl: RPC_ENDPOINTS.mainnet,
    explorer: EXPLORER_URL,
  },
  devnet: {
    name: "Solana Devnet",
    cluster: SOLANA_CLUSTER.DEVNET,
    rpcUrl: RPC_ENDPOINTS.devnet,
    explorer: EXPLORER_URL,
  },
} as const;

// Anchor.toml section mapping
export const ANCHOR_TOML_SECTIONS: Record<string, string> = {
  mainnet: "programs.mainnet",
  devnet: "programs.devnet",
  localnet: "programs.localnet",
} as const;

// Config Account Structure Offsets
// discriminator (8) + authority (32) + emergency_admin (32) + fee_recipient (32) + paused (1) + bump (1)
export const CONFIG_OFFSETS = {
  DISCRIMINATOR: 0,
  AUTHORITY: 8,
  EMERGENCY_ADMIN: 40,
  FEE_RECIPIENT: 72,
  PAUSED: 104,
  BUMP: 105,
} as const;

// ServerSigner Account Structure Offsets
// discriminator (8) + signer (32) + is_active (1) + bump (1)
export const SERVER_SIGNER_OFFSETS = {
  DISCRIMINATOR: 0,
  SIGNER: 8,
  IS_ACTIVE: 40,
  BUMP: 41,
} as const;

// PDA Seeds
export const PDA_SEEDS = {
  CONFIG: "config",
  SERVER_SIGNER: "server_signer",
} as const;

// Program Name (Anchor.toml에서 사용)
export const PROGRAM_NAME = "setto_payment" as const;
