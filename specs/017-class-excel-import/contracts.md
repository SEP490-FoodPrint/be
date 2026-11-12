# Contracts: Nhập danh sách lớp học từ Excel

## `POST /api/classes/import`

Permission: `class.manage` (thêm `class_assignment.manage` khi có dòng điền `teacherUsername`). Role: `SCHOOL_MANAGEMENT_BOARD`.

### Request

```json
{
  "academicYear": "2026-2027",
  "dryRun": true,
  "rows": [
    {
      "rowNumber": 2,
      "name": "1A",
      "registeredMealPortions": 35,
      "teacherUsername": "gv.lan"
    },
    {
      "rowNumber": 3,
      "name": "1B",
      "registeredMealPortions": "32",
      "teacherUsername": null
    }
  ]
}
```

- `rows`: 1–300 phần tử, `z.strictObject`.
- `rowNumber`: số nguyên ≥ 1.
- `name`: chuỗi, tối đa 500 ký tự trước khi trim (độ dài hợp lệ 1–120 được kiểm tra theo từng dòng).
- `registeredMealPortions`: số, chuỗi hoặc `null`, tùy chọn.
- `teacherUsername`: chuỗi tối đa 120 ký tự hoặc `null`, tùy chọn.

### Response 200 (`dryRun: true`) / 201 (`dryRun: false`)

```json
{
  "academicYear": "2026-2027",
  "dryRun": true,
  "summary": { "create": 1, "skip": 1, "error": 0 },
  "rows": [
    {
      "rowNumber": 2,
      "name": "1A",
      "registeredMealPortions": 35,
      "teacher": {
        "id": "…",
        "fullName": "Nguyễn Thị Lan",
        "username": "gv.lan"
      },
      "status": "CREATE",
      "errors": []
    },
    {
      "rowNumber": 3,
      "name": "1B",
      "registeredMealPortions": 32,
      "teacher": null,
      "status": "SKIP",
      "errors": ["Lớp đã tồn tại trong niên khóa"]
    }
  ],
  "created": []
}
```

`created` chỉ có phần tử khi `dryRun: false`.

### Lỗi

| Status | Khi nào                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------- |
| 400    | Body sai cấu trúc, thừa trường, `rows` rỗng hoặc hơn 300 dòng                                      |
| 403    | Không phải BGH, thiếu `class.manage`, hoặc có `teacherUsername` mà thiếu `class_assignment.manage` |
| 409    | Niên khóa chưa cấu hình / đã qua; lưu (`dryRun: false`) khi còn dòng `ERROR`                       |
