import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import { readListPage, type ListPage } from "../../utils/list-query";
import {
  registrationRepository,
  type RegistrationListRow,
  type RegistrationRepository,
} from "./registration.repository";
import type { RegistrationListRequestDTO } from "./registration.request.dto";
import type { RegistrationListResponseDTO } from "./registration.response.dto";

function toRegistrationListResponseDTO(
  page: ListPage<RegistrationListRow>,
): RegistrationListResponseDTO {
  return {
    items: page.items.map((row) => ({
      id: row.id,
      applicantUserId: row.applicantUserId,
      applicantUser: {
        id: row.applicantUser.id,
        username: row.applicantUser.username,
        fullName: row.applicantUser.fullName,
        email: row.applicantUser.email,
        phone: row.applicantUser.phone,
        status: row.applicantUser.status,
        emailVerifiedAt:
          row.applicantUser.emailVerifiedAt?.toISOString() ?? null,
      },
      requestType: row.requestType,
      status: row.status,
      submittedAt: row.submittedAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    })),
    pagination: {
      page: page.pagination.page,
      limit: page.pagination.limit,
      hasNext: page.pagination.hasNext,
    },
  };
}

export function createRegistrationService(
  repository: RegistrationRepository = registrationRepository,
) {
  return {
    getAll(
      query: RegistrationListRequestDTO,
      principal: AuthPrincipal,
    ): Promise<RegistrationListResponseDTO> {
      listScopes.registration(principal);
      return readListPage(
        () => repository.listForReview(query, principal),
        query,
      ).then(toRegistrationListResponseDTO);
    },
  };
}

export const registrationService = createRegistrationService();
export type RegistrationService = ReturnType<typeof createRegistrationService>;
