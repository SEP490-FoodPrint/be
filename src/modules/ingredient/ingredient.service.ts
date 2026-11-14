import { cloudinaryUpload } from "../../utils/cloudinary-upload";
import type { ImageAsset } from "../../utils/cloudinary-upload.types";
import type { Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import {
  listScopes,
  ingredientManagementScope,
} from "../../utils/resource-access";
import {
  authorizationTransaction,
  databaseOperation,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import type { ListQuery } from "../../utils/list-query";
import type {
  IngredientCreateRequest,
  IngredientUpdateRequest,
  IngredientQueryRequest,
  IngredientParamsRequest,
  IngredientHideRequest,
  IngredientSingleUploadRequest,
  IngredientMultipleUploadRequest,
} from "./ingredient.request.dto";
import type {
  IngredientCategoryResponse,
  IngredientResponse,
  LegacyIngredientResponse,
  IngredientPageResponse,
  IngredientImageResponse,
  IngredientImagesResponse,
} from "./ingredient.response.dto";
import {
  ingredientRepository,
  type IngredientRepository,
  type IngredientRow,
  type IngredientCategoryRow,
  type LegacyIngredientRow,
} from "./ingredient.repository";

function imageDto(asset: ImageAsset): IngredientImageResponse {
  return {
    publicId: asset.publicId,
    url: asset.url,
    format: asset.format,
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
  };
}
function categoryDto(row: IngredientCategoryRow): IngredientCategoryResponse {
  return {
    id: row.id,
    categoryName: row.categoryName,
    categoryDescription: row.categoryDescription,
  };
}
function legacyDto(row: LegacyIngredientRow): LegacyIngredientResponse {
  return {
    id: row.id,
    supplierId: row.supplierId,
    supplierName: row.Supplier?.name ?? null,
    supplier: row.Supplier
      ? { id: row.Supplier.id, name: row.Supplier.name }
      : null,
    name: row.name,
    description: row.description ?? null,
    defaultUnit: row.defaultUnit,
    category: row.ingredientCategory?.categoryName ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function dto(row: IngredientRow): IngredientResponse {
  return {
    ...legacyDto(row),
    description: row.description,
    categoryId: row.categoryId,
    category: row.ingredientCategory
      ? categoryDto(row.ingredientCategory)
      : null,
    coverImage: row.coverImage,
    imageDescription: [...row.imageDescription],
  };
}
function page<T>(rows: T[], query: ListQuery): IngredientPageResponse<T> {
  return {
    items: rows.slice(0, query.limit),
    pagination: { ...query, hasNext: rows.length > query.limit },
  };
}
function found(row: IngredientRow | null): IngredientRow {
  if (!row) throw new HttpError(404, "Không tìm thấy nguyên liệu");
  return row;
}
export function createIngredientService(
  repo: IngredientRepository = ingredientRepository,
  connect = getPrisma,
  uploader: Pick<
    typeof cloudinaryUpload,
    "uploadImage" | "uploadImages"
  > = cloudinaryUpload,
) {
  async function scope(
    principal: AuthPrincipal,
    tx?: Prisma.TransactionClient,
  ) {
    const value = ingredientManagementScope(principal);
    const supplier = await repo.supplierStatus(value, tx);
    if (supplier?.status !== "ACTIVE")
      throw new HttpError(403, "Nhà cung cấp không hoạt động");
    return value;
  }
  async function write<T>(
    principal: AuthPrincipal,
    operation: (
      tx: Prisma.TransactionClient,
      value: ReturnType<typeof ingredientManagementScope>,
    ) => Promise<T>,
  ) {
    const original = ingredientManagementScope(principal);
    return authorizationTransaction(await connect(), async (tx) => {
      const actor = await repo.actor(principal.id, tx);
      const current = ingredientManagementScope(actor);
      if (current.supplierId !== original.supplierId)
        throw new HttpError(403, "Phạm vi tài khoản đã thay đổi");
      await repo.lockSupplier(current, tx);
      await scope(actor, tx);
      return operation(tx, current);
    });
  }
  async function checkCategory(
    categoryId: string | null | undefined,
    tx: Prisma.TransactionClient,
  ) {
    if (categoryId && !(await repo.categoryExists(categoryId, tx)))
      throw new HttpError(400, "Danh mục nguyên liệu không tồn tại");
  }
  async function currentUploadScope(principal: AuthPrincipal) {
    const original = ingredientManagementScope(principal);
    return databaseOperation(async () => {
      const actor = await repo.actor(principal.id);
      const current = await scope(actor);
      if (current.supplierId !== original.supplierId)
        throw new HttpError(403, "Phạm vi tài khoản đã thay đổi");
      return current;
    });
  }
  return {
    async authorizeUpload(principal: AuthPrincipal) {
      await databaseOperation(() => scope(principal));
    },
    async uploadImage(
      input: IngredientSingleUploadRequest,
      principal: AuthPrincipal,
    ): Promise<IngredientImageResponse> {
      const access = await currentUploadScope(principal);
      return imageDto(
        await uploader.uploadImage(input.file, {
          namespace: "ingredients",
          ownerId: access.supplierId,
        }),
      );
    },
    async uploadImages(
      input: IngredientMultipleUploadRequest,
      principal: AuthPrincipal,
    ): Promise<IngredientImagesResponse> {
      const access = await currentUploadScope(principal);
      const results = await uploader.uploadImages(input.files, {
        namespace: "ingredients",
        ownerId: access.supplierId,
      });
      return {
        results: results.map((result) =>
          result.status === "success"
            ? {
                index: result.index,
                status: "success",
                asset: imageDto(result.asset),
              }
            : {
                index: result.index,
                status: "failed",
                error: {
                  code: result.error.code,
                  message: result.error.message,
                },
              },
        ),
      };
    },
    async getAll(query: IngredientQueryRequest, principal: AuthPrincipal) {
      const access = listScopes.ingredient(principal);
      return databaseOperation(async () =>
        page((await repo.listLegacy(access, query)).map(legacyDto), query),
      );
    },
    async listManagement(
      query: IngredientQueryRequest,
      principal: AuthPrincipal,
    ) {
      return databaseOperation(async () =>
        page((await repo.list(await scope(principal), query)).map(dto), query),
      );
    },
    async listCategories(
      query: IngredientQueryRequest,
      principal: AuthPrincipal,
    ) {
      return databaseOperation(async () =>
        page(
          (await repo.categories(await scope(principal), query)).map(
            categoryDto,
          ),
          query,
        ),
      );
    },
    async getDetail(params: IngredientParamsRequest, principal: AuthPrincipal) {
      return databaseOperation(async () =>
        dto(
          found(await repo.find(await scope(principal), params.ingredientId)),
        ),
      );
    },
    create(input: IngredientCreateRequest, principal: AuthPrincipal) {
      return write(principal, async (tx, access) => {
        await checkCategory(input.categoryId, tx);
        return dto(await repo.create(access, input, tx));
      });
    },
    update(
      params: IngredientParamsRequest,
      input: IngredientUpdateRequest,
      principal: AuthPrincipal,
    ) {
      return write(principal, async (tx, access) => {
        await repo.lockTarget(access, params.ingredientId, tx);
        found(await repo.find(access, params.ingredientId, tx));
        await checkCategory(input.categoryId, tx);
        return dto(
          found(await repo.update(access, params.ingredientId, input, tx)),
        );
      });
    },
    hide(
      params: IngredientParamsRequest,
      _input: IngredientHideRequest,
      principal: AuthPrincipal,
    ) {
      return write(principal, async (tx, access) => {
        await repo.lockTarget(access, params.ingredientId, tx);
        found(await repo.find(access, params.ingredientId, tx));
        return dto(found(await repo.hide(access, params.ingredientId, tx)));
      });
    },
  };
}
export const ingredientService = createIngredientService();
export type IngredientService = ReturnType<typeof createIngredientService>;
