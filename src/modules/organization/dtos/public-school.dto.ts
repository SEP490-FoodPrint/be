export interface PublicSchoolDTO {
  id: string;
  code: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  locationId: string | null;
  address: string;
  district: string | null;
  city: string;
  websiteUrl: string | null;
  description: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  cookingMode: string | null;
  lunchTime: string | null;
  afternoonMealTime: string | null;
  boardingScale: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicSchoolListResult {
  items: PublicSchoolDTO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
  };
}

export interface PublicLocationDTO {
  city: string;
  districts: string[];
}

export type SchoolQueryResult = {
  id: string;
  code: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  locationId: string | null;
  address: string | null;
  websiteUrl: string | null;
  description: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  cookingMode: string | null;
  lunchTime: Date | null;
  afternoonMealTime: Date | null;
  boardingScale: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  location?: {
    id: string;
    code: string;
    name: string;
    type: string;
    level: number;
    parent?: {
      id: string;
      code: string;
      name: string;
      type: string;
    } | null;
  } | null;
  classes?: Array<{ registeredMealPortions: number }>;
};
