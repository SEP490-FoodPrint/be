# Quickstart Validation: Upload ảnh nguyên liệu

**Trạng thái**: Đây là hướng dẫn kiểm chứng sau khi implement. Bước plan chưa cài Sharp, chưa chạy test feature, chưa gọi Cloudinary hay thay đổi DB.

## 1. Chuẩn bị

- Đọc [API contract](contracts/ingredient-upload-api.md), [helper contract](contracts/upload-helper.md) và [data model](data-model.md).
- Triển khai trên `feat/ingredient-image-upload` tạo từ dev; hoàn thành tasks trước quality checks cuối. Không commit `.specify/feature.json`.
- Node theo `.nvmrc`, npm theo engines; dùng dependency lock sau khi thêm Sharp. Không thay phiên bản runtime để né native install lỗi.
- Để chạy app thật: PostgreSQL/Redis local có sẵn và `.env` riêng hợp lệ, tài khoản supplier admin ACTIVE có ingredient.manage. Không seed/import/migrate DB thành viên chỉ để chạy hướng dẫn này.
- Cấu hình CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET qua môi trường bí mật. Không đưa giá trị thật vào commit hoặc log. Unit test dùng transport giả và không cần credential thật.
- Có tệp mẫu JPEG/PNG/WebP hợp lệ và PDF cho helper tests; fixture ảnh dùng bytes giải mã được, không dùng vài byte signature thay ảnh.

## 2. Kiểm chứng tự động

Từ repository root, sau triển khai:

```bash
npm ci
npx tsx --test tests/cloudinary-upload.test.ts tests/ingredient-upload.test.ts tests/ingredient-management.test.ts tests/onboarding.test.ts
npm run test:unit
npm run validate
```

Hai test mới phải được đăng ký trong script test:unit. Kỳ vọng toàn bộ đạt; ghi số test và kết quả thực tế ở tasks/validation log, không coi các lệnh trên là đã chạy.

| Nhóm           | Kết quả cần thấy                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Bốn hàm/count  | Single đúng1; many1..5;0/6/single2 lỗi trước transport                                                                                    |
| Nội dung       | Đúng5MiB chấp nhận; quá1byte/empty/mismatch/MIME giả/corrupt decode bị chặn; tài liệu chỉPDF/PNG/JPEG                                     |
| Partial result | Lượt5tệp/2lỗi và all-failed giữ đủ index/trạng thái; không destroy/retry, gửi lại riêng lỗi không đụng asset cũ                           |
| Scope/quyền    | Chặn staff/System/missingpermission/inactive supplier trước parser; nạp lại actor trước upload, chặn scope đổi                            |
| SDK adapter    | public image/private raw docs; overwrite=false/existing:true; per-call credentials; deadline/stream error/latecallback; không secret leak |
| Concurrent     | Ít nhất10upload cùng tên ở2suppliers, định danh riêng và kết quả đúng thứ tự                                                              |
| Regression     | Create/update ảnh JSON như cũ; không write DB trong upload; onboarding20tệp/private/cleanup giữ nguyên                                    |

Kiểm thử quyền với DB thật chỉ chạy trên PostgreSQL local disposable được chọn tường minh theo hướng dẫn repository. Khi hạ tầng đó đã được cho phép/chọn:

```bash
npm run test:authorization
```

Không dùng DATABASE_URL của DB thành viên hoặc Azure làm mục tiêu disposable. Các scenario mới dùng fake storage, không upload Cloudinary thật. Không cần migrate/schema tests mới vì feature không đổi schema.

## 3. Smoke HTTP chủ động trên local

Chỉ thực hiện khi muốn tạo tài nguyên ảnh thật trên tài khoản Cloudinary đã cấu hình. Dùng token còn hiệu lực từ luồng đăng nhập hiện có; nếu dùng cookie, thay Authorization bằng cookie jar hiện có. Không ghi token vào file tracked.

```bash
npm run dev
```

Trong terminal khác (API đang chạy tại localhost5000; sửa cổng nếu cấu hình khác):

```bash
read -r -s 'FOODPRINT_ACCESS_TOKEN?Access token: '
printf '\n'
curl -sS 'http://localhost:5000/api/ingredients/management/upload-image' \
  -H "Authorization: Bearer $FOODPRINT_ACCESS_TOKEN" \
  -H 'X-CSRF-Protection: 1' \
  -F 'image=@/absolute/path/ingredient.jpg;type=image/jpeg'
curl -sS 'http://localhost:5000/api/ingredients/management/upload-images' \
  -H "Authorization: Bearer $FOODPRINT_ACCESS_TOKEN" \
  -H 'X-CSRF-Protection: 1' \
  -F 'images=@/absolute/path/ingredient-a.png;type=image/png' \
  -F 'images=@/absolute/path/ingredient-b.webp;type=image/webp'
unset FOODPRINT_ACCESS_TOKEN
```

Lệnh đọc token dùng zsh như môi trường dự án. Single trả201/data.url; many trả200/data.results. Mở URL thành công, kiểm publicId thuộc namespace supplier hiện tại. Smoke này chỉ upload ảnh, không tạo bản ghi nguyên liệu.

Để kiểm trọn hành trình, dùng URL thành công qua JSON create/update theo [contract quản lý nguyên liệu](../008-supplier-ingredient-management/contracts/ingredient-management.md) với quyền cho phép ghi dữ liệu local, rồi GET chi tiết xác nhận coverImage/thứ tự imageDescription. Không coi hướng dẫn là yêu cầu tự chạy ghi dữ liệu thật.

## 4. Tình huống lỗi

Thử wrong field,6images,multipart textfield và JSON body:400; file>5MiB:413; tài khoản thiếu quyền:401/403 và transport chưa được gọi. Thiếu cấu hình test bằng factory/env cô lập, kỳ vọng503 trước network. Inject transport/clock để gây2lỗi/5tệp, all-failed hoặc timeout; không cố gây lỗi bằng credential thật.

PDF helper kiểm bằng test nội bộ, không có API tài liệu để curl. Nếu sau này cần đọc PDF thật, người vận hành kiểm account delivery policy theo research; không tự sửa setting Cloudinary từ feature này.

## 5. Ghi nhận kết quả

Ghi commit, runtime, các lệnh đã chạy, số test, native Sharp build/install nếu có và prerequisite bị thiếu. Giữ rõ phần chưa chạy; không suy ra upload thành công từ việc chỉ build hoặc chỉ có URL ví dụ.

## Kết quả kiểm tra đã thực hiện

- `npm run validate`: đạt sau khi sửa lỗi lint trong hai file test mới; gồm lint, format, typecheck và build.
- `npm run test:unit`: 487/487 đạt sau khi bổ sung kiểm thử adapter, upload HTTP và hồi quy nguyên liệu.
- Sharp 0.35.5 đã cài và import thành công trên Node 24.22.1.
- Chưa chạy `npm run test:authorization`: chưa chọn PostgreSQL local disposable cho lượt triển khai này; các scenario integration trong task T029 đã được viết nhưng chưa chạy. Không có DB thành viên hoặc Azure bị thay đổi.
- Chưa chạy smoke Cloudinary thật. Các kiểm thử upload dùng transport giả.
- Cần tiếp tục các task chưa đánh dấu, gồm bổ sung độ phủ kiểm thử adapter/deadline, hồi quy onboarding, kiểm chứng integration và rà soát hoàn thiện.
