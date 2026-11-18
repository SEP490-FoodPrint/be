import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import type { AuthPrincipal } from "../src/types/auth";
import { HttpError } from "../src/utils/http-error";
import { createSystemComplaintService } from "../src/modules/system-complaint/system-complaint.service";
import type {
  SystemComplaintRepository,
  SystemComplaintRecord,
} from "../src/modules/system-complaint/system-complaint.repository";

const userA: AuthPrincipal = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "school-staff-a",
  fullName: "Nguyễn Văn A",
  roleId: "role-staff-1",
  role: "SCHOOL_KITCHEN_STAFF",
  orgType: "SCHOOL",
  schoolId: "school-1",
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: [],
};

const userB: AuthPrincipal = {
  id: "22222222-2222-4222-8222-222222222222",
  username: "school-staff-b",
  fullName: "Trần Thị B",
  roleId: "role-staff-2",
  role: "SCHOOL_KITCHEN_STAFF",
  orgType: "SCHOOL",
  schoolId: "school-2",
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: [],
};

const systemAdmin: AuthPrincipal = {
  id: "99999999-9999-4999-8999-999999999999",
  username: "system-admin",
  fullName: "Quản trị viên Hệ thống",
  roleId: "role-admin",
  role: "SYSTEM_ADMIN",
  orgType: "SYSTEM",
  schoolId: null,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["system_complaint.view", "system_complaint.respond"],
};

type StoredVersion = {
  id: string;
  complaintId: string;
  version: number;
  previousVersionId: string | null;
  content: string;
  changeReason: string | null;
  respondedByUserId: string | null;
  respondedRoleCode: string | null;
  createdAt: Date;
  respondedByUser: {
    id: string;
    fullName: string;
  } | null;
};

void test("System Complaint Module - Full Workflow & Isolation", async (t) => {
  const complaintsStore = new Map<string, SystemComplaintRecord>();
  const versionsStore = new Map<string, StoredVersion[]>();
  let currentSeq = 100n;

  const mockRepo: SystemComplaintRepository = {
    nextComplaintCodeSequence() {
      currentSeq++;
      return Promise.resolve(currentSeq);
    },

    create(_tx, input) {
      const id = "c6-" + input.complaintCode;
      const record: SystemComplaintRecord = {
        id,
        complaintCode: input.complaintCode,
        kind: "SYSTEM",
        senderUserId: input.senderUserId,
        senderRoleCode: input.senderRoleCode,
        senderSchoolId: input.senderSchoolId ?? null,
        senderSupplierId: input.senderSupplierId ?? null,
        senderCommuneFoodSafetyUnitId:
          input.senderCommuneFoodSafetyUnitId ?? null,
        title: input.title,
        description: input.description,
        status: "SUBMITTED",
        currentResponseVersionId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        senderUser: {
          id: input.senderUserId,
          fullName:
            input.senderUserId === userA.id ? userA.fullName : userB.fullName,
          email: "user@test.local",
        },
        currentResponseVersion: null,
      };
      complaintsStore.set(id, record);
      return Promise.resolve(record);
    },

    findById(_tx, id) {
      return Promise.resolve(complaintsStore.get(id) ?? null);
    },

    listOwn(_tx, userId, params) {
      const all = Array.from(complaintsStore.values()).filter(
        (c) => c.senderUserId === userId,
      );
      return Promise.resolve({
        items: all.slice(
          (params.page - 1) * params.limit,
          params.page * params.limit,
        ),
        total: all.length,
      });
    },

    listAll(_tx, params) {
      let all = Array.from(complaintsStore.values());
      if (params.status) {
        all = all.filter((c) => c.status === params.status);
      }
      return Promise.resolve({
        items: all.slice(
          (params.page - 1) * params.limit,
          params.page * params.limit,
        ),
        total: all.length,
      });
    },

    createResponseVersion(_tx, input) {
      const complaint = complaintsStore.get(input.complaintId);
      if (!complaint) return Promise.reject(new Error("Not found"));

      const versionRecord: StoredVersion = {
        id: `v-${input.version}-${complaint.id}`,
        complaintId: input.complaintId,
        version: input.version,
        previousVersionId: input.previousVersionId ?? null,
        content: input.content,
        changeReason: input.changeReason ?? null,
        respondedByUserId: input.respondedByUserId,
        respondedRoleCode: input.respondedRoleCode ?? null,
        createdAt: new Date(),
        respondedByUser: {
          id: systemAdmin.id,
          fullName: systemAdmin.fullName,
        },
      };

      const existingVersions = versionsStore.get(input.complaintId) ?? [];
      existingVersions.push(versionRecord);
      versionsStore.set(input.complaintId, existingVersions);

      complaint.status = "RESPONDED";
      complaint.currentResponseVersionId = versionRecord.id;
      complaint.currentResponseVersion = versionRecord;

      return Promise.resolve({
        versionRecord,
        updatedComplaint: complaint,
      });
    },

    listResponseVersions(_tx, complaintId) {
      return Promise.resolve(versionsStore.get(complaintId) ?? []);
    },
  };

  const fakeDb = {
    $transaction<T>(
      fn: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> {
      return fn({} as Prisma.TransactionClient);
    },
  } as unknown as PrismaClient;

  const service = createSystemComplaintService(mockRepo, () =>
    Promise.resolve(fakeDb),
  );

  let complaintAId = "";

  await t.test("US1: User A tạo khiếu nại C06 thành công", async () => {
    const res = await service.create(
      {
        title: "Lỗi hiển thị danh sách thực đơn",
        description: "Khi bấm vào trang thực đơn màn hình bị trắng tinh",
      },
      userA,
    );
    assert.equal(res.kind, "SYSTEM");
    assert.equal(res.complaintCode, "FP-CP-00101");
    assert.equal(res.status, "SUBMITTED");
    assert.equal(res.sender.id, userA.id);
    assert.equal(res.currentResponse, null);
    complaintAId = res.id;
  });

  await t.test(
    "US2: Isolation - User B không xem được đơn của User A",
    async () => {
      await assert.rejects(
        () => service.getDetail(complaintAId, userB),
        (err: unknown) =>
          err instanceof HttpError &&
          err.statusCode === 404 &&
          err.message.includes("Không tìm thấy"),
      );
    },
  );

  await t.test("US2: User A xem được đơn của chính mình", async () => {
    const detail = await service.getDetail(complaintAId, userA);
    assert.equal(detail.id, complaintAId);
    assert.equal(detail.title, "Lỗi hiển thị danh sách thực đơn");

    const ownList = await service.listOwn({ page: 1, limit: 10 }, userA);
    assert.equal(ownList.total, 1);
    assert.equal(ownList.items[0].id, complaintAId);
  });

  await t.test(
    "US3: System Admin xem chi tiết và phản hồi lần đầu (v1)",
    async () => {
      const detail = await service.getDetail(complaintAId, systemAdmin);
      assert.equal(detail.id, complaintAId);

      const responded = await service.respond(
        complaintAId,
        {
          content:
            "Bộ phận kỹ thuật đã tiếp nhận và đang tiến hành sửa lỗi trong bản cập nhật chiều nay.",
        },
        systemAdmin,
      );

      assert.equal(responded.status, "RESPONDED");
      assert(responded.currentResponse !== null);
      assert.equal(responded.currentResponse.version, 1);
      assert.equal(responded.currentResponse.changeReason, null);
      assert.equal(
        responded.currentResponse.respondedBy?.fullName,
        systemAdmin.fullName,
      );
    },
  );

  await t.test(
    "US3: Sửa phản hồi lần 2 bắt buộc phải có changeReason",
    async () => {
      await assert.rejects(
        () =>
          service.respond(
            complaintAId,
            {
              content: "Nội dung cập nhật mới",
              changeReason: "",
            },
            systemAdmin,
          ),
        (err: unknown) =>
          err instanceof HttpError &&
          err.statusCode === 400 &&
          err.message.includes("changeReason"),
      );
    },
  );

  await t.test(
    "US3: Sửa phản hồi lần 2 có changeReason tạo version 2",
    async () => {
      const updatedV2 = await service.respond(
        complaintAId,
        {
          content: "Lỗi đã được khắc phục hoàn toàn trên production v1.2.3.",
          changeReason: "Cập nhật kết quả sau khi deploy hotfix",
        },
        systemAdmin,
      );

      assert.equal(updatedV2.status, "RESPONDED");
      assert(updatedV2.currentResponse !== null);
      assert.equal(updatedV2.currentResponse.version, 2);
      assert.equal(
        updatedV2.currentResponse.changeReason,
        "Cập nhật kết quả sau khi deploy hotfix",
      );
    },
  );

  await t.test("US3: Xem lịch sử các phiên bản phản hồi", async () => {
    const { versions } = await service.listVersions(complaintAId, userA);
    assert.equal(versions.length, 2);
    assert.equal(versions[0].version, 1);
    assert.equal(versions[1].version, 2);
  });
});
