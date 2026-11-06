# Research: SchoolAcademicYear

## Một bảng và quan hệ trường

- **Decision**: Thêm SchoolAcademicYear và `School.academicYears[]`, không thêm trường ngày vào Class hoặc bảng Holiday riêng.
- **Rationale**: Người dùng xác nhận lịch chung toàn trường và chọn phương án một bảng; lưu mỗi năm riêng để giữ lịch sử.
- **Alternatives considered**: Đặt cấu hình hiện tại trên School sẽ khó giữ các năm cũ; hai bảng năm/nghỉ trái phạm vi đã chọn.

## Holiday JSON và ràng buộc

- **Decision**: JSONB array mặc định rỗng; DB CHECK loại array. Giữ `{date, reason}` trong hợp đồng dữ liệu; kiểm tra sâu từng mục thuộc giai đoạn API.
- **Rationale**: Repo cấm thêm custom function/trigger; không viết CHECK phức tạp chưa đủ bao phủ ngày hợp lệ/duplicate/range rồi tuyên bố đã validate toàn bộ lịch.
- **Alternatives considered**: JSONPath chỉ kiểm tra được một phần shape, không thay thế business validation. Chuẩn hóa từng ngày thành bảng riêng không thuộc yêu cầu.

## Khóa, chỉ mục và ngày

- **Decision**: UUID, FK School restrict, unique schoolId/academicYear, DATE cho hai mốc, CHECK thứ tự ngày và nhãn không trống.
- **Rationale**: Theo conventions schema hiện hành; unique index có prefix schoolId nên không cần index cùng prefix đơn lẻ. Không tự cấm nhãn chồng khoảng hoặc bắt regex năm chưa được chốt.

## Kiểm chứng và nâng cấp

- **Decision**: Tái sử dụng tests/migrations.test.ts để test SQL thật, lịch sử, fresh deploy và Prisma drift.
- **Rationale**: Đây là thay đổi ràng buộc database nên kiểm thử PostgreSQL có giá trị hơn unit test so chuỗi SQL. Không dùng Azure hoặc database thành viên.
- **Evidence**: Đã đối chiếu prisma/schema.prisma, tests/migrations.test.ts và database/SCHEMA_BASELINE.md; nghiên cứu độc lập bởi agent calendar_schema_research trong workflow speckit-plan. Không cần công nghệ hoặc dependency mới.

## Khôi phục lịch sử đã applied khi CD bị chặn

- **Decision**: Phục hồi SQL GVCN từ nhánh gốc dưới đúng tên Azure đã ghi nhận, cùng model/relation/partial indexes; không merge cả nhánh hoặc làm yếu guard.
- **Rationale**: SQL nguồn có checksum `b1fe455a26a60267d045f2602e61dbdeb9a37ec6367909963f423604cb146f5e`, trùng lịch sử Azure. Bản sửa cần đầy đủ cả lịch sử và model để preflight và drift cùng đúng.
- **Alternatives considered**: Xóa/sửa `_prisma_migrations`, tự resolve migration hoặc bỏ qua lịch sử dư sẽ che lỗi; chỉ thêm file SQL mà thiếu model làm drift coi bảng GVCN là dư. Các cách đó không được dùng.
