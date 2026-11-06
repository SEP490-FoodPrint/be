# Specification Quality Checklist: Lịch năm học toàn trường

**Purpose**: Đối chiếu yêu cầu đã xác nhận trước thiết kế và triển khai.

**Created**: 2026-11-07

**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] Nội dung tập trung vào nhu cầu lưu lịch chung của trường.
- [x] Các giới hạn giai đoạn lưu trữ được nêu rõ.
- [x] Đủ user stories, requirements, success criteria và assumptions.
- [x] Không suy diễn thêm API, permission, học kỳ hoặc lịch lớp.

## Requirement Completeness

- [x] Không còn điểm chưa rõ chặn phạm vi thêm một bảng.
- [x] Yêu cầu và tiêu chí nghiệm thu có thể kiểm chứng.
- [x] Bao phủ ngày đảo ngược, năm trùng, FK và danh sách nghỉ sai loại.
- [x] Phân biệt ràng buộc lưu trữ với validation từng mục ngày nghỉ ở giai đoạn API.
- [x] Giới hạn dữ liệu cũ, seed và deployment được xác định.

## Feature Readiness

- [x] Mỗi user story có tiêu chí kiểm thử độc lập.
- [x] Tên năm học/overlap chưa bị siết ngoài yêu cầu.
- [x] Đủ điều kiện lập plan và tasks.

## Notes

Checklist xác nhận độ rõ của spec; không thay thế kết quả chạy migration hoặc triển khai database.
