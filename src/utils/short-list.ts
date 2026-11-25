/** Rút gọn danh sách trong thông báo: hiện tối đa `limit` mục rồi "và N mục khác". */
export function shortList(
  items: readonly string[],
  separator = ", ",
  limit = 2,
): string {
  const shown = items.slice(0, limit).join(separator);
  const rest = items.length - limit;
  return rest > 0 ? `${shown} và ${rest} mục khác` : shown;
}
