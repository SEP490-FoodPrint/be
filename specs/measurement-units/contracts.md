# Contract

GET /api/measurement-units: page=1, limit=20 (max100), search?, group=MASS|VOLUME|COUNT|OTHER?, status=ACTIVE|INACTIVE|ALL (defaultACTIVE). Response data {items:[{id,code,name,symbol,group,recommendedStep,status,aliases,createdAt,updatedAt}],pagination:{page,limit,total,totalPages}}.
GET /:id trả một DTO. POST nhận code/name/symbol/group/recommendedStep, aliases optional array (default[]). PATCH chỉ name/recommendedStep/status, ít nhất một trường. Decimal numeric input hoặc chuỗi, chuẩn hóa chuỗi; tối đa 11 chữ số nguyên và 3 thập phân, >0. Mã/ký hiệu/alias chuẩn hóa NFC trim lower, unique, tối đa30; code chỉ lowercase ASCII [a-z0-9_-]. Alias bất biến. Tài khoản chưa đăng nhập 401, không đủ quyền ghi403, không tồn tại404, trùng409. Không chặn số lượng nhập hàng lệch bước.
