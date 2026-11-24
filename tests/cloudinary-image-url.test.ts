import assert from "node:assert/strict";
import test from "node:test";
import {
  cloudinaryImageUrl,
  cloudinaryTransformation,
} from "../src/utils/cloudinary";
import {
  EMAIL_LOGO_CLOUDINARY_ID,
  readEmailLogoUrl,
} from "../src/utils/branded-email";

const env = { CLOUDINARY_CLOUD_NAME: "test-cloud" } as NodeJS.ProcessEnv;
const stored =
  "https://res.cloudinary.com/test-cloud/image/upload/v1700000000/foodprint/uploads/ingredient/u1/a.png";

void test("secure_url đã lưu: chèn biến đổi resize/nén, giữ version và public id", () => {
  assert.equal(
    cloudinaryImageUrl(
      stored,
      { width: 320, height: 240, crop: "fill", gravity: "auto" },
      env,
    ),
    "https://res.cloudinary.com/test-cloud/image/upload/c_fill,g_auto,w_320,h_240,q_auto,f_auto/v1700000000/foodprint/uploads/ingredient/u1/a.png",
  );
});

void test("mặc định chỉ nén (q_auto,f_auto); có kích thước thì crop limit", () => {
  assert.equal(
    cloudinaryImageUrl(stored, {}, env),
    "https://res.cloudinary.com/test-cloud/image/upload/q_auto,f_auto/v1700000000/foodprint/uploads/ingredient/u1/a.png",
  );
  assert.equal(
    cloudinaryTransformation({ width: 96, format: "png", quality: 80 }),
    "c_limit,w_96,q_80,f_png",
  );
});

void test("bỏ biến đổi cũ đứng trước version thay vì chồng thêm", () => {
  assert.equal(
    cloudinaryImageUrl(
      "https://res.cloudinary.com/test-cloud/image/upload/w_1000,c_scale/v1/foodprint/a.jpg",
      { width: 200 },
      env,
    ),
    "https://res.cloudinary.com/test-cloud/image/upload/c_limit,w_200,q_auto,f_auto/v1/foodprint/a.jpg",
  );
});

void test("publicId: dựng URL ảnh của cloud đã cấu hình", () => {
  assert.equal(
    cloudinaryImageUrl("foodprint/uploads/school/s1/logo", { width: 48 }, env),
    "https://res.cloudinary.com/test-cloud/image/upload/c_limit,w_48,q_auto,f_auto/foodprint/uploads/school/s1/logo",
  );
});

void test("từ chối nguồn không phải ảnh công khai của cloud mình", () => {
  for (const source of [
    "https://res.cloudinary.com/other-cloud/image/upload/v1/a.png",
    "https://res.cloudinary.com/test-cloud/raw/authenticated/v1/a.pdf",
    "https://res.cloudinary.com/test-cloud/image/private/v1/a.png",
    "http://res.cloudinary.com/test-cloud/image/upload/v1/a.png",
    "https://evil.example/test-cloud/image/upload/v1/a.png",
    "https://user:pw@res.cloudinary.com/test-cloud/image/upload/v1/a.png",
    "https://res.cloudinary.com:8443/test-cloud/image/upload/v1/a.png",
    "https://res.cloudinary.com/test-cloud/image/upload/v1/a.png?x=1",
    "https://res.cloudinary.com/test-cloud/image/upload/v1/",
    "javascript:alert(1)",
    "../secret",
    "a//b",
    "",
    null,
    undefined,
  ])
    assert.equal(cloudinaryImageUrl(source, {}, env), null, String(source));
});

void test("chưa cấu hình cloud thì trả về null", () => {
  assert.equal(cloudinaryImageUrl(stored, {}, {}), null);
  assert.equal(
    cloudinaryImageUrl(
      stored,
      {},
      { CLOUDINARY_CLOUD_NAME: "replace-with-your-cloud-name" },
    ),
    null,
  );
});

void test("tùy chọn sai ném RangeError", () => {
  assert.throws(() => cloudinaryTransformation({ width: 0 }), RangeError);
  assert.throws(() => cloudinaryTransformation({ height: 4001 }), RangeError);
  assert.throws(() => cloudinaryTransformation({ width: 1.5 }), RangeError);
  assert.throws(() => cloudinaryTransformation({ quality: 101 }), RangeError);
  assert.throws(
    () => cloudinaryTransformation({ width: 10, gravity: "face" }),
    RangeError,
  );
});

void test("logo email: link Cloudinary 80×80 PNG; EMAIL_LOGO_URL ưu tiên; chưa cấu hình cloud thì null (nhúng inline)", () => {
  assert.equal(
    readEmailLogoUrl(env),
    `https://res.cloudinary.com/test-cloud/image/upload/c_limit,w_80,h_80,q_auto,f_png/${EMAIL_LOGO_CLOUDINARY_ID}`,
  );
  assert.equal(
    readEmailLogoUrl({
      ...env,
      EMAIL_LOGO_URL: "https://cdn.example/logo.png",
    }),
    "https://cdn.example/logo.png",
  );
  assert.equal(readEmailLogoUrl({}), null);
});
