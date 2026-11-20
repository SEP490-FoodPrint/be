import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deliveryOrderTypeBatch,
  isDryDelivery,
} from "../src/modules/delivery/delivery.service";
import { validateDeliveryInspectionQuery } from "../src/modules/delivery/delivery.validation";
import { validateSupplyOrderListQuery } from "../src/modules/supply-order/supply-order.validation";

const freshItem = {
  IngredientEntry: { handlingType: "DIRECT_USE" },
  SupplyRequestItem: null,
};
const dryItem = {
  IngredientEntry: { handlingType: "DRY_STOCK" },
  SupplyRequestItem: null,
};

void test("T7: delivery exposes orderType/batchNo from its order; standalone has no batch", () => {
  assert.deepEqual(
    deliveryOrderTypeBatch({
      SupplyRequest: { orderType: "DIRECT_USE", batchNo: 2 },
      deliveryItems: [freshItem],
    }),
    { orderType: "DIRECT_USE", batchNo: 2 },
  );
  assert.deepEqual(deliveryOrderTypeBatch({ deliveryItems: [dryItem] }), {
    orderType: "DRY_STOCK",
    batchNo: null,
  });
});

void test("T8: isDryDelivery prefers the order's orderType", () => {
  assert.equal(
    isDryDelivery({
      SupplyRequest: { orderType: "DIRECT_USE" },
      deliveryItems: [dryItem],
    }),
    false,
  );
  assert.equal(
    isDryDelivery({
      SupplyRequest: { orderType: "DRY_STOCK" },
      deliveryItems: [freshItem],
    }),
    true,
  );
  assert.equal(isDryDelivery({ deliveryItems: [dryItem] }), true);
  assert.equal(isDryDelivery({ deliveryItems: [dryItem, freshItem] }), false);
});

void test("T6: list filters accept strict orderType/batchNo only", () => {
  const q = validateSupplyOrderListQuery({
    orderType: "DRY_STOCK",
    batchNo: "2",
  });
  assert.equal(q.orderType, "DRY_STOCK");
  assert.equal(q.batchNo, 2);
  assert.throws(() => validateSupplyOrderListQuery({ batchNo: "3" }));
  assert.throws(() => validateSupplyOrderListQuery({ orderType: "X" }));
  const d = validateDeliveryInspectionQuery({
    orderType: "DIRECT_USE",
    batchNo: "1",
  });
  assert.equal(d.batchNo, 1);
  assert.throws(() => validateDeliveryInspectionQuery({ batchNo: "0" }));
});
