import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DeliveryStatus } from "../src/generated/prisma/enums";
import {
  getAllDeliveryStatusLabels,
  getDeliveryStatusLabel,
} from "../src/utils/delivery-status";

void describe("delivery-status", () => {
  void it("maps operational and legacy delivery statuses consistently", () => {
    assert.equal(getDeliveryStatusLabel("PREPARING"), "Đang chuẩn bị hàng");
    assert.equal(getDeliveryStatusLabel("IN_TRANSIT"), "Đang giao hàng");
    assert.equal(getDeliveryStatusLabel("RECEIVED"), "Hoàn thành");
    assert.equal(getDeliveryStatusLabel("REJECTED"), "Yêu cầu giao hàng lại");
    assert.equal(getDeliveryStatusLabel("ARRIVED"), "Đã đến nơi");
    assert.equal(getDeliveryStatusLabel("PENDING_APPROVAL"), "Chờ duyệt");
    assert.equal(getDeliveryStatusLabel("CREATED"), "Mới tạo");
    assert.equal(getDeliveryStatusLabel("APPROVED"), "Đã duyệt");
    assert.equal(getDeliveryStatusLabel("CANCELLED"), "Đã hủy");
    assert.equal(getDeliveryStatusLabel("CANCELLED_MEAL"), "Đã hủy suất ăn");
    assert.notEqual(
      getDeliveryStatusLabel("APPROVED"),
      getDeliveryStatusLabel("RECEIVED"),
    );
  });

  void it("covers every Prisma DeliveryStatus enum member without introducing extra lifecycle values", () => {
    const labels = getAllDeliveryStatusLabels();
    assert.deepEqual(
      Object.keys(labels).sort(),
      Object.values(DeliveryStatus).sort(),
    );
  });
});
