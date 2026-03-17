export interface ReviewInput {
  author: string;
  rating: number;
  text: string;
  date?: string;
  isLocalGuide?: boolean;
}

export interface PhotoInput {
  filename: string;
  publicUrl: string;
  sourceUrl: string;
  sizeBytes: number;
}

export interface BusinessInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  categories?: string[];
  googleRating?: number | null;
  reviewCount?: number | null;
  googleMapsUrl?: string | null;
  reviews?: ReviewInput[] | unknown;
  photos?: PhotoInput[] | unknown;
  aiInsights?: AiInsightsInput | null;
}

export interface AiInsightsInput {
  designQuality?: string;
  contentQuality?: string;
  services?: string[];
  uniqueSellingPoints?: string[];
  painPoints?: string[];
  outreachAngles?: string[];
  summary?: string;
}
