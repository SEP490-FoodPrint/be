# Validation guide

Chạy từ root BE với Node/npm theo .nvmrc/package.json; không nạp credentials Azure cho test.

1. Generate client, typecheck và build bằng scripts hiện có.
2. Lint/Prettier file thay đổi, test:unit gồm architecture/contract tests mới.
3. Đối chiếu contracts/api-audit.md; routes/aliases còn đủ, PUT kitchen không còn và menuDayId vẫn bị từ chối.
4. Kiểm tra expiresAt +24h; hai alias lưu mẫu cùng search/status/page/limit trả cùng dữ liệu, totalItems đúng và không lẫn trường.
5. Với MIGRATION_TEST_DATABASE_URL chọn rõ PostgreSQL18 disposable local (foodprint_migration_test...), chạy test:authorization, test:registration-id, test:supplier-onboarding. Không dùng DB thành viên/Azure; tests tạo database con mới.
6. Khi Redis local sẵn sàng, chạy test:auth:redis với namespace riêng; không flush/xóa wildcard.
7. Chạy spec:check với base/head đúng và git diff --check. Ghi kết quả thật trong plan; local PASS không thay CI.
