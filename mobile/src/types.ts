export type Role = "seeker" | "housekeeper";
export interface User { id: number; email: string; name: string; role: Role }
export interface Profile {
  city: string; phone: string; rate: number; exp: number; avail: string; services: string[]; bio: string;
}
export interface Housekeeper {
  id: number; name: string; city: string; rate: number; exp: number; avail: string;
  services: string[]; bio: string; rating: number | null; reviews: number;
}
export interface Meta { services: string[]; availability: string[] }
export type RequestStatus = "pending" | "accepted" | "declined";
export interface SeekerRequest {
  id: number; status: RequestStatus; when: string; note: string; created_at: string;
  hk_id: number; hk_name: string; hk_phone: string | null; my_rating: number | null;
}
export interface HousekeeperRequest {
  id: number; status: RequestStatus; when: string; note: string; created_at: string;
  seeker_name: string; seeker_phone: string;
}
