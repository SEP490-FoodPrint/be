# Sơ đồ trạng thái — Khiếu nại (mô hình ticket) & Sự cố ATTP (bản đề xuất để duyệt)

> Đi kèm `complaint_db_design_plan_v3.md`. Mô hình khiếu nại tham chiếu `VOPS-13064-updated.md` (support ticket). Các điểm đánh dấu ⏳ đang chờ chốt.

## 1. Quy tắc chung cho mọi đơn khiếu nại (C01, C02, C03, C05, C06)

| #   | Quy tắc                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Hai lớp trạng thái**: bên xử lý thấy trạng thái chi tiết + nhãn; người gửi chỉ thấy **Đang xử lý / Đã xử lý / Đã đóng**                                                                                |
| R2  | Bên nhận **chỉ có "Tiếp nhận"**, **không có "Từ chối"**                                                                                                                                                  |
| R3  | **Bình luận hai chiều** giữa người gửi và bên xử lý; bình luận **không sửa, không xóa**; **không** có bình luận nội bộ                                                                                   |
| R4  | Bên xử lý bấm **"Đã xử lý"** phải nhập nội dung xử lý (lưu như một bình luận loại `RESOLUTION`)                                                                                                          |
| R5  | Sau "Đã xử lý": trong **48h** kể từ lần "Đã xử lý" gần nhất, người gửi chọn một trong: **Hài lòng** (đơn đóng ngay), **Yêu cầu xử lý lại**, **Chuyển ATTP** (chỉ C03). **Không** có nút "Không hài lòng" |
| R6  | **"Yêu cầu xử lý lại" không giới hạn số lần**; mỗi lần mở lại, mốc 48h tính lại từ lần "Đã xử lý" kế tiếp                                                                                                |
| R6b | Lý do khi Yêu cầu xử lý lại / Chuyển ATTP: **tùy chọn**, không bắt buộc (nếu nhập thì lưu thành bình luận)                                                                                               |
| R6c | Người gửi bình luận được khi đơn ở `NEW`, `IN_PROGRESS`, `REOPENED`; bên xử lý phải **Tiếp nhận trước** mới được bình luận (chỉ ở `IN_PROGRESS`); không ai bình luận khi `RESOLVED`/`CLOSED`             |
| R7  | **Job tự đóng sau 48h** kể từ lần "Đã xử lý" gần nhất nếu người gửi không thao tác; sau mốc này mọi nút đều hết hiệu lực                                                                                 |
| R8  | Chỉ **C03** có thêm nút **"Chuyển ATTP"** (tạo đơn C05)                                                                                                                                                  |
| R9  | Chỉ gửi **email** (không có thông báo in-app) cho người gửi khi: tạo đơn thành công, bên xử lý bình luận mới, đơn chuyển "Đã xử lý". **Không** gửi khi đóng                                              |
| R10 | Tiêu đề đơn do hệ thống tự sinh theo loại đơn                                                                                                                                                            |

## 2. Các loại đơn

| Mã  | Loại                                                    | Người gửi                | Bên xử lý                               | "Yêu cầu xử lý lại" | "Chuyển ATTP" |
| --- | ------------------------------------------------------- | ------------------------ | --------------------------------------- | ------------------- | ------------- |
| C01 | Khiếu nại suất ăn                                       | GVCN                     | BGH                                     | Không giới hạn      | Không         |
| C02 | Phản ánh chất lượng nguyên liệu (theo chuyến giao / lô) | BGH, bếp, dinh dưỡng     | NCC của chuyến giao                     | Không giới hạn      | Không         |
| C03 | Khiếu nại suất ăn                                       | Phụ huynh (Ban đại diện) | BGH                                     | Không giới hạn      | **Có**        |
| C05 | Khiếu nại leo thang (sinh từ C03)                       | Phụ huynh                | ATTP phường/xã của trường (BGH chỉ xem) | Không giới hạn      | Không         |
| C06 | Khiếu nại hệ thống                                      | Mọi vai trò              | System Admin                            | Không giới hạn      | Không         |

## 3. Trạng thái lưu trong DB và cách hiển thị (hai lớp)

| Trạng thái DB | Bên xử lý thấy                                                                    | Người gửi thấy | Ý nghĩa                                     |
| ------------- | --------------------------------------------------------------------------------- | -------------- | ------------------------------------------- |
| `NEW`         | **Đơn mới**                                                                       | Đang xử lý     | Vừa gửi, chờ tiếp nhận                      |
| `IN_PROGRESS` | **Đang xử lý** (nhãn phụ **Có tin nhắn mới** nếu bình luận cuối là của người gửi) | Đang xử lý     | Đã tiếp nhận, đang trao đổi                 |
| `REOPENED`    | **Yêu cầu xử lý lại**                                                             | Đang xử lý     | Người gửi không hài lòng, chờ tiếp nhận lại |
| `RESOLVED`    | **Đã xử lý**                                                                      | Đã xử lý       | Chờ người gửi đánh giá                      |
| `CLOSED`      | **Đã đóng** (kèm lý do)                                                           | Đã đóng        | Kết thúc                                    |

Lý do đóng (`close_reason`): `SATISFIED` (hài lòng), `ESCALATED` (C03 đã chuyển ATTP), `AUTO_CLOSED` (job 48h).

"Có tin nhắn mới" là **nhãn tính toán**, không phải trạng thái lưu.

---

## 4. Sơ đồ trạng thái chung (C01, C02, C05, C06)

```mermaid
stateDiagram-v2
    direction TB
    [*] --> NEW: Người gửi tạo đơn (email ghi nhận)
    NEW --> IN_PROGRESS: Bên xử lý "Tiếp nhận"
    IN_PROGRESS --> IN_PROGRESS: Bình luận hai chiều
    IN_PROGRESS --> RESOLVED: Bên xử lý "Đã xử lý" + nội dung (email)
    state danh_gia <<choice>>
    RESOLVED --> danh_gia: Người gửi thao tác
    danh_gia --> CLOSED: Hài lòng (≤ 48h) → SATISFIED
    danh_gia --> REOPENED: Yêu cầu xử lý lại (≤ 48h, không giới hạn)
    REOPENED --> IN_PROGRESS: Bên xử lý "Tiếp nhận" lại
    RESOLVED --> CLOSED: Job sau 48h, người gửi không thao tác → AUTO_CLOSED
    CLOSED --> [*]
```

## 5. Sơ đồ C03 — có thêm "Chuyển ATTP"

```mermaid
stateDiagram-v2
    direction TB
    [*] --> NEW: PH gửi đơn (email ghi nhận)
    NEW --> IN_PROGRESS: BGH "Tiếp nhận"
    IN_PROGRESS --> IN_PROGRESS: Bình luận PH ↔ BGH
    IN_PROGRESS --> RESOLVED: BGH "Đã xử lý" + nội dung (email)
    state danh_gia <<choice>>
    RESOLVED --> danh_gia: PH thao tác
    danh_gia --> CLOSED: Hài lòng (≤ 48h) → SATISFIED
    danh_gia --> REOPENED: Yêu cầu xử lý lại (≤ 48h, không giới hạn)
    danh_gia --> CLOSED: Chuyển ATTP (≤ 48h) → ESCALATED, tạo C05
    REOPENED --> IN_PROGRESS: BGH "Tiếp nhận" lại
    RESOLVED --> CLOSED: Job sau 48h → AUTO_CLOSED
    CLOSED --> [*]
```

- "Chuyển ATTP" dùng được sau **bất kỳ lần "Đã xử lý" nào**, trong 48h kể từ lần gần nhất.
- Sau khi chuyển, C03 đóng (`ESCALATED`) và sinh **một** đơn C05 (mỗi C03 tối đa 1 C05). C05 chạy theo sơ đồ chung ở mục 4, phụ huynh yêu cầu ATTP xử lý lại không giới hạn.
- BGH xem được C05 của trường, gồm cả bình luận PH ↔ ATTP (chỉ đọc).

## 6. Hành động theo trạng thái

| Trạng thái         | Người gửi được làm                                   | Bên xử lý được làm  |
| ------------------ | ---------------------------------------------------- | ------------------- |
| `NEW`              | Bình luận                                            | Tiếp nhận           |
| `IN_PROGRESS`      | Bình luận                                            | Bình luận, Đã xử lý |
| `REOPENED`         | Bình luận                                            | Tiếp nhận lại       |
| `RESOLVED` (≤ 48h) | Hài lòng / Yêu cầu xử lý lại / Chuyển ATTP (chỉ C03) | —                   |
| `RESOLVED` (> 48h) | — (job đã đóng `AUTO_CLOSED`)                        | —                   |
| `CLOSED`           | Chỉ xem                                              | Chỉ xem             |

## 7. Luồng C03 → C05 (nhìn liền mạch)

```mermaid
sequenceDiagram
    actor PH as Phụ huynh
    participant BGH
    participant ATTP
    PH->>BGH: Gửi khiếu nại suất ăn (C03, NEW)
    BGH->>PH: Tiếp nhận (IN_PROGRESS) — bình luận qua lại
    BGH-->>PH: Đã xử lý lần 1 (RESOLVED, email)
    alt ≤ 48h — Hài lòng
        PH->>BGH: Hài lòng → CLOSED (SATISFIED)
    else ≤ 48h — Yêu cầu xử lý lại (không giới hạn)
        PH->>BGH: REOPENED → BGH tiếp nhận lại → Đã xử lý lần tiếp theo
        Note over PH,BGH: Lặp lại vòng đánh giá 48h như trên
        alt ≤ 48h kể từ lần gần nhất
            PH->>BGH: Hài lòng → CLOSED (SATISFIED)
        else ≤ 48h kể từ lần gần nhất — chuyển ATTP
            PH->>ATTP: Chuyển ATTP → C03 CLOSED (ESCALATED), tạo C05
        end
    else ≤ 48h — Chuyển ATTP ngay
        PH->>ATTP: C03 CLOSED (ESCALATED), tạo C05
    else Không thao tác
        Note over PH,BGH: Job 48h → CLOSED (AUTO_CLOSED)
    end
    Note over BGH,ATTP: C05: ATTP xử lý theo sơ đồ chung, BGH chỉ xem
```

## 8. Các điểm đã chốt

| #   | Chốt                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------- |
| Q-a | Hài lòng (đóng ngay), Yêu cầu xử lý lại, Chuyển ATTP đều trong **48h** kể từ lần "Đã xử lý" gần nhất; quá 48h job tự đóng |
| Q-b | Lý do **không bắt buộc**                                                                                                  |
| Q-c | Người gửi bình luận ở `NEW`, `IN_PROGRESS`, `REOPENED`                                                                    |
| Q-d | Bên xử lý phải **Tiếp nhận** trước mới được bình luận                                                                     |
| Q-e | BGH xem cả bình luận C05 (chỉ đọc)                                                                                        |
| Q-f | **Bỏ** nút "Không hài lòng"; "Yêu cầu xử lý lại" **không giới hạn** số lần (mọi loại đơn, kể cả C05)                      |

---

## Báo cáo sự cố ATTP (miền riêng, không phải đơn khiếu nại)

```mermaid
stateDiagram-v2
    [*] --> PENDING_SCHOOL_REVIEW: PH / GVCN báo cáo
    [*] --> SUBMITTED_TO_AUTHORITY: BGH tự lập hồ sơ (bỏ qua xác minh)
    PENDING_SCHOOL_REVIEW --> CANCELLED_BY_SCHOOL: BGH hủy (chỉ khi trùng / nhập sai, có lý do)
    PENDING_SCHOOL_REVIEW --> SUBMITTED_TO_AUTHORITY: BGH chuyển tiếp (kể cả nhận định OUTSIDE_MEAL)
    SUBMITTED_TO_AUTHORITY --> AUTHORITY_ACKNOWLEDGED: ATTP xác nhận tiếp nhận
    AUTHORITY_ACKNOWLEDGED --> UNDER_INSPECTION: ATTP lập đợt kiểm tra
    UNDER_INSPECTION --> INSPECTION_COMPLETED: Có kết quả kiểm tra
    INSPECTION_COMPLETED --> CLOSED: ATTP đóng hồ sơ (không tự gỡ hạn chế NCC)
    CANCELLED_BY_SCHOOL --> [*]
    CLOSED --> [*]
```

| Trạng thái               | Ý nghĩa                 | Người thao tác |
| ------------------------ | ----------------------- | -------------- |
| `PENDING_SCHOOL_REVIEW`  | Chờ BGH xác minh sơ bộ  | PH / GVCN tạo  |
| `CANCELLED_BY_SCHOOL`    | Hủy vì trùng / nhập sai | BGH            |
| `SUBMITTED_TO_AUTHORITY` | Đã gửi ATTP             | BGH            |
| `AUTHORITY_ACKNOWLEDGED` | ATTP đã tiếp nhận       | ATTP           |
| `UNDER_INSPECTION`       | Đang kiểm tra           | ATTP           |
| `INSPECTION_COMPLETED`   | Đã có kết quả kiểm tra  | ATTP           |
| `CLOSED`                 | Đóng hồ sơ              | ATTP           |

- Người báo (PH / GVCN) xem được tiến độ và kết luận kiểm tra của ATTP; hồ sơ BGH tự lập thì PH / GVCN không xem được.
- Kết quả kiểm tra của ATTP **ghi một lần, không sửa** (Q26).

### Đợt kiểm tra & chế tài NCC (chạy song song trong hồ sơ sự cố)

```mermaid
stateDiagram-v2
    direction LR
    state "Đợt kiểm tra" as INSP {
        [*] --> PLANNED: ATTP lập đợt
        PLANNED --> COMPLETED: ATTP ghi kết quả
    }
    state "Yêu cầu chế tài (PAUSE_INTAKE / LOCK_ACCOUNT / RESTORE)" as ENF {
        [*] --> PENDING: ATTP đề nghị
        PENDING --> APPROVED: System Admin duyệt
        PENDING --> REJECTED: System Admin từ chối
        APPROVED --> APPLIED: Thực thi thành công
        APPROVED --> FAILED: Thực thi lỗi
    }
```
