import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Contract, FetchRequest, JsonRpcProvider, id } from "ethers";
import type { ContractTransactionResponse } from "ethers";
import { z } from "zod";
import type { operation } from "./blockchain-todo.validation";

const deploymentPath = resolve(
  __dirname,
  "../../../../FoodPrintBlockChain/deployments/localhost/FoodPrintHashRegistry.json",
);
const rpc = new FetchRequest("http://127.0.0.1:8545");
rpc.timeout = 5000;
const provider = new JsonRpcProvider(rpc);

export async function executeTodo(input: z.infer<typeof operation>) {
  const inputHash = id(input.text);
  const deployment = z
    .object({
      chainId: z.number(),
      address: z.string(),
      abi: z.array(z.unknown()),
    })
    .parse(JSON.parse(readFileSync(deploymentPath, "utf8")));
  const { chainId } = await provider.getNetwork();
  if (chainId !== 31337n || deployment.chainId !== Number(chainId)) {
    throw new Error("Demo yêu cầu Hardhat local với chain ID 31337.");
  }
  if ((await provider.getCode(deployment.address)) === "0x") {
    throw new Error(
      "Chưa có contract trên node hiện tại. Chạy npm run deploy:local.",
    );
  }

  const registry = new Contract(
    deployment.address,
    JSON.stringify(deployment.abi),
    provider,
  );

  const getHash: (recordId: string) => Promise<unknown> =
    registry.getFunction("getHash");
  if (input.action === "verify") {
    const onChainHash = z.string().parse(await getHash(input.recordId));
    return { inputHash, onChainHash, matches: inputHash === onChainHash };
  }
  const writer = registry.connect(await provider.getSigner(0));
  const confirmHash: (recordId: string, hash: string) => Promise<unknown> =
    writer.getFunction("confirmHash");
  const recordId = id(`foodprint:demo:todo:${randomUUID()}`);
  const tx = (await confirmHash(
    recordId,
    inputHash,
  )) as ContractTransactionResponse;
  const receipt = await tx.wait(1, 10000);
  if (!receipt) throw new Error("Chưa có biên nhận giao dịch.");
  const onChainHash = z.string().parse(await getHash(recordId));
  return {
    recordId,
    onChainHash,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
  };
}
