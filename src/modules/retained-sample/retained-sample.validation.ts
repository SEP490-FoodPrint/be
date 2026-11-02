// Extend this parser with approved filters when this module gains business rules.
export { parseListQuery as validateRetainedSampleListQuery } from "../../utils/list-query";
import { objectBody, text, isoTimestamp } from "../../utils/auth-validation";
import { HttpError } from "../../utils/http-error";

export function validateFoodSample(value: unknown) {
  const body = objectBody(value, [
    "quantity",
    "unit",
    "storageLocation",
    "sampledAt",
  ]);
  if (typeof body.quantity !== "number" && typeof body.quantity !== "string")
    throw new HttpError(400, "Lượng mẫu phải là số hoặc chuỗi số thập phân");
  const quantity = String(body.quantity);
  if (
    !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(quantity) ||
    Number(quantity) <= 0
  )
    throw new HttpError(400, "Lượng mẫu phải dương, tối đa 3 chữ số thập phân");
  const unit = text(body.unit, 30).toLowerCase();
  if (!["g", "ml"].includes(unit))
    throw new HttpError(400, "Đơn vị mẫu lưu phải là g hoặc ml");
  return {
    quantity,
    unit,
    storageLocation: text(body.storageLocation, 255),
    sampledAt: isoTimestamp(body.sampledAt),
  };
}
export function validateSampleDisposal(value: unknown) {
  const body = objectBody(value, ["disposedAt", "disposalNote"]);
  return {
    disposedAt: isoTimestamp(body.disposedAt),
    disposalNote: text(body.disposalNote, 2000),
  };
}
export type FoodSampleInput = ReturnType<typeof validateFoodSample>;
export type SampleDisposalInput = ReturnType<typeof validateSampleDisposal>;
