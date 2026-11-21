/** Đơn vị ATTP sau khi gắn phường/xã phụ trách. */
export interface AuthorityLocationResponseDTO {
  id: string;
  code: string;
  name: string;
  status: string;
  location: { id: string; code: string; name: string };
}
