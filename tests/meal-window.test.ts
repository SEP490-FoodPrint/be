import assert from "node:assert/strict";
import { test } from "node:test";
import { assertMealWindow } from "../src/modules/kitchen/kitchen.service";
import { HttpError } from "../src/utils/http-error";

const lunch = new Date("1970-01-01T11:30:00Z");
// Giờ Việt Nam = UTC + 7
const vn = (clock: string) => new Date(`2032-01-05T${clock}:00+07:00`);

const blocked = (message: RegExp) => (error: unknown) =>
  error instanceof HttpError &&
  error.statusCode === 409 &&
  message.test(error.message);

void test("before and at lunch time only lunch batches can be cooked", () => {
  for (const clock of ["06:00", "11:29", "11:30"]) {
    assert.doesNotThrow(() => assertMealWindow("LUNCH", lunch, vn(clock)));
    assert.throws(
      () => assertMealWindow("AFTERNOON", lunch, vn(clock)),
      blocked(/Chưa tới khung giờ bữa xế \(sau 11:30\)/),
    );
  }
});

void test("after lunch time only afternoon batches can be cooked", () => {
  for (const clock of ["11:31", "14:00", "23:59"]) {
    assert.doesNotThrow(() => assertMealWindow("AFTERNOON", lunch, vn(clock)));
    assert.throws(
      () => assertMealWindow("LUNCH", lunch, vn(clock)),
      blocked(/Đã qua giờ bữa trưa \(11:30\)/),
    );
  }
});

void test("schools without a lunch time are not blocked", () => {
  for (const time of [null, undefined, new Date("invalid")]) {
    assert.doesNotThrow(() => assertMealWindow("LUNCH", time, vn("16:00")));
    assert.doesNotThrow(() => assertMealWindow("AFTERNOON", time, vn("07:00")));
  }
});
