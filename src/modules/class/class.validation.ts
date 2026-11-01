import { objectBody, uuid } from "../../utils/auth-validation";
import { parseListQuery } from "../../utils/list-query";
import { parseAcademicYear } from "./academic-year";

export function validateClassListQuery(query: Record<string, unknown>) {
  const { academicYear, ...paging } = query;
  return {
    ...parseListQuery(paging),
    academicYear: parseAcademicYear(academicYear),
  };
}

export type ClassListQuery = ReturnType<typeof validateClassListQuery>;

export function validateClassId(value: unknown): string {
  return uuid(value);
}

export function validateHomeroomAssignment(body: unknown) {
  const data = objectBody(body ?? {}, ["teacherUserId"]);
  return { teacherUserId: uuid(data.teacherUserId) };
}
