# Feature Specification: Đồng bộ danh mục nguyên liệu thịt và lọc nhà cung cấp khả dụng

**Feature Branch**: `feat/008-supplier-category-and-status`

**Created**: 2026-11-08

**Status**: Ready

**Input**: Yêu cầu người dùng: Thống nhất nhóm hàng "Thịt" và "Thịt tươi" thành một nhóm duy nhất "Thịt tươi" trên toàn hệ thống danh bạ và dropdown tìm kiếm; đồng thời chỉ hiển thị các nhà cung cấp đang hoạt động (`status = 'ACTIVE'`) cho trường học trong danh bạ liên kết, loại bỏ các đơn vị bị vô hiệu hóa hoặc chưa kích hoạt.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Thống nhất nhóm nguyên liệu "Thịt tươi" (Priority: P1)

Là cán bộ quản lý trường học (Ban Giám hiệu) tìm kiếm nhà cung cấp theo ngành hàng, tôi muốn danh mục nhóm hàng chỉ hiển thị duy nhất "Thịt tươi" thay vì phân tách riêng lẻ giữa "Thịt" và "Thịt tươi", để việc phân loại và tìm kiếm nguyên liệu được nhất quán và thuận tiện.

**Why this priority**: Việc tồn tại song song hai tên gọi "Thịt" và "Thịt tươi" gây nhầm lẫn khi nhà trường lọc tìm nhà cung cấp và thiết lập hợp đồng cung ứng thực phẩm.

**Independent Test**: Gọi API lấy danh sách nhóm nguyên liệu `GET /api/supplier-onboarding/categories` và xác nhận kết quả trả về không có giá trị trùng lặp, "Thịt" được chuẩn hóa thành "Thịt tươi", và khi lọc theo "Thịt tươi" thì các nguyên liệu thuộc cả hai nhóm dữ liệu cũ/mới đều được trả về chính xác.

**Acceptance Scenarios**:

1. **Given** cơ sở dữ liệu có các bản ghi nguyên liệu thuộc nhóm "Thịt" và "Thịt tươi", **When** gọi API lấy danh mục ngành hàng, **Then** danh sách trả về chỉ chứa duy nhất nhãn "Thịt tươi", không còn nhãn "Thịt" riêng biệt và không có giá trị trùng lặp.
2. **Given** người dùng lọc danh bạ nhà cung cấp với tham số `category=Thịt tươi`, **When** hệ thống truy vấn nhà cung cấp có nguyên liệu phù hợp, **Then** kết quả bao gồm các nhà cung cấp cung cấp nguyên liệu có danh mục là "Thịt" hoặc "Thịt tươi".

---

### User Story 2 - Lọc nhà cung cấp đang hoạt động trong danh bạ trường học (Priority: P1)

Là cán bộ quản lý trường học duyệt danh bạ đối tác cung ứng, tôi muốn mặc định chỉ nhìn thấy các nhà cung cấp đang hoạt động hợp lệ (`ACTIVE`) để đảm bảo không ký kết hợp đồng hoặc đặt hàng từ các đơn vị đã bị tạm dừng, khóa tài khoản hoặc chưa kích hoạt (`INACTIVE`).

**Why this priority**: Bảo vệ quy trình an toàn thực phẩm và pháp lý của nhà trường, tránh rủi ro liên kết với nhà cung cấp không đủ điều kiện hoạt động.

**Independent Test**: Chuẩn bị dữ liệu nhà cung cấp gồm cả `ACTIVE` và `INACTIVE`. Gọi API `GET /api/supplier-onboarding/directory` không truyền tham số `status` và xác nhận chỉ các nhà cung cấp `ACTIVE` được trả về.

**Acceptance Scenarios**:

1. **Given** hệ thống có cả nhà cung cấp `ACTIVE` và `INACTIVE`, **When** nhà trường gọi danh bạ mà không chỉ định `status`, **Then** mặc định hệ thống lọc `status = 'ACTIVE'` và không trả về đơn vị `INACTIVE`.
2. **Given** người dùng truyền tham số `status=INACTIVE` hợp lệ, **When** hệ thống xử lý truy vấn, **Then** kết quả lọc đúng các nhà cung cấp không hoạt động theo yêu cầu.
3. **Given** client truyền tham số `status` khác ngoài `ACTIVE` và `INACTIVE`, **When** hệ thống kiểm tra tham số, **Then** trả về lỗi HTTP 400 thông báo "Trạng thái nhà cung cấp không hợp lệ."

---

### Edge Cases

- Khi danh sách categories từ database có nhiều bản ghi trùng lặp sau khi ánh xạ "Thịt" sang "Thịt tươi", mảng kết quả phải được loại bỏ trùng lặp (`Set`) và sắp xếp theo bảng chữ cái tiếng Việt.
- Khi người dùng gửi tham số `category=Thịt`, hệ thống vẫn hỗ trợ tìm kiếm khớp cả "Thịt" và "Thịt tươi" để đảm bảo khả năng tương thích ngược.
- Quyền truy cập API danh bạ và nhóm hàng vẫn tuân thủ quyền `supplier_relationship.manage` của trường học.

## Key Entities

- **Supplier (Nhà cung cấp)**: Đơn vị cung ứng thực phẩm, có thuộc tính `status` mang giá trị `ACTIVE` hoặc `INACTIVE`.
- **Ingredient (Nguyên liệu)**: Mặt hàng thực phẩm do nhà cung cấp cung ứng, có thuộc tính `category` phân loại ngành hàng thực phẩm.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% các lần gọi API `categories` không chứa chuỗi "Thịt" đơn lẻ nếu đã có "Thịt tươi", danh sách không chứa phần tử trùng lặp và được sắp xếp tiếng Việt chuẩn.
- **SC-002**: 100% các kết quả trả về từ `directory` khi không có query `status` đều có `status = 'ACTIVE'`.
- **SC-003**: Khi lọc `category=Thịt tươi`, mọi nhà cung cấp có nguyên liệu thuộc "Thịt" hoặc "Thịt tươi" đều xuất hiện đầy đủ trong kết quả.
