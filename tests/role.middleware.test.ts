import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import express, { type RequestHandler } from "express";
import type { JwtPayload } from "jsonwebtoken";
import { ORG_TYPES, ROLES } from "../src/constants/roles";
import { requireOrg, requireRoles } from "../src/middlewares/role.middleware";
import { startHttp } from "./helpers/http";

interface Policy {
  claim: "role" | "orgType";
  guard: (allowed: readonly string[]) => RequestHandler;
  allowed: string;
  claimValue: string;
  legacyClaim?: string;
  disallowed: string;
  message: string;
  requiredKey: string;
  currentKey: string;
}

const policies: Policy[] = [
  {
    claim: "role",
    guard: requireRoles,
    allowed: ROLES.SCHOOL_ADMINISTRATION,
    claimValue: "SCHOOL_ADMINISTRATION",
    legacyClaim: "SCHOOL_ADMIN",
    disallowed: ROLES.SYSTEM_ADMIN,
    message: "Bạn không có quyền thực hiện thao tác này (403)",
    requiredKey: "requiredRoles",
    currentKey: "currentRole",
  },
  {
    claim: "orgType",
    guard: requireOrg,
    allowed: ORG_TYPES.SCHOOL,
    claimValue: "SCHOOL",
    disallowed: ORG_TYPES.SUPPLIER,
    message: "Tài khoản không thuộc phân hệ tổ chức này (403)",
    requiredKey: "requiredOrgs",
    currentKey: "currentOrg",
  },
  {
    claim: "role",
    guard: requireRoles,
    allowed: ROLES.COMMUNE_FOOD_SAFETY_OFFICER,
    claimValue: "COMMUNE_FOOD_SAFETY_OFFICER",
    legacyClaim: "HEALTH_OFFICER",
    disallowed: ROLES.SCHOOL_ADMINISTRATION,
    message: "Bạn không có quyền thực hiện thao tác này (403)",
    requiredKey: "requiredRoles",
    currentKey: "currentRole",
  },
  {
    claim: "orgType",
    guard: requireOrg,
    allowed: ORG_TYPES.AUTHORITY,
    claimValue: "AUTHORITY",
    legacyClaim: "GOVERNMENT",
    disallowed: ORG_TYPES.SCHOOL,
    message: "Tài khoản không thuộc phân hệ tổ chức này (403)",
    requiredKey: "requiredOrgs",
    currentKey: "currentOrg",
  },
];

async function fixture(
  context: TestContext,
  policy: Policy,
  user: JwtPayload | undefined,
  allowed: readonly string[] = [policy.allowed],
) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.get("/restricted", policy.guard(allowed), (_req, res) => {
    res.sendStatus(204);
  });
  const http = await startHttp(app);
  context.after(() => http.close());
  return http;
}

for (const policy of policies) {
  void test(`${policy.claim} ${policy.claimValue}: unauthenticated requests retain the 401 envelope`, async (context) => {
    for (const allowed of [[policy.allowed], []]) {
      const http = await fixture(context, policy, undefined, allowed);
      const response = await http.request("/restricted");
      assert.equal(response.status, 401);
      assert.deepEqual(response.body, {
        success: false,
        statusCode: 401,
        message: "Chưa xác thực người dùng",
      });
    }
  });

  void test(`${policy.claim} ${policy.claimValue}: an allowed SQL claim reaches the handler`, async (context) => {
    const http = await fixture(context, policy, {
      [policy.claim]: policy.claimValue,
    });
    assert.equal((await http.request("/restricted")).status, 204);
  });

  void test(`${policy.claim} ${policy.claimValue}: malformed, legacy, or unmatched claims retain the 403 envelope`, async (context) => {
    for (const value of [
      undefined,
      null,
      "",
      0,
      1,
      true,
      false,
      [],
      [policy.allowed],
      { value: policy.allowed },
      "UNKNOWN_CLAIM",
      policy.disallowed,
      ...(policy.legacyClaim ? [policy.legacyClaim] : []),
    ]) {
      const http = await fixture(context, policy, { [policy.claim]: value });
      const response = await http.request("/restricted");
      assert.equal(response.status, 403);
      const details: Record<string, unknown> = {
        [policy.requiredKey]: [policy.allowed],
      };
      if (value !== undefined) details[policy.currentKey] = value;
      assert.deepEqual(response.body, {
        success: false,
        statusCode: 403,
        message: policy.message,
        error: details,
      });
    }
  });

  void test(`${policy.claim} ${policy.claimValue}: an explicit empty allowlist preserves existing unrestricted behavior`, async (context) => {
    const http = await fixture(context, policy, {}, []);
    assert.equal((await http.request("/restricted")).status, 204);
  });
}
