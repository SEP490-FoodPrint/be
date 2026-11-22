import assert from "node:assert/strict";
import { test } from "node:test";
import { deliveryInspectionRepository } from "../src/modules/delivery/delivery.repository";

type Status = string;

/** Giả lập tx: các đợt giao của một đơn và trạng thái đơn. */
function fakeTx(deliveries: Status[], requestStatus: Status) {
  const state = { requestStatus };
  const tx = {
    delivery: {
      count: ({ where }: { where: { status: { in: Status[] } } }) =>
        Promise.resolve(
          deliveries.filter((status) => where.status.in.includes(status))
            .length,
        ),
    },
    supplyRequest: {
      updateMany: ({
        where,
        data,
      }: {
        where: { status: Status };
        data: { status: Status };
      }) => {
        if (state.requestStatus !== where.status)
          return Promise.resolve({ count: 0 });
        state.requestStatus = data.status;
        return Promise.resolve({ count: 1 });
      },
    },
  };
  return { tx: tx as never, state };
}

void test("đơn có một đợt giao: nhận xong thì đơn hoàn tất", async () => {
  const { tx, state } = fakeTx(["RECEIVED"], "IN_PROGRESS");
  assert.equal(
    await deliveryInspectionRepository.completeRequestIfDone(tx, "req"),
    1,
  );
  assert.equal(state.requestStatus, "COMPLETED");
});

void test("còn đợt giao khác đang chạy thì đơn vẫn đang giao", async () => {
  for (const running of [
    "CREATED",
    "PREPARING",
    "IN_TRANSIT",
    "ARRIVED",
    "PENDING_APPROVAL",
    "APPROVED",
  ]) {
    const { tx, state } = fakeTx(["RECEIVED", running], "IN_PROGRESS");
    assert.equal(
      await deliveryInspectionRepository.completeRequestIfDone(tx, "req"),
      0,
      running,
    );
    assert.equal(state.requestStatus, "IN_PROGRESS", running);
  }
});

void test("đợt bị từ chối rồi giao lại và được nhận: đơn hoàn tất", async () => {
  const { tx, state } = fakeTx(["REJECTED", "RECEIVED"], "IN_PROGRESS");
  assert.equal(
    await deliveryInspectionRepository.completeRequestIfDone(tx, "req"),
    1,
  );
  assert.equal(state.requestStatus, "COMPLETED");
});

void test("đơn không ở trạng thái đang giao thì không bị đổi", async () => {
  for (const status of ["CANCELLED", "COMPLETED", "ACCEPTED"]) {
    const { tx, state } = fakeTx(["RECEIVED"], status);
    assert.equal(
      await deliveryInspectionRepository.completeRequestIfDone(tx, "req"),
      0,
      status,
    );
    assert.equal(state.requestStatus, status);
  }
});
