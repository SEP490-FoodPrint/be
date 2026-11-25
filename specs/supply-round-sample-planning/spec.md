# Feature Specification: Lập mẻ theo đợt giao và lấy thêm nguyên liệu lưu mẫu

**Feature Branch**: `feat/035-supply-round-sample-planning`
**Status**: Draft v7 — đã chốt toàn bộ câu hỏi (13 câu ở v2, N1–N9 và N13–N22 ở v3–v7) ngày 24/11/2026. Không còn câu mở
**Ngày**: 23/11/2026 (v1), 24/11/2026 (v2–v7)
**Phụ thuộc**: `TASK-dish-standard-portion` (món có mốc chuẩn `standardQuantity` + `standardUnit` g/ml, khẩu phần khối `portionQuantity`; định lượng trong công thức là **thành phẩm**, lượng sống tính bằng `grossFromNet` theo `IngredientEntry.wasteRate`)

## 1. Bối cảnh và vấn đề

Hiện tại lưu mẫu chỉ là bước ghi nhận sau khi mẻ hoàn thành (`retained-sample.service.ts` → `create`): bếp điền lượng mẫu (≥ 100 g hoặc ≥ 150 ml theo QĐ 1246/QĐ-BYT), tủ và ngăn. Lượng mẫu **không** được tính vào:

- lượng đặt hàng NCC (`fresh-demand.service.ts`),
- lượng nguyên liệu giữ cho mẻ (`CookingBatchLot.quantityUsed`),
- lượng trừ kho khi hoàn thành mẻ (`InventoryTransaction` `COOKING_USAGE`).

Kết quả: phần mẫu lấy ra từ phần ăn của học sinh, kho không phản ánh đúng thực tế.

Tách lượng mẫu khỏi định lượng gốc ở từng bước riêng lẻ là khó, nên tính năng này đổi thứ tự luồng: **lập mẻ ngay sau khi NCC khai báo lô**, từ cấu trúc mẻ tính ra chính xác phần mẫu cần cho từng lô, rồi **NCC lấy thêm** đúng phần đó trước khi vận chuyển.

## 2. Thuật ngữ

| Thuật ngữ         | Nghĩa trong spec                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Đợt giao (round)  | Bộ `(schoolId, deliveryDate, orderType = DIRECT_USE, batchNo ∈ {1,2})`. Gồm mọi `SupplyRequest` của trường cho ngày và đợt đó, có thể nhiều NCC.             |
| Lô khai báo       | `IngredientLot` NCC tạo khi tạo chuyến giao (`supplier-order` → `create`), trạng thái `BLOCKED` cho tới khi trường tiếp nhận.                                |
| Mẻ                | `CookingBatch` con. Theo code hiện tại **mỗi mẻ có đúng 1 món** (`groupDishPlans`), nên **1 mẻ = 1 mẫu lưu**.                                                |
| Nhóm mẻ           | `CookingBatchGroup` của một bữa (`menuDayId`, `mealType`) trong một lần lập.                                                                                 |
| Mốc chuẩn của món | `Dish.standardQuantity` + `Dish.standardUnit` (g hoặc ml). Công thức `dish_ingredient_entries` là lượng **thành phẩm** của từng nguyên liệu trong mốc chuẩn. |
| Lượng mẫu `M`     | Lượng mẫu thành phẩm của một món trong một mẻ, cùng đơn vị với `standardUnit` của món, lấy từ cấu hình trường (mục 5).                                       |
| Tỉ lệ mẫu `r`     | `r = M / standardQuantity` của món. Không phụ thuộc khối.                                                                                                    |
| NCC của món       | Các NCC có `SupplyRequest` trong đợt chứa ít nhất một nguyên liệu `DIRECT_USE` của món (cả nguyên liệu chính và gia vị).                                     |
| Nhóm nguồn        | Cách planner gom lô ở chế độ `SEPARATE_BY_LOT`: các lô cùng nguyên liệu và cùng `sourceFacilityId`. Lô không có cơ sở nguồn tự là một nhóm.                  |
| Khóa nguồn của mẻ | `(dishId, { ingredientEntryId → sourceFacilityId ?? ingredientLotId })`. Dùng để xác định mẻ Đợt 2 "trùng" mẻ Đợt 1.                                         |
| Lấy thêm (top-up) | Lượng nguyên liệu **sống** NCC phải giao thêm trên một lô để đủ phần mẫu.                                                                                    |
| Kho               | Vai trò `INGREDIENT_MANAGEMENT_DEPARTMENT`.                                                                                                                  |

## 3. Quyết định đã chốt

- **D1**: Mẻ của một món được lập tự động ngay khi **mọi NCC của món đó** trong đợt đã khai báo lô, kể cả khi lô chưa được kiểm nhận. Lập xong thì chuyển cho kho duyệt luôn (chốt 24/11, câu 11).
- **D2**: Mỗi mẻ cần một mẫu cho mỗi món. Phần nguyên liệu cho mẫu được tính **theo cấu trúc mẻ**, không theo số lô.
- **D3**: Phần lấy thêm của một lô là tổng trên các cặp (mẻ, nguyên liệu) được gán cho lô đó. Mỗi cặp chỉ được tính một lần và gán cho đúng một lô (công thức ở mục 7.3).
- **D4**: Ở Đợt 2, mẻ có **cùng khóa nguồn** với một mẻ Đợt 1 thì gộp vào mẻ Đợt 1 và **không lấy thêm** phần mẫu. Nếu mọi mẻ Đợt 2 đều trùng thì lượng lấy thêm của Đợt 2 bằng 0.
- **D5**: Xét trùng theo **cả mẻ** (khóa nguồn đầy đủ), không theo từng nguyên liệu.
- **D6**: Khi chuyến giao bị từ chối, NCC giao lại bằng chuyến giao **gắn với đơn gốc** (`creationMode = REQUEST`), bắt buộc khai báo lại lô. Sau đó hệ thống lập lại các mẻ bị ảnh hưởng, kho duyệt, NCC xác nhận lấy thêm, NCC điền thông tin vận chuyển và chuyển sang đang vận chuyển.
- **D7**: Phần mẫu được lưu tách khỏi phần ăn (cột riêng), để bước phân bổ cho lớp không chia phần mẫu. Bước trừ kho trừ cả hai phần.
- **D8** (câu 1, 2, 7): Trường cấu hình **hai** lượng mẫu: một cho món có mốc chuẩn tính theo g (mặc định **100 g**), một cho món tính theo ml (mặc định **150 ml**). Món dùng đơn vị nào thì lấy đúng cấu hình đơn vị đó, và mẫu thực tế cũng ghi theo đơn vị đó. Được phép cấu hình thấp hơn mức của QĐ 1246, khi đó chỉ hiện cảnh báo vàng, không chặn.
- **D9** (câu 3): Lượng mẫu tính theo **mốc chuẩn** của món: `r = M / standardQuantity`, không theo khẩu phần khối. Mốc chuẩn chính là tham chiếu từ suất ăn ra nguyên liệu để lấy mẫu.
- **D10** (câu 4, N1): Dòng công thức đơn vị đếm (hộp, quả…) cũng tính theo tỉ lệ `r` của mốc chuẩn, và được **làm tròn lên số nguyên**. Khi phải làm tròn lên, tỉ lệ mẫu của **cả món** tăng theo, nên các dòng g/ml và lượng mẫu thực tế cũng tăng tỉ lệ thuận (công thức ở mục 7.3). Ví dụ món sữa có mốc chuẩn 180 ml và công thức 1 hộp, cấu hình mẫu 150 ml: tính ra 0,833 hộp, làm tròn thành 1 hộp, nên lượng mẫu thực tế là 180 ml.
- **D11** (câu 5): Mốc chuẩn là lượng **thành phẩm**: `thành phẩm = sống × (1 − wasteRate)`. Phần lấy thêm là lượng **sống**: `sống = grossFromNet(thành phẩm, wasteRate)`. Hao hụt chỉ áp cho **nguyên liệu chính** (`ingredientRole = MAIN`). **Gia vị** (`SEASONING`) luôn tính hao hụt 0 trong phần mẫu, bỏ qua `wasteRate` của danh mục (N2).
- **D12** (câu 6): Phần mẫu được trừ thẳng vào kho. Tồn lô lưu 3 chữ số thập phân theo đơn vị lô, nên phần mẫu được **làm tròn lên** tới 0,001 đơn vị lô. Ví dụ muối 2,4 g với lô tính theo kg thì lấy 0,003 kg.
- **D13** (câu 9): Gia vị cũng có phần mẫu. Phần mẫu của gia vị được cộng vào lượng gia vị dùng chung của bữa (`MenuMealSeasoningLot`), không giữ kho riêng theo mẻ.
- **D14** (câu 10): Bước "kho duyệt" hiển thị lượng lấy thêm theo từng **nguyên liệu – NCC**: mỗi cặp là một khung, bên trong liệt kê từng nguồn kèm lượng cần lấy thêm, chân khung ghi **tổng lượng lấy thêm cho lưu mẫu** của nguyên liệu đó. Kho duyệt xong thì NCC mới xác nhận lấy thêm (mục 6.5).
- **D15** (câu 12): Bếp chỉ nấu sau khi Đợt 2 xong, như hiện tại. Vì vậy mẻ Đợt 1 luôn còn gộp được khi lập Đợt 2, không cần mốc "bắt đầu nấu".
- **D16** (câu 13, N6): Phần lấy thêm **thực sự đặt từ NCC** được tính vào lượng mua với NCC. Phần mẫu lấy từ tồn kho chỉ ghi nhận là tiêu hao kho. **Giá trị đơn (đơn giá, thành tiền) để sau**, vì hệ thống chưa lưu đơn giá.
- **D17** (N3): Trang "Cấu hình lưu mẫu" dành cho BGH, có đường dẫn trong nhóm **"Cấu hình"** ở sidebar của BGH (`FoodPrintFE/src/router/MenuItem.jsx`, nhóm `SCHOOL_CONFIGURATION`, cạnh Chế độ nấu và Khung giờ vận hành).
- **D18** (N4): Lượng mẫu **không cho sửa** ở bất kỳ bước nào sau cấu hình. Luồng là: BGH cấu hình → hệ thống lập mẻ, kho duyệt → NCC xác nhận lấy thêm → bếp **chỉ xác nhận đã lưu mẫu**. Lượng và đơn vị mẫu lấy từ mẻ (đã gồm phần làm tròn đơn vị đếm ở D10), bếp không nhập.
- **D19** (N5, N18): Ngày nào cũng phải có Đợt 2, giữ nguyên như hiện tại. Mẻ chỉ thành chính thức (sẵn sàng nấu) sau khi Đợt 2 của ngày xong. Ngoại lệ duy nhất: Đợt 2 không cần đặt thêm gì vì Đợt 1 đã đủ (D28).
- **D20** (N7): Tách rõ trạng thái mẻ theo đợt: **Chờ duyệt** → **Đã duyệt Đợt 1** → **Chính thức** (sau khi Đợt 2 xong). Phần Đợt 2 gộp vào mẻ Đợt 1 được lưu **tách riêng** cho tới khi chính thức. Nhờ vậy nếu lô Đợt 2 bị từ chối và phải giao lại, hệ thống xóa phần/mẻ của Đợt 2 rồi lập lại, còn mẻ Đợt 1 giữ nguyên (mục 8).
- **D21** (N9): NCC khai báo chậm hoặc không khai báo: **chưa xử lý** trong bản này, ghi lại ở mục 15 để làm sau.
- **D22** (N8): Đợt 1 là **cố định** (mốc suất Đợt 1 = nửa sĩ số đăng ký, lưu ở `SupplyBatch1GradePortion`). Đợt 2 = sĩ số sau điểm danh **trừ** mốc Đợt 1. Vì vậy Đợt 2 chỉ **cộng thêm**, không bao giờ bớt suất hay xóa mẻ Đợt 1.
- **D23** (N16): Phần lấy thêm cho lưu mẫu là hàng **"giao thêm"** của đơn, tách riêng khỏi lượng đặt theo suất. Khẩu phần từng khối không ảnh hưởng tới phần mẫu: ví dụ mẫu 100 g có 60 g gà thành phẩm thì chỉ cần giao thêm đúng lượng gà sống tương ứng. Hiện "Giao thêm" ở Đợt 2 **chỉ có trên FE**: `CreateDeliveryView.jsx` có cột `extraQty`, nhưng `IngredientOrderService` cộng gộp vào `orderedQty`, BE chỉ lưu `requested_quantity`. Bản này **tạo mới** loại hàng lưu mẫu ở BE (mục 10.5). Khi tách mẻ, phần lưu mẫu **không** được tính vào lượng nấu cho suất ăn.
- **D28** (N18): Tính theo **khối**. Đợt 2 của khối = `max(0, sĩ số thực tế − mốc Đợt 1)`, như `fresh-demand` đang làm. Một lớp nghỉ quá nửa thì các lớp khác trong khối bù được. Nếu **cả khối** nghỉ quá nửa thì Đợt 2 của khối bằng 0, và màn tạo đơn Đợt 2 báo _"Khối … đã đủ từ Đợt 1, thừa X suất"_. Khi **mọi khối** đều đủ từ Đợt 1 thì không cần đơn Đợt 2: nếu Đợt 1 đã giao và đủ lưu mẫu thì mẻ lên chính thức và **nấu luôn**. Chấp nhận phần thừa.
- **D30** (N20, N22): Hệ thống **tự xác nhận** "Đợt 2 không cần", không cần ai bấm. Điều kiện:
  1. mọi lớp đã chốt điểm danh;
  2. **mọi khối đều thừa hoặc vừa đủ suất** (sĩ số thực tế ≤ mốc Đợt 1 của khối);
  3. **kiểm tra theo nguyên liệu, không chỉ theo suất**: với **mọi** nguyên liệu tươi, lượng Đợt 1 đã đặt (đã làm tròn xuống) **≥** lượng cần cho sĩ số thực tế của **cả trường**.

  Khi đủ cả 3 điều kiện thì **bỏ qua phần lẻ** chuyển từ Đợt 1 (`SupplyBatch1Carryover`), không đặt nữa. Thiếu dù chỉ một nguyên liệu thì Đợt 2 vẫn phải đặt (mục 8.1).

- **D31** (N21): Không bù chéo giữa các khối: khối thừa không được trừ sang khối thiếu. Đây là **hạn chế đã biết** (mục 16).
- **D29** (N19): **Bỏ hẳn "Giao thêm" thủ công** ở màn tạo đơn Đợt 2: bỏ cột "Giao thêm", bỏ nút và popup "Thêm nguyên liệu giao thêm". Đơn chỉ còn một loại hàng ngoài lượng theo suất là **lưu mẫu**. Loại này do hệ thống ghi và không được tính khi chia mẻ.
- **D24** (N13): Trường chưa từng lưu cấu hình lưu mẫu thì lập mẻ dùng luôn mặc định 100 g / 150 ml.
- **D25** (N14): Khi xác nhận lưu mẫu, bếp vẫn chọn tủ, ngăn, thời điểm lấy mẫu và chụp ảnh như hiện tại. Chỉ lượng và đơn vị là cố định theo mẻ.
- **D26** (N15): Mẻ mới của Đợt 2 (không trùng mẻ Đợt 1) sau khi kho duyệt ở trạng thái **"Đã duyệt Đợt 2"**.
- **D27** (N17): Lô Đợt 1 bị từ chối sau khi phần Đợt 2 đã gộp vào: xóa mẻ Đợt 1 dùng lô đó **cùng** phần Đợt 2 đã gộp, rồi lập lại cả hai khi có lô thay thế.

## 4. Luồng tổng quan

```
[BGH] cấu hình lượng mẫu: 100 g (món tính g), 150 ml (món tính ml)  — một lần
        │
[Trường] tạo SupplyRequest Đợt 1/Đợt 2 ──► [NCC] nhận đơn
        │
[NCC] khai báo lô (tạo chuyến giao, PREPARING / LOTS_DECLARED)
        │   sau mỗi lần khai báo: kiểm tra từng món đã đủ NCC khai báo chưa
        ▼
[Hệ thống] với mỗi món vừa đủ: tách mẻ ở trạng thái "Chờ duyệt"
           (mọi bữa của ngày có món đó) + tính phần mẫu từng lô ──► chuyển kho duyệt luôn
        │
[Kho] duyệt lượng lấy thêm theo nguyên liệu – NCC ──► mẻ "Đã duyệt Đợt 1"
        │
[NCC] xác nhận lấy thêm khi mọi món dùng nguyên liệu của mình đã được duyệt
      (lô tăng số lượng) ── nếu phần lấy thêm = 0 thì bỏ qua
        │
[NCC] điền biển số xe + giờ dự kiến đến ──► IN_TRANSIT
        │
[Trường] xác nhận xe đến ──► kiểm nhận
        ├─ Đạt: RECEIVED, lô AVAILABLE
        └─ Từ chối: REJECTED ──► xóa phần/mẻ dùng lô bị từ chối, luồng giao lại (mục 9)
        │
   ... Đợt 2 lặp lại các bước trên, gộp vào mẻ Đợt 1 nếu trùng (mục 8) ...
        │
[Hệ thống] Đợt 2 của ngày xong (mọi chuyến đã nhận) ──► mẻ "Chính thức" (sẵn sàng nấu, giữ kho thật)
        │
[Bếp] nấu ──► hoàn thành mẻ ──► trừ kho = phần ăn + phần mẫu
        │
[Bếp] xác nhận đã lưu mẫu (không nhập lượng: lượng và đơn vị lấy từ mẻ)
```

Đợt 2 chạy cùng luồng, nhưng bước lập mẻ thực hiện **gộp vào mẻ Đợt 1** theo mục 8.

## 5. Cấu hình lượng lưu mẫu

### 5.1 Nghiệp vụ

- BGH (`SCHOOL_MANAGEMENT_BOARD`) cấu hình **hai** giá trị cho toàn trường:
  - `sampleGrams`: lượng mẫu cho món có `standardUnit = g`, mặc định **100**.
  - `sampleMilliliters`: lượng mẫu cho món có `standardUnit = ml`, mặc định **150**.
- Món dùng `g` lấy `sampleGrams`, món dùng `ml` lấy `sampleMilliliters`. Không quy đổi g ↔ ml.
- Giá trị phải > 0, tối đa 3 chữ số thập phân (giống `standardQuantity`).
- **Thấp hơn mức tối thiểu** (100 g / 150 ml): vẫn cho lưu, chỉ hiện **cảnh báo vàng** trên form, ví dụ _"Thấp hơn mức tối thiểu 100 g theo QĐ 1246/QĐ-BYT"_. BE không chặn.
- Ghi đè theo từng món nằm ngoài phạm vi bản này.
- Trường chưa có bản ghi cấu hình: form hiển thị sẵn 100 g / 150 ml, và lập mẻ dùng luôn mặc định này (D24). Không chặn.
- Khi lập mẻ, hệ thống **chụp lại** vào từng `CookingBatchDish`: lượng mẫu `M`, đơn vị, `standardQuantity` của món tại lúc lập. Đổi cấu hình hoặc sửa món sau đó không ảnh hưởng mẻ đã lập.

### 5.2 Trang FE

- Trang mới **"Cấu hình lưu mẫu"** trong `FoodPrintFE/src/pages/SCHOOL/SamplePolicy/`, route mới `ROUTER.SCHOOL_SAMPLE_POLICY`.
- **Sidebar (D17)**: thêm mục con "Lưu mẫu thực phẩm" vào nhóm `SCHOOL_CONFIGURATION` ("Cấu hình") trong `src/router/MenuItem.jsx`, ngay sau "Khung giờ vận hành", `roles: [ROLES.SCHOOL_MANAGEMENT_BOARD]`. Đăng ký route trong `src/router/AppRouter.jsx` cạnh route Chế độ nấu.
- Form gồm hai ô:
  - "Lượng mẫu cho món tính theo gam" — hậu tố `g`.
  - "Lượng mẫu cho món tính theo mililít" — hậu tố `ml`.
- Mỗi ô nhỏ hơn mức tối thiểu thì hiện cảnh báo vàng ngay dưới ô đó.
- **Ngay dưới form, trước nút lưu**: một đoạn chữ nhỏ, màu mờ, in nghiêng trích quy định:
  > _Theo Quyết định 1246/QĐ-BYT, mẫu thức ăn đặc lưu tối thiểu 100 g, mẫu thức ăn lỏng lưu tối thiểu 150 ml, và lưu ít nhất 24 giờ._
- Hiển thị lần cập nhật gần nhất và người cập nhật.

### 5.3 API

- `GET /api/schools/me/sample-policy` → `{ sampleGrams: string, sampleMilliliters: string, isDefault: boolean, updatedAt, updatedBy, warnings: string[] }`
- `PATCH /api/schools/me/sample-policy` body `{ sampleGrams, sampleMilliliters }` (`z.strictObject`, số dương, ≤ 3 chữ số thập phân). Kết quả trả kèm `warnings` nếu thấp hơn mức tối thiểu.
- Quyền mới: `school_sample_policy.manage` (BGH). Bếp và kho đọc được qua `cooking_plan.view`.

### 5.4 Xác nhận lưu mẫu (`retained-sample`) — D18

- Bếp **chỉ xác nhận đã lưu mẫu**, không nhập lượng và đơn vị.
- `quantity` và `unit` của `RetainedFoodSample` được hệ thống ghi từ `CookingBatchDish.sample_quantity` / `sample_unit` (lượng mẫu thực tế `M*` sau khi làm tròn đơn vị đếm, xem 7.3) và `sample_unit = standardUnit` của món.
- Bỏ `quantity` và `unit` khỏi body của `POST /cooking-batches/:id/food-samples`. Body có `quantity`/`unit` thì trả 400 (validation strict).
- Bỏ kiểm tra tối thiểu 100 g / 150 ml ở bước này (`MINIMUM_SAMPLE_QUANTITY` trong `retained-sample.validation.ts`). Cảnh báo chỉ nằm ở trang cấu hình (D8).
- Màn lưu mẫu hiển thị lượng mẫu chỉ để đọc. Nếu món có dòng đơn vị đếm bị làm tròn lên thì hiển thị thêm ghi chú, ví dụ _"Đã làm tròn lên 1 hộp, lượng mẫu 180 ml"_.
- Các thông tin vật lý vẫn nhập như hiện tại: tủ, ngăn, thời điểm lấy mẫu, ảnh (D25). Các kiểm tra tủ (trạng thái, sức chứa, ngăn trống) giữ nguyên.
- Mẫu cũ (mẻ có `sample_quantity` NULL) giữ hành vi cũ: bếp nhập lượng, có kiểm tra tối thiểu.

## 6. Kích hoạt lập mẻ theo món

### 6.1 Điều kiện "mọi NCC của món đã khai báo lô"

Món `d` trong đợt `R` sẵn sàng lập mẻ khi:

1. Với mọi `SupplyRequest` của `R` (trạng thái khác `CANCELLED`, `DRAFT`) có chứa ít nhất một nguyên liệu `DIRECT_USE` trong công thức của `d`:
   - đơn đã ở `ACCEPTED` hoặc `IN_PROGRESS`. Đơn còn `SENT` thì món tiếp tục chờ;
   - đơn có **đúng một chuyến giao còn hiệu lực** (`creationMode = REQUEST`, trạng thái khác `REJECTED`, `CANCELLED`) với `preparationStage ≥ LOTS_DECLARED`.
2. Nguyên liệu `DRY_STOCK` của món không cần chờ NCC, planner dùng lô đã `AVAILABLE` trong kho.
3. Đợt 2: mọi lớp đã chốt điểm danh. Điều kiện này đã được kiểm tra khi tạo đơn Đợt 2 và phải được kiểm tra lại lúc lập mẻ.
4. Trường đã cấu hình chế độ nấu và giờ phục vụ.

Mẻ được lập ngay khi đủ điều kiện, kể cả khi ngày giao là ngày mai. Mẻ mới lập ở trạng thái `PENDING_APPROVAL` ("Chờ duyệt"). Vòng đời đầy đủ ở mục 8.1.

### 6.2 Cơ chế

- Sau khi transaction tạo chuyến giao của NCC commit, service tìm các món của đợt **vừa đủ điều kiện**, rồi lập mẻ cho từng món trong **một transaction riêng**. Transaction này lấy advisory lock theo `(schoolId, deliveryDate, batchNo)`.
- Lập mẻ idempotent: món đã có kế hoạch còn hiệu lực trong đợt thì bỏ qua.
- Thứ tự lập giữa các món: theo thời điểm đủ điều kiện, cùng lúc thì theo `displayOrder` trong thực đơn. Món lập sau thấy lượng món lập trước đã giữ, giống cách planner hiện xử lý các món dùng chung lô.
- Lỗi lập mẻ (thiếu nguyên liệu, thiếu danh mục, dị ứng chưa có phương án…) **không** làm hỏng việc khai báo lô của NCC. Món đó ở trạng thái `PLAN_FAILED`, lưu thông báo lỗi, và kho được báo để xử lý.
- Kho có endpoint thử lập lại một món (mục 11).

### 6.3 Phạm vi bữa

Một đợt cấp nguyên liệu cho **mọi bữa của ngày** có thực đơn đã duyệt (`LUNCH` và `AFTERNOON`). Khi món `d` đủ điều kiện, hệ thống lập mẻ cho `d` ở mọi bữa có `d`, theo thứ tự `LUNCH` rồi `AFTERNOON`.

### 6.4 Nhu cầu suất dùng để lập mẻ

| Đợt   | Nhu cầu theo món                                                                                                                                                |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Đợt 1 | Σ `SupplyBatch1GradePortion.portions` của các khối mà thực đơn áp dụng (toàn trường: mọi khối; tách khối: khối được gán). Chưa có nhóm dị ứng vì lớp chưa chốt. |
| Đợt 2 | `readMealPortionDemand` (đã chốt, có nhóm suất/dị ứng) **trừ** số suất đã lập ở Đợt 1 cho món đó.                                                               |

### 6.5 Kho duyệt và NCC xác nhận lấy thêm

- Kế hoạch của mỗi món vừa lập xong được chuyển cho kho duyệt ngay (`PENDING_WAREHOUSE`). Kho duyệt thì các mẻ của món chuyển sang "Đã duyệt Đợt 1" (Đợt 1) hoặc "Đã duyệt Đợt 2" (mẻ mới của Đợt 2), và phần Đợt 2 gộp vào mẻ Đợt 1 chuyển sang `APPROVED`.
- Chuyến giao `D` của NCC chuyển sang `TOP_UP_PENDING` khi **mọi món của đợt có nguyên liệu do `D` giao** đã được kho duyệt. Khi đó phần lấy thêm của `D` đã chốt, không đổi nữa. Nếu phần lấy thêm của `D` bằng 0 thì chuyển thẳng sang `READY_TO_DISPATCH`.

### 6.6 Màn kho duyệt

Hiển thị theo ngày và đợt. Mỗi **nguyên liệu – NCC** là một khung:

```
┌─ Thịt gà — NCC Nông trại An Phú ─────────────────────────┐
│  Nguồn A (Cơ sở Bình Chánh)   lô FP-LT-…   + 0,190 kg     │
│  Nguồn B (Cơ sở Củ Chi)       lô FP-LT-…   + 0,085 kg     │
├──────────────────────────────────────────────────────────┤
│  Tổng lấy thêm cho lưu mẫu:                  0,275 kg     │
└──────────────────────────────────────────────────────────┘
```

- Mỗi dòng nguồn có thể mở ra xem chi tiết theo mẻ: mã mẻ, món, lượng mẫu `M`, phần sống tính được.
- Phần mẫu **lấy từ tồn kho** (đồ khô, lô còn dư) hiển thị trong một khung riêng "Lấy từ kho", không cộng vào tổng lấy thêm của NCC.
- Gia vị hiển thị cùng cấu trúc. Phần mẫu của gia vị được cộng vào gia vị dùng chung của bữa (D13).
- Nút **Duyệt** theo từng món, gửi kèm `planVersion` của món đó.

## 7. Thuật toán lập mẻ có tính phần mẫu

### 7.1 Tồn dùng để lập

`readPlanningStock` mở rộng thêm **lô dự kiến**: lô của các chuyến giao trong đợt có `preparationStage ≥ LOTS_DECLARED`, lấy số lượng từ `receivedQuantity` đã khai báo. Lô dự kiến được đánh dấu `incoming = true` cùng `deliveryId`. Lượng đang giữ (`reservedQuantities`) phải tính cả các mẻ và phần Đợt 2 chưa chính thức (mục 10.4).

### 7.2 Pha A — cấu trúc mẻ

Chạy `planCookingBatches` / `groupDishPlans` **như hiện tại** trên tồn ở 7.1, không có phần mẫu. Pha này quyết định số mẻ, số suất mỗi mẻ và lô cho phần ăn.

Không được đưa phần mẫu vào pha A. Ví dụ một lô gạo vừa đủ 150 suất, cộng thêm phần mẫu thành 151: chạy lại planner thì mẻ 1 lấy 151 suất, mẻ 2 còn 149, và phần mẫu bị chia cho học sinh.

### 7.3 Pha B — phần mẫu

Với mỗi mẻ `b` của món `d`:

```
M   = sampleGrams nếu d.standardUnit = g, sampleMilliliters nếu = ml   (cấu hình, chụp lúc lập mẻ)
S   = d.standardQuantity
r₀  = M / S
```

**Làm tròn đơn vị đếm (D10).** Gọi `C` là các dòng công thức có đơn vị đếm (không phải g/mg/kg/ml/l — dùng `isScaledUnit` trong `src/utils/dish-portion.ts`):

```
nếu C rỗng:  r = r₀
ngược lại:   r = max trên c ∈ C của  ceil(required_c × r₀) / required_c
M*  = làm tròn LÊN 3 chữ số thập phân của (r × S)      — lượng mẫu thực tế, đơn vị = d.standardUnit
```

`r ≥ r₀`. Khi phải làm tròn, cả món dùng tỉ lệ `r` mới, nên dòng g/ml cũng tăng tỉ lệ thuận. `M*` được chụp vào `CookingBatchDish.sample_quantity` và là lượng bếp xác nhận đã lưu (D18).

Với mỗi dòng công thức `i` của `d` (`dish_ingredient_entries`, gồm cả nguyên liệu chính và gia vị):

```
net(b, i)   = ceil(required_i × r)   nếu i ∈ C   (số nguyên)
            = required_i × r          nếu không
gross(b, i) = grossFromNet(net(b, i), wasteRate_i)   nếu i là nguyên liệu chính (MAIN)    (D11)
            = net(b, i)                                nếu i là gia vị (SEASONING), hao hụt 0 (N2)
need(b, i)  = làm tròn LÊN 3 chữ số thập phân của convertQuantity(gross, unit_i, đơn vị lô)   (D12)
```

Ví dụ món sữa: `S = 180 ml`, công thức 1 hộp, `M = 150 ml`. `r₀ = 0,833`, `ceil(0,833) = 1` hộp, nên `r = 1`, `M* = 180 ml`, phần lấy thêm 1 hộp.

Ví dụ món có cả đơn vị đếm và gam: trứng chiên `S = 120 g` gồm 2 quả trứng và 10 g dầu, `M = 100 g`. `r₀ = 0,833`, `ceil(2 × 0,833) = 2` quả, nên `r = 2 / 2 = 1`. Dầu cho mẫu = 10 g, `M* = 120 g`.

Phần mẫu dùng công thức mốc chuẩn của món (`dish_ingredient_entries`), **không** dùng định lượng 1 suất đã chụp trong thực đơn (`menu_day_dish_ingredients`). Vì vậy phần mẫu như nhau dù mẻ phục vụ khối nào (D9).

**Nguyên liệu chính** — chọn **đúng một** lô `L(b, i)` để gánh `need(b, i)`, theo thứ tự ưu tiên:

1. Lô `incoming` của đợt hiện tại nằm trong các lô mà `b` đã dùng cho `i` ở pha A (lô đầu tiên theo hạn dùng). Phần này thành **phần lấy thêm** của lô đó.
2. Lô đã `AVAILABLE` (đồ khô hoặc lô còn dư của đợt trước) nằm trong các lô `b` đã dùng cho `i`, nếu lượng còn trống sau mọi phần đang giữ ≥ `need`. Phần này được **giữ từ kho**, không lấy thêm (D16: chỉ ghi nhận tiêu hao kho).
3. Chế độ `SEPARATE_BY_LOT`: lô `incoming` khác **cùng nhóm nguồn** với lô `b` đã dùng cho `i`. Không được lấy lô khác nhóm nguồn, vì như vậy mẻ bị trộn nguồn.
4. Chế độ `COMBINE_LOTS`: bất kỳ lô `incoming` nào của cùng nguyên liệu trong đợt.
5. Không có lô nào phù hợp thì món chuyển sang `PLAN_FAILED` với thông báo _"Không đủ nguyên liệu lưu mẫu cho mẻ {batchCode}: {tên nguyên liệu}"_.

Kết quả lưu vào `CookingBatchLot.sampleQuantity` của cặp `(b, d, L)`. Nếu `b` chưa dùng `L` cho phần ăn thì tạo dòng mới với `quantityUsed = 0`.

**Gia vị dùng chung của bữa** (nguyên liệu nằm trong `MenuMealSeasoning` của bữa — D13): không gán theo mẻ. Phần mẫu của gia vị `j` trong bữa là:

```
seasoningSample(bữa, j) = Σ need(b, j)  trên mọi mẻ b của bữa có món chứa j
```

Phần này được cộng vào `MenuMealSeasoningLot.sampleQuantity` theo đúng thứ tự lô mà `reserveMealSeasonings` đang dùng: lô `incoming` của đợt thì thành phần lấy thêm, lô `AVAILABLE` thì giữ từ kho.

**Phần lấy thêm của một lô:**

```
topUp(L) = Σ CookingBatchLot.sampleQuantity  trên các dòng gán cho L (L là lô incoming)
         + Σ MenuMealSeasoningLot.sampleQuantity trên các dòng gán cho L
```

Mỗi cặp (mẻ, nguyên liệu) được tính đúng một lần. Vì vậy một mẻ dùng hai lô gà cùng nông trại không bị tính phần mẫu hai lần, còn một lô gà dùng cho hai món khác nhau thì được cộng theo định lượng riêng của từng món.

### 7.4 Ví dụ

Cấu hình `sampleGrams = 100`. Gà nguồn A (lô `L_A`, Đợt 1, lô tính theo kg, `wasteRate` gà = 0,2):

| Mẻ  | Món     | Mốc chuẩn | Gà trong mốc (thành phẩm) | `r`  | Gà thành phẩm cho mẫu | Gà sống cho mẫu |
| --- | ------- | --------- | ------------------------- | ---- | --------------------- | --------------- |
| CB1 | Gà kho  | 200 g     | 120 g                     | 0,5  | 60 g                  | 60 / 0,8 = 75 g |
| CB2 | Gà kho  | 200 g     | 120 g                     | 0,5  | 60 g                  | 75 g            |
| CB3 | Canh gà | 400 g     | 80 g                      | 0,25 | 20 g                  | 25 g            |

`CB1` và `CB2` là hai mẻ vì gạo đến từ hai lô. → `topUp(L_A) = 75 + 75 + 25 = 175 g = 0,175 kg`. NCC của `L_A` lấy thêm 0,175 kg.

Ví dụ làm tròn: muối 2,4 g sống với lô tính theo kg thì `need = 0,003 kg`.

## 8. Vòng đời mẻ và Đợt 2

### 8.1 Trạng thái mẻ (D20)

| Trạng thái (`cooking_batch_status`) | Nhãn FE                   | Khi nào                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PENDING_APPROVAL`                  | Chờ duyệt                 | Hệ thống vừa lập mẻ (Đợt 1 hoặc mẻ mới của Đợt 2), kho chưa duyệt                                                                                                                                                                                         |
| `ROUND1_APPROVED`                   | Đã duyệt Đợt 1            | Kho đã duyệt mẻ lập ở Đợt 1                                                                                                                                                                                                                               |
| `ROUND2_APPROVED`                   | Đã duyệt Đợt 2            | Kho đã duyệt mẻ **mới** lập ở Đợt 2 (không trùng mẻ Đợt 1) (D26)                                                                                                                                                                                          |
| `CONFIRMED`                         | Chính thức – sẵn sàng nấu | Đợt 2 của ngày đã xong (D19): mọi chuyến Đợt 1 và Đợt 2 của ngày đã `RECEIVED` (hoặc `CANCELLED` do hủy đơn), mọi lô của mẻ đã `AVAILABLE`, phần Đợt 2 đã được gộp chính thức. Hoặc Đợt 2 của ngày ở `NOT_NEEDED` (D28) và mọi chuyến Đợt 1 đã `RECEIVED` |
| `COMPLETED`                         | Đã hoàn thành             | Như hiện tại                                                                                                                                                                                                                                              |
| `CANCELLED`                         | Đã hủy                    | Đơn bị hủy do từ chối quá 2 lần                                                                                                                                                                                                                           |

- Bếp chỉ hoàn thành mẻ `CONFIRMED`. Quy tắc "chỉ nấu bữa của hôm nay" vẫn áp ở bước hoàn thành.
- Chuyển sang `CONFIRMED` chạy tự động trong transaction kiểm nhận của chuyến cuối cùng trong ngày. Lúc đó hệ thống gọi `checkReservedStock` có tính `sampleQuantity`. Nếu thiếu tồn thì giữ nguyên trạng thái cũ và báo kho.
- Ngày chưa có đơn Đợt 2 thì mẻ không lên được `CONFIRMED`. Màn kho và bếp hiển thị cảnh báo _"Chưa có đơn Đợt 2 cho ngày …"_ (D19).
- **Đợt 2 không cần (D28, D30)**: hệ thống tự kiểm tra trong transaction chốt điểm danh của lớp **cuối cùng** trong ngày (`meal-attendance`, khi `DailyMealPortion` chuyển `FINALIZED`). Lúc đó, nếu ngày chưa có đơn Đợt 2 nào, hệ thống kiểm tra:
  1. **Theo suất**: mọi khối có `sĩ số thực tế ≤ mốc Đợt 1`. Có khối thiếu suất thì dừng, Đợt 2 đặt như bình thường.
  2. **Theo nguyên liệu** (N22): với mỗi nguyên liệu tươi `i`:
     ```
     cần(i)  = Σ trên mọi khối g, mọi bữa, mọi món của thực đơn áp cho g:
               sĩ số thực tế(g) × grossFromNet(định lượng 1 suất(món, g, i), wasteRate_i)   (đổi về đơn vị đặt hàng)
     đã đặt(i) = Σ requested_quantity của dòng nguyên liệu i trong các đơn Đợt 1 còn hiệu lực của ngày
                 (trạng thái khác CANCELLED, DRAFT; không tính sample_top_up_quantity)
     ```
     `cần(i)` dùng đúng công thức `fresh-demand` đang tính lượng theo suất, chỉ thay số suất bằng sĩ số thực tế và **không** cộng phần lẻ.
  3. Mọi `i` có `đã đặt(i) ≥ cần(i)` thì tạo `supply_rounds` Đợt 2 ở `NOT_NEEDED` và bỏ qua phần lẻ chuyển từ Đợt 1. Nếu mọi chuyến Đợt 1 đã nhận thì các mẻ lên `CONFIRMED` ngay, không thì lên khi chuyến Đợt 1 cuối cùng được nhận.
  4. Có `i` thiếu thì Đợt 2 đặt như bình thường. Màn Đợt 2 hiển thị nguyên liệu nào thiếu và thiếu bao nhiêu.

  Phần mẫu không tham gia phép so sánh này, vì phần mẫu của mẻ Đợt 1 đã được lấy thêm riêng (D23).

- Màn tạo đơn Đợt 2 vẫn hiển thị từng khối _"đã đủ từ Đợt 1, thừa X suất"_ (X = mốc Đợt 1 − sĩ số thực tế của khối) để kho biết. Khi đợt đã `NOT_NEEDED` thì màn chỉ hiển thị _"Đợt 2 không cần đặt: Đợt 1 đã đủ"_, không cho tạo đơn.
- Ví dụ: Đợt 1 cần 7,3 kg gà nên đặt 7 kg, 0,3 kg là phần lẻ. Hôm đó cả trường nghỉ quá nửa, sĩ số thực tế chỉ cần 6,1 kg gà. 7 kg ≥ 6,1 kg nên gà đủ, phần lẻ 0,3 kg bỏ qua. Nếu thực tế cần 7,2 kg thì gà thiếu, Đợt 2 vẫn phải đặt.
- Khối thừa suất thì phần thừa vẫn được nấu và không bị trả lại. Mẻ Đợt 1 giữ nguyên số suất (D22).
- Mẻ ở `PENDING_APPROVAL`, `ROUND1_APPROVED`, `ROUND2_APPROVED` chưa trừ kho và chưa có mẫu, nên **được xóa hẳn** khi phải lập lại (mục 8.3, 9.2). Mã `FP-CB-` của mẻ bị xóa không được dùng lại.

### 8.2 Đợt 2 — gộp mẻ trùng

1. Pha A chạy cho nhu cầu Đợt 2 (mục 6.4) trên tồn gồm lô dư của Đợt 1, lô đồ khô và lô `incoming` của Đợt 2.
2. Với mỗi kế hoạch `p` của món `d`, tính khóa nguồn `key(p)`.
3. Nếu có mẻ Đợt 1 `c` cùng món, cùng `key` (theo D15, mẻ Đợt 1 luôn chưa nấu khi lập Đợt 2): tạo một **phần Đợt 2** gắn vào `c`, lưu riêng trong `cooking_batch_round_parts` + `cooking_batch_round_part_lots` (mục 10.4). **Không** sửa `plannedPortions` hay `CookingBatchLot` của `c` lúc này.
   - Phần Đợt 2 **không** chạy pha B. Phần mẫu của `c` đã đủ từ Đợt 1, nên phần lấy thêm Đợt 2 do `p` bằng 0. Gia vị của bữa cũng không cộng thêm phần mẫu cho `p`.
   - Phần Đợt 2 có trạng thái riêng: `PENDING_APPROVAL` → `APPROVED` (kho duyệt) → `MERGED` (khi mẻ lên chính thức).
   - Lô của phần Đợt 2 được tính vào `reservedQuantities` như lô của mẻ.
4. Ngược lại thì tạo mẻ mới (`PENDING_APPROVAL`) trong nhóm mẻ Đợt 2 và chạy pha B cho mẻ đó. Mẻ mới cần phần mẫu cho **mọi** nguyên liệu của món, kể cả nguyên liệu trùng nguồn với Đợt 1 (D5).
5. Chế độ `COMBINE_LOTS` có đúng 1 mẻ cho mỗi món trong mỗi bữa, nên Đợt 2 luôn thành phần gộp vào mẻ Đợt 1 của cùng món.
6. **Khi mẻ lên `CONFIRMED`**: với mỗi phần Đợt 2 `APPROVED` của mẻ thì `c.plannedPortions += part.plannedPortions`, cập nhật `CookingBatchDish.plannedPortions`, cộng lô của phần vào `CookingBatchLot` (cùng lô thì cộng dồn `quantityUsed`), rồi chuyển phần sang `MERGED`. Phần đã gộp giữ lại làm lịch sử.
7. **Mẻ Đợt 1 cố định (D22)**: Đợt 2 chỉ cộng thêm suất (phần Đợt 2 hoặc mẻ mới), không bớt suất, không đổi lô và không xóa mẻ Đợt 1. Ngoại lệ duy nhất là lô Đợt 1 bị từ chối (mục 8.3).
8. **Đổi bất biến cho mẻ lập theo đợt (D28)**: hiện bước hoàn thành bắt tổng `plannedPortions` theo món **bằng** suất đã chốt (`kitchen.service.ts` khoảng dòng 935–943). Với mẻ có `supply_round_id` thì đổi thành **lớn hơn hoặc bằng**, vì khối nghỉ quá nửa sẽ làm mẻ Đợt 1 dư suất. Mẻ lập thủ công (không có đợt) giữ quy tắc bằng nhau. Phân bổ suất cho lớp vẫn chia theo suất đã chốt, phần dư không giao cho lớp nào.
9. Nhu cầu Đợt 2 của món tính theo khối: Σ trên các khối `max(0, sĩ số thực tế − mốc Đợt 1)` của khối áp thực đơn có món đó. Khối thừa không được trừ sang khối khác.

### 8.3 Lô bị từ chối (D20)

- **Lô Đợt 2 bị từ chối**: xóa các phần Đợt 2 (`cooking_batch_round_parts`) và các mẻ mới của Đợt 2 có dùng lô của chuyến bị từ chối, ở bất kỳ trạng thái nào trước `CONFIRMED`. **Mẻ Đợt 1 giữ nguyên.** Khi NCC khai báo lô thay thế thì hệ thống lập lại phần/mẻ Đợt 2 của món đó (mục 9.2), kho duyệt lại.
- **Lô Đợt 1 bị từ chối** (D27): xóa các mẻ Đợt 1 có dùng lô của chuyến bị từ chối, cùng các phần Đợt 2 đã gắn vào những mẻ đó. Các mẻ Đợt 1 khác giữ nguyên. Khi có lô thay thế thì lập lại các mẻ đã xóa. Nếu Đợt 2 đã có kế hoạch thì phần Đợt 2 của món đó được lập lại theo các mẻ mới.

## 9. Giao lại khi bị từ chối

### 9.1 Hiện trạng cần sửa

- `supplier-order.service.ts` chặn mọi chuyến thứ hai bằng `hasDeliveryForRequest`, và unique index `uq_deliveries_request_mode` chỉ cho một chuyến `REQUEST` mỗi đơn.
- FE NCC đang giao lại bằng **chuyến giao lẻ** (`STANDALONE`, `DeliveryCreateView.jsx`). Cách này làm đơn gốc treo ở `IN_PROGRESS`, giới hạn 2 lần giao lại không áp dụng, và mất thông tin đợt.
- `redeliveryLimit: 2` và `cancelRemainder` trong `delivery.service.ts` hiện không bao giờ chạy tới.

### 9.2 Luồng mới

1. Chuyến `D` bị từ chối (`REJECTED`). Nếu số chuyến bị từ chối của đơn ≤ 2: đơn giữ `IN_PROGRESS`, các món có mẻ dùng lô của `D` chuyển sang `REPLAN_REQUIRED`, và phần/mẻ dùng lô của `D` bị xóa theo mục 8.3. Mẻ khác giữ nguyên.
2. NCC tạo **chuyến giao thay thế**: `sourceType = REQUEST`, `supplyRequestId` của đơn gốc, `replacesDeliveryId = D.id`.
   - Phải phủ đủ mọi dòng của đơn, với tổng số lượng đúng bằng số lượng đặt (giữ quy tắc hiện tại).
   - **Bắt buộc khai báo lô mới**. Form điền sẵn nguyên liệu, cơ sở nguồn, số lượng, **ngày sản xuất và hạn dùng** từ `D`.
   - Lô của `D` giữ `BLOCKED` làm lịch sử, không xóa.
3. Hệ thống **chỉ lập lại các phần/mẻ đã bị xóa**: chạy lại pha A cho món của mẻ đó với lô thay thế; mẻ không dùng lô của `D` giữ nguyên. Mẻ lập lại ở `PENDING_APPROVAL`. Pha B:
   - nguyên liệu không dính lô bị từ chối: giữ nguyên lô gánh phần mẫu cũ (không lấy thêm lần nữa);
   - nguyên liệu dính lô bị từ chối: tính lại phần mẫu trên lô thay thế, thành phần lấy thêm của chuyến thay thế.
4. Kho duyệt kế hoạch đã lập lại, sau đó NCC xác nhận lấy thêm, rồi NCC điền thông tin vận chuyển (`dispatch`) và chuyển sang `IN_TRANSIT`.
5. Số chuyến bị từ chối của đơn > 2: chạy `cancelRemainder` như hiện tại. Các mẻ đang chờ giao lại chuyển sang `CANCELLED`, bữa thiếu món và cần BGH/bếp xử lý thủ công (ngoài phạm vi, chỉ thông báo).
6. FE NCC: với chuyến `REQUEST` bị từ chối, nút "Giao lại" mở form chuyến thay thế. Bỏ đường giao lại bằng chuyến giao lẻ cho trường hợp này.

## 10. Mô hình dữ liệu (migration mới, expand-only)

### 10.1 Cấu hình — bảng mới `school_sample_policies`

| Cột                         | Kiểu                   | Ghi chú   |
| --------------------------- | ---------------------- | --------- |
| `school_id`                 | uuid PK, FK `schools`  |           |
| `sample_grams`              | numeric(14,3) NOT NULL | CHECK > 0 |
| `sample_milliliters`        | numeric(14,3) NOT NULL | CHECK > 0 |
| `updated_by_user_id`        | uuid FK `users`        |           |
| `created_at` / `updated_at` | timestamptz            |           |

Không có dòng thì dùng mặc định 100 / 150 trong code.

### 10.2 Đợt giao — bảng mới `supply_rounds`

| Cột                         | Kiểu                       | Ghi chú                                                                                                                                 |
| --------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | uuid PK                    |                                                                                                                                         |
| `school_id`                 | uuid FK                    |                                                                                                                                         |
| `delivery_date`             | date                       |                                                                                                                                         |
| `batch_no`                  | smallint                   | CHECK 1 hoặc 2                                                                                                                          |
| `status`                    | enum `supply_round_status` | `COLLECTING`, `IN_REVIEW`, `READY`, `CLOSED` (tổng hợp từ trạng thái từng món), `NOT_NEEDED` (chỉ cho Đợt 2: mọi khối đủ từ Đợt 1, D28) |
| `not_needed_at`             | timestamptz NULL           | thời điểm hệ thống tự xác nhận "đủ từ Đợt 1" (D30)                                                                                      |
| `created_at` / `updated_at` | timestamptz                |                                                                                                                                         |

UNIQUE `(school_id, delivery_date, batch_no)`.

### 10.3 Kế hoạch theo món — bảng mới `supply_round_dish_plans`

| Cột                                   | Kiểu                    | Ghi chú                                                                                             |
| ------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------- |
| `supply_round_id`                     | uuid FK                 |                                                                                                     |
| `dish_id`                             | uuid FK                 |                                                                                                     |
| `status`                              | enum `dish_plan_status` | `WAITING_SUPPLIERS`, `PLAN_FAILED`, `PENDING_WAREHOUSE`, `APPROVED`, `REPLAN_REQUIRED`, `CANCELLED` |
| `plan_version`                        | varchar(64) NULL        | hash kế hoạch hiện hành của món                                                                     |
| `failure_message`                     | text NULL               |                                                                                                     |
| `approved_by_user_id` / `approved_at` | NULL                    |                                                                                                     |
| `created_at` / `updated_at`           | timestamptz             |                                                                                                     |

PK `(supply_round_id, dish_id)`.

### 10.4 Mẻ

- `cooking_batch_status` thêm `PENDING_APPROVAL`, `ROUND1_APPROVED`, `ROUND2_APPROVED` và `CANCELLED` (mục 8.1). `CONFIRMED` giữ tên trong DB, nhãn FE đổi thành "Chính thức – sẵn sàng nấu". `UNCONFIRMED` giữ cho dữ liệu cũ.
- `cooking_batches.supply_batch_no SMALLINT NULL` (1 hoặc 2): đợt đã lập ra mẻ. NULL cho mẻ lập thủ công.
- Bảng mới `cooking_batch_round_parts` — phần Đợt 2 gộp vào mẻ Đợt 1 (mục 8.2):

  | Cột                                                | Kiểu                     | Ghi chú                                               |
  | -------------------------------------------------- | ------------------------ | ----------------------------------------------------- |
  | `id`                                               | uuid PK                  |                                                       |
  | `cooking_batch_id`, `dish_id`                      | uuid                     | FK `cooking_batch_dishes (cooking_batch_id, dish_id)` |
  | `supply_round_id`                                  | uuid FK                  | đợt 2 tạo ra phần này                                 |
  | `planned_portions`                                 | integer                  | CHECK > 0                                             |
  | `status`                                           | enum `round_part_status` | `PENDING_APPROVAL`, `APPROVED`, `MERGED`              |
  | `approved_by_user_id` / `approved_at`, `merged_at` | NULL                     |                                                       |

- Bảng mới `cooking_batch_round_part_lots`: `(round_part_id, ingredient_lot_id)` PK, `quantity_used NUMERIC(14,3)` CHECK > 0, `unit`. Không có `sample_quantity`, vì phần Đợt 2 không có phần mẫu.
- Không đổi PK của `cooking_batch_lots`, vì `meal_allocation_materials` đang tham chiếu khóa `(cooking_batch_id, dish_id, ingredient_lot_id)`.
- `cooking_batch_groups.supply_round_id UUID NULL` FK `supply_rounds`. NULL nghĩa là mẻ lập thủ công như hiện tại.
- `cooking_batch_dishes` thêm (chụp lúc lập mẻ, dòng cũ để NULL):
  - `sample_quantity NUMERIC(14,3) NULL` — lượng mẫu thực tế `M*` (đã làm tròn đơn vị đếm, mục 7.3);
  - `sample_ratio NUMERIC(18,9) NULL` — tỉ lệ `r` đã dùng;
  - `sample_unit VARCHAR(30) NULL` — `g` hoặc `ml`, bằng `standardUnit` của món;
  - `standard_quantity_snapshot NUMERIC(14,3) NULL`.
- `cooking_batch_lots.sample_quantity NUMERIC(14,3) NOT NULL DEFAULT 0`, CHECK `>= 0`. CHECK hiện tại `cooking_batch_lots_quantity_used_check (quantity_used > 0)` (migration `20261031000200_cooking_option_a_expand`) đổi thành `quantity_used >= 0 AND (quantity_used > 0 OR sample_quantity > 0)`.
- `menu_meal_seasoning_lots.sample_quantity NUMERIC(14,3) NOT NULL DEFAULT 0`, CHECK `>= 0`. CHECK `quantity_used > 0` của bảng này (migration `20261031000300_menu_meal_ingredient_standards`) giữ nguyên.
- `reservedQuantities` cộng `quantityUsed + sampleQuantity` của mẻ `PENDING_APPROVAL`, `ROUND1_APPROVED`, `ROUND2_APPROVED`, `UNCONFIRMED`, `CONFIRMED`; `quantity_used` của phần Đợt 2 chưa `MERGED`; và gia vị chưa dùng.

### 10.5 Chuyến giao, đơn và lô

- `deliveries.preparation_stage` enum `delivery_preparation_stage` NULL: `LOTS_DECLARED`, `PENDING_WAREHOUSE`, `TOP_UP_PENDING`, `READY_TO_DISPATCH`. NULL cho chuyến cũ và chuyến giao lẻ: dispatch như hiện tại.
- `deliveries.replaces_delivery_id UUID NULL` FK tự tham chiếu. CHECK: chỉ có giá trị khi `creation_mode = 'REQUEST'`.
- `deliveries.top_up_confirmed_by_user_id` / `top_up_confirmed_at` NULL.
- Thay `uq_deliveries_request_mode` bằng partial unique `(supply_request_id) WHERE creation_mode = 'REQUEST' AND status NOT IN ('REJECTED','CANCELLED')`.
- `ingredient_lots.sample_top_up_quantity NUMERIC(14,3) NOT NULL DEFAULT 0`, CHECK `>= 0`. Khi NCC xác nhận lấy thêm: `received_quantity += sample_top_up_quantity`.
- `delivery_items.sample_top_up_quantity NUMERIC(14,3) NOT NULL DEFAULT 0` = Σ của các lô. `actual_quantity` sau khi lấy thêm = số lượng đặt + phần này.
- **Hàng lưu mẫu của đơn (D23, D29)** — `supply_request_items` thêm một cột, tách khỏi `requested_quantity`:
  - `sample_top_up_quantity NUMERIC(14,3) NOT NULL DEFAULT 0`, CHECK `>= 0`: giao thêm **cho lưu mẫu**, hệ thống ghi khi NCC xác nhận lấy thêm (D16). Trường không nhập tay.
  - Không có cột giao thêm thủ công: tính năng này bị bỏ (D29). `requested_quantity` chỉ gồm lượng theo suất và phần lẻ chuyển từ Đợt 1.
  - **Lượng mua với NCC** = `requested_quantity + sample_top_up_quantity`.
  - Phần mẫu lấy từ tồn kho không ghi vào đây, chỉ có trong `COOKING_USAGE` khi hoàn thành mẻ. Giá trị đơn để sau (D16), vì hệ thống chưa có đơn giá.
  - Khi tách mẻ (pha A), phần `sample_top_up_quantity` **không** được dùng để nấu cho suất ăn. Nó đã được giữ riêng qua `CookingBatchLot.sampleQuantity` / `MenuMealSeasoningLot.sampleQuantity`, nên `reservedQuantities` loại nó khỏi lượng còn trống. Ví dụ khi Đợt 2 dùng lô dư của Đợt 1, hoặc khi lập lại mẻ do giao lại.
  - Bất biến khai báo lô: tổng `actual_quantity` các dòng giao = `requested_quantity` lúc khai báo (giữ quy tắc hiện tại), và `requested_quantity + sample_top_up_quantity` sau khi NCC xác nhận lấy thêm.

## 11. API

| Method    | Đường dẫn                                       | Ai            | Quyền                         | Mô tả                                                                                                                                                                        |
| --------- | ----------------------------------------------- | ------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET/PATCH | `/api/schools/me/sample-policy`                 | BGH           | `school_sample_policy.manage` | Mục 5.3                                                                                                                                                                      |
| GET       | `/api/supply-rounds?date=&batchNo=`             | Kho, BGH, bếp | `cooking_plan.view`           | Trạng thái đợt và từng món, chuyến giao từng NCC kèm `preparationStage`, kế hoạch mẻ, khung lấy thêm theo nguyên liệu – NCC (mục 6.6)                                        |
| POST      | `/api/supply-rounds/:id/dishes/:dishId/plan`    | Kho           | `cooking_plan.approve`        | Thử lập lại một món khi `PLAN_FAILED`                                                                                                                                        |
| POST      | `/api/supply-rounds/:id/dishes/:dishId/approve` | Kho           | `cooking_plan.approve`        | Body `{ planVersion }`. Sai version trả 409 _"Kế hoạch đã thay đổi"_. Sau khi duyệt, chuyến giao nào đủ điều kiện ở 6.5 thì chuyển `TOP_UP_PENDING` hoặc `READY_TO_DISPATCH` |
| POST      | `/api/deliveries/management/:id/top-up`         | NCC           | `delivery.manage`             | Body `{ lots: [{ ingredientLotId, sampleTopUpQuantity }] }` phải khớp đúng kế hoạch đã duyệt. Idempotent theo fingerprint                                                    |
| POST      | `/api/deliveries/management`                    | NCC           | `delivery.manage`             | Thêm `replacesDeliveryId` cho `sourceType = REQUEST`                                                                                                                         |
| POST      | `/api/deliveries/management/:id/dispatch`       | NCC           | `delivery.manage`             | Thêm điều kiện: chuyến có `preparationStage` khác NULL phải ở `READY_TO_DISPATCH`                                                                                            |
| POST      | `/api/cooking-batches`                          | Bếp           | `cooking_batch.create`        | Giữ nguyên cho bữa không có đợt. Bữa đã có nhóm mẻ gắn `supply_round_id` còn hiệu lực trả 409                                                                                |

Quyền mới gán mặc định trong catalog:

- `cooking_plan.view`: `INGREDIENT_MANAGEMENT_DEPARTMENT`, `SCHOOL_KITCHEN_STAFF`, `SCHOOL_MANAGEMENT_BOARD`
- `cooking_plan.approve`: `INGREDIENT_MANAGEMENT_DEPARTMENT`
- `school_sample_policy.manage`: `SCHOOL_MANAGEMENT_BOARD`

Mọi endpoint giữ envelope hiện có, lấy scope trường/NCC từ principal, validate bằng `z.strictObject` với thông báo tiếng Việt.

## 12. Thay đổi trong các bước hiện có

| Bước           | File                                                                                   | Thay đổi                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Khai báo lô    | `supplier-order.service.ts`                                                            | Bỏ chặn `hasDeliveryForRequest` khi các chuyến cũ đều `REJECTED`/`CANCELLED`. Đặt `preparationStage = LOTS_DECLARED`. Sau commit thì kiểm tra các món vừa đủ NCC (mục 6.2)                                                                                                                                                                                                                                                                             |
| Dispatch       | `supplier-order.service.ts`                                                            | Kiểm tra `READY_TO_DISPATCH`                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Kiểm nhận      | `delivery.service.ts`                                                                  | `verifyRequestDeliveryReceipt` chấp nhận `actual = requested + sampleTopUp`. Khi chuyến cuối của ngày `RECEIVED`: gộp phần Đợt 2 và chuyển mẻ sang `CONFIRMED` theo mục 8.1, 8.2. Khi `REJECTED`: xóa phần/mẻ theo mục 8.3, món liên quan chuyển `REPLAN_REQUIRED`                                                                                                                                                                                     |
| Lập mẻ         | `kitchen.service.ts`                                                                   | Tách pha A/B, lập theo món. Thêm lô dự kiến, trạng thái `PENDING_APPROVAL`, phần Đợt 2 lưu riêng. Chụp `sample_quantity` (`M*`), `sample_ratio`, `sample_unit`, `standard_quantity_snapshot`. Phần mẫu dùng `isScaledUnit` / `grossFromNet` có sẵn (`src/utils/dish-portion.ts`, `src/utils/waste-rate.ts`), làm tròn đơn vị đếm lên số nguyên và lượng lô lên 3 chữ số. Lập cho ngày tương lai được phép **chỉ** với các trạng thái trước `CONFIRMED` |
| Gia vị         | `kitchen.service.ts` → `reserveMealSeasonings`                                         | Cộng `sampleQuantity` vào `MenuMealSeasoningLot` (D13)                                                                                                                                                                                                                                                                                                                                                                                                 |
| Hoàn thành mẻ  | `kitchen.service.ts` → `complete`                                                      | Chỉ cho mẻ `CONFIRMED` (chính thức, D19). `COOKING_USAGE` = `quantityUsed + sampleQuantity` mỗi lô; gia vị dùng chung trừ cả `sampleQuantity`. Index idempotency `uq_inventory_usage_per_batch_lot` giữ nguyên                                                                                                                                                                                                                                         |
| Phân bổ suất   | `meal-allocation/*`                                                                    | Không đổi: nguồn chia cho lớp vẫn là `quantityUsed`, phần `sampleQuantity` không được chia                                                                                                                                                                                                                                                                                                                                                             |
| Lưu mẫu        | `retained-sample.validation.ts` / `.service.ts`, FE `KitchenSamples`                   | Bỏ `quantity`/`unit` khỏi body, hệ thống ghi từ mẻ. Bỏ kiểm tra tối thiểu ở bước này. Màn lưu mẫu hiển thị lượng chỉ để đọc, kèm ghi chú làm tròn đơn vị đếm (mục 5.4)                                                                                                                                                                                                                                                                                 |
| FE bếp         | `KitchenCooking/*`                                                                     | Nhãn trạng thái mới: Chờ duyệt, Đã duyệt Đợt 1, Đã duyệt Đợt 2, Chính thức – sẵn sàng nấu. Nút hoàn thành chỉ hiện ở mẻ chính thức. Cảnh báo khi ngày chưa có đơn Đợt 2                                                                                                                                                                                                                                                                                |
| Đặt hàng       | `fresh-demand.service.ts`, `supplier-onboarding.service.ts` (`createOrderDraft`)       | **Không** cộng phần mẫu vào lượng đặt (phần mẫu đến từ bước lấy thêm). Lượng mua với NCC = `requested + sample_top_up`. `fresh-demand` Đợt 2 trả thêm số suất thừa theo khối (`max(0, mốc Đợt 1 − thực tế)`) để FE hiển thị (D28). Tạo đơn Đợt 2 khi đợt đã `NOT_NEEDED` thì trả 409                                                                                                                                                                   |
| Chốt điểm danh | `meal-attendance.service.ts`, `fresh-demand.service.ts`                                | Khi lớp cuối cùng của ngày chốt, kiểm tra theo suất và theo nguyên liệu rồi tự tạo Đợt 2 `NOT_NEEDED` (D30, mục 8.1), trong cùng transaction chốt điểm danh. `fresh-demand` thêm hàm tính `cần(i)` theo sĩ số thực tế, không cộng phần lẻ, và so với lượng Đợt 1 đã đặt                                                                                                                                                                                |
| FE đặt hàng    | `IngredientOrders/component/CreateDeliveryView.jsx`, `services/IngredientOrderService` | **Bỏ** cột "Giao thêm", nút/popup "Thêm nguyên liệu giao thêm" và các state `extraQty`, `isExtraItem` (D29). `orderedQty` chỉ còn lượng theo suất. Màn Đợt 2 hiển thị khối "đã đủ từ Đợt 1, thừa X suất", và thông báo "Đợt 2 không cần đặt" khi đợt đã `NOT_NEEDED` (không có nút xác nhận). Màn chi tiết đơn có cột "Lưu mẫu" chỉ đọc                                                                                                                |
| FE BGH         | trang mới `SCHOOL/SamplePolicy`, `router/MenuItem.jsx`, `router/AppRouter.jsx`         | Mục 5.2; link trong nhóm "Cấu hình" của sidebar BGH (D17)                                                                                                                                                                                                                                                                                                                                                                                              |
| FE kho         | trang mới `SCHOOL/SupplyRoundPlan`                                                     | Mục 6.6                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| FE NCC         | `SupplierDeliveries/*`                                                                 | Hiển thị `preparationStage`, panel xác nhận lấy thêm theo lô, khóa nút vận chuyển tới khi sẵn sàng, nút giao lại tạo chuyến thay thế                                                                                                                                                                                                                                                                                                                   |

## 13. Câu hỏi

### 13.1 Đã chốt ngày 24/11/2026

| Câu | Nội dung                                | Trả lời                                                                                                            | Ghi vào      |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------ |
| 1   | Đơn vị và cách cấu hình lượng mẫu       | Hai giá trị: 100 g và 150 ml. Có đoạn chữ nhỏ, mờ, nghiêng dưới form, trước nút lưu, trích quy định 100 g – 150 ml | D8, 5.1, 5.2 |
| 2   | Cho cấu hình thấp hơn mức tối thiểu?    | Cho phép, chỉ hiện cảnh báo vàng                                                                                   | D8, 5.1      |
| 3   | Tính theo mốc chuẩn hay khẩu phần khối? | Theo mốc chuẩn. Mốc chuẩn là tham chiếu từ suất ăn ra nguyên liệu                                                  | D9, 7.3      |
| 4   | Dòng đơn vị đếm                         | Vẫn tính theo g/ml của mốc chuẩn và cấu hình. Ví dụ hộp sữa 180 ml thì trường tự cấu hình mẫu 180 ml               | D10, 7.3     |
| 5   | Phần lấy thêm có tính hao hụt?          | Có. Mốc là thành phẩm (= sống × (1 − wasteRate)), phải đổi ngược ra lượng sống                                     | D11, 7.3     |
| 6   | Làm tròn                                | Làm tròn lên 3 chữ số thập phân theo đơn vị lô (2,4 g → 0,003 kg)                                                  | D12, 7.3     |
| 7   | Đơn vị khi ghi nhận mẫu                 | Theo đúng đơn vị của mốc chuẩn món: món g dùng cấu hình g, món ml dùng cấu hình ml                                 | D8, 5.4      |
| 8   | Lệch công thức đặt hàng và lập mẻ       | Chưa rõ câu hỏi: đã giải thích lại ở câu N7                                                                        | 13.2         |
| 9   | Gia vị có phần mẫu?                     | Có (B): cộng vào gia vị dùng chung của bữa                                                                         | D13, 7.3     |
| 10  | "Kho xác nhận" là gì?                   | Kho xem lượng lấy thêm theo khung nguyên liệu – NCC, bên trong là các nguồn, chân khung là tổng                    | D14, 6.6     |
| 11  | Thời điểm lập mẻ                        | Ngay khi mọi NCC **của món** đã khai báo lô thì tách mẻ và cho kho duyệt luôn                                      | D1, 6.1, 6.2 |
| 12  | Bếp có nấu Đợt 1 trước Đợt 2?           | Không: phải đợi Đợt 2 xong như hiện tại                                                                            | D15, 8       |
| 13  | Tính vào hợp đồng / giá trị đơn?        | Phần đặt từ NCC thì tính vào giá trị đơn và lượng mua theo hợp đồng. Phần lấy từ kho chỉ ghi tiêu hao              | D16, 10.5    |

### 13.2 Đã chốt ngày 24/11/2026 (lần 2)

| Câu | Nội dung                 | Trả lời                                                                                                                                               | Ghi vào       |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| N1  | Làm tròn dòng đơn vị đếm | Làm tròn lên số nguyên                                                                                                                                | D10, 7.3      |
| N3  | Trang cấu hình           | Tạo trang cấu hình cho BGH, có đường dẫn trong nhóm "Cấu hình" ở sidebar                                                                              | D17, 5.2      |
| N4  | Ghi nhận mẫu thực tế     | Không cho điền: chỉ xác nhận đã lưu. Lượng theo đúng cấu hình và mẻ. Dòng đơn vị đếm làm tròn lên thì lượng mẫu tăng tỉ lệ thuận theo mốc g/ml        | D18, 5.4, 7.3 |
| N5  | Ngày không có Đợt 2      | Ngày phải có Đợt 2, giữ nguyên như hiện tại                                                                                                           | D19, 8.1      |
| N6  | Giá trị đơn              | Để sau                                                                                                                                                | D16, 15       |
| N7  | (hỏi về lệch công thức)  | Trả lời về trạng thái mẻ: tách "Chờ duyệt" – "Đã duyệt Đợt 1" – "Chính thức" sau Đợt 2. Lô Đợt 2 bị từ chối thì xóa mẻ Đợt 2 và lập lại, giữ mẻ Đợt 1 | D20, 8.1, 8.3 |
| N9  | NCC khai báo chậm        | Tạm chưa xử lý, ghi lại để làm sau                                                                                                                    | D21, 15       |

N2 và N8 chưa rõ câu hỏi: giải thích lại ở 13.3. Phần lệch công thức (câu 8 cũ) vẫn chưa có trả lời: hỏi lại ở N16.

### 13.3 Đã chốt ngày 24/11/2026 (lần 3)

| Câu | Nội dung                              | Trả lời                                                                                                                                                                             | Ghi vào   |
| --- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| N2  | Hao hụt của gia vị                    | B: gia vị luôn tính hao hụt 0 trong phần mẫu                                                                                                                                        | D11, 7.3  |
| N8  | Mẻ Đợt 1 bị giảm suất                 | Hiểu sai: Đợt 1 cố định, Đợt 2 = sau điểm danh trừ Đợt 1, nên Đợt 2 chỉ cộng thêm                                                                                                   | D22, 8.2  |
| N13 | Chưa từng lưu cấu hình                | A: dùng luôn 100 g / 150 ml                                                                                                                                                         | D24, 5.1  |
| N14 | Xác nhận lưu mẫu còn nhập gì          | Giữ tủ, ngăn, thời điểm, ảnh; chỉ cố định định lượng                                                                                                                                | D25, 5.4  |
| N15 | Trạng thái mẻ mới Đợt 2               | Đồng ý "Đã duyệt Đợt 2"                                                                                                                                                             | D26, 8.1  |
| N16 | Lệch đặt hàng – tách mẻ               | Phần mẫu tách hẳn: chỉ cần giao thêm đúng lượng nguyên liệu của mẫu, khẩu phần khối không liên quan. Đưa vào hàng "giao thêm" của đơn, chưa có thì tạo. Tách mẻ không tính phần này | D23, 10.5 |
| N17 | Lô Đợt 1 bị từ chối sau khi gộp Đợt 2 | Đồng ý xóa cả hai rồi lập lại                                                                                                                                                       | D27, 8.3  |

Phần lệch giữa định lượng đặt hàng và tách mẻ **cho suất ăn** (không phải phần mẫu) nằm ngoài TASK-10. Khi thiếu thì món báo `PLAN_FAILED` để kho xử lý, khi dư thì thành tồn kho.

### 13.4 Đã chốt ngày 24/11/2026 (lần 4)

| Câu | Nội dung                 | Trả lời                                                                                                                                                                                  | Ghi vào            |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| N18 | Sĩ số thấp hơn mốc Đợt 1 | Tính theo khối. Một lớp nghỉ quá nửa thì khối bù được. Cả khối nghỉ quá nửa thì Đợt 2 báo đã đủ từ Đợt 1 và thừa bao nhiêu. Nếu Đợt 1 đã giao và đủ lưu mẫu thì nấu luôn, chấp nhận thừa | D19, D28, 8.1, 8.2 |
| N19 | Giao thêm thủ công       | Bỏ hẳn giao thêm. Chỉ còn một loại là lưu mẫu, không tính khi chia mẻ                                                                                                                    | D29, 10.5, 12      |

### 13.5 Đã chốt ngày 24/11/2026 (lần 5)

| Câu | Nội dung                  | Trả lời                                                                                                  | Ghi vào  |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| N20 | Ai xác nhận "đủ từ Đợt 1" | B: hệ thống tự xác nhận. "Mọi khối = 0" nghĩa là lượng nguyên liệu bổ sung cho Đợt 2 của mọi khối bằng 0 | D30, 8.1 |
| N21 | Khối thừa, khối thiếu     | Đồng ý không bù chéo, ghi là hạn chế                                                                     | D31, 16  |

### 13.6 Đã chốt ngày 24/11/2026 (lần 6)

| Câu | Nội dung                | Trả lời                                                                                                                                                                   | Ghi vào  |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| N22 | Phần lẻ chuyển từ Đợt 1 | B: mọi khối thừa suất thì bỏ qua phần lẻ. Nhưng phải kiểm tra lượng Đợt 1 đã đặt (đã làm tròn xuống) vẫn đủ nguyên liệu cho cả trường, không chỉ kiểm tra sĩ số / số suất | D30, 8.1 |

Không còn câu hỏi mở.

## 14. Kịch bản nghiệm thu

1. **Cấu hình**: BGH lưu 80 g / 150 ml thì lưu thành công, có cảnh báo vàng cho ô gam. Trang hiển thị đoạn trích QĐ 1246 nhỏ, mờ, nghiêng ngay trước nút lưu.
2. **Kích hoạt theo món**: món X dùng gà (NCC A) và rau (NCC B). NCC A khai báo thì X vẫn `WAITING_SUPPLIERS`. NCC B khai báo thì X được lập mẻ "Chờ duyệt" (`PENDING_APPROVAL`) cho mọi bữa có X và chuyển `PENDING_WAREHOUSE`. Món Y chỉ dùng gà của NCC A thì đã được lập ngay sau khi NCC A khai báo.
3. **Phần lấy thêm**: ví dụ mục 7.4 cho `topUp(L_A) = 0,175 kg` (đã tính hao hụt). Một mẻ dùng 2 lô gà cùng nông trại chỉ có phần mẫu trên 1 lô. Muối 2,4 g ra 0,003 kg.
4. **Món ml**: món canh có mốc chuẩn 300 ml, cấu hình 150 ml thì `r = 0,5` cho mọi dòng công thức của món, và mẫu được ghi theo ml.
   4a. **Đơn vị đếm**: món sữa mốc chuẩn 180 ml, công thức 1 hộp, cấu hình 150 ml thì phần lấy thêm là 1 hộp và `sample_quantity` của mẻ = 180 ml. Món trứng chiên 120 g gồm 2 quả + 10 g dầu, cấu hình 100 g thì phần mẫu là 2 quả + 10 g dầu, `M* = 120 g`.
   4b. **Xác nhận lưu mẫu**: body lưu mẫu có `quantity` hoặc `unit` thì trả 400. Mẫu được lưu với lượng và đơn vị lấy từ mẻ, kể cả khi thấp hơn 100 g / 150 ml.
5. **Đồ khô**: gạo từ lô đồ khô có đủ chỗ trống thì phần mẫu được giữ từ kho, nằm trong khung "Lấy từ kho", không cộng vào tổng lấy thêm của NCC và không ghi vào `supply_request_items.sample_top_up_quantity`. Không đủ thì món `PLAN_FAILED` với thông báo đúng mẻ và nguyên liệu.
6. **Gia vị**: phần mẫu của muối trong 3 mẻ của bữa được cộng vào `MenuMealSeasoningLot.sampleQuantity` của bữa, không tạo dòng theo mẻ. Muối có `wasteRate` 5 % trong danh mục thì phần mẫu vẫn tính hao hụt 0.
   6a. **Hàng lưu mẫu của đơn**: sau khi NCC xác nhận lấy thêm, dòng đơn có `requested_quantity` (theo suất) và `sample_top_up_quantity` (lưu mẫu) tách riêng. Màn chi tiết đơn hiển thị cột "Lưu mẫu" chỉ đọc. Màn tạo đơn Đợt 2 không còn cột, nút hay popup "Giao thêm". Lập lại mẻ sau khi đã nhận hàng thì phần `sample_top_up_quantity` không bị dùng cho suất ăn.
   6b. **Đủ từ Đợt 1**: cả hai khối nghỉ quá nửa. Đợt 1 đặt 7 kg gà (phần lẻ 0,3 kg), sĩ số thực tế cần 6,1 kg; mọi nguyên liệu khác cũng đủ. Lớp cuối cùng chốt điểm danh thì hệ thống tự tạo Đợt 2 `NOT_NEEDED`, không ai phải bấm, và phần lẻ 0,3 kg không được đặt. Các mẻ Đợt 1 đã nhận hàng lên "Chính thức". Màn Đợt 2 hiển thị "Đợt 2 không cần đặt" và từng khối "thừa X suất". Gọi tạo đơn Đợt 2 thì nhận 409.
   6c. **Thừa suất nhưng thiếu nguyên liệu**: mọi khối thừa suất, nhưng sĩ số thực tế cần 7,2 kg gà mà Đợt 1 chỉ đặt 7 kg. Đợt 2 **không** được tự bỏ qua. Màn Đợt 2 báo gà thiếu 0,2 kg, và trường đặt Đợt 2 như bình thường. Hoàn thành mẻ với số suất lớn hơn suất đã chốt thì vẫn được. Mẻ lập thủ công có số suất khác suất chốt thì vẫn bị 409 như cũ.
7. **Kho duyệt**: màn kho hiển thị khung "Thịt gà — NCC An Phú" gồm từng nguồn và tổng ở chân khung. Duyệt với `planVersion` cũ thì nhận 409.
8. **NCC lấy thêm**: chuyến của NCC A chỉ sang `TOP_UP_PENDING` khi mọi món dùng nguyên liệu của NCC A đã được duyệt. Chuyến có phần lấy thêm = 0 thì sang thẳng `READY_TO_DISPATCH`. NCC gửi số lượng sai kế hoạch thì nhận 409. Gửi lặp lại cùng body thì không cộng hai lần. Sau khi xác nhận, `supply_request_items.sample_top_up_quantity` bằng tổng lấy thêm của dòng đó.
9. **Vận chuyển**: chuyến `TOP_UP_PENDING` gọi `dispatch` thì nhận 409. Chuyến cũ (`preparationStage = NULL`) dispatch như trước.
10. **Kiểm nhận**: chuyến đạt thì lô `AVAILABLE` với số lượng đã gồm phần lấy thêm. Mẻ Đợt 1 đã duyệt vẫn ở "Đã duyệt Đợt 1" cho tới khi Đợt 2 xong. Chuyến cuối của ngày được nhận thì mọi mẻ đủ lô lên "Chính thức" (`CONFIRMED`).
11. **Hoàn thành**: mẻ chưa "Chính thức" gọi hoàn thành thì nhận 409. `COOKING_USAGE` của mỗi lô = `quantityUsed + sampleQuantity`. Phân bổ cho lớp không vượt `quantityUsed`.
12. **Đợt 2 trùng hết**: mọi mẻ Đợt 2 trùng khóa nguồn với mẻ Đợt 1 thì không tạo mẻ mới, chỉ tạo phần Đợt 2. Mọi chuyến Đợt 2 có phần lấy thêm = 0. Khi lên chính thức, số suất các mẻ Đợt 1 tăng đúng phần Đợt 2.
    12a. **Lô Đợt 2 bị từ chối sau khi Đợt 1 đã duyệt**: phần Đợt 2 và mẻ mới Đợt 2 dùng lô đó bị xóa. Mẻ Đợt 1 giữ nguyên trạng thái "Đã duyệt Đợt 1", không đổi số suất, lô và phần mẫu. NCC khai báo lô thay thế thì phần/mẻ Đợt 2 được lập lại ở "Chờ duyệt".
13. **Đợt 2 trùng một phần nguyên liệu**: gà cùng nguồn A nhưng rau khác nguồn thì tạo mẻ mới, có phần mẫu cho cả gà và rau.
14. **Đợt 1 cố định**: lập Đợt 2 không bao giờ làm giảm số suất, đổi lô hay xóa mẻ Đợt 1. Mẻ Đợt 1 chỉ bị xóa khi lô Đợt 1 bị từ chối, và khi đó phần Đợt 2 gắn vào mẻ cũng bị xóa rồi lập lại (D27).
15. **Giao lại**: chuyến bị từ chối thì NCC tạo được chuyến thay thế `REQUEST` với `replacesDeliveryId`, lô mới, ngày được điền sẵn. Chỉ mẻ dùng lô bị từ chối được lập lại. Phần mẫu của nguyên liệu không bị từ chối không bị tính lại. Lần từ chối thứ 3 thì đơn bị hủy, mẻ chờ chuyển `CANCELLED`.
16. **Dữ liệu cũ**: mẻ, chuyến giao và lô có trước migration giữ nguyên hành vi. `sample_quantity` của mẻ cũ là NULL/0, `preparation_stage = NULL`.

## 15. Ngoài phạm vi

- Ghi đè lượng mẫu theo từng món.
- Giao lại một phần (theo dòng) thay vì cả chuyến.
- Xử lý bữa thiếu món khi đơn bị hủy.
- Thông báo email/đẩy cho NCC và kho (chỉ hiển thị trong trang).
- Đơn giá và tính tiền đơn hàng (N6: để sau).
- **NCC khai báo chậm hoặc không khai báo** (N9: để sau). Món có NCC chưa khai báo sẽ đứng ở `WAITING_SUPPLIERS`. Bản này chưa có hạn chót, chưa có thông báo nhắc, và kho chưa được lập tay với lô hiện có. Màn kho chỉ hiển thị NCC nào còn thiếu.
- Triển khai migration lên Azure. Migration chỉ được viết, kiểm thử trên DB local tạm, theo `AGENTS.md`.

## 16. Hạn chế đã biết

- **Không bù chéo suất giữa các khối (D31, N21).** Đợt 2 tính riêng từng khối: `max(0, sĩ số thực tế − mốc Đợt 1)`. Khối thừa không được trừ sang khối thiếu. Ví dụ khối 1 thừa 10 suất, khối 2 thiếu 20 suất: Đợt 2 vẫn đặt đủ 20 suất cho khối 2, nên cả ngày dư 10 suất. Lý do: hai khối có thể khác thực đơn hoặc khác khẩu phần, nên trừ chéo không chính xác. Phần dư được nấu và không chia cho lớp nào.
- **Mẻ theo đợt có thể dư suất (D28).** Khối nghỉ quá nửa làm số suất mẻ Đợt 1 lớn hơn suất đã chốt. Bước hoàn thành chấp nhận "lớn hơn hoặc bằng" cho mẻ theo đợt. Báo cáo thừa suất chưa có trong bản này.
- **Lệch định lượng đặt hàng và tách mẻ cho suất ăn** (không phải phần mẫu). Đặt hàng tính theo khẩu phần từng khối, còn tách mẻ dùng định lượng đã chụp trong thực đơn. Thiếu thì món báo `PLAN_FAILED` để kho xử lý, dư thì thành tồn kho.
- **NCC khai báo chậm** (N9): món đứng ở `WAITING_SUPPLIERS`, chưa có hạn chót (mục 15).

## Hồi quy luồng demo thực tế

- Gửi tuần đầy đủ cho nhiều khối phải giữ nguyên kiểm tra quyền, định lượng, đơn vị, dị ứng và tính nguyên tử. Các lần tra cùng danh mục trong một transaction dùng chung kết quả xác thực thành công.
- Gia vị của một bữa giữ theo tổng suất cần phục vụ. Đợt 2 giữ thêm phần chênh lệch dương theo khối, bảo toàn lượng đã giữ đợt 1 và lượng mẫu đang lưu theo lô. Giữ đúng quy tắc nguồn của chế độ nấu.
- Bản chụp phân bổ mẻ theo đợt chỉ mô tả phần nguyên liệu được cấp theo mẻ. Khi đọc bản chụp cũ, gia vị thực sự được quản lý chung theo bữa không làm bộ phân bổ báo thiếu nguyên liệu của mẻ.
