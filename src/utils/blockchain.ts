import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  Contract,
  FetchRequest,
  JsonRpcProvider,
  Wallet,
  isError,
  type ContractTransactionResponse,
} from "ethers";
import { z } from "zod";

const deploymentSchema = z.object({
  contractName: z.string().optional(),
  chainId: z.number(),
  address: z.string(),
  abi: z.array(z.unknown()),
});

export type DeploymentInfo = z.infer<typeof deploymentSchema>;

export interface BlockchainAnchorResult {
  recordId: string;
  dataHash: string;
  txHash: string;
  blockNumber: number;
  networkName: string;
  contractAddress: string;
}

export interface BlockchainVerificationResult {
  recordId: string;
  expectedHash: string;
  onChainHash: string | null;
  matches: boolean;
  networkName: string;
  contractAddress: string;
}

function resolveDeploymentPath(): string {
  if (process.env.BLOCKCHAIN_DEPLOYMENT_PATH) {
    return resolve(process.cwd(), process.env.BLOCKCHAIN_DEPLOYMENT_PATH);
  }
  return resolve(
    __dirname,
    "../../../../FoodPrintBlockChain/deployments/localhost/FoodPrintHashRegistry.json",
  );
}

function getRpcUrl(): string {
  return process.env.BLOCKCHAIN_RPC_URL || "http://127.0.0.1:8545";
}

export function loadDeployment(): DeploymentInfo {
  const filePath = resolveDeploymentPath();
  if (!existsSync(filePath)) {
    throw new Error(
      `Không tìm thấy file deployment tại ${filePath}. Vui lòng chạy npm run deploy:local trong FoodPrintBlockChain.`,
    );
  }
  const raw = readFileSync(filePath, "utf8");
  return deploymentSchema.parse(JSON.parse(raw));
}

export function createBlockchainProvider(): JsonRpcProvider {
  const rpc = new FetchRequest(getRpcUrl());
  rpc.timeout = 8000;
  return new JsonRpcProvider(rpc);
}

export async function getContractInstance(
  provider: JsonRpcProvider,
  withSigner = false,
) {
  const deployment = loadDeployment();
  const network = await provider.getNetwork();

  if (Number(network.chainId) !== deployment.chainId) {
    throw new Error(
      `Chain ID của RPC (${network.chainId}) không khớp với deployment (${deployment.chainId}).`,
    );
  }

  const code = await provider.getCode(deployment.address);
  if (code === "0x") {
    throw new Error(
      `Chưa có bytecode hợp đồng tại địa chỉ ${deployment.address}. Vui lòng deploy lại hợp đồng.`,
    );
  }

  const contract = new Contract(
    deployment.address,
    JSON.stringify(deployment.abi),
    provider,
  );

  if (!withSigner) {
    return { contract, deployment };
  }

  let signer;
  if (process.env.BLOCKCHAIN_WRITER_PRIVATE_KEY) {
    signer = new Wallet(process.env.BLOCKCHAIN_WRITER_PRIVATE_KEY, provider);
  } else {
    signer = await provider.getSigner(0);
  }

  return { contract: contract.connect(signer), deployment };
}

/**
 * Anchors a recordId and dataHash onto the blockchain registry.
 */
export async function anchorHashOnChain(
  recordId: string,
  dataHash: string,
): Promise<BlockchainAnchorResult> {
  const provider = createBlockchainProvider();
  try {
    const { contract, deployment } = await getContractInstance(provider, true);
    const confirmHashFn: (rId: string, hash: string) => Promise<unknown> =
      contract.getFunction("confirmHash");

    const tx = (await confirmHashFn(
      recordId,
      dataHash,
    )) as ContractTransactionResponse;

    const receipt = await tx.wait(1, 15000);
    if (!receipt) {
      throw new Error("Không nhận được biên nhận giao dịch (receipt timeout).");
    }

    return {
      recordId,
      dataHash,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      networkName:
        deployment.chainId === 31337 ? "Hardhat Local" : "Polygon Amoy",
      contractAddress: deployment.address,
    };
  } finally {
    provider.destroy();
  }
}

/**
 * Reads hash from the blockchain registry for a given recordId.
 */
export async function readHashFromChain(
  recordId: string,
): Promise<{ onChainHash: string | null; deployment: DeploymentInfo }> {
  const provider = createBlockchainProvider();
  try {
    const { contract, deployment } = await getContractInstance(provider, false);
    const getHashFn: (rId: string) => Promise<unknown> =
      contract.getFunction("getHash");

    try {
      const rawHash = await getHashFn(recordId);
      return { onChainHash: z.string().parse(rawHash), deployment };
    } catch (error) {
      if (
        isError(error, "CALL_EXCEPTION") &&
        error.revert?.name === "RecordNotFound"
      ) {
        return { onChainHash: null, deployment };
      }
      throw error;
    }
  } finally {
    provider.destroy();
  }
}

/**
 * Verifies if expectedHash matches the hash recorded on chain.
 */
export async function verifyHashOnChain(
  recordId: string,
  expectedHash: string,
): Promise<BlockchainVerificationResult> {
  const { onChainHash, deployment } = await readHashFromChain(recordId);
  const matches =
    onChainHash !== null &&
    onChainHash.toLowerCase() === expectedHash.toLowerCase();

  return {
    recordId,
    expectedHash,
    onChainHash,
    matches,
    networkName:
      deployment.chainId === 31337 ? "Hardhat Local" : "Polygon Amoy",
    contractAddress: deployment.address,
  };
}
