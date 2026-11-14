# Hướng dẫn sử dụng Spec-Kit với Codex

Tài liệu này hướng dẫn thành viên FoodPrint Backend cách bắt đầu một công việc mới (`feat`, `fix`, `refactor`, `perf`) bằng bộ kỹ năng **spec-kit** trong Codex. Quy tắc nhánh, commit và CI tổng thể nằm ở [contribute.md](../contribute.md); nguyên tắc kiến trúc và an toàn cơ sở dữ liệu nằm ở [AGENTS.md](../AGENTS.md) và [.specify/memory/constitution.md](../.specify/memory/constitution.md).

---

## 1. Tổng quan luồng làm việc

Mọi PR có thay đổi trong `src/**` hoặc `prisma/**` bắt buộc đi kèm bộ tài liệu đặc tả tại `specs/<feature-slug>/` (tối thiểu gồm `spec.md`, `plan.md`, `tasks.md`) trong **cùng một PR** với code.

```text
Tạo nhánh <type>/<feature-slug> từ dev
  │
  ▼
1. $speckit-specify    ──► Sinh specs/<feature-slug>/spec.md (yêu cầu nghiệp vụ)
  │
  ▼
2. $speckit-clarify    ──► Hỏi đáp làm rõ, xóa hết NEEDS CLARIFICATION
  │
  ▼
3. $speckit-plan       ──► Sinh plan.md + kiểm tra Constitution Check
  │
  ▼
4. $speckit-tasks      ──► Sinh tasks.md (danh sách đầu việc theo thứ tự)
  │
  ├──► (Khuyến nghị) $speckit-analyze để rà soát độ khớp spec ↔ plan ↔ tasks
  ▼
5. Commit spec         ──► Prettier + git commit "docs(spec): ..."
  │
  ▼
6. $speckit-implement  ──► Code theo tasks.md, tick [x], chạy test, commit code
  │
  ▼
7. Kiểm tra & mở PR    ──► npm run validate && npm run test:unit && npm run spec:check
```

---

## 2. Giải thích các lệnh (Skills) trong Codex

Repo đã cài sẵn 10 skill trong `.agents/skills/speckit-*/`. Khi mở `codex` tại thư mục gốc của repo, bạn gọi từng skill bằng cú pháp `$speckit-<tên>`.

### 2.1. Nhóm 5 lệnh chính (dùng trong mọi tính năng/sửa lỗi/refactor)

| Thứ tự | Lệnh                 | Khi nào dùng                                                           | Cách hoạt động & Đầu ra                                                                                                                                                                                                                                                                              |
| ------ | -------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**  | `$speckit-specify`   | **Đầu tiên**, khi bắt đầu một spec mới chưa có thư mục trong `specs/`. | Đọc mô tả của bạn, chọn tên tính năng dạng kebab-case không số, tạo `specs/<feature-slug>/spec.md` và lưu đường dẫn vào `.specify/feature.json` (file local, không commit). Những chỗ chưa rõ sẽ được gắn nhãn `[NEEDS CLARIFICATION: ...]`.                                                         |
| **2**  | `$speckit-clarify`   | Ngay sau `$speckit-specify` (hoặc khi `spec.md` còn điểm mơ hồ).       | Quét `spec.md`, đặt tối đa 5 câu hỏi ngắn gọn/trắc nghiệm cho bạn. Khi bạn trả lời, skill tự động cập nhật lại `spec.md` và xóa các nhãn `NEEDS CLARIFICATION`.                                                                                                                                      |
| **3**  | `$speckit-plan`      | Khi `spec.md` đã rõ ràng và không còn `NEEDS CLARIFICATION`.           | Đọc `spec.md` cùng [.specify/memory/constitution.md](../.specify/memory/constitution.md) để lập kế hoạch kỹ thuật vào `specs/<feature-slug>/plan.md` (và `research.md`, `data-model.md`, `contracts/` nếu cần). Tại đây mục **Constitution Check** sẽ đối chiếu thiết kế với 6 nguyên tắc của dự án. |
| **4**  | `$speckit-tasks`     | Sau khi `plan.md` đã hoàn chỉnh.                                       | Chuyển `spec.md` và `plan.md` thành danh sách công việc có thứ tự phụ thuộc trong `specs/<feature-slug>/tasks.md` (`T001`, `T002`..., chia theo Phase và User Story; nhãn `[P]` chỉ các task có thể làm song song).                                                                                  |
| **5**  | `$speckit-implement` | Sau khi đã kiểm tra, format và commit bộ file spec.                    | Đọc `tasks.md`, `plan.md`, `spec.md`, thực hiện viết code/test từng bước theo đúng kiến trúc trong `AGENTS.md`, và tự động đánh dấu `[x]` vào các task đã hoàn thành trong `tasks.md`.                                                                                                               |

### 2.2. Nhóm 5 lệnh bổ trợ (dùng khi cần)

| Lệnh                     | Khi nào dùng                                                                                                          | Cách hoạt động & Đầu ra                                                                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `$speckit-analyze`       | **Sau `$speckit-tasks`, trước khi code.** (Rất khuyến nghị chạy).                                                     | Chỉ đọc (không sửa file): đối chiếu chéo `spec.md`, `plan.md`, `tasks.md` và `constitution.md` để báo cáo các yêu cầu chưa có task, task không gắn với yêu cầu, hoặc vi phạm hiến chương.                    |
| `$speckit-checklist`     | Khi làm tính năng nhạy cảm (xác thực, phân quyền, tồn kho, migration) cần rà soát kỹ yêu cầu trước khi code.          | Tạo file checklist tại `specs/<feature-slug>/checklists/<tên>.md` để kiểm tra độ đầy đủ và rõ ràng của tài liệu yêu cầu ("unit test cho yêu cầu"), không phải checklist chạy test code.                      |
| `$speckit-converge`      | Khi code dở dang qua nhiều phiên, chia 1 spec thành nhiều PR, hoặc khi refactor module cũ muốn kiểm tra còn thiếu gì. | Quét code thực tế trong repo đối chiếu với `spec.md`, `plan.md`, `tasks.md`. Nếu phát hiện phần chưa làm hoặc làm lệch, skill sẽ nối thêm các task bù vào cuối `tasks.md` để chạy tiếp `$speckit-implement`. |
| `$speckit-constitution`  | **Chỉ dùng khi cả nhóm thống nhất** sửa nguyên tắc cốt lõi của dự án.                                                 | Cập nhật `.specify/memory/constitution.md`, nâng version theo semver và kiểm tra ảnh hưởng tới các template. Phải sửa đồng bộ với `AGENTS.md`.                                                               |
| `$speckit-taskstoissues` | Tùy chọn, khi nhóm muốn đẩy các mục trong `tasks.md` thành GitHub Issues.                                             | Đọc `tasks.md` và tạo các GitHub Issues tương ứng qua MCP/GitHub CLI. Không bắt buộc trong quy trình thường ngày.                                                                                            |

---

## 3. Hướng dẫn thực hành từng bước

### 3.1. Bắt đầu một công việc mới (`feat`, `fix`, `refactor`, `perf`)

**Bước 1 — Tạo nhánh theo tên tính năng:**

```bash
git switch dev
git pull --ff-only origin dev
git switch -c feat/menu-weekly-export
codex
```

> **Lưu ý:** Dùng tên tính năng cho nhánh và thư mục, ví dụ `feat/menu-weekly-export` và `specs/menu-weekly-export/`. Không lấy số tuần tự. Các tên cũ có số vẫn được hỗ trợ và không cần đổi tên; quy tắc đối chiếu nằm ở contribute.md mục 8.2.

**Bước 2 — Tạo đặc tả với `$speckit-specify`:**

Trong phiên chat của Codex, nhập lệnh kèm mô tả nghiệp vụ đã được xác nhận (tập trung vào **ai dùng, làm gì, dữ liệu vào/ra, quy tắc nghiệp vụ**):

```text
$speckit-specify Bổ sung API xuất thực đơn tuần cho nhà trường dưới dạng dữ liệu tổng hợp theo ngày và bữa ăn. Chỉ tài khoản thuộc tổ chức SCHOOL có quyền menu.view của chính trường đó mới được phép truy cập.
```

- Kiểm tra thư mục vừa sinh trong `specs/` tương ứng tên tính năng của nhánh, có đủ nội dung yêu cầu đã xác nhận. Khi slug trùng thư mục hiện có, cập nhật spec đó hoặc chọn tên mô tả khác, không tự thêm số.

**Bước 3 — Làm rõ các điểm mơ hồ với `$speckit-clarify`:**

```text
$speckit-clarify
```

- Trả lời các câu hỏi do Codex đưa ra (ví dụ: xử lý khi tuần chưa có thực đơn, giới hạn tham số query, mã lỗi trả về...).
- Lặp lại nếu cần cho tới khi `spec.md` không còn chuỗi `NEEDS CLARIFICATION`.

**Bước 4 — Lập kế hoạch kỹ thuật với `$speckit-plan`:**

Truyền thêm định hướng kiến trúc của FoodPrint nếu cần chỉ rõ module hoặc ràng buộc DB:

```text
$speckit-plan Triển khai trong module src/modules/menu theo đúng kiến trúc phân lớp của AGENTS.md (routes, controller, validation với z.strictObject, service, repository, tách riêng menu.request.dto.ts và menu.response.dto.ts). Không thay đổi schema Prisma và không tạo migration.
```

- Mở `specs/menu-weekly-export/plan.md` kiểm tra mục **Constitution Check** đã đạt và không còn `NEEDS CLARIFICATION`.

**Bước 5 — Sinh danh sách công việc và kiểm tra chéo:**

```text
$speckit-tasks
```

Sau khi `tasks.md` được tạo, nên chạy tiếp:

```text
$speckit-analyze
```

Nếu `$speckit-analyze` phát hiện điểm lệch giữa `spec.md`, `plan.md` và `tasks.md`, yêu cầu Codex chỉnh lại ngay trước khi code.

**Bước 6 — Format và commit phần spec trước:**

Chạy trong terminal ngoài Codex (hoặc nhờ Codex chạy):

```bash
npm exec --no -- prettier --write specs/menu-weekly-export
git add specs/menu-weekly-export
git commit -m "docs(spec): specify weekly menu export"
```

> Việc tách commit `docs(spec): ...` đi trước giúp người review PR đọc hiểu thiết kế trước khi đọc các commit code.

**Bước 7 — Triển khai code với `$speckit-implement`:**

Trong Codex:

```text
$speckit-implement
```

- Codex sẽ thực hiện từng task trong `tasks.md`, tuân thủ `AGENTS.md` và đánh dấu `[x]` khi xong.
- Nếu tính năng lớn, bạn có thể yêu cầu chạy từng giai đoạn, ví dụ: `$speckit-implement Chỉ thực hiện Phase 1 và Phase 2 trước`.

**Bước 8 — Kiểm tra chất lượng và mở PR:**

```bash
npm run validate
npm run test:unit
SPEC_GATE_BASE_SHA=$(git merge-base origin/dev HEAD) SPEC_GATE_HEAD_SHA=HEAD \
SPEC_GATE_BASE_REF=dev SPEC_GATE_HEAD_REF=$(git branch --show-current) \
npm run spec:check
```

Khi tất cả đều PASS, commit phần code + `tasks.md` đã tick và push nhánh để mở PR vào `dev`.

---

### 3.2. Khi cần sửa spec hoặc thay đổi yêu cầu giữa chừng

Các lệnh `$speckit-clarify`, `$speckit-plan`, `$speckit-tasks`, `$speckit-implement`, `$speckit-converge` xác định thư mục spec đang làm việc theo thứ tự ưu tiên:

1. Biến môi trường `SPECIFY_FEATURE_DIRECTORY` (nếu được truyền).
2. File `.specify/feature.json` trên máy local (được tạo khi chạy `$speckit-specify`).

Do đó:

- **Trường hợp 1 — Đang làm trên cùng máy và PR chưa merge:**
  - Chỉ cần sửa trực tiếp `spec.md` (hoặc gọi `$speckit-clarify`), sau đó chạy lại `$speckit-plan` → `$speckit-tasks` để đồng bộ kế hoạch, format lại `specs/<feature-slug>/` và commit vào cùng PR.
  - **Không gọi lại `$speckit-specify`** để ghi đè spec đã có; các lệnh cập nhật sử dụng thư mục đang chọn.

- **Trường hợp 2 — Spec đã merge vào `dev`, nay mở PR mới để sửa lỗi hoặc bổ sung nhỏ trên cùng spec đó:**
  - Tạo nhánh theo tên tính năng của spec, có thể thêm hậu tố mô tả, ví dụ `fix/menu-weekly-export-empty-week`. Nếu spec cũ có số, vẫn dùng nguyên thư mục và có thể giữ tên nhánh cũ.
  - Khởi động Codex kèm biến môi trường trỏ vào thư mục spec cũ:

    ```bash
    SPECIFY_FEATURE_DIRECTORY=specs/menu-weekly-export codex
    ```

  - Trong Codex, dùng `$speckit-clarify` → `$speckit-plan` → `$speckit-tasks` (hoặc `$speckit-converge`) → `$speckit-implement`.

---

### 3.3. Khi làm song song nhiều nhánh trên cùng một máy

Vì `.specify/feature.json` nằm ở máy local (đã được `.specify/.gitignore` bỏ qua để không commit lên Git), khi bạn chuyển sang nhánh khác (`git switch fix/ten-tinh-nang`), hãy chỉ định rõ thư mục spec của nhánh đó:

```bash
SPECIFY_FEATURE_DIRECTORY=specs/ten-tinh-nang codex
```

Lệnh đầu tiên chạy với `SPECIFY_FEATURE_DIRECTORY` sẽ tự động cập nhật lại `.specify/feature.json` sang thư mục mới.

---

## 4. Các lỗi Spec gate thường gặp và cách xử lý

| Trường hợp                             | Cách khắc phục                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Tên branch không hợp lệ                | Dùng `<feat                                                                                         | fix | refactor | perf>/<feature-slug>` khi đổi code; docs cũng được phép cho PR chỉ chứa spec. Tên là kebab-case, không bắt buộc số. |
| Không tìm thấy spec tương ứng          | Kiểm tra tên tính năng của branch và thư mục, thêm đủ bộ spec vào commit. Spec cũ có số vẫn hợp lệ. |
| Thiếu spec.md, plan.md hoặc tasks.md   | Chạy đủ specify → plan → tasks và commit tài liệu.                                                  |
| Spec hoặc plan còn NEEDS CLARIFICATION | Giải quyết điểm chưa rõ và cập nhật spec/plan trước khi merge.                                      |
| Branch khớp nhiều thư mục              | Đổi tên nhánh để khớp nguyên tên thư mục muốn dùng; không đánh lại số các spec khác.                |
| PR sửa spec của tính năng khác         | Tách phạm vi thay đổi, chỉ sửa spec của tính năng tương ứng với branch.                             |
| Prettier báo lỗi ở spec                | Chạy `npm exec --no -- prettier --write specs/<feature-slug>` trước khi commit.                     |

Gate ưu tiên khớp nguyên tên thư mục, sau đó tên tính năng bỏ tiền tố số cũ, rồi tên tính năng dài nhất đứng trước hậu tố mô tả của nhánh. Tra cứu bằng số chỉ là fallback tương thích cho nhánh lịch sử có số và không khớp tên. Khi mơ hồ, gate báo lỗi thay vì chọn tùy ý. Không còn quy tắc cấm hai spec khác tên dùng cùng tiền tố số cũ.

Skill `$speckit-specify` trong repository tạo slug không số theo mặc định. Không sửa scaffold `.specify/scripts/` hoặc đặt giá trị cấu hình upstream không được hỗ trợ chỉ để đổi cách đặt tên. Khi cần chọn đường dẫn cụ thể, dùng `SPECIFY_FEATURE_DIRECTORY`; các lệnh plan/tasks/implement vẫn đọc đường dẫn này hoặc `.specify/feature.json` như trước.
